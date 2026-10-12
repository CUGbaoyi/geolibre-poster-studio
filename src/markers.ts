import iconSvg from "./vendor/marker-icons.json";
import { MapPin, Star, Heart, House, Camera, Flag } from "lucide-react";
import { type MapData, type Settings, type PosterMarker } from "./model";
import { mercator, posterViewport } from "./viewport";
import { xml } from "./xml";
export const MARKER_STYLES = {
  pin: { label: "地点", Icon: MapPin },
  star: { label: "星标", Icon: Star },
  heart: { label: "心愿", Icon: Heart },
  home: { label: "家", Icon: House },
  camera: { label: "拍照", Icon: Camera },
  flag: { label: "旗帜", Icon: Flag },
};
export function markerBadge(marker: PosterMarker): string {
  const r = marker.size / 2,
    iconSize = marker.size * 0.58;
  const icon = iconSvg[marker.icon]
    .replace("<svg ", `<svg x="${-iconSize / 2}" y="${-iconSize / 2}" `)
    .replace('width="24"', `width="${iconSize}"`)
    .replace('height="24"', `height="${iconSize}"`);
  return `<circle r="${r + 2}" fill="#ffffff"/><circle r="${r}" fill="${xml(
    marker.color
  )}"/>${icon}`;
}
type Box = { x: number; y: number; width: number; height: number };
export interface MarkerLayout {
  marker: PosterMarker;
  x: number;
  y: number;
  inside: boolean;
  label?: Box;
}
const overlap = (a: Box, b: Box) =>
  a.x < b.x + b.width + 3 &&
  a.x + a.width + 3 > b.x &&
  a.y < b.y + b.height + 3 &&
  a.y + a.height + 3 > b.y;
export function layoutMarkers(map: MapData, s: Settings): MarkerLayout[] {
  const v = posterViewport(map, s),
    left = s.paper === "square" ? 115 : 35,
    top = s.paper === "square" ? 30 : 38;
  const inside = (x: number, y: number, inset = 0) =>
    s.template === "engraving"
      ? Math.hypot(x - left - v.size / 2, y - top - v.height / 2) <=
        v.size / 2 - inset
      : x >= left + inset &&
        x <= left + v.size - inset &&
        y >= top + inset &&
        y <= top + v.height - inset;
  const layouts: MarkerLayout[] = (s.markers ?? []).map((marker) => {
    const [mx, my] = mercator(marker.position),
      x = left + v.size / 2 + (mx - v.cx) * v.scale,
      y = top + v.height / 2 - (my - v.cy) * v.scale;
    return { marker, x, y, inside: inside(x, y) };
  });
  const occupied: Box[] = layouts
    .filter((l) => l.inside && l.marker.visible)
    .map((l) => ({
      x: l.x - l.marker.size / 2 - 2,
      y: l.y - l.marker.size / 2 - 2,
      width: l.marker.size + 4,
      height: l.marker.size + 4,
    }));
  for (const l of layouts) {
    const { marker: m, x, y } = l;
    if (!l.inside || !m.visible || !m.showLabel || !m.name.trim()) continue;
    const font = 12,
      width = Math.min(
        260,
        Array.from(m.name).reduce(
          (w, c) => w + (c.charCodeAt(0) > 255 ? font : font * 0.67),
          0
        ) + 16
      ),
      height = 23;
    const positions =
      m.labelPosition === "auto"
        ? ["bottom", "top", "right", "left"]
        : [
            m.labelPosition,
            ...["bottom", "top", "right", "left"].filter(
              (p) => p !== m.labelPosition
            ),
          ];
    for (const offset of [0, 12, 26]) {
      for (const side of positions) {
        const gap = m.size / 2 + 7 + offset;
        const box = {
          width,
          height,
          x:
            side === "left"
              ? x - gap - width
              : side === "right"
              ? x + gap
              : x - width / 2,
          y:
            side === "top"
              ? y - gap - height
              : side === "bottom"
              ? y + gap
              : y - height / 2,
        };
        if (
          [
            [box.x, box.y],
            [box.x + width, box.y],
            [box.x, box.y + height],
            [box.x + width, box.y + height],
          ].every(([px, py]) => inside(px, py, 3)) &&
          !occupied.some((b) => overlap(b, box))
        ) {
          l.label = box;
          occupied.push(box);
          break;
        }
      }
      if (l.label) break;
    }
  }
  return layouts;
}
export function renderMarkers(map: MapData, s: Settings): string {
  return `<g data-poster-markers="true">${layoutMarkers(map, s)
    .filter((l) => l.inside && l.marker.visible)
    .map(({ marker: m, x, y, label }) => {
      const labelSvg = label
        ? `<rect x="${label.x.toFixed(2)}" y="${label.y.toFixed(2)}" width="${
            label.width
          }" height="${
            label.height
          }" rx="4" fill="#ffffff" fill-opacity=".96"/><text x="${(
            label.x +
            label.width / 2
          ).toFixed(2)}" y="${(label.y + 15.5).toFixed(
            2
          )}" text-anchor="middle" font-family="'PingFang SC', 'Microsoft YaHei', Arial, sans-serif" font-size="12" fill="#30362f"${
            label.width >= 260
              ? ` textLength="${
                  label.width - 16
                }" lengthAdjust="spacingAndGlyphs"`
              : ""
          }>${xml(m.name)}</text>`
        : "";
      return `<g data-marker-id="${xml(m.id)}"><title>${xml(
        m.name || "标记"
      )}</title><g transform="translate(${x.toFixed(2)},${y.toFixed(
        2
      )})">${markerBadge(m)}</g>${labelSvg}</g>`;
    })
    .join("")}</g>`;
}
