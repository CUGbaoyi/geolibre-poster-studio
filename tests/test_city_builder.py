"""Regression: keep crossing ways and relation holes when selecting/tessellating."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

import osmium

class CityBuilderTest(unittest.TestCase):
    def test_geometry_and_provenance(self):
        with tempfile.TemporaryDirectory() as temp:
            pbf = Path(temp) / 'sample.osm.pbf'
            header = osmium.io.Header()
            header.set('osmosis_replication_timestamp', '2026-10-11T00:00:00Z')
            # Road has both endpoints outside the city box but crosses it.
            coords = [(120.0,31.31),(121.2,31.31),
                      (120.61,31.30),(120.63,31.30),(120.63,31.32),(120.61,31.32),
                      (120.615,31.305),(120.625,31.305),(120.625,31.315),(120.615,31.315),
                      (120.65,31.30),(120.66,31.31),(120.65,31.31),(120.66,31.30)]
            with osmium.SimpleWriter(str(pbf), header=header) as writer:
                for i, coord in enumerate(coords, 1):
                    writer.add_node(osmium.osm.mutable.Node(id=i, location=coord))
                writer.add_way(osmium.osm.mutable.Way(id=1, nodes=[1,2], tags={'highway':'primary'}))
                writer.add_way(osmium.osm.mutable.Way(id=2, nodes=[3,4,5,6,3]))
                writer.add_way(osmium.osm.mutable.Way(id=3, nodes=[7,8,9,10,7]))
                writer.add_way(osmium.osm.mutable.Way(id=4, nodes=[11,12,13,14,11], tags={'landuse':'grass'}))
                writer.add_relation(osmium.osm.mutable.Relation(id=4,
                    members=[('w',2,'outer'),('w',3,'inner')], tags={'type':'multipolygon','natural':'water'}))
            pbf.with_suffix('.source.json').write_text(json.dumps({
                'md5':hashlib.md5(pbf.read_bytes()).hexdigest(),
                'sha256':hashlib.sha256(pbf.read_bytes()).hexdigest(),
                'url':'https://example.org/fixture.pbf','downloadedAt':'2026-10-12T00:00:00Z'}))
            output = Path(temp) / 'test.poster-city.zip'
            subprocess.run([sys.executable,str(Path(__file__).resolve().parents[1] / 'scripts/build-city-package.py'),
                            str(pbf),'--output',str(output)],check=True,capture_output=True)
            with zipfile.ZipFile(output) as archive:
                manifest=json.loads(archive.read('manifest.json'))
                self.assertEqual(manifest['snapshotAt'],'2026-10-11T00:00:00Z')
                self.assertEqual(len(manifest['tiles']),100)
                features={}
                road_tiles=0
                for tile in manifest['tiles']:
                    data=archive.read(tile['file'])
                    self.assertEqual(hashlib.sha256(data).hexdigest(),tile['sha256'])
                    fs=json.loads(data)['geojson']['features']
                    features.update({f['id']:f for f in fs})
                    road_tiles+=any(f['id']=='way/1' for f in fs)
                self.assertGreaterEqual(road_tiles,10)
                self.assertEqual(len(features['relation/4']['geometry']['coordinates'][0]),2)
                self.assertEqual(features['way/1']['geometry']['coordinates'],[[120.0,31.31],[121.2,31.31]])
                self.assertEqual(features['way/4']['geometry']['type'],'MultiPolygon')

if __name__=='__main__':
    unittest.main()
