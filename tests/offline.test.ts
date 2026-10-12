import test from "node:test";
import assert from "node:assert/strict";
import {
  createCityPack,
  packReady,
  readOfflineMap,
  type CityStore,
  type CityPack,
} from "../src/offline-store";
import { downloadCityPack } from "../src/offline-download";
import { loadMap } from "../src/data";
import { covers } from "../src/viewport";
import type { MapData } from "../src/model";
const place = {
  name: "Test City",
  subtitle: "测试城市",
  title: "TEST",
  lon: 120.62,
  lat: 31.31,
};
function memoryStore() {
  const packs = new Map<string, CityPack>(),
    tiles = new Map<string, MapData>();
  const store: CityStore = {
    list: async () => [...packs.values()],
    save: async (p) => {
      packs.set(p.id, structuredClone(p));
    },
    tile: async (id, i) => tiles.get(`${id}:${i}`),
    commit: async (p, i, map) => {
      const next = {
        ...p,
        completed: [...p.completed, i],
        bytes: p.bytes + 100,
      };
      tiles.set(`${p.id}:${i}`, map);
      packs.set(p.id, next);
      return next;
    },
  };
  return { store, packs, tiles };
}
const mapFor = (bounds: MapData["bounds"], empty = false): MapData => ({
  name: "tile",
  bounds,
  center: [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2],
  source: "test",
  fetchedAt: "2026-10-10T00:00:00Z",
  snapshotAt: "2026-10-09T00:00:00Z",
  geojson: {
    type: "FeatureCollection",
    features: empty
      ? []
      : [
          {
            type: "Feature",
            id: "way/1",
            properties: { highway: "primary" },
            geometry: {
              type: "LineString",
              coordinates: [
                [120.62, 31.31],
                [120.621, 31.312],
              ],
            },
          },
        ],
  },
});
test("city grids exactly cover chosen extent and each request remains bounded", () => {
  for (const km of [5, 10, 20, 40]) {
    const pack = createCityPack(place, km);
    assert.equal(pack.tiles.length, Math.ceil(km / 4) ** 2);
    assert.equal(pack.tiles[0][0], pack.bounds[0]);
    assert.equal(pack.tiles.at(-1)![3], pack.bounds[3]);
    assert.ok(
      pack.tiles.every(
        (b) => covers(pack.bounds, b) && (b[2] - b[0]) * (b[3] - b[1]) < 0.025
      )
    );
  }
  assert.throws(() => createCityPack(place, 100));
});
test("failure preserves completed chunks; resume downloads only missing chunks including empty areas", async () => {
  const { store } = memoryStore(),
    pack = createCityPack(place, 5);
  let calls = 0;
  await assert.rejects(
    downloadCityPack(pack, new AbortController().signal, {
      store,
      loader: async (_p, _s, _h, bounds) => {
        if (++calls === 2) throw new Error("server unavailable");
        return mapFor(bounds!);
      },
    }),
    /server unavailable/
  );
  const partial = (await store.list())[0];
  assert.deepEqual(partial.completed, [0]);
  assert.equal(packReady(partial), false);
  let resumed = 0;
  const complete = await downloadCityPack(
    partial,
    new AbortController().signal,
    {
      store,
      loader: async (_p, _s, _h, bounds, options) => {
        resumed++;
        assert.equal(options!.allowEmpty, true);
        assert.equal(options!.skipOffline, true);
        return mapFor(bounds!, true);
      },
    }
  );
  assert.equal(resumed, 3);
  assert.equal(packReady(complete), true);
});
test("pause after a committed chunk leaves a resumable checkpoint", async () => {
  const { store } = memoryStore(),
    pack = createCityPack(place, 5),
    controller = new AbortController();
  let requests = 0;
  await assert.rejects(
    downloadCityPack(pack, controller.signal, {
      store,
      loader: async (_p, _s, _h, b) => {
        requests++;
        return mapFor(b!);
      },
      onProgress: (p) => {
        if (p.completed.length === 1) controller.abort();
      },
    }),
    /已暂停/
  );
  assert.equal(requests, 1);
  assert.equal((await store.list())[0].completed.length, 1);
});
test("offline reader requires complete coverage, deduplicates crossing features and reads only intersecting chunks", async () => {
  const { store, tiles } = memoryStore(),
    pack = createCityPack(place, 10);
  await store.save(pack);
  assert.equal(await readOfflineMap(place, pack.bounds, store), undefined);
  const ready = await downloadCityPack(pack, new AbortController().signal, {
    store,
    loader: async (_p, _s, _h, b) => mapFor(b!),
  });
  const local = await readOfflineMap(place, pack.bounds, store);
  assert.equal(local!.geojson.features.length, 1);
  assert.match(local!.source, /离线城市/);
  assert.equal(local!.fetchedAt, "2026-10-10T00:00:00Z");
  const edge: typeof pack.bounds = [
    pack.bounds[0],
    pack.bounds[1],
    pack.bounds[0] + 0.001,
    pack.bounds[1] + 0.001,
  ];
  assert.ok(covers((await readOfflineMap(place, edge, store))!.bounds, edge));
  let reads = 0;
  const counting = {
    ...store,
    tile: async (id: string, i: number) => {
      reads++;
      return store.tile(id, i);
    },
  };
  const b = ready.tiles[4];
  const small: typeof b = [
    b[0] + 0.001,
    b[1] + 0.001,
    b[2] - 0.001,
    b[3] - 0.001,
  ];
  assert.ok(await readOfflineMap(place, small, counting));
  assert.equal(reads, 1);
  assert.equal(
    await readOfflineMap(
      place,
      [pack.bounds[0] - 0.01, pack.bounds[1], pack.bounds[2], pack.bounds[3]],
      store
    ),
    undefined
  );
  tiles.delete(`${pack.id}:4`);
  assert.equal(await readOfflineMap(place, small, store), undefined);
});
test("offline downloader accepts valid empty OSM chunks", async () => {
  let calls = 0;
  const nativeFetch = (async () => {
    calls++;
    return Response.json({ elements: [] });
  }) as typeof fetch;
  const map = await loadMap(
    { ...place, lon: 115 },
    new AbortController().signal,
    { nativeFetch },
    [114.99, 31.3, 115.01, 31.32],
    { allowEmpty: true, skipOffline: true }
  );
  assert.equal(map.geojson.features.length, 0);
  assert.equal(calls, 1);
});
