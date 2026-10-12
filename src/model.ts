import type { FeatureCollection } from "geojson";
export type Bounds = [number, number, number, number];
export type Template = "engraving" | "linework";
export type PaletteKey = "clay" | "sage" | "night" | "ink";
export type Paper = "a3" | "a4" | "square";
export type ColorKey =
  | "paper"
  | "land"
  | "water"
  | "park"
  | "roads"
  | "buildings"
  | "text";
export type CustomColors = Partial<Record<ColorKey, string>>;
export const MARKER_ICONS = [
  "pin",
  "star",
  "heart",
  "home",
  "camera",
  "flag",
] as const;
export const LABEL_POSITIONS = [
  "auto",
  "top",
  "bottom",
  "left",
  "right",
] as const;
export const MAX_MARKERS = 30;
export interface PosterMarker {
  id: string;
  position: [number, number];
  name: string;
  icon: (typeof MARKER_ICONS)[number];
  color: string;
  size: number;
  visible: boolean;
  showLabel: boolean;
  labelPosition: (typeof LABEL_POSITIONS)[number];
}
export function validMarkers(value: unknown): value is PosterMarker[] {
  if (!Array.isArray(value) || value.length > MAX_MARKERS) return false;
  const ids = new Set<string>();
  return value.every((m) => {
    if (
      !m ||
      typeof m !== "object" ||
      typeof m.id !== "string" ||
      !m.id.length ||
      m.id.length > 80 ||
      ids.has(m.id)
    )
      return false;
    ids.add(m.id);
    return (
      validCenter(m.position) &&
      typeof m.name === "string" &&
      m.name.length <= 40 &&
      MARKER_ICONS.includes(m.icon) &&
      typeof m.color === "string" &&
      /^#[0-9a-f]{6}$/i.test(m.color) &&
      Number.isFinite(m.size) &&
      m.size >= 16 &&
      m.size <= 36 &&
      typeof m.visible === "boolean" &&
      typeof m.showLabel === "boolean" &&
      LABEL_POSITIONS.includes(m.labelPosition)
    );
  });
}
export interface Settings {
  template: Template;
  palette: PaletteKey;
  title: string;
  subtitle: string;
  paper: Paper;
  zoom: number; // Legacy drafts only; explicit print scale takes precedence.
  center?: [number, number];
  scaleDenominator?: number;
  colors?: CustomColors;
  markers?: PosterMarker[];
}
export interface MapData {
  name: string;
  center: [number, number];
  bounds: Bounds;
  fetchedAt: string;
  snapshotAt?: string;
  source: string;
  geojson: FeatureCollection;
}
export interface Draft {
  version: 1;
  settings: Settings;
  map: MapData;
}
export interface Host {
  getViewBounds?: () => Bounds | null;
  nativeFetch?: typeof fetch;
  exportTextFile?: (
    name: string,
    text: string,
    options?: { extensions?: string[]; mimeType?: string; description?: string }
  ) => void;
  registerToolbarMenu?: (menu: {
    id: string;
    label: string;
    items: { id: string; label: string; onSelect: () => void }[];
  }) => () => void;
}
export const DEFAULTS: Settings = {
  template: "engraving",
  palette: "clay",
  title: "NANJING",
  subtitle: "南京",
  paper: "a3",
  zoom: 1,
  scaleDenominator: 20000,
};
export const PAPERS = {
  a3: { label: "A3 · 竖版", width: 297, height: 420 },
  a4: { label: "A4 · 竖版", width: 210, height: 297 },
  square: { label: "方形 · 30 × 30 cm", width: 300, height: 300 },
};
export function validBounds(b: unknown): b is Bounds {
  return (
    Array.isArray(b) &&
    b.length === 4 &&
    b.every(Number.isFinite) &&
    b[0] >= -180 &&
    b[2] <= 180 &&
    b[1] >= -80 &&
    b[3] <= 80 &&
    b[0] < b[2] &&
    b[1] < b[3]
  );
}
function validCoordinates(value: unknown, depth: number): boolean {
  if (!Array.isArray(value)) return false;
  if (depth > 0)
    return (
      value.length > 0 && value.every((v) => validCoordinates(v, depth - 1))
    );
  return (
    value.length >= 2 &&
    value.every(Number.isFinite) &&
    Math.abs(value[0]) <= 180 &&
    Math.abs(value[1]) <= 90
  );
}
function validFeature(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const feature = value as {
    type?: string;
    geometry?: { type?: string; coordinates?: unknown };
    properties?: unknown;
  };
  const depths: Record<string, number> = {
    Point: 0,
    MultiPoint: 1,
    LineString: 1,
    MultiLineString: 2,
    Polygon: 2,
    MultiPolygon: 3,
  };
  const geometry = feature.geometry;
  return (
    feature.type === "Feature" &&
    !!geometry &&
    Object.hasOwn(depths, geometry.type ?? "") &&
    validCoordinates(geometry.coordinates, depths[geometry.type!]) &&
    (feature.properties === null || typeof feature.properties === "object")
  );
}
export function validateDraft(value: unknown): value is Draft {
  if (!value || typeof value !== "object") return false;
  const { version, settings: s, map: m } = value as Draft;
  return (
    version === 1 &&
    !!s &&
    ["engraving", "linework"].includes(s.template) &&
    ["clay", "sage", "night", "ink"].includes(s.palette) &&
    ["a3", "a4", "square"].includes(s.paper) &&
    typeof s.title === "string" &&
    s.title.length <= 60 &&
    typeof s.subtitle === "string" &&
    s.subtitle.length <= 80 &&
    Number.isFinite(s.zoom) &&
    s.zoom >= 1 &&
    s.zoom <= 2.5 &&
    (s.center === undefined || validCenter(s.center)) &&
    (s.scaleDenominator === undefined ||
      (Number.isFinite(s.scaleDenominator) &&
        s.scaleDenominator >= 5000 &&
        s.scaleDenominator <= 40000)) &&
    (s.colors === undefined ||
      (!!s.colors &&
        !Array.isArray(s.colors) &&
        typeof s.colors === "object" &&
        Object.entries(s.colors).every(
          ([key, color]) =>
            COLOR_KEYS.includes(key as ColorKey) &&
            typeof color === "string" &&
            /^#[0-9a-f]{6}$/i.test(color)
        ))) &&
    (s.markers === undefined || validMarkers(s.markers)) &&
    !!m &&
    typeof m.name === "string" &&
    typeof m.source === "string" &&
    typeof m.fetchedAt === "string" &&
    (m.snapshotAt === undefined || typeof m.snapshotAt === "string") &&
    validBounds(m.bounds) &&
    Array.isArray(m.center) &&
    m.center.length === 2 &&
    m.center.every(Number.isFinite) &&
    m.center[0] >= m.bounds[0] &&
    m.center[0] <= m.bounds[2] &&
    m.center[1] >= m.bounds[1] &&
    m.center[1] <= m.bounds[3] &&
    m.geojson?.type === "FeatureCollection" &&
    Array.isArray(m.geojson.features) &&
    m.geojson.features.length <= 100000 &&
    m.geojson.features.every(validFeature) &&
    JSON.stringify(value).length < 16000000
  );
}
export function boundsForCenter(lon: number, lat: number, km = 7): Bounds {
  if (
    !Number.isFinite(lon) ||
    !Number.isFinite(lat) ||
    Math.abs(lat) > 79 ||
    Math.abs(lon) > 179
  )
    throw new Error("请选择纬度 ±79°、经度 ±179° 范围内的地点。");
  const dy = km / 2 / 111.32,
    dx = dy / Math.cos((lat * Math.PI) / 180);
  const bounds: Bounds = [lon - dx, lat - dy, lon + dx, lat + dy];
  if (!validBounds(bounds)) throw new Error("暂不支持跨越日期变更线的地图。");
  return bounds;
}
export const coordinateText = ([lon, lat]: [number, number]) =>
  `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? "N" : "S"}  ·  ${Math.abs(
    lon
  ).toFixed(4)}° ${lon >= 0 ? "E" : "W"}`;

export const COLOR_KEYS: ColorKey[] = [
  "paper",
  "land",
  "water",
  "park",
  "roads",
  "buildings",
  "text",
];
export function validCenter(c: unknown): c is [number, number] {
  return (
    Array.isArray(c) &&
    c.length === 2 &&
    c.every(Number.isFinite) &&
    Math.abs(c[0]) <= 179 &&
    Math.abs(c[1]) <= 79
  );
}
