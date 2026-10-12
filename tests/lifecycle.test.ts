import test from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { readFile } from "node:fs/promises";
import type { Host } from "../src/model";
test("packaged plugin opens, closes, restores state and cleans up its menu", async () => {
  const window = new Window({ url: "http://localhost" });
  Object.assign(globalThis, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    HTMLDialogElement: window.HTMLDialogElement,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
  });
  const { default: plugin } = await import("../dist/index.js");
  let open: (() => void) | undefined,
    unregistered = 0;
  const host: Host = {
    registerToolbarMenu: (menu) => {
      open = menu.items[0].onSelect;
      return () => {
        unregistered++;
      };
    },
  };
  plugin.activate(host);
  plugin.deactivate(host);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(document.querySelectorAll("dialog").length, 0);
  plugin.activate(host);
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(document.querySelectorAll("dialog").length, 1);
  const sample = JSON.parse(
    await readFile(new URL("../data/nanjing.json", import.meta.url), "utf8")
  );
  const state = {
    version: 1,
    settings: {
      template: "linework",
      palette: "sage",
      title: "RESTORED",
      subtitle: "恢复",
      paper: "a3",
      zoom: 1,
      markers: [
        {
          id: "home",
          name: "保存的地点",
          position: sample.center,
          icon: "home",
          color: "#6b856d",
          size: 26,
          visible: true,
          showLabel: true,
          labelPosition: "auto",
        },
      ],
    },
    map: sample,
  };
  assert.equal(plugin.applyProjectState(host, state), true);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(plugin.getProjectState().settings.title, "RESTORED");
  assert.equal(plugin.getProjectState().settings.markers[0].name, "保存的地点");
  const shadow = document.querySelector("dialog > div")!.shadowRoot!;
  (shadow.querySelector(".marker-row") as HTMLElement).click();
  await new Promise((resolve) => setTimeout(resolve, 40));
  const click = (text: string) =>
    (
      Array.from(shadow.querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === text
      ) as HTMLElement
    ).click();
  click("隐藏");
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(plugin.getProjectState().settings.markers[0].visible, false);
  click("删除");
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(plugin.getProjectState().settings.markers.length, 0);
  click("撤销");
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(plugin.getProjectState().settings.markers[0].name, "保存的地点");
  assert.equal(plugin.getProjectState().settings.markers[0].visible, false);
  assert.equal(plugin.applyProjectState(host, { version: 99 }), false);
  window.document
    .querySelector("dialog")!
    .dispatchEvent(new window.Event("cancel", { cancelable: true }));
  assert.equal(document.querySelectorAll("dialog").length, 0);
  open?.();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(document.querySelectorAll("dialog").length, 1);
  plugin.deactivate(host);
  assert.equal(document.querySelectorAll("dialog").length, 0);
  assert.equal(unregistered, 2);
  await window.happyDOM.close();
});
