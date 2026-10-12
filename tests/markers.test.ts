import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  DEFAULTS,
  MARKER_ICONS,
  MAX_MARKERS,
  validateDraft,
  type MapData,
  type PosterMarker,
} from "../src/model";
import { layoutMarkers, renderMarkers } from "../src/markers";
import { renderPoster } from "../src/renderer";
const map = JSON.parse(
  await readFile(new URL("../data/nanjing.json", import.meta.url), "utf8")
) as MapData;
const marker = (patch: Partial<PosterMarker> = {}): PosterMarker => ({
  id: "example",
  position: [...map.center],
  name: "家与回忆",
  icon: "home",
  color: "#6b856d",
  size: 26,
  visible: true,
  showLabel: true,
  labelPosition: "auto",
  ...patch,
});
test("markers follow geographic coordinates and physical scale, not screen pixels", () => {
  const m = marker({ position: [map.center[0] + 0.008, map.center[1]] });
  const a = layoutMarkers(map, { ...DEFAULTS, markers: [m] })[0];
  const b = layoutMarkers(map, {
    ...DEFAULTS,
    scaleDenominator: 10000,
    markers: [m],
  })[0];
  assert.ok(Math.abs(b.x - 350 - (a.x - 350) * 2) < 1e-7);
  const c = layoutMarkers(map, {
    ...DEFAULTS,
    center: m.position,
    markers: [m],
  })[0];
  assert.equal(c.x, 350);
  assert.equal(c.y, 353);
  const square = layoutMarkers(map, {
    ...DEFAULTS,
    paper: "square",
    center: m.position,
    markers: [m],
  })[0];
  assert.equal(square.x, 350);
  assert.equal(square.y, 265);
  assert.deepEqual(m.position, [map.center[0] + 0.008, map.center[1]]);
});
test("hidden and outside markers do not export, while all icon types stay vector", () => {
  const settings = {
    ...DEFAULTS,
    markers: [
      marker({ id: "hidden", visible: false }),
      marker({ id: "outside", position: [120, 32] }),
      ...MARKER_ICONS.map((icon, i) =>
        marker({
          id: icon,
          icon,
          position: [map.center[0] + i * 0.002, map.center[1]],
        })
      ),
    ],
  };
  const svg = renderPoster(map, settings);
  assert.doesNotMatch(
    svg,
    /data-marker-id="hidden"|data-marker-id="outside"|<image/
  );
  for (const icon of MARKER_ICONS)
    assert.ok(svg.includes(`data-marker-id="${icon}"`));
  assert.equal((svg.match(/data-marker-id=/g) ?? []).length, 6);
  assert.equal(
    layoutMarkers(map, settings).find((l) => l.marker.id === "outside")!.inside,
    false
  );
  const noLabel = renderMarkers(map, {
    ...DEFAULTS,
    markers: [marker({ showLabel: false })],
  });
  assert.doesNotMatch(noLabel, /<text/);
  assert.match(noLabel, /<title>家与回忆<\/title>/);
});
test("marker labels escape XML, avoid one another and stay within round frames", () => {
  const a = marker({ id: 'a"&', name: '<script> & "home"' }),
    b = marker({ id: "b", name: "纪念地点" });
  const settings = { ...DEFAULTS, markers: [a, b] };
  const svg = renderMarkers(map, settings);
  assert.match(svg, /&lt;script&gt; &amp; &quot;home&quot;/);
  assert.doesNotMatch(svg, /<script>/);
  assert.match(svg, /data-marker-id="a&quot;&amp;"/);
  const labels = layoutMarkers(map, settings).map((l) => l.label!);
  assert.ok(labels.every(Boolean));
  assert.ok(
    labels[0].y + labels[0].height < labels[1].y ||
      labels[1].y + labels[1].height < labels[0].y ||
      labels[0].x + labels[0].width < labels[1].x ||
      labels[1].x + labels[1].width < labels[0].x
  );
  for (const l of labels)
    for (const [x, y] of [
      [l.x, l.y],
      [l.x + l.width, l.y],
      [l.x, l.y + l.height],
      [l.x + l.width, l.y + l.height],
    ])
      assert.ok(Math.hypot(x - 350, y - 353) < 315);
});
test("marker drafts round-trip and reject malicious or malformed project state", () => {
  const draft = {
    version: 1,
    map,
    settings: { ...DEFAULTS, markers: [marker()] },
  };
  assert.ok(validateDraft(JSON.parse(JSON.stringify(draft))));
  assert.ok(validateDraft({ ...draft, settings: DEFAULTS }));
  for (const bad of [
    { position: [NaN, 32] },
    { position: [118, 90] },
    { color: "url(javascript:alert(1))" },
    { name: "a".repeat(41) },
    { size: 100 },
    { size: NaN },
    { icon: "toString" },
    { labelPosition: "unknown" },
    { visible: "yes" },
    { id: "" },
  ])
    assert.equal(
      validateDraft({
        ...draft,
        settings: {
          ...DEFAULTS,
          markers: [marker(bad as Partial<PosterMarker>)],
        },
      }),
      false
    );
  assert.equal(
    validateDraft({
      ...draft,
      settings: { ...DEFAULTS, markers: [marker(), marker()] },
    }),
    false
  );
  assert.equal(
    validateDraft({
      ...draft,
      settings: {
        ...DEFAULTS,
        markers: Array.from({ length: MAX_MARKERS + 1 }, (_, i) =>
          marker({ id: String(i) })
        ),
      },
    }),
    false
  );
});
