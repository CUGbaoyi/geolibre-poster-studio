import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DEFAULTS, validateDraft, type MapData } from "../src/model";
import {
  posterViewport,
  mercator,
  covers,
  bufferedBounds,
} from "../src/viewport";
import { renderPoster, resolvedPalette, PALETTES } from "../src/renderer";
const map = JSON.parse(
  await readFile(new URL("../data/nanjing.json", import.meta.url), "utf8")
) as MapData;
test("print scale uses physical paper width and latitude-correct ground distance", () => {
  const a3 = posterViewport(map, DEFAULTS);
  assert.ok(Math.abs(a3.widthKm - 5.345454545) < 1e-6);
  const a4 = posterViewport(map, { ...DEFAULTS, paper: "a4" });
  assert.ok(Math.abs(a4.widthKm - 3.78) < 1e-8);
  for (const lat of [0, 32, 60, 79]) {
    const v = posterViewport(map, { ...DEFAULTS, center: [118, lat] });
    const dx =
      mercator(v.bounds.slice(2))[0] - mercator(v.bounds.slice(0, 2))[0];
    assert.ok(
      Math.abs(
        (dx * 6378137 * Math.cos((lat * Math.PI) / 180)) / 1000 - a3.widthKm
      ) < 1e-8
    );
  }
  const zoomOut = posterViewport(map, { ...DEFAULTS, scaleDenominator: 40000 });
  assert.equal(zoomOut.widthKm, a3.widthKm * 2);
});
test("point selection changes the crop and coordinates, retaining fetched coverage", () => {
  const v = posterViewport(map, DEFAULTS);
  assert.ok(covers(map.bounds, v.bounds));
  const shifted = {
    ...DEFAULTS,
    center: [118.796, 32.058] as [number, number],
  };
  assert.ok(covers(map.bounds, posterViewport(map, shifted).bounds));
  const svg = renderPoster(map, shifted);
  assert.match(svg, /32.0580° N/);
  assert.notEqual(svg, renderPoster(map, DEFAULTS));
  assert.equal(map.center[0], 118.79);
  assert.ok(
    !covers(
      map.bounds,
      posterViewport(map, { ...DEFAULTS, center: [120, 32] }).bounds
    )
  );
  assert.ok(covers(bufferedBounds(v.bounds), v.bounds));
});
test("old drafts preserve their previous crop while new colors and scale survive validation", () => {
  const old = { ...DEFAULTS, scaleDenominator: undefined, zoom: 1.8 };
  assert.ok(validateDraft({ version: 1, settings: old, map }));
  const view = posterViewport(map, old);
  const converted = posterViewport(map, {
    ...old,
    scaleDenominator: view.denominator,
  });
  assert.ok(Math.abs(view.scale - converted.scale) < 1e-8);
  const custom = {
    ...DEFAULTS,
    colors: { water: "#336699", roads: "#123456", buildings: "#abcdef" },
  };
  assert.ok(
    validateDraft(
      JSON.parse(JSON.stringify({ version: 1, settings: custom, map }))
    )
  );
  const palette = resolvedPalette(custom);
  assert.equal(palette.water, "#336699");
  assert.equal(palette.paper, PALETTES.clay.paper);
  assert.deepEqual(palette.buildings, ["#abcdef"]);
  const svg = renderPoster(map, custom);
  assert.match(svg, /fill="#336699"/);
  assert.match(svg, /stroke="#123456"/);
  assert.match(svg, /fill="#abcdef"/);
  for (const patch of [
    { colors: { water: '"/><script/>' } },
    { colors: { invalid: "#123456" } },
    { center: [0, 89] },
    { scaleDenominator: 0 },
    { scaleDenominator: Infinity },
  ]) {
    assert.equal(
      validateDraft({ version: 1, settings: { ...DEFAULTS, ...patch }, map }),
      false
    );
  }
});
