/**
 * Couche WebGL de la carte : champ coloré (vagues, vent…) et particules animées.
 *
 * Elle s'insère juste au-dessus du remplissage de l'océan. Le canal alpha du
 * tampon vaut alors 1 sur la mer et 0 sur la terre (rien n'y a été dessiné) :
 * on s'en sert comme masque pour arrêter le champ exactement au trait de côte
 * d'OpenStreetMap, quel que soit le zoom. Le fond de la page tient lieu de terre.
 *
 * Tout appel GL se fait dans prerender/render, jamais ailleurs : MapLibre
 * remet son cache d'état à zéro après ces deux méthodes uniquement.
 */
import { MercatorCoordinate, type CustomLayerInterface, type Map as MlMap } from 'maplibre-gl';
import type { ParticleStyle } from '../data/catalog';
import { sampleScalar, sampleVector, type Frame, type Raster } from '../data/fields';
import { LUT_SIZE, type Palette } from '../data/palettes';

const FULLSCREEN_VS = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FIELD_FS = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D u_texA;
uniform sampler2D u_texB;
uniform sampler2D u_lut;
uniform vec4 u_gridA;   // lonMin, latMin, 1/dx, 1/dy
uniform vec3 u_dimA;    // nx, ny, période (0 = pas de bouclage)
uniform vec4 u_gridB;
uniform vec3 u_dimB;
uniform float u_mix;
uniform float u_hasB;
uniform vec2 u_origin;     // coordonnées Mercator du coin haut-gauche
uniform float u_invWorld;  // 1 / taille du monde en pixels du tampon
uniform float u_height;
uniform vec2 u_range;      // min, 1 / (max - min)
uniform float u_opacity;
out vec4 fragColor;

const float PI = 3.141592653589793;
const float VALID = -9000.0;

// Poids de Catmull-Rom pour les quatre voisins d'une position fractionnaire t.
vec4 cubic(float t) {
  float t2 = t * t;
  float t3 = t2 * t;
  return vec4(-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1.0, -1.5 * t3 + 2.0 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2);
}

// Interpolation lisse : bicubique là où les 16 voisins portent une donnée,
// sinon bilinéaire en ignorant les cellules vides (près des côtes).
// Renvoie (valeur, poids des cellules valides).
vec2 sampleGrid(sampler2D tex, vec4 g, vec3 dim, vec2 ll) {
  float fx = (ll.x - g.x) * g.z;
  float fy = (ll.y - g.y) * g.w;
  if (dim.z > 0.0) fx = mod(fx, dim.z);
  else if (fx < -0.5 || fx > dim.x - 0.5) return vec2(0.0);
  if (fy < -0.5 || fy > dim.y - 0.5) return vec2(0.0);
  float x0 = floor(fx);
  float y0 = floor(fy);
  float tx = fx - x0;
  float ty = fy - y0;
  int nx = int(dim.x);
  int ny = int(dim.y);
  int per = int(dim.z);

  float v[16];
  float allValid = 1.0;
  for (int j = 0; j < 4; j++) {
    int iy = clamp(int(y0) - 1 + j, 0, ny - 1);
    for (int i = 0; i < 4; i++) {
      int ix = int(x0) - 1 + i;
      if (per > 0) {
        ix = (ix + per) % per;
        if (ix >= nx) ix = i < 2 ? nx - 1 : 0;
      } else {
        ix = clamp(ix, 0, nx - 1);
      }
      float s = texelFetch(tex, ivec2(ix, iy), 0).r;
      v[j * 4 + i] = s;
      allValid *= step(VALID, s);
    }
  }
  if (allValid > 0.5) {
    vec4 wx = cubic(tx);
    vec4 wy = cubic(ty);
    float sum = 0.0;
    for (int j = 0; j < 4; j++) {
      sum += wy[j] * (v[j * 4] * wx.x + v[j * 4 + 1] * wx.y + v[j * 4 + 2] * wx.z + v[j * 4 + 3] * wx.w);
    }
    return vec2(sum, 1.0);
  }

  float v00 = v[5];
  float v10 = v[6];
  float v01 = v[9];
  float v11 = v[10];
  float w00 = (1.0 - tx) * (1.0 - ty) * step(VALID, v00);
  float w10 = tx * (1.0 - ty) * step(VALID, v10);
  float w01 = (1.0 - tx) * ty * step(VALID, v01);
  float w11 = tx * ty * step(VALID, v11);
  float w = w00 + w10 + w01 + w11;
  if (w < 0.001) return vec2(0.0);
  return vec2((v00 * w00 + v10 * w10 + v01 * w01 + v11 * w11) / w, w);
}

