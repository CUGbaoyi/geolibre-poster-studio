import { withPrintDensity } from "./png-density";
import { PAPERS, type Paper } from "./model";
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export const fileName = (title: string, extension: string) =>
  `${
    title
      .replace(/[^\p{L}\p{N} _-]/gu, "")
      .trim()
      .slice(0, 55) || "map"
  }-poster.${extension}`;
export async function pngBlob(svg: string, paper: Paper): Promise<Blob> {
  const p = PAPERS[paper],
    width = Math.round((p.width / 25.4) * 300),
    height = Math.round((p.height / 25.4) * 300);
  const url = URL.createObjectURL(
    new Blob([svg], { type: "image/svg+xml;charset=utf-8" })
  );
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("浏览器无法创建高清画布。");
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("PNG 编码失败。"))),
        "image/png"
      )
    );
    return new Blob(
      [
        withPrintDensity(
          new Uint8Array(await blob.arrayBuffer())
        ) as Uint8Array<ArrayBuffer>,
      ],
      { type: "image/png" }
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
