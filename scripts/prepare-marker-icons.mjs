// Generate exportable SVG from the same pinned Lucide components used by the UI.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MapPin, Star, Heart, House, Camera, Flag } from "lucide-react";
import { writeFile } from "node:fs/promises";
const icons = Object.fromEntries(
  Object.entries({
    pin: MapPin,
    star: Star,
    heart: Heart,
    home: House,
    camera: Camera,
    flag: Flag,
  }).map(([key, Icon]) => [
    key,
    renderToStaticMarkup(
      createElement(Icon, { size: 24, strokeWidth: 2, color: "#ffffff" })
    ),
  ])
);
await writeFile(
  new URL("../src/vendor/marker-icons.json", import.meta.url),
  JSON.stringify(icons, null, 2) + "\n"
);
