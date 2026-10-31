/**
 * iDoom Studio — Dedicated WebGL 3D Doom Sector, 3D Floor, Skybox & Sprite Renderer
 * Features screen-accurate 3D mouse controls, multi-level 3D floors/bridges, and panoramic skyboxes.
 */

class DoomRenderer3D {
  constructor(canvas, onSelectObject) {
    this.canvas = canvas;
    this.onSelectObject = onSelectObject;
    this.gl = canvas.getContext('webgl', { antialias: true, alpha: false, stencil: false });

    this.mode = 'orbit'; // 'orbit' | 'walk'
    this.showWireframe = false;
    this.cutawayCeilings = true;
    this.selectedId = null;

    // Orbit camera state in WebGL coords (X = Doom X, Y = Doom Z height, Z = -Doom Y)
    this.orbitTarget = [256, 48, 0];
    this.orbitYaw = -0.65;
    this.orbitPitch = 0.62;
    this.orbitDist = 1350;

    // First-person walkthrough camera state in Doom coords (x, y, z)
    this.walkPos = { x: -128, y: 0, z: 48 };
    this.walkYaw = 0;
    this.walkPitch = 0;
    this.keys = {};

    this.textures = new Map();
    this.batches = [];
    this.translucentBatches = [];
    this.wireBatch = null;
    this.skyDomeBatch = null;
    this.pickTriangles = [];
    this.compiled = null;
    this.thingCatalogMap = new Map();
    this.startTime = performance.now();

    this._initGL();
    this._buildSkyDomeBuffer();
    this._bindEvents();
    this._startLoop();
  }

  setThingCatalog(catalogList) {
    this.thingCatalogMap.clear();
    for (const item of catalogList || []) {
      this.thingCatalogMap.set(item.type, item);
    }
  }

  _initGL() {
    const gl = this.gl;
    if (!gl) return;

    const vsSource = `
      attribute vec3 aPos;
      attribute vec2 aUV;
      attribute float aLight;
      attribute float aHighlight;
      uniform mat4 uProj;
      uniform mat4 uView;
      varying vec2 vUV;
      varying float vLight;
      varying float vHighlight;
      varying vec3 vWorldPos;
      void main() {
        vUV = aUV;
        vLight = aLight;
        vHighlight = aHighlight;
        vWorldPos = aPos;
        gl_Position = uProj * uView * vec4(aPos, 1.0);
      }
    `;

    const fsSource = `
      precision mediump float;
      varying vec2 vUV;
      varying float vLight;
      varying float vHighlight;
      varying vec3 vWorldPos;
      uniform sampler2D uTex;
      uniform int uMode; // 0 = textured, 1 = panoramic skybox, 2 = wireframe
      uniform float uAlpha;
      uniform vec3 uCameraPos;
      uniform float uTime;
      uniform float uSkyScroll;
      uniform vec3 uSkyTop;
      uniform vec3 uSkyHorizon;
      uniform int uUse3DSky;

      void main() {
        if (uMode == 2) {
          gl_FragColor = vec4(0.22, 0.74, 0.97, 0.55);
          return;
        }
        if (uMode == 1) {
          // True 360-degree Panoramic Doom Skybox Projection from camera eye to world fragment
          vec3 dir = normalize(vWorldPos - uCameraPos);
          float angle = atan(dir.z, dir.x); // -PI..PI
          float u = (angle / 6.2831853) * 4.0 + uTime * uSkyScroll * 0.05;
          float pitch = clamp(dir.y, -0.35, 0.85);

          // Sample Freedoom2 SKY texture band near horizon/mid-sky and blend into zenith gradient
          vec2 skyUV = vec2(fract(u), clamp(0.85 - pitch * 1.15, 0.02, 0.98));
          vec4 skyTex = texture2D(uTex, skyUV);

          float zenithMix = smoothstep(0.35, 0.82, dir.y);
          float nadirMix = smoothstep(0.0, -0.25, dir.y);
          vec3 col = mix(skyTex.rgb, uSkyTop, zenithMix);
          col = mix(col, uSkyHorizon * 0.65, nadirMix);

          // Optional 3D Skybox distant silhouette towers on the horizon
          if (uUse3DSky == 1 && dir.y > -0.05 && dir.y < 0.32) {
            float sector = fract(angle * 2.546479);
            float towerH = step(0.62, sector) * (0.14 + 0.10 * sin( floor(angle * 8.0) * 1.7 ));
            if (dir.y < towerH) {
              vec3 towerCol = mix(uSkyTop * 0.45, uSkyHorizon * 0.8, step(0.92, fract(dir.y * 28.0)) * 0.35);
              col = mix(col, towerCol, 0.85);
            }
          }

          if (vHighlight > 0.5) {
            col = mix(col, vec3(0.2, 0.72, 1.0), 0.22);
          }
          gl_FragColor = vec4(col, 1.0);
          return;
        }
        vec4 texColor = texture2D(uTex, fract(vUV));
        if (texColor.a < 0.15) discard;
        vec3 lit = texColor.rgb * clamp(vLight, 0.12, 1.15);
        if (vHighlight > 0.5) {
          lit = mix(lit, vec3(0.15, 0.68, 1.0), 0.28);
        }
        gl_FragColor = vec4(lit, texColor.a * uAlpha);
      }
    `;

    const compileShader = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };

    const vs = compileShader(gl.VERTEX_SHADER, vsSource);
    const fs = compileShader(gl.FRAGMENT_SHADER, fsSource);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.useProgram(prog);

    this.prog = prog;
    this.locs = {
      aPos: gl.getAttribLocation(prog, 'aPos'),
      aUV: gl.getAttribLocation(prog, 'aUV'),
      aLight: gl.getAttribLocation(prog, 'aLight'),
      aHighlight: gl.getAttribLocation(prog, 'aHighlight'),
      uProj: gl.getUniformLocation(prog, 'uProj'),
      uView: gl.getUniformLocation(prog, 'uView'),
      uTex: gl.getUniformLocation(prog, 'uTex'),
      uMode: gl.getUniformLocation(prog, 'uMode'),
      uAlpha: gl.getUniformLocation(prog, 'uAlpha'),
      uCameraPos: gl.getUniformLocation(prog, 'uCameraPos'),
      uTime: gl.getUniformLocation(prog, 'uTime'),
      uSkyScroll: gl.getUniformLocation(prog, 'uSkyScroll'),
      uSkyTop: gl.getUniformLocation(prog, 'uSkyTop'),
      uSkyHorizon: gl.getUniformLocation(prog, 'uSkyHorizon'),
      uUse3DSky: gl.getUniformLocation(prog, 'uUse3DSky')
    };