void main() {
  vec2 px = vec2(gl_FragCoord.x, u_height - gl_FragCoord.y);
  vec2 merc = u_origin + px * u_invWorld;
  if (merc.y <= 0.0 || merc.y >= 1.0) discard;
  vec2 ll = vec2(fract(merc.x) * 360.0 - 180.0, degrees(atan(sinh(PI * (1.0 - 2.0 * merc.y)))));

  vec2 a = sampleGrid(u_texA, u_gridA, u_dimA, ll);
  float v = a.x;
  float w = a.y;
  if (u_hasB > 0.5) {
    vec2 b = sampleGrid(u_texB, u_gridB, u_dimB, ll);
    if (a.y > 0.0 && b.y > 0.0) {
      v = mix(a.x, b.x, u_mix);
      w = mix(a.y, b.y, u_mix);
    } else if (b.y > 0.0) {
      v = b.x;
      w = b.y * u_mix;
    } else {
      w = a.y * (1.0 - u_mix);
    }
  }
  if (w <= 0.0) discard;

  float t = clamp((v - u_range.x) * u_range.y, 0.0, 1.0);
  vec4 c = texture(u_lut, vec2(t, 0.5));
  float alpha = c.a * u_opacity * smoothstep(0.0, 0.6, w);
  fragColor = vec4(c.rgb * alpha, alpha);
}`;

const BLIT_FS = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform vec2 u_size;
uniform float u_gain;
uniform float u_quantize;
out vec4 fragColor;
void main() {
  vec4 c = texture(u_tex, gl_FragCoord.xy / u_size) * u_gain;
  // Arrondi vers le bas : sans lui, les traînées ne s'éteignent jamais tout à fait.
  if (u_quantize > 0.5) c = floor(c * 255.0) / 255.0;
  fragColor = c;
}`;

const LINE_VS = `#version 300 es
in vec3 a_pos; // x, y en espace écran normalisé ; z = opacité
out float v_alpha;
void main() {
  v_alpha = a_pos.z;
  gl_Position = vec4(a_pos.xy, 0.0, 1.0);
}`;

const LINE_FS = `#version 300 es
precision mediump float;
in float v_alpha;
out vec4 fragColor;
void main() {
  fragColor = vec4(v_alpha);
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`Shader : ${gl.getShaderInfoLog(shader)}`);
  }
  return shader;
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string, attribs: string[] = []): WebGLProgram {
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fs));
  attribs.forEach((name, i) => gl.bindAttribLocation(program, i, name));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Programme : ${gl.getProgramInfoLog(program)}`);
  }
  return program;
}

function uniforms<T extends string>(gl: WebGL2RenderingContext, program: WebGLProgram, names: readonly T[]) {
  const out = {} as Record<T, WebGLUniformLocation | null>;
  for (const n of names) out[n] = gl.getUniformLocation(program, n);
  return out;
}

export interface FieldStyle {
  opacityWater: number;
  opacityLand: number;
  particles: ParticleStyle | null;
}

export interface PointSample {
  value: number;
  /** Direction de provenance en degrés (0 = nord), si la couche a un vecteur. */
  direction: number | null;
}

