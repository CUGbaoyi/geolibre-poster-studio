"""Build a Suzhou 40 km poster package from a checksum-verified Jiangsu PBF.

Requires osmium==4.3.1 and shapely==2.2.0 in a separate Python environment.
Areas are assembled from complete ways/relations before spatial selection;
tile payloads keep complete geometries (including holes), and share OSM IDs.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import zipfile

import osmium
from shapely.geometry import box, shape, mapping, Polygon
from shapely import make_valid

def compact(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(',', ':')).encode()

def kind(tags):
    if tags.get('building') and tags['building'] != 'no': return 'building'
    if tags.get('natural') == 'water' or tags.get('water') or tags.get('waterway') == 'riverbank' or tags.get('landuse') == 'reservoir': return 'water'
    if tags.get('waterway'): return 'waterline'
    if tags.get('highway'): return 'road'
    if tags.get('leisure') in ['park', 'garden', 'golf_course', 'nature_reserve', 'recreation_ground'] or tags.get('landuse') in ['forest', 'grass', 'meadow', 'village_green', 'orchard', 'recreation_ground'] or tags.get('natural') in ['wood', 'grassland', 'scrub', 'wetland']: return 'park'
    if tags.get('landuse') and tags['landuse'] not in ['construction', 'military']: return 'land'
    return ''

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pbf', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    source = json.loads(args.pbf.with_suffix('.source.json').read_text())
    if hashlib.md5(args.pbf.read_bytes()).hexdigest() != source['md5']:
        raise ValueError('PBF checksum failed')
    with osmium.io.Reader(str(args.pbf)) as reader:
        snapshot = reader.header().get('osmosis_replication_timestamp')
    if not snapshot:
        raise ValueError('PBF lacks a replication timestamp; do not substitute the download date')
    center = (120.62, 31.31)
    width = 40
    dx = width / (111.32 * math.cos(math.radians(center[1]))) / 2
    dy = width / 111.32 / 2
    bounds = [center[0] - dx, center[1] - dy, center[0] + dx, center[1] + dy]
    n = 10
    cells = [[bounds[0] + (bounds[2] - bounds[0]) * x / n,
              bounds[1] + (bounds[3] - bounds[1]) * y / n,
              bounds[0] + (bounds[2] - bounds[0]) * (x + 1) / n,
              bounds[1] + (bounds[3] - bounds[1]) * (y + 1) / n]
             for y in range(n) for x in range(n)]
    extent = box(*bounds)
    cell_shapes = [box(*b) for b in cells]
    tiles = [[] for _ in cells]
    stats = Counter()
    ids = set()
    factory = osmium.geom.GeoJSONFactory()
    errors = []

    def add(obj, tags, category, area=False, polygon=False):
        ident = f'{"way" if not area or obj.from_way() else "relation"}/{obj.orig_id() if area else obj.id}'
        if ident in ids: return
        try:
            if polygon:
                geom = Polygon([(node.lon, node.lat) for node in obj.nodes])
            else:
                raw = factory.create_multipolygon(obj) if area else factory.create_linestring(obj)
                geom = shape(json.loads(raw))
        except (RuntimeError, ValueError, osmium.InvalidLocationError) as exc:
            error = {'id': ident, 'error': str(exc)}
            nodes = [node for ring in obj.outer_rings() for node in ring] if area else obj.nodes
            known = [(node.lon, node.lat) for node in nodes if node.location.valid()]
            if known:
                known_bounds = [min(p[0] for p in known), min(p[1] for p in known),
                                max(p[0] for p in known), max(p[1] for p in known)]
                error['knownBounds'] = known_bounds
                if extent.intersects(box(*known_bounds)):
                    raise ValueError(f'Incomplete geometry in selected city: {ident} {known_bounds}') from exc
            errors.append(error)
            return
        if not extent.intersects(geom): return
        if not geom.is_valid:
            geom = make_valid(geom)
            stats['repaired'] += 1
        if geom.geom_type not in ['Polygon', 'MultiPolygon', 'LineString', 'MultiLineString']:
            errors.append({'id': ident, 'error': f'Unsupported repaired geometry {geom.geom_type}'})
            return
        feature = {'type': 'Feature', 'id': ident, 'geometry': mapping(geom), 'properties': {
            k: v for k, v in tags.items() if k in ['building', 'highway', 'water', 'waterway', 'landuse', 'leisure', 'natural']}}
        minx, miny, maxx, maxy = geom.bounds
        x0 = max(0, math.floor((minx - bounds[0]) / (bounds[2] - bounds[0]) * n))
        x1 = min(n - 1, math.floor((maxx - bounds[0]) / (bounds[2] - bounds[0]) * n))
        y0 = max(0, math.floor((miny - bounds[1]) / (bounds[3] - bounds[1]) * n))
        y1 = min(n - 1, math.floor((maxy - bounds[1]) / (bounds[3] - bounds[1]) * n))
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                i = y * n + x
                if cell_shapes[i].intersects(geom): tiles[i].append(feature)
        ids.add(ident)
        stats[category] += 1

    print('Reading complete OSM geometries and assembling multipolygons…', flush=True)
    processor = osmium.FileProcessor(str(args.pbf)).with_areas().with_filter(osmium.filter.EntityFilter(osmium.osm.WAY | osmium.osm.AREA))
    for obj in processor:
        tags = dict(obj.tags)
        category = kind(tags)
        if not category: continue
        if obj.is_area():
            # Closed ways are handled directly so self-crossing OSM rings can
            # be repaired instead of disappearing during area assembly.
            if obj.from_way(): continue
            if tags.get('area') == 'no' or category in ['road', 'waterline']: continue
            add(obj, tags, category, True)
        elif obj.is_way():
            polygon = obj.is_closed() and tags.get('area') != 'no' and category not in ['road', 'waterline']
            add(obj, tags, category, polygon=polygon)
    manifest = {'format': 'geolibre-poster-city', 'version': 1,
                'place': {'name': '苏州 Suzhou', 'title': 'SUZHOU', 'subtitle': '苏州', 'lon': center[0], 'lat': center[1]},
                'bounds': bounds, 'columns': n, 'rows': n,
                'coverageLabel': '苏州城区 40 × 40 km · 矩形范围',
                'source': source['url'], 'sourcePbfSha256': source['sha256'],
                'fetchedAt': source['downloadedAt'], 'snapshotAt': snapshot,
                'createdAt': datetime.now(timezone.utc).isoformat(),
                'attribution': '© OpenStreetMap contributors https://www.openstreetmap.org/copyright',
                'license': 'ODbL-1.0', 'tiles': []}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(args.output, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for i, (b, features) in enumerate(zip(cells, tiles)):
            filename = f'tiles/{i}.json'
            data = compact({'name': '苏州 Suzhou', 'bounds': b, 'center': [(b[0] + b[2])/2, (b[1] + b[3])/2],
                            'source': manifest['source'], 'fetchedAt': manifest['fetchedAt'], 'snapshotAt': snapshot,
                            'geojson': {'type': 'FeatureCollection', 'features': features}})
            if len(data) >= 16_000_000 or len(features) > 100_000: raise ValueError(f'Tile {i} too large')
            manifest['tiles'].append({'file': filename, 'bytes': len(data), 'features': len(features), 'sha256': hashlib.sha256(data).hexdigest()})
            archive.writestr(filename, data)
        archive.writestr('manifest.json', compact(manifest))
    report = {'package': str(args.output), 'bounds': bounds, 'coverage': manifest['coverageLabel'], 'snapshotAt': snapshot,
              'features': len(ids), 'counts': dict(stats), 'tiles': len(tiles), 'emptyTiles': sum(not t for t in tiles),
              'bytes': args.output.stat().st_size, 'expandedBytes': sum(t['bytes'] for t in manifest['tiles']),
              'sha256': hashlib.sha256(args.output.read_bytes()).hexdigest(), 'geometryErrorsProvinceWide': errors}
    args.output.with_suffix('.report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps({**report, 'geometryErrorsProvinceWide': len(errors)}, ensure_ascii=False), flush=True)

if __name__ == '__main__':
    main()
