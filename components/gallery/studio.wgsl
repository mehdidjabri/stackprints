// The metal samples' shared studio (M01–M04). Pure: no bindings. A plate spans -1..1 in x and y (y up,
// z towards the camera), photographed straight down from a camera at CAM. The studio around it is an
// environment of soft-edged area lights on a ceiling plane: a big key softbox to the upper left, a
// narrow strip light to the right, a faint gelled card in the agent's hue, a dim room. Each light is a
// box convolved with a Gaussian of the surface's roughness, so a polished plate shows crisp softboxes
// and a rough one the same energy spread into a broad sheen.

export const CAM: vec3f = vec3f(0.0, 0.0, 4.0);
const CEIL: f32 = 3.2;

fn hash_u(x: u32) -> u32 {
  let v = x * 747796405u + 2891336453u;
  let w = ((v >> ((v >> 28u) + 4u)) ^ v) * 277803737u;
  return (w >> 22u) ^ w;
}
fn hash_i(i: vec2i) -> u32 {
  return hash_u(bitcast<u32>(i.x) + hash_u(bitcast<u32>(i.y) ^ 0x9e3779b9u));
}
/** A random number in 0..1 for an integer cell. */
export fn h21(i: vec2i) -> f32 {
  return f32(hash_i(i) >> 8u) / 16777216.0;
}
/** Two random numbers in 0..1 for an integer cell. */
export fn h22(i: vec2i) -> vec2f {
  let a = hash_i(i);
  let b = hash_u(a);
  return vec2f(f32(a >> 8u), f32(b >> 8u)) / 16777216.0;
}
/** Value noise in 0..1. */
export fn vnoise(p: vec2f) -> f32 {
  let i = vec2i(floor(p));
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = h21(i);
  let b = h21(i + vec2i(1, 0));
  let c = h21(i + vec2i(0, 1));
  let d = h21(i + vec2i(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
/** Gradient noise, roughly -0.7..0.7. */
export fn gnoise(p: vec2f) -> f32 {
  let i = vec2i(floor(p));
  let f = fract(p);
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let ga = h22(i) * 2.0 - 1.0;
  let gb = h22(i + vec2i(1, 0)) * 2.0 - 1.0;
  let gc = h22(i + vec2i(0, 1)) * 2.0 - 1.0;
  let gd = h22(i + vec2i(1, 1)) * 2.0 - 1.0;
  let a = dot(ga, f);
  let b = dot(gb, f - vec2f(1.0, 0.0));
  let c = dot(gc, f - vec2f(0.0, 1.0));
  let d = dot(gd, f - vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
/** Fractal gradient noise, about -1..1. */
export fn fbm(p0: vec2f, octaves: i32) -> f32 {
  var p = p0;
  var a = 0.5;
  var s = 0.0;
  for (var i = 0; i < octaves; i++) {
    s += a * gnoise(p);
    p = vec2f(p.x * 1.6 - p.y * 1.2, p.x * 1.2 + p.y * 1.6) + vec2f(3.1, 7.7);
    a *= 0.5;
  }
  return s * 1.6;
}

/** erf, near enough. */
fn erf_(x0: f32) -> f32 {
  let x = clamp(x0, -3.0, 3.0);
  return tanh(x * (1.12838 + 0.10093 * x * x));
}
/** A box of half-size h centred at 0, convolved with a Gaussian of deviation s, at x. */
fn soft_box(x: f32, h: f32, s: f32) -> f32 {
  let k = 0.70710678 / s;
  return 0.5 * (erf_((x + h) * k) - erf_((x - h) * k));
}
/** A rectangle light on the ceiling seen along r from p, blurred by roughness alpha. */
fn ceiling_rect(p: vec3f, r: vec3f, alpha: f32, c: vec2f, half: vec2f, hot: f32) -> f32 {
  if (r.z <= 0.02) { return 0.0; }
  let t = (CEIL - p.z) / r.z;
  let q = p.xy + r.xy * t;
  let s = alpha * t * 0.85 + 0.004 * t;
  let d = q - c;
  // a softbox is a touch hotter in the middle than at its edges
  let falloff = 1.0 - hot * clamp(dot(d / half, d / half), 0.0, 1.0) * smoothstep(0.6, 0.0, alpha);
  return soft_box(d.x, half.x, s) * soft_box(d.y, half.y, s) * falloff;
}

/** The light layout: where the key sits (moved by the pointer) and how much the hue card shows. */
export struct Studio {
  key: vec2f,
  key_half: vec2f,
  key_colour: vec3f,
  strip_colour: vec3f,
  hue: vec3f,
  room: f32,
  fill: f32,
  /** Seconds: the brand's gels drift with it, very slowly. */
  drift: f32,
  /** The agent's seed, 0..1: which of the brand's colours lead its palette. */
  seed: f32,
}

/** The brand's seven colours (the dark-scheme chart tokens), linear: coral, amber, mint, aqua, periwinkle, violet, rose. */
const GELS = array<vec3f, 7>(
  vec3f(0.991, 0.356, 0.305),
  vec3f(0.855, 0.434, 0.104),
  vec3f(0.202, 0.665, 0.301),
  vec3f(0.040, 0.665, 0.768),
  vec3f(0.376, 0.497, 0.991),
  vec3f(0.610, 0.402, 0.991),
  vec3f(0.956, 0.328, 0.584),
);

/** The default studio: key to the upper left, nudged by the pointer while hovering. */
export fn studio(pointer: vec2f, hover: f32, hue: vec3f, hue_amount: f32) -> Studio {
  // the pointer only nudges the lights: the set barely moves
  let aim = (pointer - vec2f(0.5)) * vec2f(0.5, -0.5) * hover;
  var s: Studio;
  s.key = vec2f(-0.95, 1.55) + aim;
  s.key_half = vec2f(1.25, 0.72);
  // no white key or strip: all the light comes from the brand's gels
  s.key_colour = vec3f(0.0);
  s.strip_colour = vec3f(0.0);
  let hl = max(max(hue.r, hue.g), max(hue.b, 1e-3));
  s.hue = hue / hl * hue_amount;
  s.room = 1.0;
  s.fill = 0.0;
  s.drift = 0.0;
  s.seed = 0.0;
  return s;
}

/** Radiance arriving along r at p, for a surface of roughness alpha. */
export fn env(st: Studio, p: vec3f, r: vec3f, alpha: f32) -> vec3f {
  // the room: dim ceiling, brighter spill around the key, slightly lit walls towards the horizon
  let up = clamp(r.z, 0.0, 1.0);
  var c = vec3f(0.030, 0.031, 0.034) * st.room;
  if (r.z > 0.02) {
    let q = p.xy + r.xy * ((CEIL - p.z) / r.z);
    let dk = q - st.key;
    c += vec3f(0.16, 0.155, 0.15) * exp(-dot(dk, dk) / (5.0 + 8.0 * alpha)) * st.room;
  }
  // white bounce cards around the set: brightest on the key's side, they light edges and bevels
  let side = dot(normalize(r.xy + vec2f(1e-4)), normalize(st.key));
  c += vec3f(0.10, 0.10, 0.105) * (1.0 + 2.2 * smoothstep(-0.3, 1.0, side)) * pow(1.0 - up, 3.0) * st.room;
  // the key softbox, the strip, the gelled card
  c += st.key_colour * ceiling_rect(p, r, alpha, st.key, st.key_half, 0.22);
  c += st.strip_colour * ceiling_rect(p, r, alpha, vec2f(1.62, -0.25), vec2f(0.075, 1.9), 0.0);
  c += vec3f(1.0, 0.97, 0.93) * st.fill * ceiling_rect(p, r, alpha, vec2f(-1.7, -1.9), vec2f(0.8, 0.55), 0.0);
  c += st.hue * ceiling_rect(p, r, alpha, vec2f(0.9, -2.05), vec2f(0.55, 0.32), 0.0) * 1.6;
  // The brand's gels: seven large, heavily diffused lights in a wide ring overhead, each faint, each
  // drifting on its own slow orbit, so the surface holds a soft mix of colours that never sits still.
  let soft = max(alpha, 0.32);
  for (var i = 0; i < 7; i++) {
    let fi = f32(i);
    // each agent's palette: two or three of the seven lead, the rest stay faint; the ring turns with it
    let roll = fract(sin((st.seed * 97.0 + fi) * 12.9898) * 43758.5453);
    let w = 0.12 + 1.6 * smoothstep(0.55, 0.95, roll);
    let a = st.seed * 6.2831853 + fi * 0.8975979 + st.drift * (0.035 + 0.012 * sin(fi * 1.7)) + sin(st.drift * 0.07 + fi) * 0.25;
    let rad = 2.0 + 0.35 * sin(st.drift * 0.05 + fi * 2.3);
    let at = vec2f(cos(a), sin(a)) * rad;
    c += GELS[i] * 0.6 * w * ceiling_rect(p, r, soft, at, vec2f(0.85, 0.85), 0.0);
  }
  return c;
}

/** Irradiance-ish light on a diffuse surface with normal n at p (for ink and oxide). */
export fn diffuse(st: Studio, p: vec3f, n: vec3f) -> vec3f {
  return env(st, p, normalize(n + vec3f(0.0, 0.0, 0.25)), 1.4) * 2.9 + vec3f(0.03);
}

/** Schlick Fresnel, coloured. */
export fn fresnel(f0: vec3f, cos_t: f32) -> vec3f {
  return f0 + (vec3f(1.0) - f0) * pow(1.0 - clamp(cos_t, 0.0, 1.0), 5.0);
}

/** The plate's surface point and the view direction at it, from the tile's uv. */
export fn plate_point(uv: vec2f) -> vec3f {
  return vec3f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0);
}

/** The chamfer at the plate's edge: x, y outward slope (0 off the chamfer), z its coverage. */
export fn chamfer(uv: vec2f, width: f32, px: f32) -> vec3f {
  let e = vec4f(uv.x, 1.0 - uv.x, uv.y, 1.0 - uv.y);
  let m = min(min(e.x, e.y), min(e.z, e.w));
  var o = vec2f(0.0);
  if (m == e.x) { o = vec2f(-1.0, 0.0); }
  else if (m == e.y) { o = vec2f(1.0, 0.0); }
  else if (m == e.z) { o = vec2f(0.0, 1.0); }
  else { o = vec2f(0.0, -1.0); }
  let cov = clamp((width - m) / px + 0.5, 0.0, 1.0);
  return vec3f(o, cov);
}

/** Photographic finish: exposure, a filmic shoulder, a little lens falloff. */
export fn develop(c0: vec3f, uv: vec2f, exposure: f32) -> vec3f {
  let v = uv - vec2f(0.5);
  let fall = 1.0 - 0.32 * dot(v, v) * 2.0;
  let c = c0 * exposure * fall;
  return c * (2.51 * c + 0.03) / (c * (2.43 * c + 0.59) + 0.14);
}

/** develop, but keeping more of a coloured metal's saturation in its highlights: keep 0..1 mixes in a
 *  tone curve on luminance alone, which bleaches less. */
export fn develop_rich(c0: vec3f, uv: vec2f, exposure: f32, keep: f32) -> vec3f {
  let per = develop(c0, uv, exposure);
  let v = uv - vec2f(0.5);
  let c = c0 * exposure * (1.0 - 0.32 * dot(v, v) * 2.0);
  let l = max(dot(c, vec3f(0.2126, 0.7152, 0.0722)), 1e-5);
  let lt = l * (2.51 * l + 0.03) / (l * (2.43 * l + 0.59) + 0.14);
  let lum = c * (lt / l);
  // where the luminance-mapped colour runs past white, let it bleach towards the per-channel one
  let over = clamp(max(max(lum.r, lum.g), lum.b) - 1.0, 0.0, 1.0);
  return mix(per, min(lum, vec3f(1.0)), keep * (1.0 - over * 0.7));
}

/** Sensor grain for a pixel. */
export fn grain(uv: vec2f, size: vec2f) -> f32 {
  return h21(vec2i(floor(uv * size))) - 0.5;
}

/** Fine polishing marks: many short hairlines in every direction. x, y: the tilt they give the
 *  surface; z: how much of a mark is here. density 0..1, scale: marks per unit across. */
export fn hairlines(uv: vec2f, px: f32, density: f32, scale: f32) -> vec3f {
  var tilt = vec2f(0.0);
  var depth = 0.0;
  for (var l = 0; l < 6; l++) {
    let a = h21(vec2i(l, 31)) * 3.14159;
    let dir = vec2f(cos(a), sin(a));
    let nrm = vec2f(-dir.y, dir.x);
    let u = dot(uv, dir) * scale * 0.18;
    let v = dot(uv, nrm) * scale + f32(l) * 0.37;
    let cell = vec2i(i32(floor(u)), i32(floor(v)));
    let h = h22(cell + vec2i(l * 97, 13));
    if (h.x < density) {
      let along = fract(u);
      let span = smoothstep(0.0, 0.35, along) * smoothstep(1.0, 0.45, along);
      let dv = (fract(v) - (0.2 + 0.6 * h.y)) / scale;
      let w = px * (0.45 + 0.5 * h21(cell + vec2i(5, l)));
      let x = dv / w;
      let s = exp(-x * x) * span * (0.3 + 0.7 * h.y);
      tilt += nrm * x * s;
      depth = max(depth, s);
    }
  }
  return vec3f(tilt, depth);
}

/** Dried water spots: a few rings where oxide gathered at a drop's edge. */
export fn water_spots(uv: vec2f, scale: f32, chance: f32) -> f32 {
  let q = uv * scale;
  let i = vec2i(floor(q));
  var ring = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let c = i + vec2i(x, y);
      let h = h22(c + vec2i(311, 17));
      if (h21(c + vec2i(7, 911)) < chance) {
        let centre = vec2f(c) + h;
        let rad = 0.18 + 0.3 * h.y;
        let wob = gnoise((q - centre) * 5.0 + h * 9.0) * 0.06;
        let d = length(q - centre) - rad + wob;
        let rim = exp(-d * d / (0.0016 + 0.002 * h.x)) * 0.8 + smoothstep(0.0, -rad, d) * 0.22;
        ring = max(ring, rim);
      }
    }
  }
  return ring;
}

/** Light off a brushed surface: the mirror direction spread across the grooves (along y) by ay, along
 *  them by ax, the grooves running along x. */
export fn aniso_env(st: Studio, p: vec3f, r: vec3f, ax: f32, ay: f32) -> vec3f {
  var sum = vec3f(0.0);
  var wsum = 0.0;
  for (var k = -5; k <= 5; k++) {
    let o = f32(k) / 5.0;
    let w = exp(-o * o * 4.5);
    sum += env(st, p, normalize(r + vec3f(0.0, o * ay * 2.6, 0.0)), ax) * w;
    wsum += w;
  }
  return sum / wsum;
}
