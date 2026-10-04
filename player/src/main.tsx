import "./offline"; // must stay the first import: it runs before Excalidraw is evaluated
import "@excalidraw/excalidraw/index.css";
import "./styles.css";
import { createRoot } from "react-dom/client";
import { Player } from "./Player";
import type { Payload } from "./types";

const rootEl = document.getElementById("root")!;
try {
  const payload: Payload = JSON.parse(document.getElementById("timelapse-data")!.textContent!);
  document.title = payload.title || document.title;
  createRoot(rootEl).render(<Player payload={payload} />);
} catch (err) {
  rootEl.innerHTML = `<pre style="padding:2em;color:#b00">Timelapse failed to start:\n${String(err)}</pre>`;
  throw err;
}
