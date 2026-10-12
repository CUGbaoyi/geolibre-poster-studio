import { PAPERS, type Bounds, type MapData, type Settings } from "./model";
const R = 6378137;
export const mercator = ([lon, lat]: number[]): [number, number] => [
  (lon * Math.PI) / 180,
  Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)),
];
const inverse = ([x, y]: number[]): [number, number] => [
  (x * 180) / Math.PI,
  ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI,
];
export function posterViewport(map: MapData, s: Settings) {
  const square = s.paper === "square",
    size = square ? 470 : 630;
  const height = s.template === "linework" ? (square ? 455 : 662) : size;
  const center = s.center ?? map.center;
  const [cx, cy] = mercator(center);
  const paper = PAPERS[s.paper];
  // SVG uses preserveAspectRatio="xMidYMid meet"; this also handles A4 rounding.
  const mmPerUnit = Math.min(
    paper.width / 700,
    paper.height / (square ? 700 : 990)
  );
  const metersPerRadian = R * Math.cos((center[1] * Math.PI) / 180);
  const [west, south] = mercator(map.bounds.slice(0, 2));
  const [east, north] = mercator(map.bounds.slice(2));
  const scale = s.scaleDenominator
    ? (metersPerRadian * 1000) / (s.scaleDenominator * mmPerUnit)
    : Math.max(size / (east - west), height / (north - south)) * s.zoom;
  const denominator = (metersPerRadian * 1000) / (scale * mmPerUnit);
  const bounds: Bounds = [
    ...inverse([cx - size / scale / 2, cy - height / scale / 2]),
    ...inverse([cx + size / scale / 2, cy + height / scale / 2]),
  ] as Bounds;
  return {
    center,
    cx,
    cy,
    size,
    height,
    scale,
    bounds,
    denominator,
    widthKm: (size * mmPerUnit * denominator) / 1e6,
  };
}
export function covers(coverage: Bounds, view: Bounds): boolean {
  const epsilon = 1e-8;
  return (
    coverage[0] <= view[0] + epsilon &&
    coverage[1] <= view[1] + epsilon &&
    coverage[2] >= view[2] - epsilon &&
    coverage[3] >= view[3] - epsilon
  );
}
export function bufferedBounds(b: Bounds): Bounds {
  const x = (b[2] - b[0]) * 0.15,
    y = (b[3] - b[1]) * 0.15;
  return [b[0] - x, b[1] - y, b[2] + x, b[3] + y];
}
