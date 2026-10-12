import { build } from "esbuild";
import { readFile, writeFile, mkdir, cp } from "node:fs/promises";
import { zipSync, strToU8 } from "fflate";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cssPlugin = {
  name: "inline-css",
  setup(b) {
    b.onResolve({ filter: /\.(css\?inline|js\?raw)$/ }, (a) => ({
      path: a.path.startsWith(".")
        ? path.resolve(a.resolveDir, a.path.replace(/\?(inline|raw)$/, ""))
        : require.resolve(a.path.replace(/\?(inline|raw)$/, "")),
      namespace: "inline-css",
    }));
    b.onLoad({ filter: /.*/, namespace: "inline-css" }, async (a) => ({
      contents: await readFile(a.path, "utf8"),
      loader: "text",
    }));
  },
};
await mkdir(path.join(root, "dist"), { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ["src/plugin.ts"],
  outfile: "dist/index.js",
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
  loader: { ".woff2": "dataurl" },
  plugins: [cssPlugin],
  legalComments: "eof",
});
await cp(path.join(root, "plugin.json"), path.join(root, "dist/plugin.json"));
const files = {
  "plugin.json": new Uint8Array(await readFile(path.join(root, "plugin.json"))),
  "index.js": new Uint8Array(await readFile(path.join(root, "dist/index.js"))),
};
for (const name of [
  "GEOLIBRE-LICENSE",
  "FONT-LICENSE",
  "LUCIDE-LICENSE",
  "REACT-LICENSE",
  "MAPLIBRE-LICENSE",
  "FFLATE-LICENSE",
])
  files[`licenses/${name}.txt`] = new Uint8Array(
    await readFile(path.join(root, "src/vendor", name))
  );
files["README.md"] = new Uint8Array(
  await readFile(path.join(root, "README.md"))
);
files["data/nanjing.json"] = new Uint8Array(
  await readFile(path.join(root, "data/nanjing.json"))
);
files["DATA-LICENSE.txt"] = strToU8(
  "Map data © OpenStreetMap contributors. Licensed under ODbL 1.0. https://www.openstreetmap.org/copyright\nThe enclosed data/nanjing.json contains the sample database used in this bundle.\n"
);
for (const name of ["LICENSE", "README.zh-CN.md", "screenshots/overview.jpg"])
  files[name] = new Uint8Array(await readFile(path.join(root, name)));
await mkdir(path.join(root, "artifacts"), { recursive: true });
const zip = zipSync(files, { level: 6 });
await writeFile(
  path.join(
    root,
    `artifacts/poster-studio-${
      JSON.parse(await readFile(path.join(root, "plugin.json"), "utf8")).version
    }.zip`
  ),
  zip
);
console.log(
  `Built Poster Studio: ${(files["index.js"].length / 1048576).toFixed(
    2
  )} MiB JS, ${(zip.length / 1048576).toFixed(2)} MiB ZIP`
);
