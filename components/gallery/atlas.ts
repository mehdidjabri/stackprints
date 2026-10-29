// Each logo as a signed distance field, drawn with canvas 2D and uploaded once: crisp at any size.

/** Texels per logo, and how far the field reaches (mirrored in components/styles/common.wgsl). */
export const LOGO_TEX = 256;
export const LOGO_SPREAD = 24;
/** The logo fills the box but for room for its field to fade. */
const LOGO_PAD = 0.1;

/** The sprite's symbols as standalone SVG documents, by id. */
export async function loadSymbols(url: string): Promise<Map<string, { viewBox: string; body: string }>> {
  const text = await fetch(url).then((r) => (r.ok ? r.text() : ""));
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const out = new Map<string, { viewBox: string; body: string }>();
  for (const s of doc.querySelectorAll("symbol")) out.set(s.id, { viewBox: s.getAttribute("viewBox") ?? "0 0 24 24", body: s.innerHTML });
  return out;
}

async function rasterSymbol(sym: { viewBox: string; body: string }, ctx: CanvasRenderingContext2D) {
  const inner = Math.round(LOGO_TEX * (1 - 2 * LOGO_PAD));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${sym.viewBox}" width="${inner}" height="${inner}" style="color:#fff">${sym.body}</svg>`;
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const o = (LOGO_TEX - inner) / 2;
    ctx.drawImage(img, o, o, inner, inner);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function rasterMono(text: string, family: string, ctx: CanvasRenderingContext2D) {
  const inner = LOGO_TEX * (1 - 2 * LOGO_PAD);
  let size = inner * 0.62;
  ctx.font = `600 ${size}px ${family}`;
  const w = ctx.measureText(text).width;
  if (w > inner * 0.9) size *= (inner * 0.9) / w;
  ctx.font = `600 ${size}px ${family}`;
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, LOGO_TEX / 2, LOGO_TEX / 2 + size * 0.04);
}

const INF = 1e20;

/** One dimension of Felzenszwalb and Huttenlocher's distance transform, in place on f. */
function edt1(f: Float64Array, off: number, stride: number, n: number, tmp: { d: Float64Array; v: Int32Array; z: Float64Array; g: Float64Array }) {
  const { d, v, z, g } = tmp;
  for (let i = 0; i < n; i++) g[i] = f[off + i * stride];
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  let k = 0;
  for (let q = 1; q < n; q++) {
    let s: number;
    do {
      const r = v[k];
      s = (g[q] + q * q - (g[r] + r * r)) / (2 * q - 2 * r);
    } while (s <= z[k] && --k > -1);
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const r = v[k];
    d[q] = (q - r) * (q - r) + g[r];
  }
  for (let i = 0; i < n; i++) f[off + i * stride] = d[i];
}

function edt(f: Float64Array, n: number) {
  const tmp = { d: new Float64Array(n), v: new Int32Array(n), z: new Float64Array(n + 1), g: new Float64Array(n) };
  for (let x = 0; x < n; x++) edt1(f, x, n, n, tmp);
  for (let y = 0; y < n; y++) edt1(f, y * n, 1, n, tmp);
}

/**
 * A logo's distance field from its coverage, edge pixels placed by how much they cover (as TinySDF
 * does): r the field (0.5 on the edge, more outside), g the coverage itself.
 */
function field(alpha: Uint8ClampedArray, n: number): Uint8Array {
  const outer = new Float64Array(n * n);
  const inner = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) {
    const a = alpha[i * 4 + 3] / 255;
    if (a >= 1) {
      outer[i] = 0;
      inner[i] = INF;
    } else if (a <= 0) {
      outer[i] = INF;
      inner[i] = 0;
    } else {
      const d = 0.5 - a;
      outer[i] = d > 0 ? d * d : 0;
      inner[i] = d < 0 ? d * d : 0;
    }
  }
  edt(outer, n);
  edt(inner, n);
  const out = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    const d = Math.sqrt(outer[i]) - Math.sqrt(inner[i]);
    out[i * 4] = Math.round(255 * Math.min(1, Math.max(0, 0.5 + d / (2 * LOGO_SPREAD))));
    out[i * 4 + 1] = alpha[i * 4 + 3];
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** A logo (a sprite symbol, or a monogram when there is none) as its distance field. */
export async function logoField(sym: { viewBox: string; body: string } | undefined, mono: string, family: string): Promise<Uint8Array> {
  const c = document.createElement("canvas");
  c.width = c.height = LOGO_TEX;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  try {
    if (sym) await rasterSymbol(sym, ctx);
    else rasterMono(mono, family, ctx);
  } catch {
    ctx.clearRect(0, 0, LOGO_TEX, LOGO_TEX);
    rasterMono(mono, family, ctx);
  }
  return field(ctx.getImageData(0, 0, LOGO_TEX, LOGO_TEX).data, LOGO_TEX);
}
