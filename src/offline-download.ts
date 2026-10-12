import { loadMap } from "./data";
import { cityStore, type CityPack, type CityStore } from "./offline-store";
import type { Host } from "./model";
/** Sequential small requests; each complete chunk is committed before the next request. */
export async function downloadCityPack(
  pack: CityPack,
  signal: AbortSignal,
  options: {
    host?: Host;
    store?: CityStore;
    onProgress?: (pack: CityPack, message: string) => void;
    loader?: typeof loadMap;
  } = {}
): Promise<CityPack> {
  const store = options.store ?? cityStore;
  await store.save(pack);
  let current = pack;
  for (let i = 0; i < pack.tiles.length; i++) {
    if (signal.aborted) throw new DOMException("已暂停", "AbortError");
    if (current.completed.includes(i)) continue;
    const bounds = pack.tiles[i];
    const place = {
      ...pack.place,
      lon: (bounds[0] + bounds[2]) / 2,
      lat: (bounds[1] + bounds[3]) / 2,
    };
    const map = await (options.loader ?? loadMap)(
      place,
      signal,
      options.host,
      bounds,
      {
        allowEmpty: true,
        skipOffline: true,
        requestTimeoutMs: 60000,
        onProgress: (text) =>
          options.onProgress?.(
            current,
            `分块 ${i + 1}/${pack.tiles.length} · ${text}`
          ),
      }
    );
    if (signal.aborted) throw new DOMException("已暂停", "AbortError");
    current = await store.commit(current, i, map);
    options.onProgress?.(
      current,
      `已保存 ${current.completed.length}/${pack.tiles.length} 个分块`
    );
  }
  return current;
}
