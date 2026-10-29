// Draws the gallery's tiles with vgpu: one Gpu, a surface per tile canvas, the granite shader seeded
// by each agent. Tiles on screen drift slowly (their lights move); off-screen tiles, hidden tabs and
// prefers-reduced-motion draw nothing more. The pointer nudges a tile's lights while it is over it.
import { effect, frame, init, sampler, surface, texture, type Effect, type Surface } from "vgpu";
import granite from "./granite.wgsl";
import { LOGO_TEX, loadSymbols, logoField } from "./atlas";

/** An agent's seed in 0..1 from its slug: the same agent always gets the same stone and light. */
export function seedOf(slug: string) {
  let h = 2166136261;
  for (const ch of slug) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 10007) / 10007;
}

/** Draw every canvas[data-slug] under root; resolves to a function that stops and frees it all. */
export async function mountTiles(root: HTMLElement, still: boolean): Promise<() => void> {
  const gpu = await init();
  const family = getComputedStyle(document.body).fontFamily;
  const symbols = await loadSymbols("/logos.svg").catch(() => new Map<string, { viewBox: string; body: string }>());
  const samp = sampler(gpu, { minFilter: "linear", magFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });
  const textures = new Map<string, ReturnType<typeof texture>>();

  type Spring = { x: number; y: number; h: number };
  const tiles: { canvas: HTMLCanvasElement; s: Surface; fx: Effect; now: Spring; to: Spring; seen: boolean }[] = [];
  for (const canvas of root.querySelectorAll<HTMLCanvasElement>("canvas[data-slug]")) {
    const { slug, logo = "", mono = "" } = canvas.dataset;
    const key = logo && symbols.has(logo) ? `l:${logo}` : `m:${mono}`;
    if (!textures.has(key)) {
      const tex = texture(gpu, { kind: "2d", size: [LOGO_TEX, LOGO_TEX], format: "rgba8unorm", usage: ["texture_binding", "copy_dst"], label: `logo-${key}` });
      const field = await logoField(key.startsWith("l:") ? symbols.get(logo) : undefined, mono, family);
      gpu.gpu.queue.writeTexture({ texture: tex.gpu }, field as Uint8Array<ArrayBuffer>, { bytesPerRow: LOGO_TEX * 4, rowsPerImage: LOGO_TEX }, [LOGO_TEX, LOGO_TEX, 1]);
      textures.set(key, tex);
    }
    const params = { size: [1, 1], pointer: [0.5, 0.5], hover: 0, time: 0, dark: 1, seed: seedOf(slug!), bg: [0, 0, 0, 1], fg: [1, 1, 1, 1], hue: [0, 0, 0, 1] };
    tiles.push({
      canvas,
      s: surface(gpu, canvas, { dpr: [1, 2], label: `tile-${slug}` }),
      fx: effect(gpu, granite, { label: `tile-${slug}`, set: { params, logo: textures.get(key)!, samp } }),
      now: { x: 0.5, y: 0.5, h: 0 },
      to: { x: 0.5, y: 0.5, h: 0 },
      seen: false,
    });
  }

  let time = 0;
  const draw = (list: typeof tiles) =>
    frame(gpu, (f) => {
      for (const t of list) {
        t.fx.set({ params: { size: [t.canvas.width, t.canvas.height], pointer: [t.now.x, t.now.y], hover: t.now.h, time } });
        f.pass(t.s, t.fx);
      }
    });

  // Only tiles on screen move; the rest keep their last frame.
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const t = tiles.find((x) => x.canvas === e.target);
      if (t) t.seen = e.isIntersecting;
    }
    wake();
  });
  tiles.forEach((t) => io.observe(t.canvas));

  let raf = 0;
  let last = 0;
  const tick = (ms: number) => {
    const dt = last ? Math.min(0.05, (ms - last) / 1000) : 1 / 60;
    last = ms;
    const springing = tiles.filter((t) => Math.abs(t.to.x - t.now.x) + Math.abs(t.to.y - t.now.y) + Math.abs(t.to.h - t.now.h) > 1e-4);
    for (const t of springing) {
      const k = 1 - Math.exp(-dt * 6);
      t.now.x += (t.to.x - t.now.x) * k;
      t.now.y += (t.to.y - t.now.y) * k;
      t.now.h += (t.to.h - t.now.h) * k;
    }
    const drifting = still || document.hidden ? [] : tiles.filter((t) => t.seen);
    if (drifting.length) time += dt;
    const list = [...new Set([...drifting, ...springing])];
    if (list.length) draw(list);
    raf = list.length ? requestAnimationFrame(tick) : 0;
    if (!raf) last = 0;
  };
  const wake = () => (raf ||= requestAnimationFrame(tick));
  const visibility = () => wake();
  document.addEventListener("visibilitychange", visibility);

  const offs = tiles.map((t) => {
    const move = (e: PointerEvent) => {
      const r = t.canvas.getBoundingClientRect();
      t.to = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, h: 1 };
      wake();
    };
    const leave = () => {
      t.to = { x: 0.5, y: 0.5, h: 0 };
      wake();
    };
    t.canvas.addEventListener("pointermove", move);
    t.canvas.addEventListener("pointerleave", leave);
    return () => {
      t.canvas.removeEventListener("pointermove", move);
      t.canvas.removeEventListener("pointerleave", leave);
    };
  });

  // Sizes settle after layout: draw every tile once, then let the CSS tile underneath go.
  // (a timeout, not a frame: frames don't come while the tab is in the background)
  await new Promise((r) => setTimeout(r, 0));
  draw(tiles);
  root.dataset.drawn = "";
  wake();

  return () => {
    cancelAnimationFrame(raf);
    io.disconnect();
    document.removeEventListener("visibilitychange", visibility);
    offs.forEach((off) => off());
    gpu.dispose();
  };
}
