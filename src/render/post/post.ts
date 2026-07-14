// Raw WebGL2 post pass. Takes the p5 2D canvas as a texture, applies the
// effect chain (rgb split, feedback, displacement, scanlines, grain, bloomish,
// strobe invert), ping-pongs a feedback buffer, and presents to the visible
// canvas.

import fragSrc from './post.frag?raw';

const vertSrc = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

export interface PostUniforms {
  rgbSplit: number;
  feedbackDecay: number;
  displacement: number;
  scanlines: number;
  noise: number;
  bloomish: number;
  invert: number;
  brightness: number;
}

export class PostPass {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private sceneTex: WebGLTexture;
  private fbTex: [WebGLTexture, WebGLTexture];
  private fbo: [WebGLFramebuffer, WebGLFramebuffer];
  private pingpong = 0;
  private uniforms = new Map<string, WebGLUniformLocation>();
  private width: number;
  private height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    const gl = this.canvas.getContext('webgl2', { antialias: false });
    if (!gl) throw new Error('WebGL2 not available');
    this.gl = gl;
    // Flip canvas uploads so the scene texture shares the FBO orientation
    // (row 0 = bottom) and one UV convention works for both.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

    this.program = this.buildProgram(vertSrc, fragSrc);
    gl.useProgram(this.program);
    for (const name of [
      'u_scene', 'u_prev', 'u_resolution', 'u_time', 'u_rgbSplit', 'u_feedbackDecay',
      'u_displacement', 'u_scanlines', 'u_noise', 'u_bloomish', 'u_invert', 'u_brightness',
    ]) {
      const loc = gl.getUniformLocation(this.program, name);
      if (loc) this.uniforms.set(name, loc);
    }

    // Fullscreen triangle-strip quad.
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const posLoc = gl.getAttribLocation(this.program, 'a_pos');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    this.sceneTex = this.makeTexture();
    this.fbTex = [this.makeTexture(), this.makeTexture()];
    this.fbo = [gl.createFramebuffer()!, gl.createFramebuffer()!];
    for (let i = 0; i < 2; i++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[i]);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fbTex[i], 0);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private makeTexture(): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.width, this.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private buildProgram(vs: string, fs: string): WebGLProgram {
    const gl = this.gl;
    const compile = (type: number, src: string): WebGLShader => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(`Shader compile failed: ${gl.getShaderInfoLog(shader)}`);
      }
      return shader;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Program link failed: ${gl.getProgramInfoLog(program)}`);
    }
    return program;
  }

  render(sourceCanvas: HTMLCanvasElement, time: number, u: PostUniforms): void {
    const gl = this.gl;
    gl.useProgram(this.program);

    // Upload this frame's 2D layer.
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);
    gl.uniform1i(this.uniforms.get('u_scene') ?? null, 0);

    const prev = this.fbTex[this.pingpong];
    const target = this.fbo[1 - this.pingpong];
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, prev);
    gl.uniform1i(this.uniforms.get('u_prev') ?? null, 1);

    gl.uniform2f(this.uniforms.get('u_resolution') ?? null, this.width, this.height);
    gl.uniform1f(this.uniforms.get('u_time') ?? null, time);
    gl.uniform1f(this.uniforms.get('u_rgbSplit') ?? null, u.rgbSplit);
    gl.uniform1f(this.uniforms.get('u_feedbackDecay') ?? null, u.feedbackDecay);
    gl.uniform1f(this.uniforms.get('u_displacement') ?? null, u.displacement);
    gl.uniform1f(this.uniforms.get('u_scanlines') ?? null, u.scanlines);
    gl.uniform1f(this.uniforms.get('u_noise') ?? null, u.noise);
    gl.uniform1f(this.uniforms.get('u_bloomish') ?? null, u.bloomish);
    // Invert/brightness are presentation-only — they must not accumulate into
    // the feedback buffer or trails would strobe/darken permanently.
    gl.uniform1f(this.uniforms.get('u_invert') ?? null, 0);
    gl.uniform1f(this.uniforms.get('u_brightness') ?? null, 1);

    // Pass 1: render into the feedback target.
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.viewport(0, 0, this.width, this.height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Pass 2: blit the result to the visible canvas (re-run, feedback off,
    // reading what we just wrote would need another texture bind — cheaper to
    // just draw the same frame to screen with prev = the fresh target).
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.fbTex[1 - this.pingpong]);
    // Present the accumulated buffer directly: scene contribution already in it.
    gl.uniform1i(this.uniforms.get('u_scene') ?? null, 1); // show accumulated
    gl.uniform1f(this.uniforms.get('u_rgbSplit') ?? null, 0);
    gl.uniform1f(this.uniforms.get('u_feedbackDecay') ?? null, 0);
    gl.uniform1f(this.uniforms.get('u_displacement') ?? null, 0);
    gl.uniform1f(this.uniforms.get('u_scanlines') ?? null, 0);
    gl.uniform1f(this.uniforms.get('u_noise') ?? null, 0);
    gl.uniform1f(this.uniforms.get('u_bloomish') ?? null, 0);
    gl.uniform1f(this.uniforms.get('u_invert') ?? null, u.invert);
    gl.uniform1f(this.uniforms.get('u_brightness') ?? null, u.brightness);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    this.pingpong = 1 - this.pingpong;
  }
}
