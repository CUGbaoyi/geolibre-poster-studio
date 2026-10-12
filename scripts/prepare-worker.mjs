import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
await mkdir(new URL("../src/generated", import.meta.url), { recursive: true });
await build({
  entryPoints: [require.resolve("maplibre-gl/dist/maplibre-gl-worker.mjs")],
  outfile: new URL("../src/generated/map-worker.js", import.meta.url).pathname,
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: true,
  legalComments: "eof",
});