const MAX_PARTICLES = 9000;
const FLOATS_PER_PARTICLE = 18; // 6 sommets × (x, y, alpha)
const RAD = Math.PI / 180;

export class FieldLayer implements CustomLayerInterface {
  readonly id = 'field';
  readonly type = 'custom' as const;
  readonly renderingMode = '2d' as const;

  private map: MlMap | null = null;
  private hasAlpha = true;

  private fieldProgram!: WebGLProgram;
  private fieldU!: Record<string, WebGLUniformLocation | null>;
  private blitProgram!: WebGLProgram;
  private blitU!: Record<string, WebGLUniformLocation | null>;
  private lineProgram!: WebGLProgram;
  private emptyVao!: WebGLVertexArrayObject;
  private lineVao!: WebGLVertexArrayObject;
  private lineBuffer!: WebGLBuffer;

  private lutTexture: WebGLTexture | null = null;
  private palette: Palette | null = null;
  private paletteDirty = false;
  private textures = new Map<string, { texture: WebGLTexture; used: number }>();
  private clock = 0;

  private frameA: Frame | null = null;
  private frameB: Frame | null = null;
  private mix = 0;
  private style: FieldStyle = { opacityWater: 1, opacityLand: 0, particles: null };
  private animate = true;

  // Particules : positions en coordonnées Mercator (0–1), indépendantes du zoom.
  private px = new Float64Array(MAX_PARTICLES);
  private py = new Float64Array(MAX_PARTICLES);
  private age = new Float32Array(MAX_PARTICLES);
  private life = new Float32Array(MAX_PARTICLES);
  private count = 0;
  private vertices = new Float32Array(MAX_PARTICLES * FLOATS_PER_PARTICLE);
  private vertexCount = 0;
  private trail: { textures: WebGLTexture[]; fbos: WebGLFramebuffer[]; w: number; h: number; current: number } | null =
    null;
  private trailHasContent = false;
  private lastView = { x: NaN, y: NaN, world: NaN };
  private lastTick = 0;
  private vecA = new Float32Array(2);
  private vecB = new Float32Array(2);

  onAdd(map: MlMap, gl: WebGL2RenderingContext): void {
    // La couche peut être remise après une perte du contexte WebGL : rien de
    // ce qui venait de l'ancien contexte n'est réutilisable.
    this.textures.clear();
    this.lutTexture = null;
    this.trail = null;
    this.trailHasContent = false;
    this.lastView.world = NaN;
    this.map = map;
    this.hasAlpha = gl.getContextAttributes()?.alpha !== false;
    this.fieldProgram = link(gl, FULLSCREEN_VS, FIELD_FS);
    this.fieldU = uniforms(gl, this.fieldProgram, [
      'u_texA',
      'u_texB',
      'u_lut',
      'u_gridA',
      'u_dimA',
      'u_gridB',
      'u_dimB',
      'u_mix',
      'u_hasB',
      'u_origin',
      'u_invWorld',
      'u_height',
      'u_range',
      'u_opacity',
    ]);
    this.blitProgram = link(gl, FULLSCREEN_VS, BLIT_FS);
    this.blitU = uniforms(gl, this.blitProgram, ['u_tex', 'u_size', 'u_gain', 'u_quantize']);
    this.lineProgram = link(gl, LINE_VS, LINE_FS, ['a_pos']);
    this.emptyVao = gl.createVertexArray()!;
    this.lineVao = gl.createVertexArray()!;
    this.lineBuffer = gl.createBuffer()!;
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.vertices.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    this.paletteDirty = this.palette !== null;
  }

