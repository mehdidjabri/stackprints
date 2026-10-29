// Shared pieces for the processor surfaces (C1–C4). Pure: no bindings. Geometry of a package's top
// (its rounded rim, a pin-1 mark, a small data-matrix code) and the optics of silicon (thin films on
// it, the colour of one wavelength), on top of the metal studio in m01-metal.wgsl.
import { h21 } from "./studio.wgsl";

/** A rounded square inset from the tile's border: x, y the outward direction, z the signed distance
 *  (uv units, negative inside) to its outline. inset: how far in, radius: its corner radius. */
export fn rim(uv: vec2f, inset: f32, radius: f32) -> vec3f {
  let q = abs(uv - vec2f(0.5)) - vec2f(0.5 - inset - radius);
  let outside = max(q, vec2f(0.0));
  let d = length(outside) + min(max(q.x, q.y), 0.0) - radius;
  var g = vec2f(0.0);
  if (q.x > 0.0 && q.y > 0.0) { g = normalize(outside); }
  else if (q.x > q.y) { g = vec2f(1.0, 0.0); }
  else { g = vec2f(0.0, 1.0); }
  let s = sign(uv - vec2f(0.5));
  return vec3f(g * s, d);
}

/** The normal of a filleted edge: within width of the outline (d from rim, negative inside), the
 *  surface rolls over towards the outward direction o (uv, y down) like a quarter round. */
export fn fillet_normal(o: vec2f, d: f32, width: f32) -> vec3f {
  let t = clamp(1.0 + d / width, 0.0, 1.0);
  // a quarter circle, eased in where it leaves the flat so there is no crease: the slope angle grows
  // as asin(t), steepest at the outline
  let a = asin(clamp(t * t * (2.0 - t), 0.0, 0.999)) * 0.92;
  // uv y runs down, the plate's y up
  return normalize(vec3f(o.x * sin(a), -o.y * sin(a), cos(a)));
}

/** A right triangle in the corner at c (uv), legs of length l pointing into the tile: coverage. */
export fn pin1(uv: vec2f, c: vec2f, l: f32, px: f32) -> f32 {
  let into = sign(vec2f(0.5) - c);
  let q = (uv - c) * into;
  // inside when both legs positive and below the hypotenuse
  let d = max(max(-q.x, -q.y), (q.x + q.y - l) * 0.70710678);
  return clamp(0.5 - d / px, 0.0, 1.0);
}

/** A small data-matrix code (12×12 modules) with its L finder and clock track, centred at c, of side
 *  s: x the coverage of a dark/marked module, y 1 inside the code's square. */
export fn data_matrix(uv: vec2f, c: vec2f, s: f32, seed: i32) -> vec2f {
  let q = (uv - c) / s + vec2f(0.5);
  if (q.x < 0.0 || q.y < 0.0 || q.x >= 1.0 || q.y >= 1.0) { return vec2f(0.0); }
  let n = 12.0;
  let cell = vec2i(floor(q * n));
  let f = fract(q * n);
  var on = h21(cell + vec2i(seed * 17, seed * 31)) > 0.52;
  if (cell.x == 0 || cell.y == 11) { on = true; }
  if (cell.y == 0) { on = (cell.x % 2) == 0; }
  if (cell.x == 11) { on = (cell.y % 2) == 1; }
  // laser dots: round, a little smaller than the module
  let dot_ = smoothstep(0.5, 0.36, length(f - vec2f(0.5)));
  return vec2f(select(0.0, dot_, on), 1.0);
}

/** Linear sRGB of one wavelength (nm), roughly unit brightness across the visible, 0 outside it. */
export fn spectral(l: f32) -> vec3f {
  let x = clamp((l - 400.0) / 300.0, 0.0, 1.0);
  // a smooth rainbow: violet, blue, cyan, green, yellow, orange, red
  let r = smoothstep(0.42, 0.62, x) + 0.35 * smoothstep(0.12, 0.0, x) * step(0.0, x);
  let g = smoothstep(0.18, 0.40, x) * smoothstep(0.82, 0.58, x);
  let b = smoothstep(0.0, 0.10, x) * smoothstep(0.42, 0.26, x);
  let edge = smoothstep(380.0, 420.0, l) * smoothstep(720.0, 660.0, l);
  return vec3f(r, g, b) * edge;
}

fn cmul(a: vec2f, b: vec2f) -> vec2f { return vec2f(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
fn cdiv(a: vec2f, b: vec2f) -> vec2f { return vec2f(a.x * b.x + a.y * b.y, a.y * b.x - a.x * b.y) / dot(b, b); }

/** Reflectance (linear rgb) of a transparent film of index n1, d nm thick, on silicon, seen at cos_i.
 *  Sampled at three wavelengths with silicon's complex index at each. */
export fn film_on_si(d: f32, n1: f32, cos_i: f32) -> vec3f {
  let sin2 = 1.0 - cos_i * cos_i;
  let ls = vec3f(610.0, 545.0, 465.0);
  let si_n = vec3f(3.94, 4.09, 4.60);
  let si_k = vec3f(0.02, 0.05, 0.13);
  var out = vec3f(0.0);
  for (var i = 0; i < 3; i++) {
    let cos1 = sqrt(max(1.0 - sin2 / (n1 * n1), 0.0));
    let N2 = vec2f(si_n[i], si_k[i]);
    let r01 = vec2f((cos_i - n1 * cos1) / (cos_i + n1 * cos1), 0.0);
    let r12 = cdiv(vec2f(n1, 0.0) - N2, vec2f(n1, 0.0) + N2);
    let beta = 12.566371 * n1 * d * cos1 / ls[i];
    let t = cmul(r12, vec2f(cos(beta), sin(beta)));
    let r = cdiv(r01 + t, vec2f(1.0, 0.0) + cmul(r01, t));
    out[i] = dot(r, r);
  }
  return out;
}
