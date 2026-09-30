const MIN = 0.2;
const MAX = 5;
const TOP = 48;
const PAD = 16;
const DRAG = 4;

interface Point {
  x: number;
  y: number;
}

export interface PanZoom {
  show(content: HTMLElement): void;
  clear(): void;
  dragged(): boolean;
  destroy(): void;
}

const clamp = (s: number) => Math.min(MAX, Math.max(MIN, s));

export function panZoom(view: HTMLElement): PanZoom {
  let content: HTMLElement | undefined;
  let x = 0;
  let y = 0;
  let s = 1;
  let free = false;
  let moved = false;
  let start: Point | undefined;
  let pinch: { dist: number; mid: Point } | undefined;
  const pointers = new Map<number, Point>();

  const apply = () => {
    if (content) content.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
  };

  function fit() {
    const svg = content?.firstElementChild;
    const w = Number(svg?.getAttribute("width")) || 1;
    const h = Number(svg?.getAttribute("height")) || 1;
    s = clamp(Math.min(1, (view.clientWidth - PAD * 2) / w, (view.clientHeight - TOP - PAD) / h));
    x = (view.clientWidth - w * s) / 2;
    y = TOP;
    apply();
  }

  function zoomAt(p: Point, factor: number) {
    const next = clamp(s * factor);
    x = p.x - (p.x - x) * (next / s);
    y = p.y - (p.y - y) * (next / s);
    s = next;
    free = true;
    apply();
  }

  const local = (e: { clientX: number; clientY: number }): Point => {
    const r = view.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const twoFinger = () => {
    const [a, b] = [...pointers.values()] as [Point, Point];
    return {
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  };

  function onMove(e: PointerEvent) {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const p = local(e);
    pointers.set(e.pointerId, p);
    if (pointers.size >= 2 && pinch) {
      const next = twoFinger();
      zoomAt(next.mid, next.dist / pinch.dist);
      x += next.mid.x - pinch.mid.x;
      y += next.mid.y - pinch.mid.y;
      pinch = next;
      moved = true;
      apply();
      return;
    }
    if (!moved && start && Math.hypot(p.x - start.x, p.y - start.y) < DRAG) return;
    moved = true;
    free = true;
    view.classList.add("mid-dragging");
    x += p.x - prev.x;
    y += p.y - prev.y;
    apply();
  }

  function onUp(e: PointerEvent) {
    pointers.delete(e.pointerId);
    pinch = pointers.size >= 2 ? twoFinger() : undefined;
    if (pointers.size) return;
    view.classList.remove("mid-dragging");
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    document.removeEventListener("pointercancel", onUp);
  }

  view.addEventListener("pointerdown", (e) => {
    if (!content || e.button !== 0) return;
    const p = local(e);
    if (!pointers.size) {
      moved = false;
      start = p;
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onUp);
    }
    pointers.set(e.pointerId, p);
    if (pointers.size >= 2) pinch = twoFinger();
  });

  view.addEventListener(
    "wheel",
    (e) => {
      if (!content) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey)
        return zoomAt(local(e), Math.exp(-Math.max(-30, Math.min(30, e.deltaY)) * 0.01));
      x -= e.deltaX;
      y -= e.deltaY;
      free = true;
      apply();
    },
    { passive: false },
  );

  view.addEventListener("dblclick", (e) => {
    if (!content || (e.target as Element).closest("[data-node],[data-message]")) return;
    free = false;
    fit();
  });

  const resize = new ResizeObserver(() => {
    if (content && !free) fit();
  });
  resize.observe(view);

  return {
    show(next) {
      content = next;
      content.classList.add("mid-canvas");
      view.classList.add("mid-pan");
      view.replaceChildren(content);
      if (free) apply();
      else fit();
    },
    clear() {
      content = undefined;
      view.classList.remove("mid-pan", "mid-dragging");
    },
    dragged: () => moved,
    destroy() {
      resize.disconnect();
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
    },
  };
}