    this.fallbackTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.fallbackTex);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([
        110, 120, 135, 255,  80, 90, 105, 255,
        80, 90, 105, 255,    110, 120, 135, 255
      ])
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  }

  _buildSkyDomeBuffer() {
    const gl = this.gl;
    if (!gl) return;
    // Build a giant skybox cube surrounding the world so background is a real panoramic skybox
    const S = 7500;
    const corners = [
      [-S, -S, -S], [ S, -S, -S], [ S,  S, -S], [-S,  S, -S],
      [-S, -S,  S], [ S, -S,  S], [ S,  S,  S], [-S,  S,  S]
    ];
    const faces = [
      [0, 1, 2, 3], [5, 4, 7, 6], [4, 0, 3, 7],
      [1, 5, 6, 2], [3, 2, 6, 7], [4, 5, 1, 0]
    ];
    const data = [];
    for (const [a, b, c, d] of faces) {
      const p1 = corners[a], p2 = corners[b], p3 = corners[c], p4 = corners[d];
      data.push(
        p1[0], p1[1], p1[2], 0, 0, 1, 0,
        p2[0], p2[1], p2[2], 1, 0, 1, 0,
        p3[0], p3[1], p3[2], 1, 1, 1, 0,
        p1[0], p1[1], p1[2], 0, 0, 1, 0,
        p3[0], p3[1], p3[2], 1, 1, 1, 0,
        p4[0], p4[1], p4[2], 0, 1, 1, 0
      );
    }
    const arr = new Float32Array(data);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
    this.skyDomeBatch = { buffer: buf, count: arr.length / 7 };
  }

  _getOrLoadTexture(kind, name) {
    if (!name || name === '-') return null;
    const upper = name.toUpperCase();
    const key = `${kind}:${upper}`;
    if (this.textures.has(key)) return this.textures.get(key);

    const gl = this.gl;
    const entry = {
      key,
      glTex: this.fallbackTex,
      width: 64,
      height: 64,
      loaded: false
    };
    this.textures.set(key, entry);

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      const potW = Math.pow(2, Math.round(Math.log2(Math.max(8, img.width))));
      const potH = Math.pow(2, Math.round(Math.log2(Math.max(8, img.height))));
      const off = document.createElement('canvas');
      off.width = potW;
      off.height = potH;
      const ctx = off.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, potW, potH);

      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, off);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

      entry.glTex = tex;
      entry.width = img.width || 64;
      entry.height = img.height || 64;
      entry.loaded = true;
    };
    if (kind === 'TEX') img.src = `/api/texture/${encodeURIComponent(upper)}`;
    else if (kind === 'FLAT') img.src = `/api/flat/${encodeURIComponent(upper)}`;
    else if (kind === 'SPR') img.src = `/api/sprite/${encodeURIComponent(upper)}`;

    return entry;
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === 'walk' && this.compiled) {
      const p1 = (this.compiled.things || []).find(t => t.type === 1);
      if (p1) {
        const floorH = this._getSectorFloorAt(p1.x, p1.y, 0);
        this.walkPos = { x: p1.x, y: p1.y, z: floorH + 46 };
        this.walkYaw = ((p1.angle || 0) * Math.PI) / 180;
        this.walkPitch = 0;
      }
    }
    this._rebuildGeometry();
  }

  resetCamera() {
    if (!this.compiled || !this.compiled.vertices || this.compiled.vertices.length === 0) {
      this.orbitTarget = [0, 48, 0];
      this.orbitDist = 1100;
      return;
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const v of this.compiled.vertices) {
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    }
    const cx = (minX + maxX) * 0.5;
    const cy = (minY + maxY) * 0.5;
    const span = Math.max(512, Math.hypot(maxX - minX, maxY - minY));
    this.orbitTarget = [cx, 48, -cy];
    this.orbitDist = span * 1.1;
    this.orbitYaw = -0.6;
    this.orbitPitch = 0.6;
  }

  _getSectorFloorAt(x, y, currentEyeZ = null) {
    if (!this.compiled) return 0;
    let baseFloor = 0;
    const sectors = this.compiled.sectors || [];
    for (let i = sectors.length - 1; i >= 0; i--) {
      const sec = sectors[i];
      const poly = sec.polygon || [];
      let inside = false;
      for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
        const xi = poly[a].x, yi = poly[a].y;
        const xj = poly[b].x, yj = poly[b].y;
        if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi)) {
          inside = !inside;
        }
      }
      if (inside) {
        baseFloor = sec.floorHeight || 0;
        break;
      }
    }
    // Check if standing on top of a 3D Floor / Mezzanine / Bridge
    if (currentEyeZ !== null && this.compiled.threeDFloors) {
      const feetZ = currentEyeZ - 46;
      for (const vol of this.compiled.threeDFloors) {
        if (vol.floorType !== 1) continue; // Only solid 3D floors support walking on top
        const poly = vol.polygon || [];
        let inside = false;
        for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
          const xi = poly[a].x, yi = poly[a].y;
          const xj = poly[b].x, yj = poly[b].y;
          if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi)) {
            inside = !inside;
          }
        }
        if (inside && feetZ >= vol.topZ - 28) {
          baseFloor = Math.max(baseFloor, vol.topZ);
        }
      }
    }
    return baseFloor;
  }

  updateScene(compiled, selectedId = null) {
    const firstLoad = !this.compiled;
    this.compiled = compiled;
    this.selectedId = selectedId;
    if (compiled?.skybox?.texture) {
      this._getOrLoadTexture('TEX', compiled.skybox.texture);
    }
    this._rebuildGeometry();
    if (firstLoad) this.resetCamera();
  }

  setSelectedId(selectedId) {
    if (this.selectedId !== selectedId) {
      this.selectedId = selectedId;
      this._rebuildGeometry();
    }
  }

  _rebuildGeometry() {
    const gl = this.gl;
    if (!gl || !this.compiled) return;

    for (const b of this.batches) if (b.buffer) gl.deleteBuffer(b.buffer);
    for (const b of this.translucentBatches) if (b.buffer) gl.deleteBuffer(b.buffer);
    if (this.wireBatch && this.wireBatch.buffer) gl.deleteBuffer(this.wireBatch.buffer);

    this.batches = [];
    this.translucentBatches = [];
    this.pickTriangles = [];

    const batchMap = new Map();
    const transMap = new Map();
    const wireVerts = [];

    const addTri = (texKey, isSky, p1, p2, p3, uv1, uv2, uv3, light, highlight, sourceId, alpha = 1.0) => {
      const targetMap = alpha < 0.99 ? transMap : batchMap;
      const mapKey = `${texKey}::${alpha.toFixed(2)}`;
      if (!targetMap.has(mapKey)) {
        targetMap.set(mapKey, { texKey, isSky, alpha, data: [] });
      }
      const arr = targetMap.get(mapKey).data;
      arr.push(
        p1[0], p1[1], p1[2], uv1[0], uv1[1], light, highlight,
        p2[0], p2[1], p2[2], uv2[0], uv2[1], light, highlight,
        p3[0], p3[1], p3[2], uv3[0], uv3[1], light, highlight
      );
      if (sourceId) {
        this.pickTriangles.push({ a: p1, b: p2, c: p3, sourceId });
      }
    };

    const addQuad = (texKey, isSky, p1, p2, p3, p4, uv1, uv2, uv3, uv4, light, highlight, sourceId, alpha = 1.0) => {
      addTri(texKey, isSky, p1, p2, p3, uv1, uv2, uv3, light, highlight, sourceId, alpha);
      addTri(texKey, isSky, p1, p3, p4, uv1, uv3, uv4, light, highlight, sourceId, alpha);
      wireVerts.push(
        p1[0], p1[1], p1[2], p2[0], p2[1], p2[2],
        p2[0], p2[1], p2[2], p3[0], p3[1], p3[2],
        p3[0], p3[1], p3[2], p4[0], p4[1], p4[2],
        p4[0], p4[1], p4[2], p1[0], p1[1], p1[2]
      );
    };

    const to3D = (x, y, z) => [x, z, -y];

    const sectors = this.compiled.sectors || [];
    const threeDFloors = this.compiled.threeDFloors || [];
    const vertices = this.compiled.vertices || [];
    const linedefs = this.compiled.linedefs || [];
    const skyTexName = (this.compiled.skybox?.texture || 'SKY1').toUpperCase();
    this._getOrLoadTexture('TEX', skyTexName);

    // 1. Sector Floors & Ceilings
    for (const sec of sectors) {
      const light = Math.max(0.15, Math.min(1.0, (sec.lightLevel || 160) / 235));
      const pickId = sec.baseSourceId || sec.sourceId;
      const hi = (pickId && pickId === this.selectedId) ? 1.0 : 0.0;
      const floorKey = `FLAT:${(sec.floorTexture || 'FLOOR4_8').toUpperCase()}`;
      this._getOrLoadTexture('FLAT', sec.floorTexture || 'FLOOR4_8');

      const isSkyCeil = (sec.ceilingTexture || '').toUpperCase() === 'F_SKY1';
      const ceilKey = isSkyCeil ? `TEX:${skyTexName}` : `FLAT:${(sec.ceilingTexture || 'CEIL3_5').toUpperCase()}`;
      if (!isSkyCeil) this._getOrLoadTexture('FLAT', sec.ceilingTexture || 'CEIL3_5');

      const faces = sec.faces || [];
      for (const face of faces) {
        const tris = face.triangles || [];
        for (const [a, b, c] of tris) {
          const fa = to3D(a.x, a.y, sec.floorHeight);
          const fb = to3D(b.x, b.y, sec.floorHeight);
          const fc = to3D(c.x, c.y, sec.floorHeight);
          addTri(
            floorKey, false,
            fa, fb, fc,
            [a.x / 64, -a.y / 64],
            [b.x / 64, -b.y / 64],
            [c.x / 64, -c.y / 64],
            light, hi, pickId
          );

          // In First-Person mode, always render ceilings (including panoramic skybox ceilings!).
          // In Dollhouse mode, hide ceilings when Cutaway is enabled so you can peer inside rooms.
          const showCeiling = (this.mode === 'walk') || !this.cutawayCeilings || sec.kind === 'door' || sec.kind === 'window';
          if (showCeiling) {
            const ca = to3D(a.x, a.y, sec.ceilingHeight);
            const cb = to3D(c.x, c.y, sec.ceilingHeight);
            const cc = to3D(b.x, b.y, sec.ceilingHeight);
            addTri(
              ceilKey, isSkyCeil,
              ca, cb, cc,
              [a.x / 64, -a.y / 64],
              [c.x / 64, -c.y / 64],
              [b.x / 64, -b.y / 64],
              light * 0.92, hi, pickId
            );
          }
        }
      }
    }

    // 1B. Multi-Level 3D Floors / Half-Floors / Bridges (`threeDFloors`)
    for (const vol of threeDFloors) {
      const hi = (vol.sourceId && vol.sourceId === this.selectedId) ? 1.0 : 0.0;
      const alpha = Math.max(0.25, Math.min(1.0, (vol.opacity || 255) / 255));
      const topKey = `FLAT:${(vol.topTexture || 'STEP2').toUpperCase()}`;
      const botKey = `FLAT:${(vol.bottomTexture || 'FLAT20').toUpperCase()}`;
      const edgeTex = (vol.edgeTexture || 'SUPPORT3').toUpperCase();
      const edgeEntry = this._getOrLoadTexture('TEX', edgeTex);
      this._getOrLoadTexture('FLAT', vol.topTexture || 'STEP2');
      this._getOrLoadTexture('FLAT', vol.bottomTexture || 'FLAT20');

      const tris = vol.triangles || [];
      for (const [a, b, c] of tris) {
        // Walkable Top Surface at vol.topZ
        addTri(
          topKey, false,
          to3D(a.x, a.y, vol.topZ),
          to3D(b.x, b.y, vol.topZ),
          to3D(c.x, c.y, vol.topZ),
          [a.x / 64, -a.y / 64],
          [b.x / 64, -b.y / 64],
          [c.x / 64, -c.y / 64],
          0.92, hi, vol.sourceId, alpha
        );
        // Underside Ceiling Surface at vol.bottomZ
        addTri(
          botKey, false,
          to3D(a.x, a.y, vol.bottomZ),
          to3D(c.x, c.y, vol.bottomZ),
          to3D(b.x, b.y, vol.bottomZ),
          [a.x / 64, -a.y / 64],
          [c.x / 64, -c.y / 64],
          [b.x / 64, -b.y / 64],
          0.72, hi, vol.sourceId, alpha
        );
      }

      // Perimeter Slab Edges from vol.bottomZ to vol.topZ
      const poly = vol.polygon || [];
      const tw = edgeEntry?.width || 64;
      const th = edgeEntry?.height || 64;
      const slabH = Math.max(2, vol.topZ - vol.bottomZ);
      for (let i = 0; i < poly.length; i++) {
        const va = poly[i];
        const vb = poly[(i + 1) % poly.length];
        const edgeLen = Math.hypot(vb.x - va.x, vb.y - va.y);
        if (edgeLen < 1) continue;
        const u1 = edgeLen / tw;
        const v1 = slabH / th;
        // Outer & inner facing slab edges
        addQuad(
          `TEX:${edgeTex}`, false,
          to3D(va.x, va.y, vol.topZ),
          to3D(vb.x, vb.y, vol.topZ),
          to3D(vb.x, vb.y, vol.bottomZ),
          to3D(va.x, va.y, vol.bottomZ),
          [0, 0], [u1, 0], [u1, v1], [0, v1],
          0.85, hi, vol.sourceId, alpha
        );
        addQuad(
          `TEX:${edgeTex}`, false,
          to3D(vb.x, vb.y, vol.topZ),
          to3D(va.x, va.y, vol.topZ),
          to3D(va.x, va.y, vol.bottomZ),
          to3D(vb.x, vb.y, vol.bottomZ),
          [0, 0], [u1, 0], [u1, v1], [0, v1],
          0.85, hi, vol.sourceId, alpha
        );
      }
    }

    // 2. Linedef Walls
    for (const ld of linedefs) {
      const v1 = vertices[ld.v1];
      const v2 = vertices[ld.v2];
      if (!v1 || !v2) continue;

      const len = Math.hypot(v2.x - v1.x, v2.y - v1.y);
      if (len < 1e-2) continue;

      const frontSec = sectors[ld.front?.sector];
      if (!frontSec) continue;

      const dirShade = Math.abs(v2.x - v1.x) > Math.abs(v2.y - v1.y) ? 0.94 : 1.06;
      const baseLight = Math.max(0.15, Math.min(1.05, ((frontSec.lightLevel || 160) / 235) * dirShade));
      const frontPickId = frontSec.baseSourceId || frontSec.sourceId;
      const frontHi = (frontPickId && frontPickId === this.selectedId) ? 1.0 : 0.0;

      const buildWallSegment = (va, vb, zBottom, zTop, texName, pegBottom, lightVal, hiVal, srcId, isSkyWall = false, wallAlpha = 1.0) => {
        if (zTop <= zBottom + 0.1) return;
        if (isSkyWall) {
          const p1 = to3D(va.x, va.y, zTop);
          const p2 = to3D(vb.x, vb.y, zTop);
          const p3 = to3D(vb.x, vb.y, zBottom);
          const p4 = to3D(va.x, va.y, zBottom);
          addQuad(`TEX:${skyTexName}`, true, p1, p2, p3, p4, [0, 0], [1, 0], [1, 1], [0, 1], 1.0, hiVal, srcId);
          return;
        }
        if (!texName || texName === '-') return;
        const texEntry = this._getOrLoadTexture('TEX', texName);
        const tw = texEntry?.width || 128;
        const th = texEntry?.height || 128;
        const h = zTop - zBottom;
        const u0 = 0;
        const u1 = len / tw;
        const v0 = pegBottom ? (1.0 - h / th) : 0.0;
        const v1 = pegBottom ? 1.0 : (h / th);

        const p1 = to3D(va.x, va.y, zTop);
        const p2 = to3D(vb.x, vb.y, zTop);
        const p3 = to3D(vb.x, vb.y, zBottom);
        const p4 = to3D(va.x, va.y, zBottom);
        addQuad(
          `TEX:${texName.toUpperCase()}`, false,
          p1, p2, p3, p4,
          [u0, v0], [u1, v0], [u1, v1], [u0, v1],
          lightVal, hiVal, srcId, wallAlpha
        );
      };

      if (!ld.twoSided || !ld.back) {
        const isHorizonWall = ld.special === 9;
        buildWallSegment(
          v1, v2,
          frontSec.floorHeight, frontSec.ceilingHeight,
          ld.front.texturemiddle || 'STARTAN2',
          ld.dontpegbottom,
          baseLight, frontHi, frontPickId,
          isHorizonWall
        );
      } else {
        const backSec = sectors[ld.back.sector];
        if (!backSec) continue;
        const backPickId = backSec.baseSourceId || backSec.sourceId;
        const backHi = (backPickId && backPickId === this.selectedId) ? 1.0 : frontHi;

        const bothSky = (frontSec.ceilingTexture === 'F_SKY1' && backSec.ceilingTexture === 'F_SKY1');
        if (frontSec.ceilingHeight > backSec.ceilingHeight && !bothSky) {
          buildWallSegment(
            v1, v2,
            backSec.ceilingHeight, frontSec.ceilingHeight,
            ld.front.texturetop || 'STARTAN2',
            !ld.dontpegtop,
            baseLight, backHi, backPickId
          );
        }
        if (backSec.ceilingHeight > frontSec.ceilingHeight && !bothSky) {
          buildWallSegment(
            v2, v1,
            frontSec.ceilingHeight, backSec.ceilingHeight,
            ld.back.texturetop || 'STARTAN2',
            !ld.dontpegtop,
            baseLight, frontHi, frontPickId
          );
        }

        if (backSec.floorHeight > frontSec.floorHeight) {
          buildWallSegment(
            v1, v2,
            frontSec.floorHeight, backSec.floorHeight,
            ld.front.texturebottom || 'STEP1',
            ld.dontpegbottom,
            baseLight, backHi, backPickId
          );
        }
        if (frontSec.floorHeight > backSec.floorHeight) {
          buildWallSegment(
            v2, v1,
            backSec.floorHeight, frontSec.floorHeight,
            ld.back.texturebottom || 'STEP1',
            ld.dontpegbottom,
            baseLight, frontHi, frontPickId
          );
        }

        if (ld.front.texturemiddle && ld.front.texturemiddle !== '-') {
          const zBot = Math.max(frontSec.floorHeight, backSec.floorHeight);
          const zTop = Math.min(frontSec.ceilingHeight, backSec.ceilingHeight);
          const midAlpha = ld.alpha ?? 1.0;
          buildWallSegment(v1, v2, zBot, zTop, ld.front.texturemiddle, false, baseLight, backHi, backPickId, false, midAlpha);
          buildWallSegment(v2, v1, zBot, zTop, ld.front.texturemiddle, false, baseLight, frontHi, backPickId, false, midAlpha);
        }
      }
    }

    // 3. Things / Sprites
    const things = this.compiled.things || [];
    for (const th of things) {
      const cat = this.thingCatalogMap.get(th.type);
      if (!cat || !cat.sprite) continue;
      if (this.mode === 'walk' && th.type === 1) continue;

      const sprEntry = this._getOrLoadTexture('SPR', cat.sprite);
      const texKey = `SPR:${cat.sprite.toUpperCase()}`;
      const zFloor = this._getSectorFloorAt(th.x, th.y, null);
      const halfW = (sprEntry?.width ? sprEntry.width * 0.5 : (cat.radius || 20));
      const h = (sprEntry?.height || cat.height || 48);
      const hi = (th.id && th.id === this.selectedId) ? 1.0 : 0.0;

      for (const ang of [0, Math.PI * 0.5]) {
        const dx = Math.cos(ang) * halfW;
        const dy = Math.sin(ang) * halfW;
        const p1 = to3D(th.x - dx, th.y - dy, zFloor + h);
        const p2 = to3D(th.x + dx, th.y + dy, zFloor + h);
        const p3 = to3D(th.x + dx, th.y + dy, zFloor);
        const p4 = to3D(th.x - dx, th.y - dy, zFloor);
        addTri(texKey, false, p1, p2, p3, [0, 0], [1, 0], [1, 1], 1.0, hi, th.id);
        addTri(texKey, false, p1, p3, p4, [0, 0], [1, 1], [0, 1], 1.0, hi, th.id);
        addTri(texKey, false, p2, p1, p4, [1, 0], [0, 0], [0, 1], 1.0, hi, th.id);
        addTri(texKey, false, p2, p4, p3, [1, 0], [0, 1], [1, 1], 1.0, hi, th.id);
      }
    }

    for (const b of batchMap.values()) {
      if (b.data.length === 0) continue;
      const arr = new Float32Array(b.data);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
      this.batches.push({
        texKey: b.texKey,
        isSky: b.isSky,
        alpha: 1.0,
        buffer: buf,
        count: arr.length / 7
      });
    }

    for (const b of transMap.values()) {
      if (b.data.length === 0) continue;
      const arr = new Float32Array(b.data);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
      this.translucentBatches.push({
        texKey: b.texKey,
        isSky: b.isSky,
        alpha: b.alpha,
        buffer: buf,
        count: arr.length / 7
      });
    }

    if (wireVerts.length > 0) {
      const wArr = new Float32Array(wireVerts);
      const wBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, wBuf);
      gl.bufferData(gl.ARRAY_BUFFER, wArr, gl.STATIC_DRAW);
      this.wireBatch = {
        buffer: wBuf,
        count: wArr.length / 3
      };
    }
  }

  _bindEvents() {
    let dragging = false;
    let dragBtn = 0;
    let startX = 0, startY = 0;
    let lastX = 0, lastY = 0;

    this.canvas.addEventListener('contextmenu', e => e.preventDefault());

    this.canvas.addEventListener('mousedown', e => {
      dragging = true;
      dragBtn = e.button;
      startX = lastX = e.clientX;
      startY = lastY = e.clientY;
      if (this.mode === 'walk' && e.button === 0 && document.pointerLockElement !== this.canvas) {
        this.canvas.requestPointerLock?.();
      }
    });

    window.addEventListener('mousemove', e => {
      // 1. First-Person Walkthrough mouse look (works both with Pointer Lock AND click-drag!)
      if (this.mode === 'walk') {
        if (document.pointerLockElement === this.canvas) {
          this.walkYaw -= e.movementX * 0.0028;
          this.walkPitch = Math.max(-1.35, Math.min(1.35, this.walkPitch - e.movementY * 0.0028));
          return;
        }
        if (dragging) {
          const dx = e.clientX - lastX;
          const dy = e.clientY - lastY;
          lastX = e.clientX;
          lastY = e.clientY;
          this.walkYaw -= dx * 0.004;
          this.walkPitch = Math.max(-1.35, Math.min(1.35, this.walkPitch - dy * 0.004));
        }
        return;
      }

      // 2. 3D Dollhouse Orbit & Screen-Accurate Pan
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;

      if (dragBtn === 0 && !e.shiftKey && !e.altKey) {
        // Left-drag: Turntable Orbit (dragging right rotates camera around target in natural direction)
        this.orbitYaw -= dx * 0.0065;
        this.orbitPitch = Math.max(0.08, Math.min(1.48, this.orbitPitch + dy * 0.0065));
      } else {
        // Right-drag / Middle-drag / Shift+Drag: 1:1 Screen-Plane & Ground-Aligned Panning!
        // Extract exact Right and Up vectors from the current View Matrix so panning ALWAYS matches mouse direction!
        const { view } = this._getCameraMatrices();
        const rightVec = [view[0], view[4], view[8]];
        const upVec = [view[1], view[5], view[9]];
        const fovScale = 2.0 * Math.tan((65 * Math.PI / 180) * 0.5);
        const viewH = Math.max(200, this.canvas.clientHeight || 600);
        const unitsPerPixel = (this.orbitDist * fovScale) / viewH;

        this.orbitTarget[0] += (-dx * rightVec[0] + dy * upVec[0]) * unitsPerPixel;
        this.orbitTarget[1] += (-dx * rightVec[1] + dy * upVec[1]) * unitsPerPixel;
        this.orbitTarget[2] += (-dx * rightVec[2] + dy * upVec[2]) * unitsPerPixel;
      }
    });

    window.addEventListener('mouseup', e => {
      if (!dragging) return;
      dragging = false;
      const moved = Math.hypot(e.clientX - startX, e.clientY - startY);
      if (moved < 5 && e.button === 0 && this.mode === 'orbit') {
        this._handlePick(e);
      }
    });

    this.canvas.addEventListener('wheel', e => {
      e.preventDefault();
      if (this.mode === 'orbit') {
        // Zoom toward mouse cursor direction
        const factor = e.deltaY < 0 ? 0.88 : 1.13;
        this.orbitDist = Math.max(80, Math.min(6000, this.orbitDist * factor));
      }
    }, { passive: false });

    window.addEventListener('keydown', e => {
      this.keys[e.code] = true;
    });
    window.addEventListener('keyup', e => {
      this.keys[e.code] = false;
    });
  }

  _getCameraMatrices() {
    const aspect = (this.canvas.width || 1) / (this.canvas.height || 1);
    const proj = mat4Perspective(65 * Math.PI / 180, aspect, 6.0, 16000.0);
    let eye, center;

    if (this.mode === 'walk') {
      eye = [this.walkPos.x, this.walkPos.z, -this.walkPos.y];
      const dirX = Math.cos(this.walkYaw) * Math.cos(this.walkPitch);
      const dirY = Math.sin(this.walkPitch);
      const dirZ = -Math.sin(this.walkYaw) * Math.cos(this.walkPitch);
      center = [eye[0] + dirX * 100, eye[1] + dirY * 100, eye[2] + dirZ * 100];
    } else {
      const cosP = Math.cos(this.orbitPitch);
      const sinP = Math.sin(this.orbitPitch);
      const cosY = Math.cos(this.orbitYaw);
      const sinY = Math.sin(this.orbitYaw);
      // Consistent right-handed spherical orbit coordinates around orbitTarget
      eye = [
        this.orbitTarget[0] + sinY * cosP * this.orbitDist,
        this.orbitTarget[1] + sinP * this.orbitDist,
        this.orbitTarget[2] + cosY * cosP * this.orbitDist
      ];
      center = this.orbitTarget;
    }

    const view = mat4LookAt(eye, center, [0, 1, 0]);
    return { proj, view, eye };
  }

  _handlePick(e) {
    const rect = this.canvas.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = 1 - ((e.clientY - rect.top) / rect.height) * 2;

    const { proj, view, eye } = this._getCameraMatrices();
    const pv = mat4Multiply(proj, view);
    const invPV = mat4Invert(pv);
    if (!invPV) return;

    const nearPt = unprojectPoint(nx, ny, -1, invPV);
    const farPt = unprojectPoint(nx, ny, 1, invPV);
    const dir = normalizeVec3([farPt[0] - nearPt[0], farPt[1] - nearPt[1], farPt[2] - nearPt[2]]);

    let bestT = Infinity;
    let bestId = null;

    for (const tri of this.pickTriangles) {
      const t = rayIntersectTriangle(eye, dir, tri.a, tri.b, tri.c);
      if (t !== null && t > 1 && t < bestT) {
        bestT = t;
        bestId = tri.sourceId;
      }
    }

    if (bestId && this.onSelectObject) {
      this.onSelectObject(bestId);
    }
  }

  _updateMovement(dt) {
    if (document.activeElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

    if (this.mode === 'walk') {
      const speed = (this.keys['ShiftLeft'] ? 520 : 300) * dt;
      // Forward in Doom (x, y) is (cos(walkYaw), sin(walkYaw))
      // Right in Doom (x, y) is (+sin(walkYaw), -cos(walkYaw))
      const fwdX = Math.cos(this.walkYaw);
      const fwdY = Math.sin(this.walkYaw);
      const rightX = Math.sin(this.walkYaw);
      const rightY = -Math.cos(this.walkYaw);

      let moveX = 0, moveY = 0;
      if (this.keys['KeyW'] || this.keys['ArrowUp']) { moveX += fwdX; moveY += fwdY; }
      if (this.keys['KeyS'] || this.keys['ArrowDown']) { moveX -= fwdX; moveY -= fwdY; }
      if (this.keys['KeyD'] || this.keys['ArrowRight']) { moveX += rightX; moveY += rightY; }
      if (this.keys['KeyA'] || this.keys['ArrowLeft']) { moveX -= rightX; moveY -= rightY; }

      if (moveX !== 0 || moveY !== 0) {
        const len = Math.hypot(moveX, moveY);
        this.walkPos.x += (moveX / len) * speed;
        this.walkPos.y += (moveY / len) * speed;
        const targetFloor = this._getSectorFloorAt(this.walkPos.x, this.walkPos.y, this.walkPos.z) + 46;
        this.walkPos.z += (targetFloor - this.walkPos.z) * 0.22;
      }

      if (this.keys['KeyE'] || this.keys['Space']) this.walkPos.z += 240 * dt;
      if (this.keys['KeyQ'] || this.keys['ControlLeft']) this.walkPos.z -= 240 * dt;
    } else if (this.mode === 'orbit') {
      // Support arrow-key panning in Orbit mode as well
      const panSpeed = this.orbitDist * 0.65 * dt;
      const { view } = this._getCameraMatrices();
      const rightVec = [view[0], 0, view[8]];
      const fwdVec = [-view[2], 0, -view[10]];
      if (this.keys['ArrowRight']) {
        this.orbitTarget[0] += rightVec[0] * panSpeed;
        this.orbitTarget[2] += rightVec[2] * panSpeed;
      }
      if (this.keys['ArrowLeft']) {
        this.orbitTarget[0] -= rightVec[0] * panSpeed;
        this.orbitTarget[2] -= rightVec[2] * panSpeed;
      }
      if (this.keys['ArrowUp']) {
        this.orbitTarget[0] += fwdVec[0] * panSpeed;
        this.orbitTarget[2] += fwdVec[2] * panSpeed;
      }
      if (this.keys['ArrowDown']) {
        this.orbitTarget[0] -= fwdVec[0] * panSpeed;
        this.orbitTarget[2] -= fwdVec[2] * panSpeed;
      }
    }
  }

  _startLoop() {
    let lastTime = performance.now();
    const tick = (now) => {
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;
      this._updateMovement(dt);
      this.render();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  render() {
    const gl = this.gl;
    if (!gl) return;

    const dpr = window.devicePixelRatio || 1;
    const w = Math.floor(this.canvas.clientWidth * dpr);
    const h = Math.floor(this.canvas.clientHeight * dpr);
    if (w > 0 && h > 0 && (this.canvas.width !== w || this.canvas.height !== h)) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.045, 0.055, 0.08, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);

    const { proj, view, eye } = this._getCameraMatrices();
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.locs.uProj, false, proj);
    gl.uniformMatrix4fv(this.locs.uView, false, view);
    gl.uniform3f(this.locs.uCameraPos, eye[0], eye[1], eye[2]);
    gl.uniform1f(this.locs.uTime, (performance.now() - this.startTime) * 0.001);

    const skyCfg = this.compiled?.skybox || {
      texture: 'SKY1',
      scrollSpeed: 0,
      use3DSkybox: false,
      topColor: [0.12, 0.22, 0.42],
      horizonColor: [0.45, 0.58, 0.75]
    };
    gl.uniform1f(this.locs.uSkyScroll, skyCfg.scrollSpeed || 0);
    gl.uniform3fv(this.locs.uSkyTop, skyCfg.topColor || [0.12, 0.22, 0.42]);
    gl.uniform3fv(this.locs.uSkyHorizon, skyCfg.horizonColor || [0.45, 0.58, 0.75]);
    gl.uniform1i(this.locs.uUse3DSky, skyCfg.use3DSkybox ? 1 : 0);

    const stride = 7 * 4;
    const skyTexKey = `TEX:${(skyCfg.texture || 'SKY1').toUpperCase()}`;
    const skyTexEntry = this.textures.get(skyTexKey);

    // 0. Render 360° Panoramic Skybox Dome behind scene in First-Person mode (or when looking toward horizon)
    if (this.skyDomeBatch) {
      gl.depthMask(false);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.skyDomeBatch.buffer);
      gl.enableVertexAttribArray(this.locs.aPos);
      gl.vertexAttribPointer(this.locs.aPos, 3, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(this.locs.aUV);
      gl.vertexAttribPointer(this.locs.aUV, 2, gl.FLOAT, false, stride, 12);
      gl.enableVertexAttribArray(this.locs.aLight);
      gl.vertexAttribPointer(this.locs.aLight, 1, gl.FLOAT, false, stride, 20);
      gl.enableVertexAttribArray(this.locs.aHighlight);
      gl.vertexAttribPointer(this.locs.aHighlight, 1, gl.FLOAT, false, stride, 24);
      gl.uniform1i(this.locs.uMode, 1);
      gl.uniform1f(this.locs.uAlpha, 1.0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, skyTexEntry ? skyTexEntry.glTex : this.fallbackTex);
      gl.uniform1i(this.locs.uTex, 0);
      gl.drawArrays(gl.TRIANGLES, 0, this.skyDomeBatch.count);
      gl.depthMask(true);
    }

    // 1. Render Opaque Batches
    const drawBatchList = (list) => {
      for (const batch of list) {
        gl.bindBuffer(gl.ARRAY_BUFFER, batch.buffer);
        gl.enableVertexAttribArray(this.locs.aPos);
        gl.vertexAttribPointer(this.locs.aPos, 3, gl.FLOAT, false, stride, 0);
        gl.enableVertexAttribArray(this.locs.aUV);
        gl.vertexAttribPointer(this.locs.aUV, 2, gl.FLOAT, false, stride, 12);
        gl.enableVertexAttribArray(this.locs.aLight);
        gl.vertexAttribPointer(this.locs.aLight, 1, gl.FLOAT, false, stride, 20);
        gl.enableVertexAttribArray(this.locs.aHighlight);
        gl.vertexAttribPointer(this.locs.aHighlight, 1, gl.FLOAT, false, stride, 24);
        gl.uniform1f(this.locs.uAlpha, batch.alpha ?? 1.0);

        if (batch.isSky) {
          gl.uniform1i(this.locs.uMode, 1);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, skyTexEntry ? skyTexEntry.glTex : this.fallbackTex);
          gl.uniform1i(this.locs.uTex, 0);
        } else {
          gl.uniform1i(this.locs.uMode, 0);
          const texEntry = this.textures.get(batch.texKey);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, texEntry ? texEntry.glTex : this.fallbackTex);
          gl.uniform1i(this.locs.uTex, 0);
        }
        gl.drawArrays(gl.TRIANGLES, 0, batch.count);
      }
    };

    drawBatchList(this.batches);

    // 2. Render Translucent 3D Floors (Glass Bridges / Deep Water Volumes)
    if (this.translucentBatches.length > 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      drawBatchList(this.translucentBatches);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    // 3. Optional Wireframe Overlay
    if (this.showWireframe && this.wireBatch) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.wireBatch.buffer);
      gl.enableVertexAttribArray(this.locs.aPos);
      gl.vertexAttribPointer(this.locs.aPos, 3, gl.FLOAT, false, 12, 0);
      gl.disableVertexAttribArray(this.locs.aUV);
      gl.disableVertexAttribArray(this.locs.aLight);
      gl.disableVertexAttribArray(this.locs.aHighlight);
      gl.uniform1i(this.locs.uMode, 2);
      gl.drawArrays(gl.LINES, 0, this.wireBatch.count);
    }
  }
}