  onRemove(_map: MlMap, gl: WebGL2RenderingContext): void {
    for (const { texture } of this.textures.values()) gl.deleteTexture(texture);
    this.textures.clear();
    if (this.lutTexture) gl.deleteTexture(this.lutTexture);
    this.lutTexture = null;
    this.destroyTrail(gl);
    gl.deleteProgram(this.fieldProgram);
    gl.deleteProgram(this.blitProgram);
    gl.deleteProgram(this.lineProgram);
    gl.deleteVertexArray(this.emptyVao);
    gl.deleteVertexArray(this.lineVao);
    gl.deleteBuffer(this.lineBuffer);
    this.map = null;
  }

  /* ------------------------------------------------------------ API publique */

  setPalette(palette: Palette): void {
    this.palette = palette;
    this.paletteDirty = true;
    this.map?.triggerRepaint();
  }

  setStyle(style: FieldStyle): void {
    this.style = style;
    this.trailHasContent = false;
    this.lastView.world = NaN;
    this.map?.triggerRepaint();
  }

  setAnimate(animate: boolean): void {
    this.animate = animate;
    this.map?.triggerRepaint();
  }

  setFrames(a: Frame | null, b: Frame | null, mix: number): void {
    this.frameA = a;
    this.frameB = b && a && b.key !== a.key ? b : null;
    this.mix = this.frameB ? Math.min(1, Math.max(0, mix)) : 0;
    this.map?.triggerRepaint();
  }

  get hasData(): boolean {
    return this.frameA !== null;
  }

  /** Valeur (et direction) affichée en un point, interpolée comme à l'écran. */
  sample(lon: number, lat: number): PointSample | null {
    const a = this.frameA;
    if (!a) return null;
    let value = sampleScalar(a.scalar, lon, lat);
    const b = this.frameB;
    if (b && this.mix > 0) {
      const vb = sampleScalar(b.scalar, lon, lat);
      if (Number.isFinite(value) && Number.isFinite(vb)) value = value + (vb - value) * this.mix;
      else if (Number.isFinite(vb)) value = vb;
    }
    if (!Number.isFinite(value)) return null;
    let direction: number | null = null;
    if (this.sampleMotion(lon, lat)) {
      const [u, v] = this.vecA;
      if (Math.hypot(u, v) > 1e-6) direction = ((Math.atan2(-u, -v) / RAD) % 360 + 360) % 360;
    }
    return { value, direction };
  }

  /* ------------------------------------------------------------------ rendu */

