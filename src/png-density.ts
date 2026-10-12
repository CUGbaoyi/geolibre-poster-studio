/** Insert pHYs so print applications read the intended resolution, not canvas's 96 dpi. */
export function withPrintDensity(bytes: Uint8Array, dpi = 300): Uint8Array {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((b, i) => bytes[i] === b))
    throw new Error("Invalid PNG");
  const chunk = new Uint8Array(21),
    view = new DataView(chunk.buffer);
  view.setUint32(0, 9);
  chunk.set([112, 72, 89, 115], 4);
  const ppm = Math.round(dpi / 0.0254);
  view.setUint32(8, ppm);
  view.setUint32(12, ppm);
  chunk[16] = 1;
  let crc = 0xffffffff;
  for (const b of chunk.slice(4, 17)) {
    crc ^= b;
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  view.setUint32(17, (crc ^ 0xffffffff) >>> 0);
  const chunks: Uint8Array[] = [bytes.slice(0, 8)];
  let offset = 8;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error("Truncated PNG");
    const length = new DataView(
        bytes.buffer,
        bytes.byteOffset + offset,
        4
      ).getUint32(0),
      end = offset + 12 + length;
    if (end > bytes.length) throw new Error("Truncated PNG");
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    if (type !== "pHYs") chunks.push(bytes.slice(offset, end));
    if (type === "IHDR") chunks.push(chunk);
    offset = end;
  }
  const result = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let i = 0;
  for (const c of chunks) {
    result.set(c, i);
    i += c.length;
  }
  return result;
}