// 4x4 Matrix & Raycast Math Helpers
function mat4Perspective(fovy, aspect, near, far) {
  const f = 1.0 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, (2 * far * near) * nf, 0
  ]);
}

function mat4LookAt(eye, center, up) {
  let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
  let len = Math.hypot(zx, zy, zz) || 1;
  zx /= len; zy /= len; zz /= len;

  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  len = Math.hypot(xx, xy, xz) || 1;
  xx /= len; xy /= len; xz /= len;

  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;

  return new Float32Array([
    xx, yx, zx, 0,
    xy, yy, zy, 0,
    xz, yz, zz, 0,
    -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
    -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
    -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
    1
  ]);
}

function mat4Multiply(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

function mat4Invert(m) {
  const inv = new Float32Array(16);
  inv[0] = m[5]*m[10]*m[15] - m[5]*m[11]*m[14] - m[9]*m[6]*m[15] + m[9]*m[7]*m[14] + m[13]*m[6]*m[11] - m[13]*m[7]*m[10];
  inv[4] = -m[4]*m[10]*m[15] + m[4]*m[11]*m[14] + m[8]*m[6]*m[15] - m[8]*m[7]*m[14] - m[12]*m[6]*m[11] + m[12]*m[7]*m[10];
  inv[8] = m[4]*m[9]*m[15] - m[4]*m[11]*m[13] - m[8]*m[5]*m[15] + m[8]*m[7]*m[13] + m[12]*m[5]*m[11] - m[12]*m[7]*m[9];
  inv[12] = -m[4]*m[9]*m[14] + m[4]*m[10]*m[13] + m[8]*m[5]*m[14] - m[8]*m[6]*m[13] - m[12]*m[5]*m[10] + m[12]*m[6]*m[9];
  inv[1] = -m[1]*m[10]*m[15] + m[1]*m[11]*m[14] + m[9]*m[2]*m[15] - m[9]*m[3]*m[14] - m[13]*m[2]*m[11] + m[13]*m[3]*m[10];
  inv[5] = m[0]*m[10]*m[15] - m[0]*m[11]*m[14] - m[8]*m[2]*m[15] + m[8]*m[3]*m[14] + m[12]*m[2]*m[11] - m[12]*m[3]*m[10];
  inv[9] = -m[0]*m[9]*m[15] + m[0]*m[11]*m[13] + m[8]*m[1]*m[15] - m[8]*m[3]*m[13] - m[12]*m[1]*m[11] + m[12]*m[3]*m[9];
  inv[13] = m[0]*m[9]*m[14] - m[0]*m[10]*m[13] - m[8]*m[1]*m[14] + m[8]*m[2]*m[13] + m[12]*m[1]*m[10] - m[12]*m[2]*m[9];
  inv[2] = m[1]*m[6]*m[15] - m[1]*m[7]*m[14] - m[5]*m[2]*m[15] + m[5]*m[3]*m[14] + m[13]*m[2]*m[7] - m[13]*m[3]*m[6];
  inv[6] = -m[0]*m[6]*m[15] + m[0]*m[7]*m[14] + m[4]*m[2]*m[15] - m[4]*m[3]*m[14] - m[12]*m[2]*m[7] + m[12]*m[3]*m[6];
  inv[10] = m[0]*m[5]*m[15] - m[0]*m[7]*m[13] - m[4]*m[1]*m[15] + m[4]*m[3]*m[13] + m[12]*m[1]*m[7] - m[12]*m[3]*m[5];
  inv[14] = -m[0]*m[5]*m[14] + m[0]*m[6]*m[13] + m[4]*m[1]*m[14] - m[4]*m[2]*m[13] - m[12]*m[1]*m[6] + m[12]*m[2]*m[5];
  inv[3] = -m[1]*m[6]*m[11] + m[1]*m[7]*m[10] + m[5]*m[2]*m[11] - m[5]*m[3]*m[10] - m[9]*m[2]*m[7] + m[9]*m[3]*m[6];
  inv[7] = m[0]*m[6]*m[11] - m[0]*m[7]*m[10] - m[4]*m[2]*m[11] + m[4]*m[3]*m[10] + m[8]*m[2]*m[7] - m[8]*m[3]*m[6];
  inv[11] = -m[0]*m[5]*m[11] + m[0]*m[7]*m[9] + m[4]*m[1]*m[11] - m[4]*m[3]*m[9] - m[8]*m[1]*m[7] + m[8]*m[3]*m[5];
  inv[15] = m[0]*m[5]*m[10] - m[0]*m[6]*m[9] - m[4]*m[1]*m[10] + m[4]*m[2]*m[9] + m[8]*m[1]*m[6] - m[8]*m[2]*m[5];
  let det = m[0]*inv[0] + m[1]*inv[4] + m[2]*inv[8] + m[3]*inv[12];
  if (Math.abs(det) < 1e-8) return null;
  det = 1.0 / det;
  for (let i = 0; i < 16; i++) inv[i] *= det;
  return inv;
}

function unprojectPoint(nx, ny, nz, invPV) {
  const x = invPV[0]*nx + invPV[4]*ny + invPV[8]*nz + invPV[12];
  const y = invPV[1]*nx + invPV[5]*ny + invPV[9]*nz + invPV[13];
  const z = invPV[2]*nx + invPV[6]*ny + invPV[10]*nz + invPV[14];
  const w = invPV[3]*nx + invPV[7]*ny + invPV[11]*nz + invPV[15] || 1;
  return [x / w, y / w, z / w];
}

function normalizeVec3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function rayIntersectTriangle(orig, dir, v0, v1, v2) {
  const e1 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]];
  const e2 = [v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]];
  const h = [
    dir[1]*e2[2] - dir[2]*e2[1],
    dir[2]*e2[0] - dir[0]*e2[2],
    dir[0]*e2[1] - dir[1]*e2[0]
  ];
  const a = e1[0]*h[0] + e1[1]*h[1] + e1[2]*h[2];
  if (Math.abs(a) < 1e-6) return null;
  const f = 1.0 / a;
  const s = [orig[0] - v0[0], orig[1] - v0[1], orig[2] - v0[2]];
  const u = f * (s[0]*h[0] + s[1]*h[1] + s[2]*h[2]);
  if (u < 0.0 || u > 1.0) return null;
  const q = [
    s[1]*e1[2] - s[2]*e1[1],
    s[2]*e1[0] - s[0]*e1[2],
    s[0]*e1[1] - s[1]*e1[0]
  ];
  const v = f * (dir[0]*q[0] + dir[1]*q[1] + dir[2]*q[2]);
  if (v < 0.0 || u + v > 1.0) return null;
  const t = f * (e2[0]*q[0] + e2[1]*q[1] + e2[2]*q[2]);
  return t > 1e-3 ? t : null;
}

window.DoomRenderer3D = DoomRenderer3D;
