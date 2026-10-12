import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";

// Keep the ticking clock outside Studio so it does not redraw the map each second.
export function LoadingStatus({
  message,
  startedAt,
  onCancel,
  timed = true,
}: {
  message: string;
  startedAt: number;
  onCancel?: () => void;
  timed?: boolean;
}) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    setSeconds(0);
    if (!timed) return;
    const start = startedAt;
    const timer = setInterval(
      () => setSeconds(Math.floor((Date.now() - start) / 1000)),
      1000
    );
    return () => clearInterval(timer);
  }, [timed, startedAt]);
  return (
    <div className="status loading" role="status">
      <LoaderCircle size={15} />
      <span>
        {message}
        {timed && (
          <>
            {" "}
            已等待 {seconds} 秒。
            {seconds >= 10 && "首次访问需联网下载；可取消或缩小取景范围。"}
          </>
        )}
      </span>
      {onCancel && (
        <button className="cancel" onClick={onCancel}>
          取消
        </button>
      )}
    </div>
  );
}