  prerender(gl: WebGL2RenderingContext): void {
    const map = this.map;
    if (!map) return;
    this.uploadPalette(gl);
    if (this.frameA) this.textureFor(gl, this.frameA);
    if (this.frameB) this.textureFor(gl, this.frameB);

    const active = this.particlesActive();
    if (!active) {
      if (this.trail && this.trailHasContent) this.clearTrail(gl);
      this.lastTick = 0;
    } else {
      this.stepParticles(gl);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  }

  render(gl: WebGL2RenderingContext): void {
    const map = this.map;
    const a = this.frameA;
    if (!map || !a || !this.lutTexture || !this.palette) return;
    const texA = this.textures.get(a.key);
    if (!texA) return;
    const b = this.frameB;
    const texB = b ? this.textures.get(b.key) : undefined;

    const { originX, originY, world, ratio } = this.viewState();
    const u = this.fieldU;
    gl.useProgram(this.fieldProgram);
    gl.bindVertexArray(this.emptyVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texA.texture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, (texB ?? texA).texture);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.lutTexture);
    gl.uniform1i(u.u_texA, 0);
    gl.uniform1i(u.u_texB, 1);
    gl.uniform1i(u.u_lut, 2);
    this.setGridUniforms(gl, u.u_gridA, u.u_dimA, a.scalar);
    this.setGridUniforms(gl, u.u_gridB, u.u_dimB, (texB && b ? b : a).scalar);
    gl.uniform1f(u.u_mix, this.mix);
    gl.uniform1f(u.u_hasB, texB ? 1 : 0);
    gl.uniform2f(u.u_origin, originX, originY);
    gl.uniform1f(u.u_invWorld, 1 / (world * ratio));
    gl.uniform1f(u.u_height, gl.drawingBufferHeight);
    gl.uniform2f(u.u_range, this.palette.min, 1 / (this.palette.max - this.palette.min));

    gl.enable(gl.BLEND);
    const { opacityWater, opacityLand } = this.style;
    if (!this.hasAlpha) {
      // Tampon sans alpha : pas de masque possible, on dessine partout.
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform1f(u.u_opacity, opacityWater);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    } else {
      if (opacityWater > 0) {
        // Sur la mer : pondéré par l'alpha déjà présent, qui reste inchangé.
        gl.blendFuncSeparate(gl.DST_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
        gl.uniform1f(u.u_opacity, opacityWater);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      if (opacityLand > 0) {
        // Sur la terre : là où rien n'est encore dessiné.
        gl.blendFuncSeparate(gl.ONE_MINUS_DST_ALPHA, gl.ONE, gl.ONE_MINUS_DST_ALPHA, gl.ONE);
        gl.uniform1f(u.u_opacity, opacityLand);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    }

    if (this.trail && this.trailHasContent && this.particlesActive()) {
      const bu = this.blitU;
      gl.useProgram(this.blitProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.trail.textures[this.trail.current]);
      gl.uniform1i(bu.u_tex, 0);
      gl.uniform2f(bu.u_size, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.uniform1f(bu.u_gain, 0.9);
      gl.uniform1f(bu.u_quantize, 0);
      if (this.hasAlpha && opacityLand === 0) {
        gl.blendFuncSeparate(gl.DST_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
      } else {
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
    if (this.particlesActive()) map.triggerRepaint();
  }

  /* ---------------------------------------------------------------- textures */

  private uploadPalette(gl: WebGL2RenderingContext): void {
    if (!this.paletteDirty || !this.palette) return;
    this.paletteDirty = false;
    if (!this.lutTexture) this.lutTexture = gl.createTexture()!;
    this.resetUnpack(gl);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.lutTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, LUT_SIZE, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.palette.lut);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  private resetUnpack(gl: WebGL2RenderingContext): void {
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
  }

  private textureFor(gl: WebGL2RenderingContext, frame: Frame): void {
    const hit = this.textures.get(frame.key);
    if (hit) {
      hit.used = ++this.clock;
      return;
    }
    const texture = gl.createTexture()!;
    this.resetUnpack(gl);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    const f = frame.scalar;
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, f.nx, f.ny, 0, gl.RED, gl.FLOAT, f.data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.textures.set(frame.key, { texture, used: ++this.clock });
    // On garde quelques textures : pendant la lecture, l'échéance B devient la A suivante.
    while (this.textures.size > 4) {
      let oldest = '';
      let min = Infinity;
      for (const [key, t] of this.textures) {
        if (t.used < min && key !== this.frameA?.key && key !== this.frameB?.key) {
          min = t.used;
          oldest = key;
        }
      }
      if (!oldest) break;
      gl.deleteTexture(this.textures.get(oldest)!.texture);
      this.textures.delete(oldest);
    }
  }

  private setGridUniforms(
    gl: WebGL2RenderingContext,
    grid: WebGLUniformLocation | null,
    dim: WebGLUniformLocation | null,
    r: Raster,
  ): void {
    gl.uniform4f(grid, r.lonMin, r.latMin, 1 / r.dx, 1 / r.dy);
    gl.uniform3f(dim, r.nx, r.ny, r.period);
  }

  /* --------------------------------------------------------------- particules */

  private particlesActive(): boolean {
    return this.animate && !!this.style.particles && !!this.frameA?.vector && !document.hidden;
  }

  private viewState() {
    const map = this.map!;
    const canvas = map.getCanvas();
    const width = canvas.clientWidth || 1;
    const height = canvas.clientHeight || 1;
    const topLeft = MercatorCoordinate.fromLngLat(map.unproject([0, 0]));
    const world = 512 * 2 ** map.getZoom();
    return { originX: topLeft.x, originY: topLeft.y, world, width, height, ratio: canvas.width / width };
  }

  /** (u, v) au point donné dans vecA, mélange des deux échéances. */
  private sampleMotion(lon: number, lat: number): boolean {
    const a = this.frameA?.vector;
    if (!a) return false;
    const okA = sampleVector(a, lon, lat, this.vecA);
    const b = this.frameB?.vector;
    if (b && this.mix > 0) {
      const okB = sampleVector(b, lon, lat, this.vecB);
      if (okA && okB) {
        this.vecA[0] += (this.vecB[0] - this.vecA[0]) * this.mix;
        this.vecA[1] += (this.vecB[1] - this.vecA[1]) * this.mix;
        return true;
      }
      if (okB) {
        this.vecA[0] = this.vecB[0];
        this.vecA[1] = this.vecB[1];
        return true;
      }
    }
    return okA;
  }

  private ensureTrail(gl: WebGL2RenderingContext): void {
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    if (this.trail && this.trail.w === w && this.trail.h === h) return;
    this.destroyTrail(gl);
    const textures: WebGLTexture[] = [];
    const fbos: WebGLFramebuffer[] = [];
    for (let i = 0; i < 2; i++) {
      const texture = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      textures.push(texture);
      fbos.push(fbo);
    }
    this.trail = { textures, fbos, w, h, current: 0 };
    this.trailHasContent = false;
  }

  private destroyTrail(gl: WebGL2RenderingContext): void {
    if (!this.trail) return;
    this.trail.textures.forEach((t) => gl.deleteTexture(t));
    this.trail.fbos.forEach((f) => gl.deleteFramebuffer(f));
    this.trail = null;
  }

  private clearTrail(gl: WebGL2RenderingContext): void {
    if (!this.trail) return;
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.clearColor(0, 0, 0, 0);
    for (const fbo of this.trail.fbos) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    this.trailHasContent = false;
  }

  private stepParticles(gl: WebGL2RenderingContext): void {
    const style = this.style.particles!;
    const view = this.viewState();
    this.ensureTrail(gl);
    const trail = this.trail!;

    const now = performance.now();
    const dt = this.lastTick ? Math.min(3, (now - this.lastTick) / 16.667) : 1;
    this.lastTick = now;

    // La carte a bougé : les traînées ne correspondent plus au fond, on repart de zéro.
    const moved =
      Math.abs(view.originX - this.lastView.x) * view.world > 0.01 ||
      Math.abs(view.originY - this.lastView.y) * view.world > 0.01 ||
      view.world !== this.lastView.world;
    const zoomJump = !(Math.max(view.world, this.lastView.world) / Math.min(view.world, this.lastView.world) < 1.25);
    this.lastView = { x: view.originX, y: view.originY, world: view.world };

    const target = Math.min(MAX_PARTICLES, Math.max(1200, Math.round((view.width * view.height) / 240)));
    if (zoomJump) this.count = 0;
    const spanX = view.width / view.world;
    const spanY = view.height / view.world;
    const spawn = (i: number, stagger: boolean) => {
      this.px[i] = view.originX + Math.random() * spanX;
      this.py[i] = view.originY + Math.random() * spanY;
      this.life[i] = 70 + Math.random() * 110;
      this.age[i] = stagger ? Math.random() * this.life[i] : 0;
    };
    for (let i = this.count; i < target; i++) spawn(i, true);
    this.count = target;

    const scalarA = this.frameA!.scalar;
    const [lo, hi] = style.alphaRange;
    const half = 0.8; // demi-épaisseur du trait, en pixels CSS
    const sxToClip = 2 / view.width;
    const syToClip = 2 / view.height;
    const verts = this.vertices;
    let n = 0;
    for (let i = 0; i < this.count; i++) {
      if (this.age[i] >= this.life[i]) {
        spawn(i, false);
        continue;
      }
      const x = this.px[i];
      const y = this.py[i];
      const sx = (x - view.originX) * view.world;
      const sy = (y - view.originY) * view.world;
      if (sx < -4 || sy < -4 || sx > view.width + 4 || sy > view.height + 4 || y <= 0 || y >= 1) {
        spawn(i, false);
        continue;
      }
      const lon = (x - Math.floor(x)) * 360 - 180;
      const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) / RAD;
      if (!this.sampleMotion(lon, lat)) {
        spawn(i, false);
        continue;
      }
      const u = this.vecA[0];
      const v = this.vecA[1];
      const strength = style.alphaFrom === 'vector' ? Math.hypot(u, v) : sampleScalar(scalarA, lon, lat);
      const dx = u * style.speed * dt;
      const dy = -v * style.speed * dt;
      this.px[i] = x + dx / view.world;
      this.py[i] = y + dy / view.world;
      this.age[i] += dt;

      let len = Math.hypot(dx, dy);
      if (!(len > 1e-4)) continue;
      // Fondu d'entrée et de sortie sur la durée de vie.
      const k = this.age[i] / this.life[i];
      const envelope = Math.min(1, k * 6, (1 - k) * 4);
      const s = Number.isFinite(strength) ? Math.min(1, Math.max(0, (strength - lo) / (hi - lo))) : 0;
      const alpha = (0.14 + 0.72 * s) * envelope;
      if (alpha < 0.02) continue;
      let ex = dx;
      let ey = dy;
      if (len < 0.7) {
        ex *= 0.7 / len;
        ey *= 0.7 / len;
        len = 0.7;
      }
      const ox = (-ey / len) * half;
      const oy = (ex / len) * half;
      const x0 = sx * sxToClip - 1;
      const y0 = 1 - sy * syToClip;
      const x1 = (sx + ex) * sxToClip - 1;
      const y1 = 1 - (sy + ey) * syToClip;
      const cx = ox * sxToClip;
      const cy = -oy * syToClip;
      verts[n++] = x0 - cx;
      verts[n++] = y0 - cy;
      verts[n++] = alpha;
      verts[n++] = x0 + cx;
      verts[n++] = y0 + cy;
      verts[n++] = alpha;
      verts[n++] = x1 + cx;
      verts[n++] = y1 + cy;
      verts[n++] = alpha;
      verts[n++] = x0 - cx;
      verts[n++] = y0 - cy;
      verts[n++] = alpha;
      verts[n++] = x1 + cx;
      verts[n++] = y1 + cy;
      verts[n++] = alpha;
      verts[n++] = x1 - cx;
      verts[n++] = y1 - cy;
      verts[n++] = alpha;
    }
    this.vertexCount = n / 3;

    // Nouvelle image des traînées : l'ancienne atténuée, puis les segments du jour.
    const next = 1 - trail.current;
    gl.bindFramebuffer(gl.FRAMEBUFFER, trail.fbos[next]);
    gl.viewport(0, 0, trail.w, trail.h);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.CULL_FACE);
    gl.colorMask(true, true, true, true);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!moved && this.trailHasContent) {
      gl.disable(gl.BLEND);
      gl.useProgram(this.blitProgram);
      gl.bindVertexArray(this.emptyVao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, trail.textures[trail.current]);
      gl.uniform1i(this.blitU.u_tex, 0);
      gl.uniform2f(this.blitU.u_size, trail.w, trail.h);
      gl.uniform1f(this.blitU.u_gain, style.fade ** dt);
      gl.uniform1f(this.blitU.u_quantize, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    if (this.vertexCount > 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(this.lineProgram);
      gl.bindVertexArray(this.lineVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, verts, 0, n);
      gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }
    gl.bindVertexArray(null);
    trail.current = next;
    this.trailHasContent = true;
  }
}
