/**
 * Draws a textured globe with WebGL in a single full-screen pass.
 *
 * For every pixel, the fragment shader inverts an orthographic projection to
 * find the longitude and latitude underneath, then samples an equirectangular
 * world texture (painted on a 2D canvas). Because it is exactly the same
 * projection as d3.geoOrthographic, anything drawn on the 2D overlay with d3
 * (labels, units, highlights) lines up with the globe pixel for pixel.
 */

const VERT = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform sampler2D u_tex;
uniform vec2 u_origin;   // globe centre on screen, device pixels, y up
uniform float u_radius;  // globe radius, device pixels
uniform vec2 u_center;   // longitude, latitude at the centre of the view (radians)
const float PI = 3.141592653589793;

void main() {
  vec2 p = (gl_FragCoord.xy - u_origin) / u_radius;
  float r = length(p);
  float aa = 1.5 / u_radius;
  vec3 glowColor = vec3(0.32, 0.55, 0.95);
  float glow = smoothstep(1.0 + 0.08 + 12.0 / u_radius, 1.0, r) * 0.45;

  if (r > 1.0) {
    // Atmosphere halo just outside the globe (premultiplied alpha).
    gl_FragColor = vec4(glowColor * glow, glow);
    return;
  }

  float z = sqrt(max(0.0, 1.0 - r * r));
  float sp = sin(u_center.y);
  float cp = cos(u_center.y);
  float lat = asin(clamp(z * sp + p.y * cp, -1.0, 1.0));
  float lon = u_center.x + atan(p.x, z * cp - p.y * sp);
  vec2 uv = vec2(lon / (2.0 * PI) + 0.5, 0.5 - lat / PI);
  vec3 col = texture2D(u_tex, uv).rgb;

  // Soft light from the upper left, plus a rim of atmosphere near the edge.
  vec3 n = vec3(p, z);
  float light = 0.6 + 0.4 * max(dot(n, normalize(vec3(-0.35, 0.45, 0.82))), 0.0);
  col *= light;
  col = mix(col, glowColor, pow(1.0 - z, 3.0) * 0.35);

  float inside = smoothstep(1.0, 1.0 - aa, r);
  vec3 outside = glowColor * glow;
  gl_FragColor = vec4(mix(outside, col, inside), mix(glow, 1.0, inside));
}
`;

export interface GlobeCamera {
  /** Centre of the view, in degrees. */
  lon: number;
  lat: number;
  /** Globe radius in CSS pixels. */
  radius: number;
  /** Globe centre on screen, CSS pixels. */
  x: number;
  y: number;
}

export class GlobeRenderer {
  private gl: WebGLRenderingContext;
  private program: WebGLProgram;
  private texture: WebGLTexture;
  private loc: Record<string, WebGLUniformLocation | null>;
  readonly maxTextureSize: number;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false });
    if (!gl) throw new Error("WebGL is not available in this browser, so the 3D globe can't be shown.");
    this.gl = gl;
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    this.program = link(gl, VERT, FRAG);
    gl.useProgram(this.program);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(this.program, "a_pos");
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);

    this.texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    this.loc = Object.fromEntries(["u_tex", "u_origin", "u_radius", "u_center"].map((n) => [n, gl.getUniformLocation(this.program, n)]));
    gl.uniform1i(this.loc.u_tex!, 0);
  }

  /** Upload the world texture (an equirectangular canvas whose sides are powers of two). */
  setTexture(source: HTMLCanvasElement) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  draw(cam: GlobeCamera, dpr: number) {
    const gl = this.gl;
    const { width, height } = this.canvas;
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(this.loc.u_origin!, cam.x * dpr, height - cam.y * dpr);
    gl.uniform1f(this.loc.u_radius!, cam.radius * dpr);
    gl.uniform2f(this.loc.u_center!, (cam.lon * Math.PI) / 180, (cam.lat * Math.PI) / 180);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  dispose() {
    const gl = this.gl;
    gl.deleteTexture(this.texture);
    gl.deleteProgram(this.program);
    // Don't force-lose the context: the same canvas may be reused (React re-mounts in development).
  }
}

function link(gl: WebGLRenderingContext, vs: string, fs: string): WebGLProgram {
  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`Shader error: ${gl.getShaderInfoLog(s) ?? ""}`);
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Shader link error: ${gl.getProgramInfoLog(p) ?? ""}`);
  return p;
}
