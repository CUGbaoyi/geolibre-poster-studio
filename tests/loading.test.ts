import test from "node:test";
import assert from "node:assert/strict";
import { loadMap } from "../src/data";
const place = {
  name: "Suzhou",
  title: "SUZHOU",
  subtitle: "苏州",
  lon: 120.62,
  lat: 31.31,
};
const box = (offset: number): [number, number, number, number] => [
  120.61 + offset,
  31.3,
  120.63 + offset,
  31.32,
];
const raw = {
  elements: [
    {
      type: "way",
      id: 1,
      tags: { highway: "primary" },
      geometry: [
        { lon: 120.62, lat: 31.31 },
        { lon: 120.621, lat: 31.311 },
      ],
    },
  ],
};

test("stalled headers and stalled response bodies both hit deadlines and leave a retryable error", async () => {
  for (const phase of ["headers", "body"]) {
    let calls = 0;
    const stages: string[] = [];
    const signals: AbortSignal[] = [];
    const nativeFetch = (async (_url, init) => {
      calls++;
      signals.push(init!.signal!);
      if (phase === "headers") return await new Promise<Response>(() => {});
      return { ok: true, json: () => new Promise(() => {}) } as Response;
    }) as typeof fetch;
    await assert.rejects(
      loadMap(place, new AbortController().signal, { nativeFetch }, box(0), {
        requestTimeoutMs: 10,
        onProgress: (message) => stages.push(message),
      }),
      /地图服务暂未完成/
    );
    assert.equal(calls, 2);
    assert.ok(signals.every((signal) => signal.aborted));
    assert.ok(stages.some((stage) => stage.includes("备用")));
  }
});

test("cancel interrupts a native fetch that ignores abort without starting a fallback", async () => {
  const c = new AbortController();
  let calls = 0;
  const nativeFetch = (async () => {
    calls++;
    queueMicrotask(() => c.abort());
    return await new Promise<Response>(() => {});
  }) as typeof fetch;
  await assert.rejects(
    loadMap(place, c.signal, { nativeFetch }, box(0.1)),
    /已取消/
  );
  assert.equal(calls, 1);
});

test("timeouts recover on fallback; a contained crop reuses geometry and respects pre-cancel", async () => {
  let calls = 0;
  const stages: string[] = [];
  const nativeFetch = (async (_url, init) => {
    calls++;
    assert.equal(init!.method, "POST");
    assert.match(decodeURIComponent(String(init!.body)), /timeout:20/);
    return calls === 1
      ? await new Promise<Response>(() => {})
      : Response.json(raw);
  }) as typeof fetch;
  const bounds = box(0.2);
  await loadMap(place, new AbortController().signal, { nativeFetch }, bounds, {
    requestTimeoutMs: 10,
  });
  const small: typeof bounds = [
    bounds[0] + 0.002,
    bounds[1] + 0.002,
    bounds[2] - 0.002,
    bounds[3] - 0.002,
  ];
  const cached = await loadMap(
    { ...place, name: "Nearby", lon: 120.82 },
    new AbortController().signal,
    { nativeFetch },
    small,
    { onProgress: (stage) => stages.push(stage) }
  );
  assert.equal(calls, 2);
  assert.equal(cached.name, "Nearby");
  assert.deepEqual(cached.center, [120.82, 31.31]);
  assert.match(stages[0], /缓存/);
  await assert.rejects(
    loadMap(place, AbortSignal.abort(), { nativeFetch }, bounds),
    /已取消/
  );
  assert.equal(calls, 2);
});

test("partial Overpass results with a timeout remark are never treated as a complete map", async () => {
  let calls = 0;
  const nativeFetch = (async () => {
    calls++;
    return Response.json({ ...raw, remark: "runtime error: Query timed out" });
  }) as typeof fetch;
  await assert.rejects(
    loadMap(place, new AbortController().signal, { nativeFetch }, box(0.3)),
    /Query timed out/
  );
  assert.equal(calls, 2);
});
