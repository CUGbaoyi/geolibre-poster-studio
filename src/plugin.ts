import { mountStudio } from "./mount";
import { validateDraft, type Draft, type Host } from "./model";
let dispose: (() => void) | undefined,
  unregister: (() => void) | undefined,
  dialog: HTMLDialogElement | undefined,
  saved: Draft | undefined,
  timer: ReturnType<typeof setTimeout> | undefined;
function close() {
  dispose?.();
  dispose = undefined;
  dialog?.close();
  dialog?.remove();
  dialog = undefined;
}
function open(host: Host) {
  if (dialog?.open) return;
  dialog = document.createElement("dialog");
  dialog.setAttribute("aria-label", "Poster Studio 地图海报编辑器");
  dialog.style.cssText =
    "position:fixed;inset:0;margin:auto;padding:0;border:0;border-radius:8px;width:calc(100vw - 32px);height:calc(100vh - 32px);max-width:1600px;max-height:1100px;overflow:hidden;background:#f2f1ee;color:#252a29;box-shadow:0 24px 100px #0005;";
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
  });
  document.body.append(dialog);
  dialog.showModal();
  // Native dialog is not a valid shadow host in Chromium/WebKit; use a div.
  const surface = document.createElement("div");
  surface.style.cssText = "width:100%;height:100%;";
  dialog.append(surface);
  dispose = mountStudio(surface, {
    host,
    initial: saved,
    onClose: close,
    onChange: (d) => {
      saved = d;
    },
  });
}
const plugin = {
  id: "poster-studio",
  name: "Poster Studio · 地图海报",
  version: "0.5.0",
  engines: ["maplibre", "cesium"],
  activate(host: Host) {
    unregister?.();
    unregister = host.registerToolbarMenu?.({
      id: "poster-studio-menu",
      label: "Poster Studio",
      items: [
        {
          id: "open-poster-studio",
          label: "地图海报工坊",
          onSelect: () => open(host),
        },
      ],
    });
    clearTimeout(timer);
    timer = setTimeout(() => open(host), 0);
  },
  deactivate() {
    clearTimeout(timer);
    close();
    unregister?.();
    unregister = undefined;
  },
  getProjectState() {
    return saved;
  },
  applyProjectState(host: Host, state: unknown) {
    if (!validateDraft(state)) return false;
    saved = state;
    if (dialog?.open) {
      close();
      open(host);
    }
    return true;
  },
};
export default plugin;
