import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource } from "maplibre-gl";
import { LocateFixed, Plus, Minus, MapPinPlus } from "lucide-react";
import { DEFAULTS, type MapData, type Settings } from "./model";
import { posterViewport } from "./viewport";
import type { PickMode } from "./MarkerEditor";
import { markerBadge } from "./markers";
import { xml } from "./xml";
import { featureKind } from "./renderer";
import workerSource from "./generated/map-worker.js?raw";

export function MapPicker({
  data,
  settings,
  onPick,
  mode,
  selectedId,
  onMode,
  onMarkerSelect,
  onMarkerMove,
}: {
  data: MapData;
  settings: Settings;
  onPick: (center: [number, number]) => void;
  mode: PickMode;
  selectedId: string | null;
  onMode: (mode: PickMode) => void;
  onMarkerSelect: (id: string) => void;
  onMarkerMove: (id: string, position: [number, number]) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<maplibregl.Map | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);
  const pointMarkers = useRef(
    new Map<string, { marker: maplibregl.Marker; markup: string }>()
  );
  const latest = useRef({
    data,
    settings,
    onPick,
    mode,
    onMarkerSelect,
    onMarkerMove,
  });
  latest.current = {
    data,
    settings,
    onPick,
    mode,
    onMarkerSelect,
    onMarkerMove,
  };
  const { center, scaleDenominator, zoom, paper, template } = settings;
  const frameSettings = useMemo(
    () => ({ ...DEFAULTS, center, scaleDenominator, zoom, paper, template }),
    [center, scaleDenominator, zoom, paper, template]
  );
  const [failure, setFailure] = useState("");
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(false);
  useEffect(() => {
    let map: maplibregl.Map | undefined;
    let observer: ResizeObserver | undefined;
    let disposed = false;
    const points = pointMarkers.current;
    let workerUrl: string | undefined;
    try {
      workerUrl = URL.createObjectURL(
        new Blob([workerSource], { type: "text/javascript" })
      );
      maplibregl.setWorkerUrl(workerUrl);
      map = new maplibregl.Map({
        container: container.current!,
        center: latest.current.settings.center ?? latest.current.data.center,
        zoom: 12.6,
        minZoom: 2,
        maxZoom: 18,
        renderWorldCopies: false,
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
        style: {
          version: 8,
          sources: {},
          layers: [
            {
              id: "background",
              type: "background",
              paint: { "background-color": "#eeeae0" },
            },
          ],
        },
      });
      instance.current = map;
      const m = map;
      m.on("load", () => {
        if (disposed) return;
        m.addSource("context", {
          type: "raster",
          tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
          tileSize: 256,
          maxzoom: 19,
        });
        m.addLayer({
          id: "context",
          source: "context",
          type: "raster",
          layout: { visibility: "none" },
          paint: { "raster-saturation": -0.75, "raster-opacity": 0.75 },
        });
        m.addSource("local", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        m.addLayer({
          id: "areas",
          source: "local",
          type: "fill",
          filter: ["==", ["geometry-type"], "Polygon"],
          paint: {
            "fill-color": [
              "match",
              ["get", "posterKind"],
              "water",
              "#b9cecf",
              "park",
              "#bdcbb5",
              "building",
              "#d2c1ad",
              "#e8e2d4",
            ],
          },
        });
        m.addLayer({
          id: "roads",
          source: "local",
          type: "line",
          filter: ["==", ["get", "posterKind"], "road"],
          paint: {
            "line-color": "#faf8f0",
            "line-width": ["interpolate", ["linear"], ["zoom"], 11, 1, 16, 5],
          },
        });
        m.addSource("frame", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        m.addLayer({
          id: "frame-fill",
          source: "frame",
          type: "fill",
          paint: { "fill-color": "#a75337", "fill-opacity": 0.06 },
        });
        m.addLayer({
          id: "frame-line",
          source: "frame",
          type: "line",
          paint: {
            "line-color": "#a75337",
            "line-width": 2,
            "line-dasharray": [3, 2],
          },
        });
        marker.current = new maplibregl.Marker({
          color: "#a75337",
          draggable: true,
        })
          .setLngLat(
            latest.current.settings.center ?? latest.current.data.center
          )
          .addTo(m);
        marker.current
          .getElement()
          .setAttribute("aria-label", "海报画心（不导出）");
        marker.current.getElement().title = "拖动画心调整取景";
        marker.current.on("drag", () => {
          const p = marker.current!.getLngLat();
          if (latest.current.mode === "center")
            latest.current.onPick([p.lng, p.lat]);
        });
        setReady(true);
      });
      m.on("click", (e) => latest.current.onPick([e.lngLat.lng, e.lngLat.lat]));
      m.on("error", () => {
        if (!disposed)
          setFailure("在线底图暂不可用，可继续使用已载入的街道选点。");
      });
      observer = new ResizeObserver(() => m.resize());
      observer.observe(container.current!);
    } catch {
      setFailure("地图视图无法启动，请使用地点搜索或坐标输入选点。");
    }
    return () => {
      disposed = true;
      observer?.disconnect();
      for (const entry of points.values()) entry.marker.remove();
      points.clear();
      marker.current?.remove();
      marker.current = null;
      map?.remove();
      instance.current = null;
      if (workerUrl) URL.revokeObjectURL(workerUrl);
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    (instance.current!.getSource("local") as GeoJSONSource).setData({
      ...data.geojson,
      features: data.geojson.features.map((f) => ({
        ...f,
        properties: { ...f.properties, posterKind: featureKind(f.properties) },
      })),
    });
  }, [ready, data]);
  useEffect(() => {
    if (!ready) return;
    const m = instance.current!,
      v = posterViewport(data, frameSettings);
    const [w, s, e, n] = v.bounds;
    let ring = [
      [w, s],
      [e, s],
      [e, n],
      [w, n],
      [w, s],
    ];
    if (frameSettings.template === "engraving") {
      // Interpolate the circle in Mercator, matching the poster's clip exactly.
      const toLat = (y: number) =>
        ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI;
      ring = Array.from({ length: 65 }, (_, i) => {
        const a = (i / 64) * Math.PI * 2,
          r = v.size / v.scale / 2;
        return [
          ((v.cx + Math.cos(a) * r) * 180) / Math.PI,
          toLat(v.cy + Math.sin(a) * r),
        ];
      });
    }
    (m.getSource("frame") as GeoJSONSource).setData({
      type: "Feature",
      properties: {},
      geometry: { type: "Polygon", coordinates: [ring] },
    });
    marker.current!.setLngLat(v.center);
    if (!m.getBounds().contains(v.center)) m.jumpTo({ center: v.center });
  }, [ready, data, frameSettings]);
  useEffect(() => {
    if (ready) {
      instance.current!.setLayoutProperty(
        "context",
        "visibility",
        online ? "visible" : "none"
      );
      setFailure("");
    }
  }, [ready, online]);
  useEffect(() => {
    if (!ready) return;
    instance.current!.getCanvas().style.cursor =
      mode === "center" ? "" : "crosshair";
    marker.current?.setDraggable(mode === "center");
  }, [ready, mode]);
  useEffect(() => {
    if (!ready) return;
    const m = instance.current!,
      points = pointMarkers.current;
    const visible = (settings.markers ?? []).filter((p) => p.visible);
    const ids = new Set(visible.map((p) => p.id));
    for (const [id, entry] of points)
      if (!ids.has(id)) {
        entry.marker.remove();
        points.delete(id);
      }
    for (const point of visible) {
      let entry = points.get(point.id);
      if (!entry) {
        const element = document.createElement("button");
        element.type = "button";
        element.addEventListener("click", (e) => {
          e.stopPropagation();
          latest.current.onMarkerSelect(point.id);
        });
        const pin = new maplibregl.Marker({
          element,
          anchor: "center",
          draggable: true,
        })
          .setLngLat(point.position)
          .addTo(m);
        pin.on("drag", () => {
          const p = pin.getLngLat();
          latest.current.onMarkerMove(point.id, [p.lng, p.lat]);
        });
        entry = { marker: pin, markup: "" };
        points.set(point.id, entry);
      }
      const element = entry.marker.getElement();
      element.classList.add("personal-marker");
      element.classList.toggle("selected", point.id === selectedId);
      element.setAttribute("aria-label", `编辑标记：${point.name || "未命名"}`);
      element.title = `${point.name || "未命名"} · 拖动可调整位置`;
      const markup = `<svg width="${point.size + 6}" height="${
        point.size + 6
      }" viewBox="-21 -21 42 42" aria-hidden="true">${markerBadge({
        ...point,
        size: 32,
      })}</svg>${
        point.showLabel && point.name ? `<span>${xml(point.name)}</span>` : ""
      }`;
      if (markup !== entry.markup) {
        element.innerHTML = markup;
        entry.markup = markup;
      }
      entry.marker.setLngLat(point.position);
    }
  }, [ready, settings.markers, selectedId]);
  return (
    <section className="map-pane" aria-label="地图选点">
      <div className="map-heading">
        <div>
          <span className="eyebrow">01 / FIND YOUR PLACE</span>
          <h2>把故事的中心，放在这里。</h2>
        </div>
        <span className="live-dot">
          {mode === "add"
            ? "添加标记"
            : mode === "move"
            ? "移动标记"
            : "调整画心"}
        </span>
      </div>
      <div className="picker-map" ref={container} />
      <div className="map-modes">
        <button
          aria-pressed={mode === "center"}
          onClick={() => onMode("center")}
        >
          <LocateFixed size={14} />
          调整画心
        </button>
        <button
          aria-pressed={mode === "add"}
          onClick={() => onMode(mode === "add" ? "center" : "add")}
        >
          <MapPinPlus size={14} />
          添加标记
        </button>
      </div>
      <div className="map-tools">
        <button
          aria-label="放大选点地图"
          onClick={() => instance.current?.zoomIn()}
        >
          <Plus size={17} />
        </button>
        <button
          aria-label="缩小选点地图"
          onClick={() => instance.current?.zoomOut()}
        >
          <Minus size={17} />
        </button>
        <button
          aria-label="回到海报中心"
          onClick={() =>
            instance.current?.jumpTo({
              center: settings.center ?? data.center,
              zoom: 12.6,
            })
          }
        >
          <LocateFixed size={17} />
        </button>
      </div>
      <div className="map-caption">
        <p>
          {mode === "add"
            ? "点击地图添加重要地点 · 可连续添加"
            : mode === "move"
            ? "点击地图移动所选标记 · 调整画心可退出"
            : "点击调整画心 · 拖动圆形标记调整地点"}
        </p>
        <p>虚线内即海报范围 · 画心图钉不导出</p>
        <label className="online-toggle">
          <input
            type="checkbox"
            checked={online}
            onChange={(e) => setOnline(e.target.checked)}
          />
          在线街道与地名
        </label>
        {failure && <p role="status">{failure}</p>}
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
        >
          © OpenStreetMap contributors
        </a>
      </div>
    </section>
  );
}
