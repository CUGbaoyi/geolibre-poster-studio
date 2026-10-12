import { createRoot } from "react-dom/client";
import { Studio } from "./Studio";
import type { Draft, Host } from "./model";
import mapCss from "maplibre-gl/dist/maplibre-gl.css?inline";
import css from "./studio.css?inline";
import font from "@fontsource-variable/ibm-plex-sans/files/ibm-plex-sans-latin-wght-normal.woff2";
export function mountStudio(
  element: HTMLElement,
  props: {
    host?: Host;
    onClose?: () => void;
    initial?: Draft;
    onChange?: (d: Draft) => void;
  }
) {
  const shadow = element.attachShadow({ mode: "open" }),
    style = document.createElement("style"),
    mount = document.createElement("div");
  style.textContent = `@font-face{font-family:'IBM Plex Sans';font-style:normal;font-weight:100 700;font-display:swap;src:url('${font}') format('woff2');}${mapCss}${css}`;
  mount.style.cssText = "height:100%;width:100%;";
  shadow.append(style, mount);
  const root = createRoot(mount);
  root.render(<Studio {...props} />);
  return () => root.unmount();
}
