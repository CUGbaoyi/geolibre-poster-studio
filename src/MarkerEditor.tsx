import {
  MapPinPlus,
  Trash2,
  Eye,
  EyeOff,
  LocateFixed,
  Move,
  X,
} from "lucide-react";
import {
  MAX_MARKERS,
  MARKER_ICONS,
  coordinateText,
  type MapData,
  type Settings,
  type PosterMarker,
} from "./model";
import { layoutMarkers, MARKER_STYLES } from "./markers";
export type PickMode = "center" | "add" | "move";
export function MarkerEditor({
  settings,
  map,
  selectedId,
  mode,
  onMode,
  onSelect,
  onUpdate,
  onDelete,
  onLocate,
}: {
  settings: Settings;
  map: MapData;
  selectedId: string | null;
  mode: PickMode;
  onMode: (mode: PickMode) => void;
  onSelect: (id: string) => void;
  onUpdate: (id: string, patch: Partial<PosterMarker>) => void;
  onDelete: (id: string) => void;
  onLocate: (marker: PosterMarker) => void;
}) {
  const markers = settings.markers ?? [],
    selected = markers.find((m) => m.id === selectedId);
  const layouts = layoutMarkers(map, settings),
    hiddenLabels = layouts.filter(
      (l) =>
        l.inside &&
        l.marker.visible &&
        l.marker.showLabel &&
        l.marker.name.trim() &&
        !l.label
    ).length;
  return (
    <section
      className="control-section marker-section"
      aria-label="重要地点标记"
    >
      <h2>
        重要地点{" "}
        <span>
          {markers.length} / {MAX_MARKERS}
        </span>
      </h2>
      <button
        className={`add-marker ${mode === "add" ? "active" : ""}`}
        disabled={mode !== "add" && markers.length >= MAX_MARKERS}
        onClick={() => onMode(mode === "add" ? "center" : "add")}
      >
        {mode === "add" ? <X size={15} /> : <MapPinPlus size={15} />}{" "}
        {mode === "add" ? "结束添加" : "在地图上添加标记"}
      </button>
      <p className="marker-help">
        {mode === "add"
          ? "点击左侧地图放置标记，可连续添加。"
          : mode === "move"
          ? "点击地图，为当前标记选择新位置。"
          : "标记会随海报保存和导出。"}
      </p>
      {!!markers.length && (
        <div className="marker-list">
          {layouts.map(({ marker: m, inside }) => {
            const Icon = MARKER_STYLES[m.icon].Icon;
            return (
              <button
                key={m.id}
                className={`marker-row ${
                  m.id === selectedId ? "selected" : ""
                }`}
                aria-pressed={m.id === selectedId}
                aria-label={`编辑标记：${m.name || "未命名"}`}
                onClick={() => onSelect(m.id)}
              >
                <span className="marker-icon" style={{ background: m.color }}>
                  <Icon size={13} />
                </span>
                <span className="marker-name">{m.name || "未命名"}</span>
                <small>{!m.visible ? "已隐藏" : !inside ? "取景外" : ""}</small>
              </button>
            );
          })}
        </div>
      )}
      {selected && (
        <div className="marker-detail">
          <label className="marker-field">
            标记名称
            <input
              aria-label="标记名称"
              value={selected.name}
              maxLength={40}
              onChange={(e) => onUpdate(selected.id, { name: e.target.value })}
            />
          </label>
          <div className="marker-icon-options">
            {MARKER_ICONS.map((key) => {
              const { Icon, label } = MARKER_STYLES[key];
              return (
                <button
                  key={key}
                  aria-label={`${label}标记图标`}
                  aria-pressed={selected.icon === key}
                  onClick={() => onUpdate(selected.id, { icon: key })}
                >
                  <Icon size={17} />
                </button>
              );
            })}
          </div>
          <div className="marker-edit-grid">
            <label className="marker-field">
              颜色
              <div className="marker-color">
                <input
                  aria-label="标记颜色"
                  type="color"
                  value={selected.color}
                  onChange={(e) =>
                    onUpdate(selected.id, { color: e.target.value })
                  }
                />
                <input
                  key={`${selected.id}-${selected.color}`}
                  aria-label="标记色值"
                  defaultValue={selected.color.toUpperCase()}
                  maxLength={7}
                  onBlur={(e) => {
                    if (/^#[0-9a-f]{6}$/i.test(e.target.value))
                      onUpdate(selected.id, { color: e.target.value });
                    else e.target.value = selected.color.toUpperCase();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                />
              </div>
            </label>
            <label className="marker-field">
              大小
              <select
                aria-label="标记大小"
                value={selected.size}
                onChange={(e) =>
                  onUpdate(selected.id, { size: Number(e.target.value) })
                }
              >
                <option value="18">小</option>
                <option value="26">中</option>
                <option value="34">大</option>
              </select>
            </label>
          </div>
          <label className="marker-label-toggle">
            <input
              type="checkbox"
              checked={selected.showLabel}
              onChange={(e) =>
                onUpdate(selected.id, { showLabel: e.target.checked })
              }
            />
            显示名称
          </label>
          {selected.showLabel && (
            <label className="marker-field">
              名称位置
              <select
                aria-label="标记名称位置"
                value={selected.labelPosition}
                onChange={(e) =>
                  onUpdate(selected.id, {
                    labelPosition: e.target
                      .value as PosterMarker["labelPosition"],
                  })
                }
              >
                <option value="auto">自动避让</option>
                <option value="top">优先上方</option>
                <option value="bottom">优先下方</option>
                <option value="left">优先左侧</option>
                <option value="right">优先右侧</option>
              </select>
            </label>
          )}
          <p className="marker-coordinates">
            {coordinateText(selected.position)}
          </p>
          <div className="marker-actions">
            <button
              onClick={() => onMode(mode === "move" ? "center" : "move")}
              aria-pressed={mode === "move"}
            >
              <Move size={13} />
              {mode === "move" ? "取消移动" : "重新选点"}
            </button>
            <button onClick={() => onLocate(selected)}>
              <LocateFixed size={13} />
              移至画心
            </button>
            <button
              onClick={() =>
                onUpdate(selected.id, { visible: !selected.visible })
              }
            >
              {selected.visible ? <EyeOff size={13} /> : <Eye size={13} />}
              {selected.visible ? "隐藏" : "显示"}
            </button>
            <button onClick={() => onDelete(selected.id)}>
              <Trash2 size={13} />
              删除
            </button>
          </div>
        </div>
      )}
      {hiddenLabels > 0 && (
        <p className="marker-warning">
          {hiddenLabels}{" "}
          个名称空间不足，暂未显示。可移动标记或选择其他名称位置。
        </p>
      )}
    </section>
  );
}
