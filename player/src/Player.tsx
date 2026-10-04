import { useEffect, useMemo, useRef, useState } from "react";
import { Excalidraw, restoreElements, CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { El, Frame, Payload } from "./types";
import { Controller } from "./Transition";
import { Timeline } from "./Timeline";

const RESERVED_BOTTOM = 96; // px kept clear for the timeline bar

function prepare(payload: Payload) {
  const frames: Frame[] = payload.frames.map((f) => ({
    label: f.label,
    file: f.file,
    background: f.background,
    elements: restoreElements(
      f.elements.map((k) => structuredClone(payload.pool[k])) as any,
      null,
      { refreshDimensions: false, repairBindings: false },
    ) as unknown as El[],
  }));
  // union bounds over every frame so the camera never jumps between snapshots
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const f of frames) for (const e of f.elements) {
    const cx = e.x + e.width / 2, cy = e.y + e.height / 2, a = e.angle || 0;
    const hw = (Math.abs(e.width * Math.cos(a)) + Math.abs(e.height * Math.sin(a))) / 2;
    const hh = (Math.abs(e.width * Math.sin(a)) + Math.abs(e.height * Math.cos(a))) / 2;
    x1 = Math.min(x1, cx - hw); x2 = Math.max(x2, cx + hw);
    y1 = Math.min(y1, cy - hh); y2 = Math.max(y2, cy + hh);
  }
  if (!isFinite(x1)) { x1 = 0; y1 = 0; x2 = 100; y2 = 100; }
  return { frames, bounds: { x1, y1, x2, y2 }, files: Object.values(payload.files) as any[] };
}

function fitState(bounds: { x1: number; y1: number; x2: number; y2: number }, w: number, h: number) {
  const W = w, H = h - RESERVED_BOTTOM;
  const { x1, y1, x2, y2 } = bounds;
  const z = Math.min((W * 0.92) / Math.max(1, x2 - x1), (H * 0.92) / Math.max(1, y2 - y1), 3);
  return { zoom: { value: z as any }, scrollX: W / (2 * z) - (x1 + x2) / 2, scrollY: H / (2 * z) - (y1 + y2) / 2 };
}

export function Player({ payload }: { payload: Payload }) {
  const rt = useMemo(() => prepare(payload), [payload]);
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [controller, setController] = useState<Controller | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const initialData = useMemo(() => ({
    elements: rt.frames[0].elements as any,
    // Excalidraw applies initialData asynchronously *after* the API callback fires, and would
    // overwrite an early updateScene(), so the fitted camera has to be part of initialData.
    appState: { viewBackgroundColor: rt.frames[0].background, ...fitState(rt.bounds, window.innerWidth, window.innerHeight) },
    files: payload.files as any,
    scrollToContent: false,
  }), [rt, payload]);

  useEffect(() => {
    if (!api) return;
    if (rt.files.length) api.addFiles(rt.files);

    const fit = () => {
      const el = rootRef.current;
      if (!el) return;
      api.updateScene({ appState: fitState(rt.bounds, el.clientWidth, el.clientHeight), captureUpdate: CaptureUpdateAction.NEVER });
    };

    let lastBg = "";
    const c = new Controller(
      rt.frames,
      { transitionMs: payload.transitionMs },
      (elements, background) => {
        api.updateScene({
          elements: elements as any,
          ...(background !== lastBg ? { appState: { viewBackgroundColor: background } } : {}),
          captureUpdate: CaptureUpdateAction.NEVER,
        });
        lastBg = background;
      },
    );
    setController(c);
    fit();
    const unsub = api.onChange(() => { unsub(); fit(); }); // first change == scene initialised
    // re-render the resting frame once web fonts are actually available
    (document as any).fonts?.ready?.then(() => c.refresh());

    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key;
      const handled = () => { e.preventDefault(); e.stopPropagation(); };
      if (k === " " || k === "ArrowRight" || k === "PageDown") { handled(); c.next(); }
      else if (k === "ArrowLeft" || k === "PageUp") { handled(); c.prev(); }
      else if (k === "Home") { handled(); c.first(); }
      else if (k === "End") { handled(); c.lastFrame(); }
      else if (k === "f" || k === "F") { handled(); fit(); }
    };
    let timer: ReturnType<typeof setTimeout>;
    const onResize = () => { clearTimeout(timer); timer = setTimeout(fit, 100); };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onResize);
      c.dispose();
    };
  }, [api, rt, payload]);

  return (
    <div className="tl-root" ref={rootRef}>
      <Excalidraw
        excalidrawAPI={setApi}
        initialData={initialData}
        viewModeEnabled
        zenModeEnabled
        handleKeyboardGlobally={false}
        autoFocus={false}
        detectScroll={false}
        validateEmbeddable={false}
        langCode="en"
      />
      {controller && <Timeline controller={controller} />}
      <div className="tl-hint">Space / → next · ← back · Home / End · F fit</div>
    </div>
  );
}
