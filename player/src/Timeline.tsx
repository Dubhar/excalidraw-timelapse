import { useEffect, useRef, useSyncExternalStore } from "react";
import type { Controller } from "./Transition";

export function Timeline({ controller }: { controller: Controller }) {
  const snap = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const fill = useRef<HTMLDivElement>(null);
  const frames = controller.frames;
  const n = frames.length;
  const pct = (pos: number) => (n > 1 ? (pos / (n - 1)) * 100 : 100);

  useEffect(() => {
    const set = (pos: number) => { if (fill.current) fill.current.style.width = `${pct(pos)}%`; };
    set(snap.index);
    return controller.onProgress(set);
  }, [controller]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = snap.target ?? snap.index;
  const showAllLabels = n <= 8;

  return (
    <div className="tl-bar" onClick={(e) => e.stopPropagation()}>
      <div className="tl-title">
        <span className="tl-label">{frames[shown].label}</span>
        <span className="tl-count">{shown + 1} / {n}</span>
      </div>
      <div className="tl-row">
        <button className="tl-btn" title="Previous (←)" disabled={shown === 0} onClick={() => controller.prev()}>‹</button>
        <div className="tl-track-wrap">
          <div className="tl-track"><div className="tl-fill" ref={fill} /></div>
          {frames.map((f, i) => (
            <button
              key={i}
              className={"tl-dot" + (i === shown ? " active" : "") + (i < shown ? " past" : "")}
              style={{ left: `${pct(i)}%` }}
              title={f.label}
              onClick={() => controller.goTo(i)}
            >
              {(showAllLabels || i === 0 || i === n - 1) && <span className="tl-dot-label">{f.label}</span>}
            </button>
          ))}
        </div>
        <button className="tl-btn" title="Next (Space / →)" disabled={shown === n - 1} onClick={() => controller.next()}>›</button>
      </div>
    </div>
  );
}
