// Ink renderer for the tank game: an orthographic top-down view of the board is drawn into a
// data buffer (shade, inkId, normal.xy) + depth, then a full-screen "pen on lined paper" pass
// draws outlines, hatching, paper grain and ruled lines — same pipeline as doodleshooter,
// reworked for an orthographic camera (depth is linear, so the edge test works on raw depth).
import * as THREE from 'three';

export const INK = { BLUE: 0, RED: 1, BLACK: 2, ORANGE: 3, GREEN: 4, PINK: 5 };
export const INK_COLORS = [
  new THREE.Vector3(0.10, 0.19, 0.76), // blue ballpoint
  new THREE.Vector3(0.86, 0.12, 0.20), // red pen
  new THREE.Vector3(0.18, 0.20, 0.26), // graphite
  new THREE.Vector3(0.92, 0.55, 0.08), // orange highlighter
  new THREE.Vector3(0.12, 0.60, 0.30), // green
  new THREE.Vector3(0.90, 0.40, 0.66), // pink
];
export const LIGHT_WORLD = new THREE.Vector3(0.35, 0.85, 0.40).normalize();
export const shared = { uLightDir: { value: new THREE.Vector3(0, 1, 0) }, uTime: { value: 0 } };

const inkVert = /* glsl */`
varying vec3 vNormalV;
varying vec4 vColorData;
uniform float uTime;
void main() {
  vec3 transformed = position;
  vec3 objectNormal = normal;
  #ifdef USE_INSTANCING
    transformed = (instanceMatrix * vec4(transformed, 1.0)).xyz;
    objectNormal = mat3(instanceMatrix) * objectNormal;
  #endif
  #ifdef USE_INSTANCING_COLOR
    vColorData = vec4(instanceColor, 1.0);
  #else
    vColorData = vec4(0.0, 0.0, 0.0, -1.0);
  #endif
  vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
  vNormalV = normalize(normalMatrix * objectNormal);
  gl_Position = projectionMatrix * mvPosition;
}`;

const inkFrag = /* glsl */`
precision highp float;
uniform float uInk;
uniform float uFill;
uniform float uShadeScale;
uniform float uShadeBias;
uniform vec3 uLightDir;
varying vec3 vNormalV;
varying vec4 vColorData;
void main() {
  vec3 n = normalize(vNormalV);
  if (!gl_FrontFacing) n = -n;
  float ndl = dot(n, uLightDir) * 0.5 + 0.5;
  float ink = uInk; float fill = uFill;
  if (vColorData.a > 0.0) { ink = vColorData.r; fill = vColorData.g; }
  float shade = clamp(ndl * uShadeScale + uShadeBias, 0.0, 1.0);
  if (fill > 0.5) shade = -1.0;
  gl_FragColor = vec4(shade, ink, n.x, n.y);
}`;

export function makeInkMaterial(opts = {}) {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uInk: { value: opts.ink ?? INK.BLUE }, uFill: { value: opts.fill ? 1 : 0 },
      uShadeScale: { value: opts.shadeScale ?? 1.0 }, uShadeBias: { value: opts.shadeBias ?? 0.0 },
      uLightDir: shared.uLightDir, uTime: shared.uTime,
    },
    vertexShader: inkVert, fragmentShader: inkFrag, side: opts.side ?? THREE.FrontSide,
  });
  m.inkId = opts.ink ?? INK.BLUE;
  return m;
}
export function setInk(mat, ink) { mat.uniforms.uInk.value = ink; mat.inkId = ink; }
export function setFill(mat, fill) { mat.uniforms.uFill.value = fill ? 1 : 0; }

const postVert = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

// Orthographic post pass: depth is already linear view distance, so silhouette edges are found
// with a plain depth laplacian; face boundaries come from the normal buffer. Hatching is laid
// out in world space by rebuilding the fragment's view position from ndc + ortho half extents.
const postFrag = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform vec2 uRes;
uniform float uAspect;
uniform float uTime;
uniform float uNear;
uniform float uFar;
uniform float uHurt;
uniform float uFlash;
uniform vec2 uHalf;
uniform mat4 uInvView;
uniform float uSolid;
uniform float uLineSpacing;
uniform vec3 uPaper;
uniform vec3 uInks[6];

