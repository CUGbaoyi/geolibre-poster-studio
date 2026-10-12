import { unzipSync, strFromU8 } from "fflate";
import {
  DEFAULTS,
  validBounds,
  validateDraft,
  type Bounds,
  type MapData,
} from "./model";
import {
  cityStore,
  installCityPack,
  packReady,
  type CityPack,
} from "./offline-store";
import type { Place } from "./data";

export const MAX_PACKAGE_BYTES = 64 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 256 * 1024 * 1024;
interface Manifest {
  format: "geolibre-poster-city";
  version: 1;
  place: Place;
  bounds: Bounds;
  columns: number;
  rows: number;
  coverageLabel: string;
  source: string;
  fetchedAt: string;
  snapshotAt: string;
  attribution: string;
  license: "ODbL-1.0";
  tiles: { file: string; bytes: number; sha256: string; features: number }[];
}
const text = (v: unknown, max = 500): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= max;
const date = (v: unknown): v is string =>
  text(v, 40) && Number.isFinite(Date.parse(v));
const sameBounds = (a: Bounds, b: Bounds) =>
  a.every((v, i) => Math.abs(v - b[i]) < 1e-8);
export async function sha256(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new Uint8Array(bytes).buffer
  );
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** ZIP: manifest.json plus row-major, regular-grid MapData JSON files. No file extraction. */
export async function decodeCityPackage(
  bytes: Uint8Array,
  progress = (_message: string) => {}
) {
  if (!bytes.length || bytes.length > MAX_PACKAGE_BYTES)
    throw new Error("离线包须小于 64 MB。");
  progress("正在解压和校验离线包…");
  let total = 0,
    files = 0;
  const entries = unzipSync(bytes, {
    filter: (entry) => {
      total += entry.originalSize;
      if (
        ++files > 1025 ||
        entry.originalSize > 16 * 1024 * 1024 ||
        total > MAX_EXPANDED_BYTES
      )
        throw new Error("离线包解压后过大，请按城区拆分。");
      return true;
    },
  });
  if (!entries["manifest.json"] || entries["manifest.json"].length > 512 * 1024)
    throw new Error("缺少有效的离线包清单，请选择 .poster-city.zip 文件。");
  const m: Manifest = JSON.parse(strFromU8(entries["manifest.json"]));
  if (!m || m.format !== "geolibre-poster-city" || m.version !== 1)
    throw new Error("不支持此离线包格式或版本。");
  const p = m.place;
  if (
    !validBounds(m.bounds) ||
    !p ||
    !text(p.name) ||
    !text(p.title, 60) ||
    !text(p.subtitle, 80) ||
    !Number.isFinite(p.lon) ||
    !Number.isFinite(p.lat) ||
    p.lon < m.bounds[0] ||
    p.lon > m.bounds[2] ||
    p.lat < m.bounds[1] ||
    p.lat > m.bounds[3] ||
    !text(m.coverageLabel, 160) ||
    !text(m.source) ||
    !text(m.attribution) ||
    m.license !== "ODbL-1.0" ||
    !date(m.fetchedAt) ||
    !date(m.snapshotAt) ||
    !Number.isInteger(m.columns) ||
    !Number.isInteger(m.rows) ||
    m.columns < 1 ||
    m.rows < 1 ||
    m.columns * m.rows > 1024 ||
    !Array.isArray(m.tiles) ||
    m.tiles.length !== m.columns * m.rows
  )
    throw new Error("离线包的范围、分块或来源信息无效。");
  const maps: MapData[] = [],
    grid: Bounds[] = [];
  let mapBytes = 0;
  for (const [i, item] of m.tiles.entries()) {
    const filename = `tiles/${i}.json`;
    if (
      !item ||
      item.file !== filename ||
      !Number.isInteger(item.bytes) ||
      !text(item.sha256, 64) ||
      !/^[a-f0-9]{64}$/.test(item.sha256) ||
      !Number.isInteger(item.features) ||
      item.features < 0 ||
      item.features > 100000
    )
      throw new Error(`第 ${i + 1} 块清单无效。`);
    const raw = entries[filename];
    if (
      !raw ||
      raw.length !== item.bytes ||
      (await sha256(raw)) !== item.sha256
    )
      throw new Error(`第 ${i + 1} 块缺失或校验失败，请重新获取完整离线包。`);
    const x = i % m.columns,
      y = Math.floor(i / m.columns),
      b = m.bounds;
    const bounds: Bounds = [
      b[0] + ((b[2] - b[0]) * x) / m.columns,
      b[1] + ((b[3] - b[1]) * y) / m.rows,
      b[0] + ((b[2] - b[0]) * (x + 1)) / m.columns,
      b[1] + ((b[3] - b[1]) * (y + 1)) / m.rows,
    ];
    const map: MapData = JSON.parse(strFromU8(raw));
    if (
      !validateDraft({ version: 1, settings: DEFAULTS, map }) ||
      !sameBounds(map.bounds, bounds) ||
      map.geojson.features.length !== item.features ||
      map.source !== m.source ||
      map.snapshotAt !== m.snapshotAt ||
      map.fetchedAt !== m.fetchedAt ||
      map.geojson.features.some(
        (f) => typeof f.id !== "string" || !/^(way|relation)\/\d+$/.test(f.id)
      )
    )
      throw new Error(`第 ${i + 1} 块地图数据或覆盖范围无效。`);
    maps.push(map);
    grid.push(bounds);
    mapBytes += raw.length;
    if (i % 8 === 0) {
      progress(`正在校验离线包 ${i + 1}/${m.tiles.length}…`);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  if (
    Object.keys(entries).some(
      (name) =>
        name !== "manifest.json" && !m.tiles.some((t) => t.file === name)
    )
  )
    throw new Error("离线包包含清单之外的文件。");
  const pack: CityPack = {
    id: `import-${await sha256(bytes)}`,
    place: p,
    bounds: m.bounds,
    widthKm: Math.min(
      (m.bounds[2] - m.bounds[0]) * 111.32 * Math.cos((p.lat * Math.PI) / 180),
      (m.bounds[3] - m.bounds[1]) * 111.32
    ),
    tiles: grid,
    completed: grid.map((_, i) => i),
    bytes: mapBytes,
    updatedAt: new Date().toISOString(),
    coverageLabel: m.coverageLabel,
    snapshotAt: m.snapshotAt,
  };
  return { pack, maps };
}

export async function importCityPackage(
  file: File,
  progress: (message: string) => void
): Promise<CityPack> {
  if (file.size > MAX_PACKAGE_BYTES) throw new Error("离线包须小于 64 MB。");
  const { pack, maps } = await decodeCityPackage(
    new Uint8Array(await file.arrayBuffer()),
    progress
  );
  const existing = (await cityStore.list()).find(
    (p) => p.id === pack.id && packReady(p)
  );
  if (existing) return existing;
  progress("校验通过，正在保存到本机…");
  await installCityPack(pack, maps);
  return pack;
}
