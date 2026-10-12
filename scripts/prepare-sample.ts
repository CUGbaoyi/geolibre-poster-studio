import { readFile, writeFile } from "node:fs/promises";
import { overpassJsonToGeoJson } from "../src/vendor/osm-downloader-api";
import { prepareFeatures } from "../src/data";
if (!process.argv[2]) throw new Error("Usage: npx tsx scripts/prepare-sample.ts overpass.json");
const raw = JSON.parse(
  await readFile(process.argv[2], "utf8")
);
if (raw.remark) throw new Error(raw.remark);
const data = prepareFeatures(overpassJsonToGeoJson(raw));
// Six decimal places retain approximately 0.1 m coordinate precision.
const compact = JSON.parse(
  JSON.stringify(data, (_k, v) =>
    typeof v === "number" ? Math.round(v * 1e6) / 1e6 : v
  )
);
const sample = {
  name: "南京 Nanjing",
  center: [118.79, 32.0525],
  bounds: [118.74, 32.01, 118.84, 32.095],
  fetchedAt: new Date().toISOString(),
  snapshotAt: raw.osm3s?.timestamp_osm_base,
  source: "https://overpass.private.coffee/api/interpreter",
  geojson: compact,
};
await writeFile(
  new URL("../data/nanjing.json", import.meta.url),
  JSON.stringify(sample)
);
console.log(
  JSON.stringify({
    features: data.features.length,
    buildings: data.features.filter((f) => f.properties?.building).length,
    roads: data.features.filter((f) => f.properties?.highway).length,
    date: sample.fetchedAt,
  })
);
