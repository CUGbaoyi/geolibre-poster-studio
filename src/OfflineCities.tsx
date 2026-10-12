import { useEffect, useRef, useState } from "react";
import {
  Database,
  Download,
  MapPin,
  Pause,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { findPlaces, type Place } from "./data";
import { boundsForCenter, type Host, type MapData } from "./model";
import {
  cityStore,
  createCityPack,
  deleteCityPack,
  packReady,
  type CityPack,
} from "./offline-store";
import { downloadCityPack } from "./offline-download";
import { importCityPackage } from "./offline-package";

export function OfflineCities({
  host,
  map,
  onUse,
}: {
  host?: Host;
  map: MapData;
  onUse: (pack: CityPack) => void;
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [places, setPlaces] = useState<Place[]>([]);
  const [place, setPlace] = useState<Place | null>(null),
    [width, setWidth] = useState(10),
    [packs, setPacks] = useState<CityPack[]>([]);
  const [active, setActive] = useState<string | null>(null),
    [searching, setSearching] = useState(false),
    [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null),
    searchController = useRef<AbortController | null>(null),
    alive = useRef(true);
  const refresh = async () => {
    const result = await cityStore.list();
    if (alive.current) setPacks(result);
  };
  useEffect(() => {
    alive.current = true;
    void refresh().catch(() => {
      if (alive.current) setError("无法访问本机存储，请检查浏览器存储权限。");
    });
    return () => {
      alive.current = false;
      controller.current?.abort();
      searchController.current?.abort();
    };
  }, []);
  const updatePack = (pack: CityPack) =>
    setPacks((list) => [...list.filter((p) => p.id !== pack.id), pack]);
  async function search() {
    searchController.current?.abort();
    const c = new AbortController();
    searchController.current = c;
    setSearching(true);
    setError("");
    setPlace(null);
    setPlaces([]);
    try {
      const results = await findPlaces(query.trim(), c.signal, host);
      if (c.signal.aborted || !alive.current) return;
      if (results.length === 1) setPlace(results[0]);
      else setPlaces(results);
      if (!results.length)
        setError("未找到地点，可输入城市英文名或纬度, 经度。");
    } catch (e) {
      if (!c.signal.aborted && alive.current)
        setError(String(e instanceof Error ? e.message : e));
    } finally {
      if (!c.signal.aborted && alive.current) setSearching(false);
    }
  }
  async function run(pack: CityPack) {
    if (controller.current && !controller.current.signal.aborted) return;
    const c = new AbortController();
    controller.current = c;
    setActive(pack.id);
    setError("");
    setMessage("正在准备下载…");
    updatePack(pack);
    try {
      await downloadCityPack(pack, c.signal, {
        host,
        onProgress: (next, text) => {
          if (alive.current && !c.signal.aborted) {
            updatePack(next);
            setMessage(text);
          }
        },
      });
      if (alive.current && !c.signal.aborted)
        setMessage("下载完成，可以离线使用。范围内选点将优先读取本机数据。");
    } catch (e) {
      if (alive.current) {
        if (c.signal.aborted)
          setMessage("已暂停。已完成的分块保留在本机，稍后可继续。");
        else
          setError(
            `下载未完成，已保存的分块可继续使用于续传。${
              e instanceof Error ? e.message : String(e)
            }`
          );
      }
    } finally {
      c.abort();
      if (alive.current) {
        setActive(null);
        void refresh().catch(() => {});
      }
    }
  }
  async function saveCurrent() {
    setSaving(true);
    setError("");
    try {
      const existing = (await cityStore.list()).find(
        (p) =>
          packReady(p) &&
          p.tiles.length === 1 &&
          p.bounds.every((v, i) => v === map.bounds[i])
      );
      if (existing) {
        setMessage("当前范围已保存在本机。");
        return;
      }
      const widthKm = Math.min(
        (map.bounds[2] - map.bounds[0]) *
          111.32 *
          Math.cos((map.center[1] * Math.PI) / 180),
        (map.bounds[3] - map.bounds[1]) * 111.32
      );
      const pack: CityPack = {
        id: crypto.randomUUID(),
        place: {
          name: map.name,
          title: map.name.split(" ")[0].toUpperCase(),
          subtitle: map.name.split(",")[0],
          lon: map.center[0],
          lat: map.center[1],
        },
        bounds: map.bounds,
        widthKm,
        tiles: [map.bounds],
        completed: [],
        bytes: 0,
        updatedAt: new Date().toISOString(),
      };
      await cityStore.commit(pack, 0, map);
      await refresh();
      if (alive.current)
        setMessage("当前已加载的地图已保存，重新打开后仍可离线使用。");
    } catch (e) {
      if (alive.current)
        setError(`保存失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (alive.current) setSaving(false);
    }
  }
  async function remove(pack: CityPack) {
    try {
      await deleteCityPack(pack);
      await refresh();
      setMessage("离线包已移除，当前海报保留。");
    } catch {
      setError("移除失败，请重试。");
    }
  }
  async function importFile(file: File) {
    setImporting(true);
    setError("");
    setMessage("正在读取离线包…");
    try {
      const pack = await importCityPackage(file, (text) => {
        if (alive.current) setMessage(text);
      });
      if (alive.current) {
        updatePack(pack);
        setMessage(
          `${pack.place.subtitle}已导入，点击「使用此城市」开始创作。`
        );
      }
    } catch (e) {
      if (alive.current) {
        setMessage("");
        setError(`导入失败：${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      if (alive.current) setImporting(false);
    }
  }
  return (
    <section className="control-section offline-section" aria-label="离线城市">
      <button
        className="offline-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span>
          <Database size={16} /> 离线城市
        </span>
        <span>
          {packs.filter(packReady).length} 个已下载 · {open ? "收起" : "管理"}
        </span>
      </button>
      {open && (
        <div className="offline-content">
          <p>
            先下载，再创作。数据保存在此浏览器／应用中，刷新或重新打开后仍可使用。
          </p>
          <input
            ref={fileInput}
            type="file"
            hidden
            accept=".zip"
            aria-label="选择城市离线包"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void importFile(file);
            }}
          />
          <button
            className="offline-primary"
            disabled={!!active || saving || importing}
            onClick={() => fileInput.current?.click()}
          >
            <Upload size={15} /> {importing ? "正在导入…" : "导入离线包"}
          </button>
          <p>选择 .poster-city.zip 城市包，本地导入无需联网。</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void search();
            }}
          >
            <div className="search-field">
              <MapPin size={16} />
              <input
                aria-label="离线城市搜索"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPlace(null);
                  setPlaces([]);
                  searchController.current?.abort();
                  setSearching(false);
                }}
                placeholder="搜索城市 / 纬度, 经度"
                maxLength={160}
              />
              <button
                aria-label="查找下载城市"
                disabled={searching || !query.trim()}
              >
                <Search size={16} />
              </button>
            </div>
          </form>
          {searching && <p role="status">正在查找下载城市…</p>}
          {places.map((p, i) => (
            <button
              className="offline-result"
              key={i}
              onClick={() => {
                setPlace(p);
                setPlaces([]);
              }}
            >
              {p.name}
            </button>
          ))}
          {place && (
            <div className="offline-plan">
              <strong>{place.name}</strong>
              <label>
                城市中心下载范围
                <select
                  aria-label="离线下载范围"
                  value={width}
                  onChange={(e) => setWidth(Number(e.target.value))}
                >
                  {[5, 10, 20, 40].map((k) => (
                    <option key={k} value={k}>
                      {k} × {k} km
                    </option>
                  ))}
                </select>
              </label>
              <p>
                {Math.ceil(width / 4) ** 2} 个分块 ·
                包含道路、建筑、水域和绿地。是以选点为中心的矩形范围，非行政边界；首次下载仍需联网。
              </p>
              <button
                className="offline-primary"
                disabled={!!active || saving || importing}
                onClick={() => {
                  try {
                    boundsForCenter(place.lon, place.lat, width);
                    void run(createCityPack(place, width));
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  }
                }}
              >
                <Download size={15} /> 下载到本机
              </button>
            </div>
          )}
          <button
            className="offline-save"
            disabled={!!active || saving || importing}
            onClick={() => void saveCurrent()}
          >
            {saving ? "正在保存…" : "保存当前已加载地图"}
          </button>
          <div className="offline-list">
            {packs.map((pack) => (
              <div className="offline-pack" key={pack.id}>
                <strong>{pack.place.subtitle}</strong>
                <span className="offline-badge">
                  {packReady(pack)
                    ? "可离线使用"
                    : active === pack.id
                    ? "下载中"
                    : "待完成"}
                </span>
                <p>
                  {pack.coverageLabel ?? `${pack.widthKm.toFixed(1)} km 范围`} ·{" "}
                  {(pack.bytes / 1048576).toFixed(1)} MB ·{" "}
                  {pack.completed.length}/{pack.tiles.length} 块
                </p>
                {pack.snapshotAt && (
                  <p>数据日期 · {pack.snapshotAt.slice(0, 10)}</p>
                )}
                <progress
                  aria-label={`${pack.place.subtitle}下载进度`}
                  max={pack.tiles.length}
                  value={pack.completed.length}
                />
                <p className="offline-coordinates">
                  {pack.bounds.map((n) => n.toFixed(3)).join(" / ")} · 西 / 南 /
                  东 / 北
                </p>
                <div className="offline-actions">
                  {packReady(pack) ? (
                    <button onClick={() => onUse(pack)}>使用此城市</button>
                  ) : active === pack.id ? (
                    <button onClick={() => controller.current?.abort()}>
                      <Pause size={13} /> 暂停
                    </button>
                  ) : (
                    <button
                      disabled={!!active || importing || saving}
                      onClick={() => void run(pack)}
                    >
                      继续下载
                    </button>
                  )}
                  <button
                    aria-label={`移除离线包：${pack.place.subtitle}`}
                    disabled={!!active || saving || importing}
                    onClick={() => void remove(pack)}
                  >
                    <Trash2 size={13} /> 移除
                  </button>
                </div>
              </div>
            ))}
          </div>
          {message && <p role="status">{message}</p>}
          {error && (
            <p role="alert" className="offline-error">
              {error}
            </p>
          )}
          <p>
            仅完整下载包用于离线取景；超出范围会联网补载。清理网站数据会删除离线包。
          </p>
        </div>
      )}
    </section>
  );
}
