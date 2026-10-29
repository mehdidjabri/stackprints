// The gallery's tile: polished black granite-like ceramic, made unique for each
// agent from its seed. The seed picks the body's colour (one of the brand's, deep, or black), how coarse and how crowded the crystals are,
// which of the brand's colours a share of the grains carry, how glossy the polish is, and where the
// brand's gels hang and how they drift. The logo is flat white ink.
import { Params, encode, logo_uv, logo_distance } from "./common.wgsl";
import { CAM, gnoise, fbm, studio, env, diffuse, plate_point, develop, grain } from "./studio.wgsl";
import { rim, fillet_normal } from "./edge.wgsl";
import { grains, tilt_n, coat, ink } from "./ceramic.wgsl";
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var logo: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

/** The brand's colours, linear (the light scheme's chart tokens: deep enough to read as mineral). */
const MINERALS = array<vec3f, 7>(
  vec3f(0.491, 0.072, 0.056),
  vec3f(0.342, 0.140, 0.002),
  vec3f(0.003, 0.258, 0.063),
  vec3f(0.002, 0.231, 0.270),
  vec3f(0.089, 0.152, 0.584),
  vec3f(0.242, 0.107, 0.485),
  vec3f(0.431, 0.072, 0.216),
);
/** The matrix's tones: black, blue-black, brown-black, green-black, violet-black. */
const MATRIX = array<vec3f, 5>(
  vec3f(0.016, 0.016, 0.017),
  vec3f(0.010, 0.013, 0.022),
  vec3f(0.019, 0.014, 0.011),
  vec3f(0.011, 0.016, 0.014),
  vec3f(0.015, 0.012, 0.020),
);

/** The k-th random number of this agent, 0..1. */
fn r(k: f32) -> f32 {
  return fract(sin((params.seed * 113.0 + k) * 12.9898) * 43758.5453);
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let px = 1.0 / params.size.x;
  let p = plate_point(uv);
  let V = normalize(CAM - p);
  var st = studio(params.pointer, params.hover, params.hue.rgb, 0.0);
  // each agent's lights: its own palette and its own place in the slow drift
  st.drift = params.time + params.seed * 400.0;
  st.seed = params.seed;
  st.key_colour = vec3f(0.0);
  st.strip_colour = vec3f(0.0);
  st.room = 0.2 + 0.2 * r(1.0);

  // The mix: crystal sizes, how crowded, which two colours some grains carry, and how many do.
  let s = params.size.x;
  let coarse = mix(7.0, 12.0, r(2.0));
  let fine = mix(3.4, 5.5, r(3.0));
  let crowd = mix(0.93, 0.965, r(4.0));
  // The body: one of the brand's colours, deep, for most agents; a few stay black. The grains take
  // two other colours of the palette, never the body's own.
  let body = u32(r(14.0) * 6.999);
  let c1 = MINERALS[(body + 1u + u32(r(5.0) * 2.999)) % 7u];
  let c2 = MINERALS[(body + 4u + u32(r(6.0) * 1.999)) % 7u];
  let share = mix(0.3, 0.65, r(7.0));
  let tinted = MINERALS[body] * mix(0.06, 0.11, r(15.0)) + vec3f(0.008);
  let base = select(tinted, MATRIX[u32(r(8.0) * 4.999)], r(16.0) < 0.22);

  let m = grains(uv * s / 2.2);
  let big = grains(uv * s / coarse + vec2f(3.0, 1.0) + r(9.0) * 40.0);
  let mid = grains(uv * s / fine + vec2f(11.0, 5.0) + r(10.0) * 40.0);
  let mica = grains(uv * s / 4.0 + vec2f(2.0, 19.0) + r(11.0) * 40.0);
  var a = base * (0.8 + 0.4 * m.z);
  let cloud = 0.85 + 0.3 * gnoise(uv * s / 3.0);
  let f_big = step(crowd, big.w);
  let f_mid = step(crowd - 0.05, mid.w) * (1.0 - f_big);
  // a big crystal is pale feldspar, or one of the agent's two colours
  let pale_big = vec3f(0.045 + 0.09 * big.z) * cloud * vec3f(1.0, 0.99, 0.97);
  let tint_big = mix(c1, c2, step(0.5, fract(big.z * 7.0))) * (0.28 + 0.4 * big.z) * cloud;
  a = mix(a, mix(pale_big, tint_big, step(1.0 - share, fract(big.z * 13.0))), f_big);
  let pale_mid = vec3f(0.035 + 0.07 * mid.z) * cloud;
  let tint_mid = mix(c2, c1, step(0.5, fract(mid.z * 5.0))) * (0.2 + 0.32 * mid.z) * cloud;
  a = mix(a, mix(pale_mid, tint_mid, step(1.0 - share * 0.6, fract(mid.z * 11.0))), f_mid * step(0.4, mid.z));
  a = mix(a, base * 2.2 * cloud, f_mid * step(mid.z, 0.4));

  // lapped flat and polished; the mica is a tilted mirror under the polish
  let rm = rim(uv, 0.0, 0.03);
  var n = tilt_n(vec2f(fbm(uv * 4.0 + r(12.0) * 9.0, 3), fbm(uv * 4.0 + 5.0, 3)) * 0.01);
  n = normalize(mix(n, fillet_normal(rm.xy, rm.z, 0.02), smoothstep(-0.02, 0.0, rm.z)));

  var col = a * (diffuse(st, p, n) * 0.5 + env(st, p, normalize(n + vec3f(0.0, 0.0, 0.5)), 0.5) * 3.5) * 1.4;
  let is_mica = step(0.95, mica.w) * smoothstep(0.55, 0.3, length(mica.xy));
  if (is_mica > 0.0) {
    let mn = tilt_n((vec2f(mica.z, fract(mica.w * 37.0)) - 0.5) * 1.6);
    col += env(st, p, reflect(-V, mn), 0.02) * 1.6 * is_mica;
  }
  let gloss = mix(0.03, 0.09, r(13.0));
  col += coat(st, p, V, n, 0.045, gloss) * 1.9 + coat(st, p, V, n, 0.045, 0.45) * 0.35;
  // Hover: a small white lamp over the pointer, seen in the polish. A broad faint sheen with a wide, soft
  // core, the mica near it glinting white, and the closest edge catching a thin line of light.
  let h = params.hover;
  if (h > 0.001) {
    let dp = uv - params.pointer;
    let near = dot(dp, dp);
    col += vec3f(1.0, 0.99, 0.97) * h * (0.005 * exp(-near / 1.44) + 0.0067 * exp(-near / 0.27));
    col += vec3f(1.0) * h * is_mica * 0.27 * exp(-near / 0.18);
    let edge = smoothstep(-0.02, 0.0, rm.z) * (1.0 - smoothstep(0.0, 0.004, rm.z));
    col += vec3f(1.0) * h * edge * 0.058 * exp(-near / 0.45);
  }
  col = mix(col, vec3f(0.006), clamp(rm.z / px + 0.5, 0.0, 1.0));

  let d = logo_distance(textureSampleLevel(logo, samp, logo_uv(uv), 0.0).r);
  let cover = clamp(0.5 - d / px, 0.0, 1.0);
  var out = develop(col, uv, 1.2);
  out = mix(out, ink(st, p, uv, params.size), cover);
  out += grain(uv, params.size) * 0.005;
  return encode(out);
}