float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0)), c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
vec3 inkColor(float id) {
  int i = int(id + 0.5);
  if (i <= 0) return uInks[0]; if (i == 1) return uInks[1]; if (i == 2) return uInks[2];
  if (i == 3) return uInks[3]; if (i == 4) return uInks[4]; return uInks[5];
}
float stripes(vec2 p, vec2 dir, float spacing, float width) {
  float t = dot(p, vec2(-dir.y, dir.x));
  float f = abs(fract(t / spacing) - 0.5) * spacing;
  float soft = width * 0.6;
  return 1.0 - smoothstep(width * 0.5 - soft, width * 0.5 + soft, f);
}
void main() {
  vec2 px = 1.0 / uRes;
  float sc = uRes.y / 900.0;
  vec2 nuv = vUv * vec2(uAspect, 1.0);
  vec2 wob = vec2(vnoise(nuv * 6.0 + 11.3), vnoise(nuv * 6.0 + 37.0)) - 0.5;
  vec2 suv = vUv + wob * 2.0 * sc * px;
  vec4 s = texture2D(tScene, suv);
  float z = texture2D(tDepth, suv).x;
  float d = mix(uNear, uFar, z);
  float o = 1.15 * sc;
  vec2 ox = vec2(o, 0.0) * px, oy = vec2(0.0, o) * px;
  float zl = texture2D(tDepth, suv - ox).x, zr = texture2D(tDepth, suv + ox).x;
  float zu = texture2D(tDepth, suv + oy).x, zd = texture2D(tDepth, suv - oy).x;
  vec4 sl = texture2D(tScene, suv - ox), sr = texture2D(tScene, suv + ox);
  vec4 su = texture2D(tScene, suv + oy), sd = texture2D(tScene, suv - oy);
  // silhouettes: depth laplacian in world units (ortho depth is linear)
  float lap = abs(mix(uNear, uFar, zl) + mix(uNear, uFar, zr) - 2.0 * d)
            + abs(mix(uNear, uFar, zu) + mix(uNear, uFar, zd) - 2.0 * d);
  float edge = smoothstep(0.10, 0.38, lap);
  // face boundaries: view-space normal change
  float nEdge = length(sl.ba - sr.ba) + length(su.ba - sd.ba);
  edge = max(edge, smoothstep(0.42, 0.85, nEdge));
  // thin objects (bullet strokes, wires) sit below the depth threshold: catch them by shade dip
  float zmin = z; float inkId = s.g;
  if (zl < zmin) { zmin = zl; inkId = sl.g; }
  if (zr < zmin) { zmin = zr; inkId = sr.g; }
  if (zu < zmin) { zmin = zu; inkId = su.g; }
  if (zd < zmin) { zmin = zd; inkId = sd.g; }
  bool sky = z >= 0.99999;

  // hatching anchored to world position, rebuilt from ortho ndc + half extents
  float shade = s.r;
  float hatch = 0.0;
  if (!sky) {
    if (shade < 0.0) hatch = 1.0;
    else {
      vec2 ndc = vUv * 2.0 - 1.0;
      vec3 vpos = vec3(ndc.x * uHalf.x, ndc.y * uHalf.y, -d);
      vec3 wpos = (uInvView * vec4(vpos, 1.0)).xyz;
      vec2 nxy = s.ba;
      vec3 nView = vec3(nxy, sqrt(max(0.0, 1.0 - dot(nxy, nxy))));
      vec3 wn = normalize(mat3(uInvView) * nView);
      vec3 an = abs(wn);
      vec2 hp = an.y > max(an.x, an.z) ? wpos.xz : (an.x > an.z ? wpos.zy : wpos.xy);
      float lod = exp2(floor(log2(max(1e-4, (0.0165 * d) / 0.16))));
      float sp = 0.16 * lod; float w = sp * 0.17;
      hp += (vnoise(hp * (2.5 / sp)) - 0.5) * sp * 0.4;
      const vec2 d1 = vec2(0.7071, 0.7071);
      const vec2 d2 = vec2(-0.7071, 0.7071);
      const vec2 d3 = vec2(0.2588, 0.9659);
      float h1 = stripes(hp, d1, sp, w);
      float h2 = stripes(hp, d2, sp * 1.15, w);
      float h3 = stripes(hp, d3, sp * 0.7, w);
      hatch = h1 * smoothstep(0.64, 0.5, shade);
      hatch = max(hatch, h2 * smoothstep(0.42, 0.32, shade));
      hatch = max(hatch, h3 * smoothstep(0.24, 0.14, shade));
      hatch = max(hatch, smoothstep(0.12, 0.0, shade) * 0.9);
    }
  }
  float fade = mix(1.0, 0.35, smoothstep(24.0, 70.0, d));
  float fadeE = mix(1.0, 0.55, smoothstep(28.0, 80.0, d));

  // paper with grain, ruled lines and a red margin
  vec2 pp = gl_FragCoord.xy;
  float grain = vnoise(pp * 0.8) * 0.6 + vnoise(pp * 0.17) * 0.4;
  vec3 paper = uPaper * (0.95 + 0.06 * grain);
  float ls = uLineSpacing;
  float ly = mod(pp.y + ls * 0.5, ls);
  float rule = 1.0 - smoothstep(0.5 * sc, 1.7 * sc, abs(ly - ls * 0.5));
  paper = mix(paper, vec3(0.58, 0.70, 0.92), rule * 0.5);
  float margin = 1.0 - smoothstep(0.9 * sc, 2.3 * sc, abs(pp.x - uRes.x * 0.07));
  paper = mix(paper, vec3(0.92, 0.48, 0.55), margin * 0.55);

  vec3 col = paper;
  col = mix(col, inkColor(s.g), hatch * 0.72 * fade);
  float ew = 0.75 + 0.35 * vnoise(pp * 0.35);
  col = mix(col, inkColor(inkId) * 0.92, clamp(edge * ew, 0.0, 1.0) * fadeE);

  // 纯色模式：去掉纸面横线与排线，每种墨水换成一块干净的玩具色；天空给一个柔和渐变。
  if (uSolid > 0.5) {
    vec3 base;
    if (shade < 0.0) {
      // 填充面：水面读作水，其余（地面/阴影/焦痕）统一为草地色调
      base = (s.g > -0.5 && s.g < 0.5) ? vec3(0.33, 0.60, 0.80) : vec3(0.60, 0.69, 0.56);
    } else if (s.g < 0.5) base = vec3(0.24, 0.46, 0.84);        // 蓝：玩家坦克
    else if (s.g < 1.5) base = vec3(0.86, 0.26, 0.20);          // 红：子弹与爆炸
    else if (s.g < 2.5) base = vec3(0.54, 0.57, 0.62);          // 石墨：敌军与钢墙
    else if (s.g < 3.5) base = vec3(0.83, 0.50, 0.27);          // 橙：砖墙与道具
    else if (s.g < 4.5) base = vec3(0.34, 0.61, 0.33);          // 绿：树丛
    else base = vec3(0.91, 0.60, 0.74);                          // 粉：护罩
    float light = shade < 0.0 ? 1.0 : 0.62 + 0.38 * shade;
    col = base * light;
    col *= 1.0 - edge * 0.20 * fadeE;                            // 保留一点描边做体积感
    if (sky) col = mix(vec3(0.74, 0.81, 0.84), vec3(0.56, 0.68, 0.78), smoothstep(0.0, 1.0, vUv.y));
  }

  // hurt: red scribble vignette
  vec2 vc = (vUv - 0.5) * vec2(uAspect, 1.0);
  float vig = smoothstep(0.32, 0.9, length(vc));
  float scr = 0.55 + 0.45 * stripes(pp + wob * 8.0, normalize(vec2(1.0, 0.8)), 7.0 * sc, 2.2 * sc);
  col = mix(col, uInks[1] * 0.9, clamp(uHurt, 0.0, 1.0) * vig * scr);
  col = mix(col, uPaper, clamp(uFlash, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}`;

export class InkRenderer {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.autoClear = false;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.scene = new THREE.Scene();
    // orthographic camera, gently tilted so walls and tanks read as hand-drawn boxes on paper
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 120);
    this.tilt = 0.60;                    // how far south the camera sits (0 = straight down)
    this.camDist = 46;                   // height along the view axis
    this.camTarget = new THREE.Vector3(0, 0, 0.5);
    const depthTexture = new THREE.DepthTexture(2, 2); depthTexture.format = THREE.DepthFormat; depthTexture.type = THREE.FloatType;
    this.rt = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthTexture, depthBuffer: true, stencilBuffer: false, generateMipmaps: false });
    this.post = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: this.rt.texture }, tDepth: { value: depthTexture }, uRes: { value: new THREE.Vector2(2, 2) }, uAspect: { value: 1 },
        uTime: { value: 0 }, uNear: { value: this.camera.near }, uFar: { value: this.camera.far }, uHurt: { value: 0 }, uFlash: { value: 0 },
        uHalf: { value: new THREE.Vector2(1, 1) }, uSolid: { value: 0 }, uLineSpacing: { value: 60 }, uPaper: { value: new THREE.Vector3(0.965, 0.955, 0.905) }, uInks: { value: INK_COLORS },
        uInvView: { value: new THREE.Matrix4() },
      },
      vertexShader: postVert, fragmentShader: postFrag, depthTest: false, depthWrite: false,
    });
    this.postScene = new THREE.Scene(); this.postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.post));
    this._clear = new THREE.Color(1, 0, 0);
    this.shake = 0; this.shakeT = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }
  // fit the whole 26x26 board with slim margins, whatever the window shape. In landscape the
  // view is nudged right so the board centres in the space left of the score panel.
  frame(boardHalf = 13) {
    const s = boardHalf * 1.13;
    const a = this.camera.aspect;
    const halfH = Math.max(s, s / a), halfW = halfH * a;
    const shift = a > 0.9 ? halfH * 0.14 : 0;   // room for the tally panel on the right
    this.camera.left = -halfW + shift; this.camera.right = halfW + shift; this.camera.top = halfH; this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();
    const az = this.tilt;
    const d = this.camDist;
    this.camera.position.set(this.camTarget.x, this.camTarget.y + d * Math.cos(az), this.camTarget.z + d * Math.sin(az));
    this.camera.lookAt(this.camTarget);
    this.post.uniforms.uHalf.value.set(halfW, halfH);
  }
  shakeKick(v) { this.shake = Math.min(0.55, this.shake + v); }
  // 视觉风格：'notebook'（默认，墨水纸面）或 'solid'（纯色平滑表面）。只影响本地画面。
  setAppearance(mode) { this.post.uniforms.uSolid.value = mode === 'solid' ? 1 : 0; }
  resize() {
    const w = Math.max(2, window.innerWidth), h = Math.max(2, window.innerHeight);
    this.renderer.setPixelRatio(this.pixelRatio); this.renderer.setSize(w, h, false);
    const rw = Math.floor(w * this.pixelRatio), rh = Math.floor(h * this.pixelRatio);
    this.rt.setSize(rw, rh);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.frame();
    const u = this.post.uniforms; u.uRes.value.set(rw, rh); u.uAspect.value = w / h; u.uLineSpacing.value = rh / 13.5;
  }
  render(time, fx = {}) {
    shared.uTime.value = time;
    // camera shake: small world-space offset that decays
    if (this.shake > 0.001) {
      this.shakeT += time * 47.0;
      this.camera.position.x += Math.sin(this.shakeT * 1.7) * this.shake;
      this.camera.position.z += Math.cos(this.shakeT * 2.3) * this.shake;
      this.shake *= Math.exp(-6.0 * Math.min(0.05, 1 / 60));
    }
    this.camera.updateMatrixWorld(); this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert();
    shared.uLightDir.value.copy(LIGHT_WORLD).transformDirection(this.camera.matrixWorldInverse);
    const r = this.renderer;
    r.setRenderTarget(this.rt); r.setClearColor(this._clear, 0); r.clear(true, true, false);
    r.render(this.scene, this.camera);
    r.setRenderTarget(null);
    const u = this.post.uniforms; u.uTime.value = time; u.uNear.value = this.camera.near; u.uFar.value = this.camera.far;
    u.uInvView.value.copy(this.camera.matrixWorld);
    u.uHurt.value = fx.hurt || 0; u.uFlash.value = fx.flash || 0;
    r.render(this.postScene, this.postCam);
  }
}
