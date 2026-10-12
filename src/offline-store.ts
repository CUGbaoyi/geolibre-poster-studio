import type { Bounds, MapData } from "./model";
import { boundsForCenter } from "./model";
import { covers } from "./viewport";
import type { Place } from "./data";

export interface CityPack {
  id: string;
  place: Place;
  bounds: Bounds;
  widthKm: number;
  tiles: Bounds[];
  completed: number[];
  bytes: number;
  updatedAt: string;
  coverageLabel?: string;
  snapshotAt?: string;
}
export interface CityStore {
  list(): Promise<CityPack[]>;
  save(pack: CityPack): Promise<void>;
  tile(id: string, index: number): Promise<MapData | undefined>;
  commit(pack: CityPack, index: number, map: MapData): Promise<CityPack>;
}
export const packReady = (pack: CityPack) =>
  pack.tiles.length > 0 && pack.completed.length === pack.tiles.length;
export function createCityPack(place: Place, widthKm: number): CityPack {
  if (![5, 10, 20, 40].includes(widthKm))
    throw new Error("请选择 5、10、20 或 40 km 范围。");
  const bounds = boundsForCenter(place.lon, place.lat, widthKm);
  const count = Math.ceil(widthKm / 4);
  const tiles: Bounds[] = [];
  for (let y = 0; y < count; y++)
    for (let x = 0; x < count; x++) {
      tiles.push([
        bounds[0] + ((bounds[2] - bounds[0]) * x) / count,
        bounds[1] + ((bounds[3] - bounds[1]) * y) / count,
        bounds[0] + ((bounds[2] - bounds[0]) * (x + 1)) / count,
        bounds[1] + ((bounds[3] - bounds[1]) * (y + 1)) / count,
      ]);
    }
  return {
    id: crypto.randomUUID(),
    place,
    bounds,
    widthKm,
    tiles,
    completed: [],
    bytes: 0,
    updatedAt: new Date().toISOString(),
  };
}
export const intersects = (a: Bounds, b: Bounds) =>
  a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("geolibre-poster-cities", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("packs", { keyPath: "id" });
      request.result.createObjectStore("tiles");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function read<T>(store: string, key?: IDBValidKey): Promise<T> {
  const db = await openDB();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(store, "readonly"),
        object = tx.objectStore(store);
      const req = key === undefined ? object.getAll() : object.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}
async function write(pack: CityPack, tile?: { index: number; map: MapData }) {
  const db = await openDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["packs", "tiles"], "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () =>
        reject(tx.error ?? new Error("本地空间不足或保存被中止。"));
      tx.objectStore("packs").put(pack);
      if (tile)
        tx.objectStore("tiles").put(tile.map, `${pack.id}:${tile.index}`);
    });
  } finally {
    db.close();
  }
}
export const cityStore: CityStore = {
  list: () => read<CityPack[]>("packs"),
  save: (pack) => write(pack),
  tile: (id, index) => read<MapData | undefined>("tiles", `${id}:${index}`),
  async commit(pack, index, map) {
    const next = {
      ...pack,
      completed: [...new Set([...pack.completed, index])],
      bytes: pack.bytes + new Blob([JSON.stringify(map)]).size,
      updatedAt: new Date().toISOString(),
    };
    await write(next, { index, map });
    return next;
  },
};
export async function deleteCityPack(pack: CityPack): Promise<void> {
  const db = await openDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["packs", "tiles"], "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
      tx.objectStore("packs").delete(pack.id);
      pack.tiles.forEach((_, i) =>
        tx.objectStore("tiles").delete(`${pack.id}:${i}`)
      );
    });
  } finally {
    db.close();
  }
}
/** Publish all imported tiles together, or roll back everything on quota/error. */
export async function installCityPack(
  pack: CityPack,
  maps: MapData[]
): Promise<void> {
  const db = await openDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["packs", "tiles"], "readwrite");
      tx.oncomplete = () => resolve();
      tx.onabort = () =>
        reject(tx.error ?? new Error("本机空间不足，导入未保存。"));
      tx.onerror = () => reject(tx.error);
      try {
        maps.forEach((map, i) =>
          tx.objectStore("tiles").put(map, `${pack.id}:${i}`)
        );
        tx.objectStore("packs").put(pack);
      } catch (error) {
        tx.abort();
        reject(error);
      }
    });
  } finally {
    db.close();
  }
}
/** Never treat a partly downloaded city as complete coverage. Only read relevant chunks. */
export async function readOfflineMap(
  place: Place,
  bounds: Bounds,
  store: CityStore = cityStore
): Promise<MapData | undefined> {
  if (store === cityStore && typeof indexedDB === "undefined") return;
  const packs = (await store.list().catch(() => []))
    .filter((p) => packReady(p) && covers(p.bounds, bounds))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  for (const pack of packs) {
    const indexes = pack.tiles.flatMap((b, i) =>
      intersects(b, bounds) ? [i] : []
    );
    const maps = await Promise.all(indexes.map((i) => store.tile(pack.id, i)));
    if (!maps.length || maps.some((m) => !m)) continue;
    const features = new Map<string, MapData["geojson"]["features"][number]>();
    maps.forEach((map, i) =>
      map!.geojson.features.forEach((f, j) =>
        features.set(String(f.id ?? `${i}/${j}`), f)
      )
    );
    if (features.size > 100000)
      throw new Error("离线取景要素过多，请缩小比例尺分母。");
    const snapshot = [...new Set(maps.map((m) => m!.snapshotAt))];
    return {
      name: place.name,
      center: [place.lon, place.lat],
      bounds: [
        Math.min(...indexes.map((i) => pack.tiles[i][0])),
        Math.min(...indexes.map((i) => pack.tiles[i][1])),
        Math.max(...indexes.map((i) => pack.tiles[i][2])),
        Math.max(...indexes.map((i) => pack.tiles[i][3])),
      ],
      geojson: { type: "FeatureCollection", features: [...features.values()] },
      source: `离线城市 · ${pack.place.subtitle} · ${[
        ...new Set(maps.map((m) => m!.source)),
      ].join(" / ")}`,
      fetchedAt: maps.map((m) => m!.fetchedAt).sort()[0],
      snapshotAt: snapshot.length === 1 ? snapshot[0] : undefined,
    };
  }
}
