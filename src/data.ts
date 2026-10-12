import type { FeatureCollection } from "geojson";
import {
  boundsForCenter,
  validBounds,
  type Bounds,
  type Host,
  type MapData,
} from "./model";
import { overpassJsonToGeoJson } from "./vendor/osm-downloader-api";
import { featureKind } from "./renderer";
import { readOfflineMap } from "./offline-store";
import { covers } from "./viewport";
export interface Place {
  name: string;
  lon: number;
  lat: number;
  title: string;
  subtitle: string;
}
const cache = new Map<string, MapData>();
let lastGeocode = 0;
export async function findPlaces(
  query: string,
  signal: AbortSignal,
  host?: Host
): Promise<Place[]> {
  const coords = /^\s*(-?\d+(?:\.\d+)?)\s*[,，]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(
    query
  );
  if (coords) {
    const lat = Number(coords[1]),
      lon = Number(coords[2]);
    boundsForCenter(lon, lat);
    return [
      {
        name: `${lat}, ${lon}`,
        lat,
        lon,
        title: "A PLACE TO REMEMBER",
        subtitle: "此地",
      },
    ];
  }
  if (Date.now() - lastGeocode < 1100) throw new Error("请稍等一秒后再搜索。");
  lastGeocode = Date.now();
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.search = new URLSearchParams({
    q: query,
    format: "jsonv2",
    limit: "4",
    namedetails: "1",
    "accept-language": "zh,en",
  }).toString();
  const res = await (host?.nativeFetch ?? fetch)(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
  });
  if (!res.ok)
    throw new Error(
      `地点搜索暂不可用（${res.status}）。也可输入「纬度, 经度」。`
    );
  const results = await res.json();
  if (!Array.isArray(results)) throw new Error("地点服务返回格式异常。");
  return results
    .map((r) => ({
      name: String(r.display_name),
      lon: Number(r.lon),
      lat: Number(r.lat),
      title: String(
        r.namedetails?.["name:en"] ?? r.name ?? query
      ).toUpperCase(),
      subtitle: String(r.namedetails?.["name:zh"] ?? r.name ?? query),
    }))
    .filter((r) => Number.isFinite(r.lon) && Number.isFinite(r.lat));
}
export function prepareFeatures(data: FeatureCollection): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: data.features
      .filter((f) => f.geometry && featureKind(f.properties))
      .map((f) => ({
        type: "Feature",
        id: f.id,
        geometry: f.geometry,
        properties: Object.fromEntries(
          Object.entries(f.properties ?? {}).filter(([k]) =>
            [
              "building",
              "highway",
              "water",
              "waterway",
              "landuse",
              "leisure",
              "natural",
            ].includes(k)
          )
        ),
      })),
  };
}
export async function loadMap(
  place: Place,
  signal: AbortSignal,
  host?: Host,
  bounds?: Bounds,
  options: {
    onProgress?: (message: string) => void;
    requestTimeoutMs?: number;
    allowEmpty?: boolean;
    skipOffline?: boolean;
    offlineBounds?: Bounds;
  } = {}
): Promise<MapData> {
  if (signal.aborted) throw new DOMException("已取消", "AbortError");
  const progress = options.onProgress ?? (() => {});
  const box = bounds ?? boundsForCenter(place.lon, place.lat);
  if (!validBounds(box) || (box[2] - box[0]) * (box[3] - box[1]) > 0.025)
    throw new Error(
      "当前取景范围过大，请减小比例尺分母，或在主地图中放大后重试。"
    );
  if (!options.skipOffline) {
    const local = await readOfflineMap(place, options.offlineBounds ?? box);
    if (signal.aborted) throw new DOMException("已取消", "AbortError");
    if (local) {
      progress("正在读取本机离线城市…");
      return local;
    }
  }
  const key = box.map((v) => v.toFixed(5)).join(",");
  // Reuse a loaded region when a new crop sits inside it, not only identical boxes.
  const cached =
    cache.get(key) ?? [...cache.values()].find((m) => covers(m.bounds, box));
  if (cached) {
    progress("正在读取已缓存的地图…");
    return { ...cached, name: place.name, center: [place.lon, place.lat] };
  }
  const bbox = [box[1], box[0], box[3], box[2]]
    .map((n) => n.toFixed(6))
    .join(",");
  const selectors = [
    "way[highway]",
    "way[building]",
    "nwr[natural=water]",
    "way[waterway]",
    "way[landuse]",
    "nwr[leisure=park]",
    "way[natural=wood]",
  ];
  const query = `[out:json][timeout:20];(${selectors
    .map((s) => `${s}(${bbox});`)
    .join("")});out geom;`;
  const endpoints = [
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  ];
  let lastError: unknown;
  for (const [index, endpoint] of endpoints.entries()) {
    if (signal.aborted) throw new DOMException("已取消", "AbortError");
    progress(
      index === 0
        ? `正在下载${place.subtitle}的地图数据（服务 1/2）…`
        : "首个服务未完成，正在尝试备用服务（2/2）…"
    );
    try {
      const raw = await withDeadline(
        async (requestSignal) => {
          const res = await (host?.nativeFetch ?? fetch)(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
            },
            body: `data=${encodeURIComponent(query)}`,
            signal: requestSignal,
          });
          if (requestSignal.aborted) throw requestSignal.reason;
          if (!res.ok) throw new Error(`地图服务返回 ${res.status}`);
          progress("已连接地图服务，正在接收数据…");
          return await res.json();
        },
        signal,
        options.requestTimeoutMs ?? 25000
      );
      if (raw.remark) throw new Error(String(raw.remark));
      progress("数据已收到，正在整理道路与建筑…");
      const geojson = prepareFeatures(overpassJsonToGeoJson(raw));
      if (!geojson.features.length && !options.allowEmpty)
        throw new Error("该范围暂未找到道路或建筑数据。");
      if (geojson.features.length > 100000)
        throw new Error("地图要素过多，请缩小范围。");
      const data: MapData = {
        name: place.name,
        center: [place.lon, place.lat],
        bounds: box,
        geojson,
        source: endpoint,
        fetchedAt: new Date().toISOString(),
        snapshotAt:
          typeof raw.osm3s?.timestamp_osm_base === "string"
            ? raw.osm3s.timestamp_osm_base
            : undefined,
      };
      cache.set(key, data);
      if (cache.size > 5) cache.delete(cache.keys().next().value!);
      return data;
    } catch (e) {
      lastError = e;
      if (signal.aborted) throw e;
    }
  }
  throw new Error(
    `地图服务暂未完成，请重试，或减小比例尺分母后再加载。${
      lastError instanceof Error ? lastError.message : ""
    }`
  );
}

/** Bound headers AND response-body reading, even if a native fetch ignores abort. */
async function withDeadline<T>(
  work: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
  timeoutMs: number
): Promise<T> {
  const controller = new AbortController();
  let rejectDeadline: (reason: unknown) => void = () => {};
  const stopped = new Promise<never>((_, reject) => {
    rejectDeadline = reject;
  });
  const stop = (reason: unknown) => {
    controller.abort(reason);
    rejectDeadline(reason);
  };
  const cancel = () => stop(new DOMException("已取消", "AbortError"));
  const timeout = setTimeout(
    () =>
      stop(new Error(`地图服务等待超过 ${Math.round(timeoutMs / 1000)} 秒。`)),
    timeoutMs
  );
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  try {
    return await Promise.race([work(controller.signal), stopped]);
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", cancel);
  }
}
