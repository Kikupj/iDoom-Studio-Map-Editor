const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Minimal fast PNG encoder (RGBA -> PNG Buffer) using built-in zlib
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type 0 (None)
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const compressed = zlib.deflateSync(raw, { level: 3 });

  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0))
  ]);
}

class WadReader {
  constructor(wadPath) {
    this.wadPath = wadPath;
    this.buf = fs.readFileSync(wadPath);
    this.lumps = [];
    this.lumpMap = new Map();
    this.palette = [];
    this.pnames = [];
    this.textures = new Map();
    this.flats = new Map();
    this.sprites = new Map();
    this.pngCache = new Map();

    this._parseDirectory();
    this._parsePalette();
    this._parsePnames();
    this._parseTextures('TEXTURE1');
    this._parseTextures('TEXTURE2');
    this._parseFlats();
    this._parseSprites();
  }

  _parseDirectory() {
    const numLumps = this.buf.readInt32LE(4);
    const dirOffset = this.buf.readInt32LE(8);
    for (let i = 0; i < numLumps; i++) {
      const off = dirOffset + i * 16;
      const filepos = this.buf.readInt32LE(off);
      const size = this.buf.readInt32LE(off + 4);
      const name = this.buf.toString('ascii', off + 8, off + 16).replace(/\0.*$/, '').toUpperCase();
      const lump = { index: i, name, filepos, size };
      this.lumps.push(lump);
      this.lumpMap.set(name, lump);
    }
  }

  _parsePalette() {
    const playpal = this.lumpMap.get('PLAYPAL');
    if (!playpal) {
      for (let i = 0; i < 256; i++) this.palette.push([i, i, i]);
      return;
    }
    const off = playpal.filepos;
    for (let i = 0; i < 256; i++) {
      this.palette.push([
        this.buf[off + i * 3],
        this.buf[off + i * 3 + 1],
        this.buf[off + i * 3 + 2]
      ]);
    }
  }

  _parsePnames() {
    const pnamesLump = this.lumpMap.get('PNAMES');
    if (!pnamesLump) return;
    const off = pnamesLump.filepos;
    const count = this.buf.readInt32LE(off);
    for (let i = 0; i < count; i++) {
      const pname = this.buf.toString('ascii', off + 4 + i * 8, off + 12 + i * 8).replace(/\0.*$/, '').toUpperCase();
      this.pnames.push(pname);
    }
  }

  _parseTextures(lumpName) {
    const texLump = this.lumpMap.get(lumpName);
    if (!texLump) return;
    const base = texLump.filepos;
    const numTex = this.buf.readInt32LE(base);
    for (let i = 0; i < numTex; i++) {
      const texOffset = this.buf.readInt32LE(base + 4 + i * 4);
      const pos = base + texOffset;
      const name = this.buf.toString('ascii', pos, pos + 8).replace(/\0.*$/, '').toUpperCase();
      const width = this.buf.readUInt16LE(pos + 12);
      const height = this.buf.readUInt16LE(pos + 14);
      const patchCount = this.buf.readUInt16LE(pos + 20);
      const patches = [];
      for (let p = 0; p < patchCount; p++) {
        const pPos = pos + 22 + p * 10;
        const originX = this.buf.readInt16LE(pPos);
        const originY = this.buf.readInt16LE(pPos + 2);
        const patchIndex = this.buf.readUInt16LE(pPos + 4);
        patches.push({
          originX,
          originY,
          patchName: this.pnames[patchIndex] || ''
        });
      }
      if (width > 0 && height > 0 && width <= 2048 && height <= 2048) {
        this.textures.set(name, { name, width, height, patches });
      }
    }
  }

  _parseFlats() {
    let inFlats = false;
    for (const lump of this.lumps) {
      if (lump.name === 'F_START' || lump.name === 'FF_START') {
        inFlats = true;
        continue;
      }
      if (lump.name === 'F_END' || lump.name === 'FF_END') {
        inFlats = false;
        continue;
      }
      if (inFlats && lump.size === 4096) {
        this.flats.set(lump.name, lump);
      }
    }
  }

  _parseSprites() {
    let inSprites = false;
    for (const lump of this.lumps) {
      if (lump.name === 'S_START' || lump.name === 'SS_START') {
        inSprites = true;
        continue;
      }
      if (lump.name === 'S_END' || lump.name === 'SS_END') {
        inSprites = false;
        continue;
      }
      if (inSprites && lump.size > 8) {
        this.sprites.set(lump.name, lump);
      }
    }
  }

