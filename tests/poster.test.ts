import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  DEFAULTS,
  validateDraft,
  boundsForCenter,
  type MapData,
} from "../src/model";
import { geometryPath, renderPoster, xml } from "../src/renderer";
import { findPlaces, loadMap } from "../src/data";
import { withPrintDensity } from "../src/png-density";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { unzipSync, strFromU8 } from "fflate";
const sample = JSON.parse(
  await readFile(new URL("../data/nanjing.json", import.meta.url), "utf8")
) as MapData;
test("real sample renders safe vector geometry and legal attribution in all layouts", () => {
  assert.ok(sample.geojson.features.length > 10000);
  for (const template of ["engraving", "linework"] as const)
    for (const paper of ["a3", "a4", "square"] as const) {
      const svg = renderPoster(sample, {
        ...DEFAULTS,
        template,
        paper,
        title: '<script> & "城"',
      });
      assert.match(svg, /&lt;script&gt; &amp;/);
      assert.doesNotMatch(svg, /<script>|NaN|Infinity|<image/);
      assert.match(svg, /OpenStreetMap contributors/);
      assert.match(svg, /openstreetmap.org\/copyright/);
      assert.match(
        svg,
        paper === "square" ? /viewBox="0 0 700 700"/ : /viewBox="0 0 700 990"/
      );
      assert.ok((svg.match(/M-?\d/g) ?? []).length > 5000);
    }
});
test("polygon holes and multipolygon rings retain independent closed paths", () => {
  const p = geometryPath(
    {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 0],
        ],
        [
          [1, 1],
          [2, 1],
          [1, 2],
          [1, 1],
        ],
      ],
    },
    (p) => [p[0], p[1]]
  );
  assert.equal((p.match(/M/g) ?? []).length, 2);
  assert.equal((p.match(/Z/g) ?? []).length, 2);
  assert.equal(
    geometryPath(
      {
        type: "LineString",
        coordinates: [
          [NaN, 2],
          [3, 4],
        ],
      },
      (p) => [p[0], p[1]]
    ),
    ""
  );
  assert.equal(xml('<&"'), "&lt;&amp;&quot;");
});
test("draft and bounds validation reject unsafe dimensions and project state", () => {
  const draft = { version: 1, settings: { ...DEFAULTS }, map: sample };
  assert.ok(validateDraft(draft));
  assert.equal(
    validateDraft({ ...draft, settings: { ...DEFAULTS, paper: "toString" } }),
    false
  );
  assert.equal(
    validateDraft({ ...draft, settings: { ...DEFAULTS, zoom: NaN } }),
    false
  );
  assert.equal(
    validateDraft({ ...draft, map: { ...sample, bounds: [170, 0, -170, 1] } }),
    false
  );
  assert.throws(() => boundsForCenter(179.99, 85));
});
test("coordinate entry validates without calling a geocoder", async () => {
  const p = await findPlaces("32.05, 118.79", new AbortController().signal, {
    nativeFetch: () => {
      throw new Error("network not needed");
    },
  });
  assert.equal(p[0].lon, 118.79);
  assert.equal(p[0].lat, 32.05);
  await assert.rejects(
    () => findPlaces("91, 118", new AbortController().signal),
    /纬度/
  );
});
test("map loader retries failed service, returns real geometry, and caches same extent", async () => {
  let calls = 0;
  const fakeFetch: typeof fetch = async () => {
    calls++;
    return calls === 1
      ? new Response("", { status: 503 })
      : Response.json({
          elements: [
            {
              id: 12,
              type: "way",
              tags: { highway: "primary" },
              geometry: [
                { lat: 30, lon: 114 },
                { lat: 30.001, lon: 114.001 },
              ],
            },
          ],
        });
  };
  const place = {
    name: "Test",
    lat: 30,
    lon: 114,
    title: "TEST",
    subtitle: "test",
  };
  const map = await loadMap(place, new AbortController().signal, {
    nativeFetch: fakeFetch,
  });
  assert.equal(map.geojson.features.length, 1);
  assert.equal(calls, 2);
  await loadMap(place, new AbortController().signal, {
    nativeFetch: fakeFetch,
  });
  assert.equal(calls, 2);
  await assert.rejects(
    () =>
      loadMap(
        place,
        AbortSignal.abort(),
        { nativeFetch: fakeFetch },
        [113.99, 29.99, 114.01, 30.01]
      ),
    /已取消/
  );
});
test("300 dpi metadata replaces existing pHYs without duplicate chunks", () => {
  const tiny = Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==",
      "base64"
    )
  );
  const result = withPrintDensity(tiny),
    twice = withPrintDensity(result);
  assert.deepEqual(result, twice);
  const offset = Buffer.from(result).indexOf("pHYs");
  assert.ok(offset > 0);
  assert.equal(new DataView(result.buffer).getUint32(offset + 4), 11811);
  assert.equal(result[offset + 12], 1);
});
test("release ZIP includes matching metadata, source data and licenses", async () => {
  const files = unzipSync(new Uint8Array(await readFile(new URL("../artifacts/poster-studio-0.5.0.zip", import.meta.url))));
  const manifest = JSON.parse(strFromU8(files["plugin.json"]));
  const { default: plugin } = await import("../dist/index.js");
  for (const key of ["id", "name", "version"] as const) assert.equal(plugin[key], manifest[key]);
  assert.ok(files[manifest.entry].length < 50 * 1024 * 1024);
  for (const name of ["LICENSE", "DATA-LICENSE.txt", "data/nanjing.json", "licenses/GEOLIBRE-LICENSE.txt", "screenshots/overview.jpg"])
    assert.ok(files[name]?.length, name);
});

test("release ZIP passes the actual GeoLibre installer validation", {
  skip: !process.env.GEOLIBRE_CHECKOUT && "Set GEOLIBRE_CHECKOUT to an installed GeoLibre source checkout",
}, async () => {
  const url = pathToFileURL(path.resolve(process.env.GEOLIBRE_CHECKOUT!, "apps/geolibre-desktop/src/lib/plugin-archive-unpack.ts"));
  const { bundleFromZipBytes } = await import(url.href);
  const zip = new Uint8Array(await readFile(new URL("../artifacts/poster-studio-0.5.0.zip", import.meta.url)));
  const bundle = await bundleFromZipBytes("poster-studio-0.5.0.zip", zip);
  assert.equal(bundle.manifest.id, "poster-studio");
  assert.ok(bundle.entrySource.includes("poster-studio-menu"));
});
