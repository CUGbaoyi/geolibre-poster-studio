import test from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { decodeCityPackage, sha256 } from "../src/offline-package";
import { readOfflineMap, type CityStore } from "../src/offline-store";
import type { MapData } from "../src/model";

async function fixture() {
  const maps: MapData[] = [0, 1].map((i) => ({
    name: "苏州",
    bounds: [120.6 + i * 0.01, 31.3, 120.61 + i * 0.01, 31.31],
    center: [120.605 + i * 0.01, 31.305],
    source: "https://example.org/jiangsu.osm.pbf",
    fetchedAt: "2026-10-12T00:00:00Z",
    snapshotAt: "2026-10-11T00:00:00Z",
    geojson: {
      type: "FeatureCollection",
      features: i
        ? []
        : [
            {
              type: "Feature",
              id: "way/1",
              properties: { highway: "primary" },
              geometry: {
                type: "LineString",
                coordinates: [
                  [120.601, 31.301],
                  [120.609, 31.309],
                ],
              },
            },
          ],
    },
  }));
  const entries: Record<string, Uint8Array> = {};
  const tiles = await Promise.all(
    maps.map(async (map, i) => {
      const data = strToU8(JSON.stringify(map)),
        file = `tiles/${i}.json`;
      entries[file] = data;
      return {
        file,
        bytes: data.length,
        sha256: await sha256(data),
        features: map.geojson.features.length,
      };
    })
  );
  const manifest = {
    format: "geolibre-poster-city",
    version: 1,
    bounds: [120.6, 31.3, 120.62, 31.31],
    place: {
      name: "苏州",
      subtitle: "苏州",
      title: "SUZHOU",
      lon: 120.605,
      lat: 31.305,
    },
    coverageLabel: "测试范围",
    source: maps[0].source,
    fetchedAt: maps[0].fetchedAt,
    snapshotAt: maps[0].snapshotAt,
    attribution: "© OpenStreetMap contributors",
    license: "ODbL-1.0",
    columns: 2,
    rows: 1,
    tiles,
  };
  const zip = () =>
    zipSync({ ...entries, "manifest.json": strToU8(JSON.stringify(manifest)) });
  return { entries, manifest, maps, zip };
}

test("portable package loads roads and legitimate empty tiles offline; digest provides repeatable identity", async () => {
  const f = await fixture(),
    bytes = f.zip();
  const { pack, maps } = await decodeCityPackage(bytes);
  assert.equal((await decodeCityPackage(bytes)).pack.id, pack.id);
  assert.deepEqual(pack.completed, [0, 1]);
  const store: CityStore = {
    list: async () => [pack],
    tile: async (_id, i) => maps[i],
    save: async () => {},
    commit: async () => {
      throw new Error("No network/storage writes during read");
    },
  };
  const map = await readOfflineMap(pack.place, pack.bounds, store);
  assert.equal(map!.geojson.features.length, 1);
  assert.equal(map!.snapshotAt, "2026-10-11T00:00:00Z");
  assert.equal(map!.fetchedAt, "2026-10-12T00:00:00Z");
  assert.equal(
    await readOfflineMap(pack.place, [120.5, 31.3, 120.62, 31.31], store),
    undefined
  );
});

test("rejects incomplete, corrupt or incompatible packages", async () => {
  for (const kind of [
    "missing",
    "corrupt",
    "version",
    "grid",
    "extra",
    "path",
  ]) {
    const f = await fixture();
    if (kind === "missing") delete f.entries["tiles/1.json"];
    if (kind === "corrupt") f.entries["tiles/0.json"][10] ^= 1;
    if (kind === "version") f.manifest.version = 2;
    if (kind === "grid") f.manifest.columns = 3;
    if (kind === "extra") f.entries["extra.js"] = strToU8("unused");
    if (kind === "path") f.manifest.tiles[0].file = "../tiles/0.json";
    await assert.rejects(decodeCityPackage(f.zip()), /./, kind);
  }
  await assert.rejects(decodeCityPackage(strToU8("not a zip")));
});

test("rejects geometry corruption and coverage gaps even when hashes match", async () => {
  for (const kind of ["geometry", "bounds", "date", "id"]) {
    const f = await fixture();
    if (kind === "geometry")
      f.maps[0].geojson.features[0].geometry = {
        type: "Point",
        coordinates: [999, 32],
      };
    if (kind === "bounds") f.maps[0].bounds[2] -= 0.001;
    if (kind === "date") f.maps[0].snapshotAt = "2020-01-01T00:00:00Z";
    if (kind === "id") f.maps[0].geojson.features[0].id = "wrong";
    const raw = strToU8(JSON.stringify(f.maps[0]));
    f.entries["tiles/0.json"] = raw;
    f.manifest.tiles[0].bytes = raw.length;
    f.manifest.tiles[0].sha256 = await sha256(raw);
    await assert.rejects(decodeCityPackage(f.zip()), /地图数据或覆盖范围无效/);
  }
});

test("bounds decompression before allocating large tile output", async () => {
  const zip = zipSync({ "too-large.json": new Uint8Array(17 * 1024 * 1024) });
  await assert.rejects(decodeCityPackage(zip), /解压后过大/);
});