  _drawPatchIntoRGBA(patchLump, destRgba, destWidth, destHeight, originX, originY) {
    if (!patchLump || patchLump.size < 8) return;
    const base = patchLump.filepos;
    const width = this.buf.readUInt16LE(base);
    const height = this.buf.readUInt16LE(base + 2);
    if (width === 0 || height === 0 || width > 2048 || height > 2048) return;

    for (let col = 0; col < width; col++) {
      const dx = originX + col;
      if (dx < 0 || dx >= destWidth) continue;
      const colOffset = this.buf.readUInt32LE(base + 8 + col * 4);
      let pos = base + colOffset;
      let safety = 0;
      while (pos < base + patchLump.size && safety++ < 256) {
        const topDelta = this.buf[pos];
        if (topDelta === 0xff) break;
        const length = this.buf[pos + 1];
        pos += 3; // topDelta, length, unused padding byte
        for (let row = 0; row < length; row++) {
          const dy = originY + topDelta + row;
          const colorIdx = this.buf[pos + row];
          if (dy >= 0 && dy < destHeight) {
            const rgb = this.palette[colorIdx] || [128, 128, 128];
            const idx = (dy * destWidth + dx) * 4;
            destRgba[idx] = rgb[0];
            destRgba[idx + 1] = rgb[1];
            destRgba[idx + 2] = rgb[2];
            destRgba[idx + 3] = 255;
          }
        }
        pos += length + 1; // data + trailing padding byte
      }
    }
  }

  getTexturePNG(name) {
    const upper = (name || '').toUpperCase();
    const cacheKey = `TEX:${upper}`;
    if (this.pngCache.has(cacheKey)) return this.pngCache.get(cacheKey);

    const tex = this.textures.get(upper);
    if (!tex) return null;

    const rgba = Buffer.alloc(tex.width * tex.height * 4, 0);
    for (const p of tex.patches) {
      const patchLump = this.lumpMap.get(p.patchName);
      if (patchLump) {
        this._drawPatchIntoRGBA(patchLump, rgba, tex.width, tex.height, p.originX, p.originY);
      }
    }

    const png = encodePNG(tex.width, tex.height, rgba);
    this.pngCache.set(cacheKey, png);
    return png;
  }

  getFlatPNG(name) {
    const upper = (name || '').toUpperCase();
    const cacheKey = `FLAT:${upper}`;
    if (this.pngCache.has(cacheKey)) return this.pngCache.get(cacheKey);

    const lump = this.flats.get(upper);
    if (!lump) return null;

    const rgba = Buffer.alloc(64 * 64 * 4);
    const base = lump.filepos;
    for (let i = 0; i < 4096; i++) {
      const colorIdx = this.buf[base + i];
      const rgb = this.palette[colorIdx] || [128, 128, 128];
      const idx = i * 4;
      rgba[idx] = rgb[0];
      rgba[idx + 1] = rgb[1];
      rgba[idx + 2] = rgb[2];
      rgba[idx + 3] = 255;
    }

    const png = encodePNG(64, 64, rgba);
    this.pngCache.set(cacheKey, png);
    return png;
  }

  getSpritePNG(prefix) {
    const upper = (prefix || '').toUpperCase();
    const cacheKey = `SPR:${upper}`;
    if (this.pngCache.has(cacheKey)) return this.pngCache.get(cacheKey);

    let matchLump = this.sprites.get(upper);
    if (!matchLump) {
      // Find first sprite starting with 4-char prefix + A1 or A0 or similar
      const candidates = [
        `${upper}A1`, `${upper}A0`, `${upper}A1D1`, `${upper}A1C1`, `${upper}A1A5`,
        `${upper}B1`, `${upper}B0`
      ];
      for (const c of candidates) {
        if (this.sprites.has(c)) {
          matchLump = this.sprites.get(c);
          break;
        }
      }
      if (!matchLump) {
        for (const [k, v] of this.sprites.entries()) {
          if (k.startsWith(upper)) {
            matchLump = v;
            break;
          }
        }
      }
    }
    if (!matchLump) return null;

    const base = matchLump.filepos;
    const width = this.buf.readUInt16LE(base);
    const height = this.buf.readUInt16LE(base + 2);
    if (width <= 0 || height <= 0 || width > 1024 || height > 1024) return null;

    const rgba = Buffer.alloc(width * height * 4, 0);
    this._drawPatchIntoRGBA(matchLump, rgba, width, height, 0, 0);
    const png = encodePNG(width, height, rgba);
    this.pngCache.set(cacheKey, png);
    return png;
  }

  getCatalog() {
    const textureList = [];
    for (const [name, tex] of this.textures.entries()) {
      if (name === 'AASTINKY' || name === 'AASHITTY') continue;
      textureList.push({ name, width: tex.width, height: tex.height });
    }
    const flatList = Array.from(this.flats.keys());
    return {
      textures: textureList,
      flats: flatList
    };
  }
}

module.exports = { WadReader };

