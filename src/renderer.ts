import { xml } from "./xml";
export { xml } from "./xml";
import { renderMarkers } from "./markers";
import type { Geometry, Position } from "geojson";
import { posterViewport, mercator } from "./viewport";
import {
  coordinateText,
  PAPERS,
  type Settings,
  type MapData,
  type PaletteKey,
} from "./model";
export const PALETTES: Record<
  PaletteKey,
  {
    label: string;
    paper: string;
    land: string;
    water: string;
    park: string;
    roads: string;
    buildings: string[];
    text: string;
  }
> = {
  clay: {
    label: "暖陶",
    paper: "#faf5e9",
    land: "#ede5d5",
    water: "#a5c1c4",
    park: "#a7b8a1",
    roads: "#424d48",
    buildings: ["#ca8765", "#d99c78", "#b96e50", "#e2b38d"],
    text: "#272b29",
  },
  sage: {
    label: "青绿",
    paper: "#f5f5eb",
    land: "#e6e8d8",
    water: "#acc9c5",
    park: "#819d83",
    roads: "#34564e",
    buildings: ["#9fa788", "#7f9984", "#c0bea0", "#65887a"],
    text: "#29483e",
  },
  night: {
    label: "暮蓝",
    paper: "#152935",
    land: "#203a45",
    water: "#315968",
    park: "#395b54",
    roads: "#ded9ba",
    buildings: ["#7a9290", "#8eaaa0", "#586f77", "#acb5a4"],
    text: "#f0e8d1",
  },
  ink: {
    label: "墨色",
    paper: "#f7f5ef",
    land: "#eeece5",
    water: "#ced4d0",
    park: "#d9dcd1",
    roads: "#383e3c",
    buildings: ["#969c96", "#a9afa7", "#737e78", "#c3c7bc"],
    text: "#222927",
  },
};
export function resolvedPalette(s: Settings) {
  const base = PALETTES[s.palette];
  const { buildings, ...colors } = s.colors ?? {};
  return {
    ...base,
    ...colors,
    buildings: buildings ? [buildings] : base.buildings,
  };
}
export function geometryPath(
  geometry: Geometry | null,
  project: (p: Position) => [number, number]
): string {
  const line = (points: Position[], close = false) => {
    if (
      !Array.isArray(points) ||
      points.length < 2 ||
      points.some(
        (p) =>
          !Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])
      )
    )
      return "";
    return (
      points
        .map((p, i) => {
          const [x, y] = project(p);
          return `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
        })
        .join("") + (close ? "Z" : "")
    );
  };
  const polygon = (rings: Position[][]) =>
    rings
      .map((ring, index) => {
        let area = 0;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
          area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
        // Consistent winding permits path batching while preserving holes and overlapping areas.
        return line(
          (index === 0 ? area < 0 : area > 0) ? [...ring].reverse() : ring,
          true
        );
      })
      .join("");
  if (!geometry) return "";
  switch (geometry.type) {
    case "LineString":
      return line(geometry.coordinates);
    case "MultiLineString":
      return geometry.coordinates.map((p) => line(p)).join("");
    case "Polygon":
      return polygon(geometry.coordinates);
    case "MultiPolygon":
      return geometry.coordinates.map((p) => polygon(p)).join("");
    default:
      return "";
  }
}
export function featureKind(
  properties: Record<string, unknown> | null
): string {
  const p = properties ?? {};
  if (p.building && p.building !== "no") return "building";
  if (
    p.natural === "water" ||
    p.water ||
    p.waterway === "riverbank" ||
    p.landuse === "reservoir"
  )
    return "water";
  if (p.waterway) return "waterline";
  if (p.highway) return "road";
  if (
    [
      "park",
      "garden",
      "golf_course",
      "nature_reserve",
      "recreation_ground",
    ].includes(String(p.leisure)) ||
    [
      "forest",
      "grass",
      "meadow",
      "village_green",
      "orchard",
      "recreation_ground",
    ].includes(String(p.landuse)) ||
    ["wood", "grassland", "scrub", "wetland"].includes(String(p.natural))
  )
    return "park";
  if (p.landuse && !["construction", "military"].includes(String(p.landuse)))
    return "land";
  return "";
}
function hash(value: string) {
  let h = 0;
  for (const c of value) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}
function batchPaths(paths: string[]): string {
  const batches = new Map<string, string[]>();
  for (const path of paths) {
    const m = /^<path d="([^"]*)"(.*)\/>$/.exec(path);
    if (!m) continue;
    const list = batches.get(m[2]) ?? [];
    list.push(m[1]);
    batches.set(m[2], list);
  }
  return Array.from(
    batches,
    ([attrs, parts]) => `<path d="${parts.join("")}"${attrs}/>`
  ).join("");
}
export function renderPoster(
  map: MapData,
  s: Settings,
  options: { mini?: boolean; id?: string } = {}
): string {
  const c = resolvedPalette(s),
    square = s.paper === "square",
    W = 700,
    H = square ? 700 : 990;
  const x = square ? 115 : 35,
    y = square ? 30 : 38,
    size = square ? 470 : 630;
  const mapH = s.template === "linework" ? (square ? 455 : 662) : size;
  const view = posterViewport(map, s);
  const { cx, cy, scale } = view;
  const project = (p: Position): [number, number] => {
    const [px, py] = mercator(p);
    return [x + size / 2 + (px - cx) * scale, y + mapH / 2 - (py - cy) * scale];
  };
  const groups: Record<string, string[]> = {
    land: [],
    park: [],
    water: [],
    waterline: [],
    building: [],
    casing: [],
    road: [],
  };
  for (const f of map.geojson.features) {
    if (!f || f.type !== "Feature") continue;
    const kind = featureKind(f.properties);
    if (!kind) continue;
    if (s.template === "linework" && (kind === "building" || kind === "land"))
      continue;
    const d = geometryPath(f.geometry, project);
    if (!d) continue;
    const area =
      f.geometry?.type === "Polygon" || f.geometry?.type === "MultiPolygon";
    const p = f.properties ?? {};
    if (kind === "road") {
      const major = ["motorway", "trunk", "primary", "secondary"].some((v) =>
        String(p.highway).startsWith(v)
      );
      const medium = [
        "tertiary",
        "residential",
        "unclassified",
        "living_street",
      ].includes(String(p.highway));
      const width =
        (major ? 1.35 : medium ? 0.7 : 0.35) *
        (s.template === "linework" ? 0.8 : 1);
      if (s.template === "engraving")
        groups.casing.push(`<path d="${d}" stroke-width="${width + 1.8}"/>`);
      groups.road.push(
        `<path d="${d}" stroke-width="${width}" opacity="${
          major ? 1 : medium ? 0.75 : 0.45
        }"/>`
      );
    } else if (kind === "waterline")
      groups.waterline.push(`<path d="${d}" stroke-width="1.5"/>`);
    else if (area)
      groups[kind].push(
        `<path d="${d}"${
          kind === "building"
            ? ` fill="${
                c.buildings[hash(String(f.id)) % c.buildings.length]
              }" stroke="${c.paper}" stroke-width=".12"`
            : ""
        }/>`
      );
  }
  const clipId = xml(options.id ?? "poster-clip"),
    titleY = square ? 558 : 766,
    subY = square ? 605 : 820,
    ruleY = square ? 624 : 856,
    coordY = square ? 648 : 890,
    attrY = square ? 681 : 956;
  const titleSpacing = s.title.length > 20 ? 1 : 5;
  const subtitleSpacing = s.subtitle.length > 25 ? 0.4 : 5;
  const fit = (text: string, max: number, spacing: number) => {
    const letters = Array.from(text);
    const units =
      letters.reduce((n, ch) => n + (ch.charCodeAt(0) > 255 ? 1 : 0.7), 0) || 1;
    return Math.min(
      max,
      (570 - Math.max(0, letters.length - 1) * spacing) / units
    );
  };
  const titleSize = fit(s.title, square ? 49 : 65, titleSpacing);
  const subtitleSize = fit(s.subtitle, 26, subtitleSpacing);
  const paper = PAPERS[s.paper];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${
    paper.width
  }mm" height="${
    paper.height
  }mm" viewBox="0 0 ${W} ${H}" role="img" aria-label="${xml(
    s.title
  )} 地图海报"><title>${xml(s.title)} — ${xml(
    s.subtitle
  )}</title><desc>Map data © OpenStreetMap contributors, ODbL. ${xml(
    map.source
  )}. Retrieved ${xml(map.fetchedAt)}. OSM snapshot ${xml(
    map.snapshotAt ?? map.fetchedAt
  )}. EPSG:3857. Center ${xml(
    coordinateText(view.center)
  )}. Center print scale 1:${Math.round(
    view.denominator
  )}.</desc><defs><clipPath id="${clipId}">${
    s.template === "engraving"
      ? `<circle cx="${x + size / 2}" cy="${y + size / 2}" r="${size / 2}"/>`
      : `<rect x="${x}" y="${y}" width="${size}" height="${mapH}"/>`
  }</clipPath></defs><rect width="${W}" height="${H}" fill="${
    c.paper
  }"/><g clip-path="url(#${clipId})"><rect x="${x}" y="${y}" width="${size}" height="${mapH}" fill="${
    s.template === "linework" ? c.paper : c.land
  }"/><g fill="${c.land}" fill-rule="nonzero">${batchPaths(
    groups.land
  )}</g><g fill="${c.park}" fill-rule="nonzero">${batchPaths(
    groups.park
  )}</g><g fill="${c.water}" fill-rule="nonzero">${batchPaths(
    groups.water
  )}</g><g fill="none" stroke="${c.water}">${batchPaths(
    groups.waterline
  )}</g><g fill-rule="nonzero">${batchPaths(
    groups.building
  )}</g><g fill="none" stroke="${
    c.paper
  }" stroke-linecap="round" stroke-linejoin="round">${batchPaths(
    groups.casing
  )}</g><g fill="none" stroke="${
    c.roads
  }" stroke-linecap="round" stroke-linejoin="round">${batchPaths(
    groups.road
  )}</g>${renderMarkers(map, s)}</g>${
    options.mini
      ? ""
      : `<g fill="${
          c.text
        }" text-anchor="middle"><text x="350" y="${titleY}" font-family="Georgia, 'Times New Roman', serif" font-size="${titleSize}" letter-spacing="${titleSpacing}">${xml(
          s.title
        )}</text><text x="350" y="${subY}" font-family="'Songti SC', 'Noto Serif CJK SC', serif" font-size="${subtitleSize}" letter-spacing="${subtitleSpacing}">${xml(
          s.subtitle
        )}</text><path d="M296 ${ruleY}H404" stroke="${
          c.text
        }" stroke-width="1"/><text x="350" y="${coordY}" font-family="Georgia, serif" font-size="12" letter-spacing="2.4">${xml(
          coordinateText(view.center)
        )}</text><text x="350" y="${
          coordY + 23
        }" font-family="Arial, sans-serif" font-size="9" letter-spacing="1" opacity=".7">1 : ${Math.round(
          view.denominator
        ).toLocaleString(
          "en-US"
        )}</text><text x="350" y="${attrY}" font-family="Arial, sans-serif" font-size="8" letter-spacing=".65" opacity=".64">© OpenStreetMap contributors · openstreetmap.org/copyright</text></g>`
  }</svg>`;
}
