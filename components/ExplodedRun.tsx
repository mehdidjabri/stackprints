"use client";

import { useEffect, useRef, useState } from "react";
import type { Phase } from "./Exploded";

type Pt = [number, number];

const NS = "http://www.w3.org/2000/svg";
const SPEED = 0.16; // px per ms
const BEAT = 2300; // ms per step while playing

const len = (p: Pt[]) => p.reduce((a, q, i) => (i ? a + Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) : 0), 0);
const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
/** The point a fraction f of the way along a polyline. */
function along(p: Pt[], f: number): Pt {
  let d = len(p) * f;
  for (let k = 1; k < p.length; k++) {
    const s = Math.hypot(p[k][0] - p[k - 1][0], p[k][1] - p[k - 1][1]);
    if (d <= s || k === p.length - 1) {
      const u = s ? Math.min(1, d / s) : 0;
      return [p[k - 1][0] + (p[k][0] - p[k - 1][0]) * u, p[k - 1][1] + (p[k][1] - p[k - 1][1]) * u];
    }
    d -= s;
  }
  return p[p.length - 1];
}

/**
 * The exploded view's motion. Runs and steps are radios ("m0" is the whole of run m, "m3" its third
 * step) and work without it; this adds Play (the run's steps in turn), Esc or a second click to show the
 * whole run again, a dot that travels each step's lines, and pointing at a part to see everywhere it
 * shows.
 */
export function ExplodedRun() {
  const ref = useRef<HTMLButtonElement>(null);
  const toggle = useRef<() => void>(() => {});
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const root = ref.current?.closest<HTMLElement>(".xp");
    if (!root) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const radios = () => [...root.querySelectorAll<HTMLInputElement>(".xp-in")];
    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let armed: HTMLInputElement | null = null;
    /** The run picked now: the letter of the checked radio. */
    const run = () => root.querySelector<HTMLInputElement>(".xp-in:checked")?.value[0] ?? "m";

    const stopDots = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      root.querySelectorAll(".dots").forEach((d) => d.replaceChildren());
    };
    function dots(v: string) {
      stopDots();
      if (v.endsWith("0") || reduced.matches) return;
      const svg = [...root!.querySelectorAll<SVGSVGElement>(".xp-svg")].find((s) => s.getBoundingClientRect().width > 0);
      const layer = svg?.querySelector(".dots");
      if (!svg || !layer) return;
      const phases: Phase[] = (JSON.parse(svg.dataset.anim || "{}") as Record<string, Phase[]>)[v] ?? [];
      if (!phases.length) return;
      const plan = phases.map((ph) => ({ ph, dur: "pulse" in ph ? 900 : Math.max(260, Math.max(...ph.lines.map((l) => len(l.pts))) / SPEED) }));
      let i = 0;
      let t0 = performance.now();
      let els: SVGElement[] = [];
      const begin = () => {
        const { ph } = plan[i];
        layer.replaceChildren();
        if ("pulse" in ph) {
          const e = document.createElementNS(NS, "ellipse");
          e.setAttribute("class", "pulse");
          e.setAttribute("cx", String(ph.pulse.cx));
          e.setAttribute("cy", String(ph.pulse.cy));
          els = [e];
        } else
          els = ph.lines.map((l) => {
            const r = document.createElementNS(NS, "rect");
            r.setAttribute("class", l.rose ? "dot rose" : "dot");
            r.setAttribute("width", "4");
            r.setAttribute("height", "4");
            return r;
          });
        layer.append(...els);
      };
      const tick = (now: number) => {
        const { ph, dur } = plan[i];
        const f = Math.min(1, (now - t0) / dur);
        if ("pulse" in ph) {
          els[0].setAttribute("rx", String(ph.pulse.rx * (1 + f * 1.6)));
          els[0].setAttribute("ry", String(ph.pulse.ry * (1 + f * 1.6)));
          els[0].setAttribute("opacity", String(1 - f));
        } else
          ph.lines.forEach((l, j) => {
            const [x, y] = along(l.pts, ease(f));
            els[j].setAttribute("x", String(x - 2));
            els[j].setAttribute("y", String(y - 2));
          });
        if (f >= 1) {
          if (++i >= plan.length) {
            raf = 0;
            setTimeout(() => !raf && layer.replaceChildren(), 500);
            return;
          }
          t0 = now;
          begin();
        }
        raf = requestAnimationFrame(tick);
      };
      begin();
      raf = requestAnimationFrame(tick);
    }
    const pick = (v: string) => {
      const r = radios().find((x) => x.value === v);
      if (r) r.checked = true;
      dots(v);
    };
    const stop = () => {
      clearTimeout(timer);
      timer = undefined;
      setPlaying(false);
    };
    toggle.current = () => {
      const r = run();
      if (timer !== undefined) {
        stop();
        pick(`${r}0`);
        return;
      }
      setPlaying(true);
      const steps = root.querySelectorAll(`.xp-list-${r} .xp-in`).length;
      let n = 1;
      const next = () => {
        if (n > steps) {
          stop();
          pick(`${r}0`);
          return;
        }
        pick(`${r}${n++}`);
        timer = setTimeout(next, reduced.matches ? BEAT + 300 : BEAT);
      };
      next();
    };

    // A second click on the step you're on shows the whole run again.
    const down = (e: PointerEvent) => {
      const label = (e.target as Element).closest<HTMLLabelElement>(".xp-step");
      const input = label && root.querySelector<HTMLInputElement>(`#${CSS.escape(label.htmlFor)}`);
      armed = input?.checked ? input : null;
    };
    const click = (e: MouseEvent) => {
      const label = (e.target as Element).closest<HTMLLabelElement>(".xp-step");
      if (!label || !armed || armed.id !== label.htmlFor) return;
      e.preventDefault();
      armed = null;
      stop();
      pick(`${run()}0`);
    };
    const change = (e: Event) => {
      const t = e.target as HTMLInputElement;
      if (!t.classList.contains("xp-in")) return;
      stop();
      dots(t.value);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      stop();
      pick(`${run()}0`);
    };
    // Point at a part, on the plates or in the list, to see where else it shows.
    let peek = "";
    const light = (layer: string) => {
      if (layer === peek) return;
      peek = layer;
      root.classList.toggle("peek", !!layer);
      root.querySelectorAll<HTMLElement>(".fx").forEach((el) => el.classList.toggle("on", !!layer && el.dataset.layer === layer));
    };
    const over = (e: MouseEvent) => {
      const t = (e.target as Element).closest<HTMLElement>("[data-layer]");
      light(t && !t.closest(".xp-run") ? (t.dataset.layer ?? "") : "");
    };
    const leave = () => light("");

    root.addEventListener("pointerdown", down);
    root.addEventListener("click", click);
    root.addEventListener("change", change);
    root.addEventListener("keydown", key);
    root.addEventListener("mouseover", over);
    root.addEventListener("mouseleave", leave);
    return () => {
      clearTimeout(timer);
      stopDots();
      root.removeEventListener("pointerdown", down);
      root.removeEventListener("click", click);
      root.removeEventListener("change", change);
      root.removeEventListener("keydown", key);
      root.removeEventListener("mouseover", over);
      root.removeEventListener("mouseleave", leave);
    };
  }, []);

  return (
    <button ref={ref} type="button" className="xp-play" aria-pressed={playing} onClick={() => toggle.current()}>
      <svg viewBox="0 0 8 8" aria-hidden="true">
        {playing ? <rect width="8" height="8" /> : <polygon points="0,0 8,4 0,8" />}
      </svg>
      {playing ? "Stop" : "Play"}
    </button>
  );
}
