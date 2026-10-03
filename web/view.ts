import { type Graph, renderAscii, renderSvg, type Span } from "../src/index.ts";
import { corner, el, modeButton } from "./dom.ts";
import { panZoom } from "./panzoom.ts";
import { svgToPng } from "./png.ts";

export type View = "svg" | "ascii";

const ICON_COPY =
  '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5.5" y="5.5" width="8.5" height="8.5" rx="1.5"/><path d="M10.5 5.5V3.5a1.5 1.5 0 0 0-1.5-1.5H3.5A1.5 1.5 0 0 0 2 3.5V9a1.5 1.5 0 0 0 1.5 1.5h2"/></svg>';
const ICON_DONE =
  '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M3 8.5l3.5 3.5L13 4.5"/></svg>';

const covers = (spans: Span[] | undefined, pos: number) =>
  spans?.some((s) => s.start <= pos && pos <= s.end) ?? false;

export function outputPane(initial: View, onPick: (span: Span) => void) {
  let view = initial;
  let graph: Graph | undefined;
  let cycle = { key: "", index: 0 };
  let marked = 0;

  const out = el("div", "mid-out");
  const pan = panZoom(out);
  const copy = el("button", "mid-copy");
  copy.type = "button";
  copy.innerHTML = ICON_COPY;
  const toggle = modeButton<View>(
    [
      ["svg", "SVG"],
      ["ascii", "ASCII"],
    ],
    () => {
      view = view === "svg" ? "ascii" : "svg";
      draw();
    },
  );
  const pane = el("div", "mid-pane mid-view");
  pane.append(out, corner("left", toggle.button), corner("right", copy));

  function labelCopy() {
    copy.title = view === "ascii" ? "Copy ASCII" : "Copy as PNG";
    copy.setAttribute("aria-label", copy.title);
  }

  function draw() {
    labelCopy();
    toggle.set(view);
    if (!graph) {
      pan.clear();
      return out.replaceChildren();
    }
    if (view === "svg") {
      const canvas = el("div", "");
      canvas.innerHTML = renderSvg(graph);
      pan.show(canvas);
    } else {
      pan.clear();
      out.replaceChildren(el("pre", "mid-text", renderAscii(graph)));
    }
    mark(marked);
  }

  function mark(pos: number) {
    marked = pos;
    let node: string | undefined;
    for (const [name, spans] of graph?.spans ?? []) if (covers(spans, pos)) node = name;
    const message = graph?.messages.findIndex((m) => covers(m.span && [m.span], pos)) ?? -1;
    for (const g of out.querySelectorAll("[data-node]"))
      g.classList.toggle("mid-hl", g.getAttribute("data-node") === node);
    for (const g of out.querySelectorAll("[data-message]"))
      g.classList.toggle("mid-hl", g.getAttribute("data-message") === String(message));
  }

  out.addEventListener("click", (e) => {
    if (pan.dragged()) return;
    const target = (e.target as Element).closest("[data-node],[data-message]");
    const name = target?.getAttribute("data-node");
    const index = target?.getAttribute("data-message");
    const spans =
      name != null
        ? graph?.spans.get(name)
        : index != null
          ? [graph?.messages[Number(index)]?.span].filter((s) => s !== undefined)
          : undefined;
    if (!spans?.length) return;
    const key = name ?? `#${index}`;
    cycle = { key, index: cycle.key === key ? (cycle.index + 1) % spans.length : 0 };
    onPick(spans[cycle.index]!);
    mark(spans[cycle.index]!.start);
  });

  copy.addEventListener("click", async () => {
    if (!graph) return;
    try {
      if (view === "ascii") await navigator.clipboard.writeText(renderAscii(graph));
      else {
        const style = getComputedStyle(pane);
        const colors = {
          fg: style.getPropertyValue("--mid-fg").trim(),
          bg: style.getPropertyValue("--mid-bg").trim(),
        };
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": svgToPng(renderSvg(graph), colors) }),
        ]);
      }
      copy.innerHTML = ICON_DONE;
      copy.title = "Copied";
    } catch {
      copy.title = "Copy failed";
    }
    setTimeout(() => {
      copy.innerHTML = ICON_COPY;
      labelCopy();
    }, 1200);
  });

  return {
    el: pane,
    show(next: Graph | undefined, caret: number) {
      graph = next;
      marked = caret;
      draw();
    },
    mark,
    destroy: () => pan.destroy(),
  };
}
