import { useEffect, useMemo, useRef, useState } from "react";
import {
  MapPin,
  Search,
  Download,
  Check,
  Save,
  X,
  LocateFixed,
  RotateCcw,
  ArrowUpRight,
} from "lucide-react";
import {
  DEFAULTS,
  PAPERS,
  coordinateText,
  validCenter,
  COLOR_KEYS,
  MAX_MARKERS,
  type PosterMarker,
  type ColorKey,
  type Draft,
  type Host,
  type Settings,
  type MapData,
  type Template,
  type PaletteKey,
} from "./model";
import { renderPoster, PALETTES, resolvedPalette } from "./renderer";
import { findPlaces, loadMap, type Place } from "./data";
import { download, fileName, pngBlob } from "./export";
import { readDraft, writeDraft } from "./storage";
import { MarkerEditor, type PickMode } from "./MarkerEditor";
import { OfflineCities } from "./OfflineCities";
import { LoadingStatus } from "./LoadingStatus";
import { MapPicker } from "./MapPicker";
import { posterViewport, covers, bufferedBounds } from "./viewport";
import sample from "../data/nanjing.json";
export const SAMPLE = sample as MapData;
export function initialDraft(): Draft {
  return { version: 1, settings: { ...DEFAULTS }, map: SAMPLE };
}
export function Studio({
  host,
  onClose,
  initial,
  onChange,
}: {
  host?: Host;
  onClose?: () => void;
  initial?: Draft;
  onChange?: (d: Draft) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => initial ?? initialDraft());
  const { settings: s, map } = draft;
  const [pickMode, setPickMode] = useState<PickMode>("center");
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
  const [deletedMarker, setDeletedMarker] = useState<{
    marker: PosterMarker;
    index: number;
  } | null>(null);
  const markerEditorRef = useRef<HTMLDivElement>(null);
  const latest = useRef(draft);
  latest.current = draft;
  const dirty = useRef(false);
  const [query, setQuery] = useState(map.name),
    [places, setPlaces] = useState<Place[]>([]),
    [busy, setBusy] = useState(""),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false),
    [format, setFormat] = useState<"svg" | "png">("svg");
  const controller = useRef<AbortController | null>(null),
    alive = useRef(true);
  const centerLon = s.center?.[0],
    centerLat = s.center?.[1];
  const viewport = posterViewport(map, s);
  const complete = covers(map.bounds, viewport.bounds);
  const [retry, setRetry] = useState(0);
  const [mapLoading, setMapLoading] = useState(false);
  const [mapProgress, setMapProgress] = useState("");
  const [loadStartedAt, setLoadStartedAt] = useState(0);
  const [placeLoading, setPlaceLoading] = useState(false);
  const [retryPlace, setRetryPlace] = useState<{
    place: Place;
    bounds?: [number, number, number, number];
  } | null>(null);
  const color = resolvedPalette(s);
  const coverageController = useRef<AbortController | null>(null);
  const svg = useMemo(() => renderPoster(map, s), [map, s]);
  const thumbs = useMemo(
    () =>
      Object.fromEntries(
        ["linework", "engraving"].map((t) => [
          t,
          renderPoster(
            map,
            { ...s, template: t as Template },
            { mini: true, id: `thumb-${t}` }
          ),
        ])
      ),
    [map, s]
  );
  useEffect(() => {
    onChange?.(draft);
  }, [draft, onChange]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    if (!initial)
      void readDraft()
        .then((d) => {
          if (d && !cancelled && !dirty.current) {
            setDraft(d);
            setQuery(d.map.name);
            setSaved(true);
          }
        })
        .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [initial]);
  useEffect(() => {
    if (complete) {
      setMapLoading(false);
      return;
    }
    const c = new AbortController();
    coverageController.current = c;
    setLoadStartedAt(Date.now());
    setMapLoading(true);
    setMapProgress("正在准备所选范围…");
    setError("");
    const timeout = setTimeout(() => {
      const current = latest.current;
      const view = posterViewport(current.map, current.settings);
      const [lon, lat] = view.center;
      void loadMap(
        {
          name: "地图选点",
          lon,
          lat,
          title: current.settings.title,
          subtitle: current.settings.subtitle,
        },
        c.signal,
        host,
        bufferedBounds(view.bounds),
        {
          offlineBounds: view.bounds,
          onProgress: (text) => {
            if (!c.signal.aborted && alive.current) setMapProgress(text);
          },
        }
      )
        .then((next) => {
          if (!c.signal.aborted) {
            setDraft((d) => ({ ...d, map: next }));
            setSaved(false);
          }
        })
        .catch((e) => {
          if (!c.signal.aborted && alive.current)
            setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (!c.signal.aborted && alive.current) setMapLoading(false);
        });
    }, 650);
    return () => {
      clearTimeout(timeout);
      c.abort();
    };
  }, [
    centerLon,
    centerLat,
    s.scaleDenominator,
    s.zoom,
    s.paper,
    s.template,
    map,
    complete,
    retry,
    host,
  ]);
  const update = (patch: Partial<Settings>) => {
    dirty.current = true;
    setDraft((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
    setSaved(false);
  };
  const editMarker = (id: string, patch: Partial<PosterMarker>) => {
    if (patch.position && !validCenter(patch.position)) return;
    dirty.current = true;
    setDraft((d) => ({
      ...d,
      settings: {
        ...d.settings,
        markers: (d.settings.markers ?? []).map((m) =>
          m.id === id ? { ...m, ...patch } : m
        ),
      },
    }));
    setSaved(false);
  };
  const selectMarker = (id: string) => {
    setSelectedMarkerId(id);
    setPickMode("center");
    markerEditorRef.current?.scrollIntoView({ block: "nearest" });
  };
  const mapPick = (position: [number, number]) => {
    if (!validCenter(position)) {
      setError("请选择纬度 ±79°、经度 ±179° 内的地点。");
      return;
    }
    if (pickMode === "add") {
      const markers = latest.current.settings.markers ?? [];
      if (markers.length >= MAX_MARKERS) {
        setError(`一幅海报最多添加 ${MAX_MARKERS} 个标记。`);
        return;
      }
      const marker: PosterMarker = {
        id: crypto.randomUUID(),
        position,
        name: `重要地点 ${markers.length + 1}`,
        icon: "pin",
        color: "#a75337",
        size: 26,
        visible: true,
        showLabel: true,
        labelPosition: "auto",
      };
      update({ markers: [...markers, marker] });
      setSelectedMarkerId(marker.id);
      setError("");
      setNotice("");
      markerEditorRef.current?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (pickMode === "move" && selectedMarkerId) {
      editMarker(selectedMarkerId, { position });
      setPickMode("center");
      return;
    }
    controller.current?.abort();
    setBusy("");
    setPlaceLoading(false);
    setRetryPlace(null);
    setPlaces([]);
    setNotice("");
    update({
      center: position,
      scaleDenominator: Math.max(
        5000,
        Math.min(40000, Math.round(viewport.denominator))
      ),
    });
  };
  const message = (msg: string) => {
    setNotice(msg);
    setError("");
  };
  const failed = (e: unknown) => {
    if (alive.current) setError(e instanceof Error ? e.message : String(e));
  };
  const start = () => {
    controller.current?.abort();
    coverageController.current?.abort();
    setMapLoading(false);
    setPlaceLoading(false);
    setRetryPlace(null);
    const c = new AbortController();
    controller.current = c;
    setError("");
    setNotice("");
    return c;
  };
  async function selectPlace(
    place: Place,
    bounds?: [number, number, number, number],
    scaleOverride?: number
  ) {
    dirty.current = true;
    const c = start();
    setLoadStartedAt(Date.now());
    setPlaceLoading(true);
    setBusy("正在准备地图数据…");
    setPlaces([]);
    try {
      const settings = latest.current.settings;
      const scaleDenominator =
        scaleOverride ??
        settings.scaleDenominator ??
        Math.round(posterViewport(latest.current.map, settings).denominator);
      const viewBounds = posterViewport(latest.current.map, {
        ...settings,
        center: [place.lon, place.lat],
        scaleDenominator,
      }).bounds;
      const requestedBounds = bounds ?? bufferedBounds(viewBounds);
      const next = await loadMap(place, c.signal, host, requestedBounds, {
        offlineBounds: viewBounds,
        onProgress: (text) => {
          if (!c.signal.aborted && alive.current) setBusy(text);
        },
      });
      if (!c.signal.aborted) {
        setDraft((d) => ({
          ...d,
          map: next,
          settings: {
            ...d.settings,
            title: place.title.slice(0, 60),
            subtitle: place.subtitle.slice(0, 80),
            zoom: 1,
            scaleDenominator,
            center: [place.lon, place.lat],
          },
        }));
        setQuery(place.name);
        setSaved(false);
        message("地图已更新");
      }
    } catch (e) {
      if (!c.signal.aborted) {
        failed(e);
        if (alive.current) setRetryPlace({ place, bounds });
      }
    } finally {
      if (controller.current === c && alive.current) {
        setBusy("");
        setPlaceLoading(false);
      }
    }
  }
  async function search() {
    if (!query.trim()) return;
    dirty.current = true;
    if (/^(南京|nanjing)(\s+nanjing)?$/i.test(query.trim())) {
      start();
      setBusy("");
      setDraft((d) => ({
        ...d,
        map: SAMPLE,
        settings: {
          ...d.settings,
          title: "NANJING",
          subtitle: "南京",
          zoom: 1,
          center: undefined,
          scaleDenominator: 20000,
        },
      }));
      setQuery(SAMPLE.name);
      setSaved(false);
      setPlaces([]);
      message("已载入南京离线地图");
      return;
    }
    const c = start();
    setBusy("正在查找地点…");
    try {
      const results = await findPlaces(query.trim(), c.signal, host);
      if (c.signal.aborted) return;
      setBusy("");
      if (results.length === 1) {
        await selectPlace(results[0]);
        return;
      }
      setPlaces(results);
      if (!results.length)
        setError("没有找到这个地点。试试城市英文名或「纬度, 经度」。");
    } catch (e) {
      if (!c.signal.aborted) failed(e);
    } finally {
      if (controller.current === c && alive.current) setBusy("");
    }
  }
  async function currentView() {
    const bounds = host?.getViewBounds?.();
    if (!bounds) {
      setError("请先在 GeoLibre 中打开地图。");
      return;
    }
    const lon = (bounds[0] + bounds[2]) / 2,
      lat = (bounds[1] + bounds[3]) / 2;
    await selectPlace(
      {
        name: "当前地图范围",
        lon,
        lat,
        title: "MY CITY",
        subtitle: "此刻 · 此地",
      },
      bounds
    );
  }
  async function save() {
    if (!complete || mapLoading || busy) return;
    try {
      await writeDraft(draft);
      if (!alive.current) return;
      setSaved(latest.current === draft);
      message("草稿已保存在这台设备，下次打开可继续编辑。");
    } catch {
      failed(new Error("无法保存草稿，请检查浏览器存储权限或导出海报。"));
    }
  }
  async function exportPoster() {
    if (!complete || mapLoading || busy) return;
    setError("");
    setBusy(format === "png" ? "正在生成 300 dpi 图片…" : "正在导出矢量海报…");
    try {
      if (format === "svg") {
        const text = `<?xml version="1.0" encoding="UTF-8"?>\n${svg}`;
        if (host?.exportTextFile)
          host.exportTextFile(fileName(s.title, "svg"), text, {
            extensions: ["svg"],
            mimeType: "image/svg+xml",
            description: "SVG 地图海报",
          });
        else
          download(
            new Blob([text], { type: "image/svg+xml;charset=utf-8" }),
            fileName(s.title, "svg")
          );
      } else {
        const blob = await pngBlob(svg, s.paper);
        if (!alive.current) return;
        download(blob, fileName(s.title, "png"));
      }
      if (alive.current) message("已发起导出，请在保存窗口或下载列表中查看。");
    } catch (e) {
      failed(e);
    } finally {
      if (alive.current) setBusy("");
    }
  }
  const counts = useMemo(
    () => ({
      buildings: map.geojson.features.filter((f) => f.properties?.building)
        .length,
      roads: map.geojson.features.filter((f) => f.properties?.highway).length,
    }),
    [map]
  );
  return (
    <div className="studio">
      <header className="topbar">
        <div className="brand">
          <strong>GeoLibre</strong>
          <span className="slash">/</span>
          <span>Poster Studio</span>
          <span className="edition">地图海报工坊</span>
        </div>
        <div className="top-actions">
          <button
            className="quiet"
            onClick={save}
            disabled={!complete || mapLoading || !!busy}
          >
            {saved ? <Check size={16} /> : <Save size={16} />}
            <span>{saved ? "已保存" : "保存草稿"}</span>
          </button>
          {onClose && (
            <button
              className="icon-button"
              aria-label="关闭海报编辑器"
              onClick={onClose}
            >
              <X size={19} />
            </button>
          )}
        </div>
      </header>
      <main className="workspace">
        <div className="composition">
          <MapPicker
            data={map}
            settings={s}
            onPick={mapPick}
            mode={pickMode}
            selectedId={selectedMarkerId}
            onMode={setPickMode}
            onMarkerSelect={selectMarker}
            onMarkerMove={(id, position) => editMarker(id, { position })}
          />
          <section className="canvas-area" aria-label="海报预览">
            <div className="canvas-meta">
              <span>
                {s.template === "engraving"
                  ? "NEIGHBORHOOD / 街区版画"
                  : "CITY ATLAS / 城市线稿"}
              </span>
              <span>
                {PAPERS[s.paper].width} × {PAPERS[s.paper].height} mm
              </span>
            </div>
            <div
              className={`paper ${s.paper === "square" ? "square" : ""}`}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
            {!complete && (
              <div className="coverage-banner" role="status">
                <span>
                  {mapLoading ? "正在载入选点范围…" : "所选范围数据尚不完整"}
                </span>
                <small>预览中只显示已载入的地图数据</small>
                {!mapLoading && (
                  <button onClick={() => setRetry((n) => n + 1)}>
                    重新加载
                  </button>
                )}
              </div>
            )}
            <div className="canvas-foot">
              <span className="live-dot">实时海报</span>
              <span>
                1 : {Math.round(viewport.denominator).toLocaleString()}
              </span>
            </div>
          </section>
        </div>
        <aside className="inspector" aria-label="海报编辑">
          <div className="inspector-scroll">
            <OfflineCities
              host={host}
              map={map}
              onUse={(pack) =>
                void selectPlace(
                  pack.place,
                  undefined,
                  Math.max(
                    5000,
                    Math.min(20000, Math.floor(pack.widthKm * 2000))
                  )
                )
              }
            />
            <section className="control-section location">
              <h2>
                地点 <span>01</span>
              </h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void search();
                }}
              >
                <div className="search-field">
                  <MapPin size={19} />
                  <input
                    aria-label="地点搜索"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="城市名 / 纬度, 经度"
                    maxLength={160}
                  />
                  <button type="submit" aria-label="搜索地点">
                    <Search size={18} />
                  </button>
                </div>
              </form>
              {places.length > 0 && (
                <div className="results">
                  {places.map((p, i) => (
                    <button key={i} onClick={() => void selectPlace(p)}>
                      {p.name}
                      <ArrowUpRight size={14} />
                    </button>
                  ))}
                </div>
              )}
              <div className="location-meta">
                <span>
                  {map.source.startsWith("离线城市")
                    ? "本机离线数据"
                    : s.center
                    ? "地图选点"
                    : map === SAMPLE
                    ? "南京 · 内置离线地图"
                    : map.name.split(",")[0]}
                </span>
                {host?.getViewBounds ? (
                  <button onClick={() => void currentView()}>
                    <LocateFixed size={13} />
                    当前地图
                  </button>
                ) : (
                  <span>真实 OSM 数据</span>
                )}
              </div>
            </section>
            <div ref={markerEditorRef}>
              <MarkerEditor
                settings={s}
                map={map}
                selectedId={selectedMarkerId}
                mode={pickMode}
                onMode={setPickMode}
                onSelect={selectMarker}
                onUpdate={editMarker}
                onLocate={(m) => {
                  setPickMode("center");
                  update({ center: m.position });
                }}
                onDelete={(id) => {
                  const markers = s.markers ?? [],
                    index = markers.findIndex((m) => m.id === id);
                  if (index < 0) return;
                  setDeletedMarker({ marker: markers[index], index });
                  update({ markers: markers.filter((m) => m.id !== id) });
                  setSelectedMarkerId(null);
                  setPickMode("center");
                }}
              />
              {deletedMarker && (
                <div className="marker-undo">
                  已删除标记
                  <button
                    disabled={(s.markers?.length ?? 0) >= MAX_MARKERS}
                    onClick={() => {
                      const markers = [...(s.markers ?? [])];
                      markers.splice(
                        deletedMarker.index,
                        0,
                        deletedMarker.marker
                      );
                      update({ markers });
                      setSelectedMarkerId(deletedMarker.marker.id);
                      setDeletedMarker(null);
                    }}
                  >
                    撤销
                  </button>
                </div>
              )}
            </div>
            <section className="control-section scale-section">
              <h2>
                比例尺 <span>PRINT SCALE</span>
              </h2>
              <label className="scale-number">
                <span>1 :</span>
                <input
                  aria-label="比例尺分母"
                  key={Math.round(viewport.denominator)}
                  type="number"
                  min="5000"
                  max="40000"
                  step="100"
                  defaultValue={Math.round(viewport.denominator)}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v) && v >= 5000 && v <= 40000)
                      update({ scaleDenominator: v });
                    else {
                      e.target.value = String(Math.round(viewport.denominator));
                      setError("比例尺分母请输入 5,000–40,000。");
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                />
              </label>
              <input
                aria-label="调整比例尺"
                type="range"
                min="5000"
                max="40000"
                step="100"
                value={Math.round(viewport.denominator)}
                onChange={(e) =>
                  update({ scaleDenominator: Number(e.target.value) })
                }
              />
              <div className="scale-ends">
                <span>街区细节</span>
                <span>更大范围</span>
              </div>
              <p>地图宽约 {viewport.widthKm.toFixed(2)} km · 中心比例尺</p>
              <p>按所选纸张 100% 打印时成立</p>
              <div className="picked-coordinate">
                {coordinateText(viewport.center)}
              </div>
            </section>
            <section className="control-section">
              <h2>
                模板 <span>02</span>
              </h2>
              <div className="template-grid">
                {(["linework", "engraving"] as const).map((t) => (
                  <button
                    className={`template ${s.template === t ? "selected" : ""}`}
                    aria-label={t === "linework" ? "城市线稿" : "街区版画"}
                    aria-pressed={s.template === t}
                    key={t}
                    onClick={() => update({ template: t })}
                  >
                    <div
                      className="template-image"
                      dangerouslySetInnerHTML={{ __html: thumbs[t] }}
                    />
                    <div className="template-name">
                      <span>{t === "linework" ? "城市线稿" : "街区版画"}</span>
                      {s.template === t && <Check size={13} />}
                    </div>
                  </button>
                ))}
              </div>
            </section>
            <section className="control-section">
              <h2>
                配色 <span>03</span>
              </h2>
              <div className="palette-grid">
                {(
                  Object.entries(PALETTES) as [
                    PaletteKey,
                    typeof PALETTES.clay
                  ][]
                ).map(([key, p]) => (
                  <button
                    key={key}
                    className={`palette ${s.palette === key ? "selected" : ""}`}
                    aria-label={`${p.label}配色`}
                    aria-pressed={s.palette === key}
                    onClick={() => update({ palette: key, colors: undefined })}
                  >
                    <span className="swatch">
                      {[p.paper, p.buildings[0], p.roads].map((color, i) => (
                        <i key={i} style={{ backgroundColor: color }} />
                      ))}
                    </span>
                    <span>{p.label}</span>
                  </button>
                ))}
              </div>
            </section>
            <section className="control-section custom-section">
              <h2>
                自定义颜色{" "}
                <button
                  className="reset-colors"
                  onClick={() => update({ colors: undefined })}
                >
                  <RotateCcw size={12} />
                  恢复配色
                </button>
              </h2>
              <div className="color-fields">
                {COLOR_KEYS.map((key) => {
                  const labels: Record<ColorKey, string> = {
                    paper: "纸张",
                    land: "底色",
                    water: "水域",
                    park: "绿地",
                    roads: "道路",
                    buildings: "建筑",
                    text: "文字",
                  };
                  const value =
                    key === "buildings" ? color.buildings[0] : color[key];
                  const change = (v: string) =>
                    update({ colors: { ...s.colors, [key]: v } });
                  return (
                    <div className="color-field" key={key}>
                      <label>
                        <input
                          aria-label={`${labels[key]}颜色`}
                          type="color"
                          value={value}
                          onChange={(e) => change(e.target.value)}
                        />
                        <span>{labels[key]}</span>
                      </label>
                      <input
                        aria-label={`${labels[key]}色值`}
                        className="hex"
                        key={value}
                        defaultValue={value.toUpperCase()}
                        maxLength={7}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (/^#[0-9a-f]{6}$/i.test(v)) change(v);
                          else {
                            e.target.value = value.toUpperCase();
                            setError("颜色请使用 #RRGGBB 格式，例如 #A75337。");
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </section>
            <section className="control-section text-section">
              <h2>
                文字 <span>04</span>
              </h2>
              <label>
                主标题
                <input
                  value={s.title}
                  onChange={(e) => update({ title: e.target.value })}
                  maxLength={60}
                />
              </label>
              <label>
                副标题
                <input
                  value={s.subtitle}
                  onChange={(e) => update({ subtitle: e.target.value })}
                  maxLength={80}
                />
              </label>
            </section>
            <section className="control-section size-section">
              <h2>
                尺寸 <span>05</span>
              </h2>
              <select
                aria-label="海报尺寸"
                value={s.paper}
                onChange={(e) =>
                  update({ paper: e.target.value as Settings["paper"] })
                }
              >
                {Object.entries(PAPERS).map(([key, p]) => (
                  <option key={key} value={key}>
                    {p.label}
                    {key !== "square" ? `（${p.width} × ${p.height} mm）` : ""}
                  </option>
                ))}
              </select>
            </section>
            <details className="data-details">
              <summary>地图数据与署名</summary>
              <p>
                {counts.roads.toLocaleString()} 条道路 ·{" "}
                {counts.buildings.toLocaleString()} 栋建筑
                <br />
                数据日期：{(map.snapshotAt ?? map.fetchedAt).slice(0, 10)}
                <br />
                OSM 各地覆盖程度不同。
              </p>
              <a
                href="https://www.openstreetmap.org/copyright"
                target="_blank"
                rel="noreferrer"
              >
                © OpenStreetMap contributors · ODbL
              </a>
            </details>
          </div>
          <div className="export-area">
            {mapLoading && (
              <LoadingStatus
                startedAt={loadStartedAt}
                message={mapProgress}
                onCancel={() => {
                  coverageController.current?.abort();
                  setMapLoading(false);
                }}
              />
            )}
            {busy && (
              <LoadingStatus
                startedAt={loadStartedAt}
                message={busy}
                timed={placeLoading}
                onCancel={
                  placeLoading
                    ? () => {
                        controller.current?.abort();
                        setBusy("");
                        setPlaceLoading(false);
                        setNotice("已取消加载，保留原海报。");
                      }
                    : undefined
                }
              />
            )}
            {error && (
              <p className="status error" role="alert">
                {error}
              </p>
            )}
            {retryPlace && !busy && (
              <button
                className="quiet"
                onClick={() =>
                  void selectPlace(retryPlace.place, retryPlace.bounds)
                }
              >
                <RotateCcw size={15} /> 重试加载{retryPlace.place.subtitle}
              </button>
            )}
            {!busy && notice && (
              <p className="status" role="status">
                {notice}
              </p>
            )}
            <div className="export-formats" aria-label="导出格式">
              <button
                aria-pressed={format === "svg"}
                onClick={() => setFormat("svg")}
              >
                SVG <span>可编辑矢量</span>
              </button>
              <button
                aria-pressed={format === "png"}
                onClick={() => setFormat("png")}
              >
                PNG <span>300 dpi</span>
              </button>
            </div>
            <button
              className="export-button"
              disabled={!!busy || mapLoading || !complete}
              onClick={() => void exportPoster()}
            >
              <Download size={20} />
              导出海报
            </button>
            <p className="export-hint">为打印、收藏与分享而作</p>
          </div>
        </aside>
      </main>
    </div>
  );
}
