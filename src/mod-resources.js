const fs = require('fs');
const path = require('path');
const { WadReader, encodePNG } = require('./wad-reader');

// A GZDoom/UZDoom mod loaded as a folder (`-file <dir>`): textures/, flats/, patches/ and sprites/ hold PNGs or
// Doom-format patches, one per file. Lump names follow the engine's folder rules: the file name without its
// extension, upper-cased, at most 8 characters, with '^' standing for '\'.
const MATERIAL_DIRS = ['textures', 'flats', 'patches'];
const SPRITE_DIRS = ['sprites'];
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function lumpNameOf(file) {
    const base = path.basename(file).replace(/\.[^.]*$/, '');
    return base.toUpperCase().replace(/\^/g, '\\').slice(0, 8);
}

function walkFiles(dir, out = []) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return out; }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walkFiles(full, out);
        else if (entry.isFile()) out.push(full);
    }
    return out;
}

function pngSize(buf) {
    if (buf.length < 24 || !buf.subarray(0, 4).equals(PNG_MAGIC)) return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function patchSize(buf) {
    if (buf.length < 8) return null;
    const width = buf.readUInt16LE(0), height = buf.readUInt16LE(2);
    if (!width || !height || width > 4096 || height > 4096) return null;
    return { width, height };
}

// A Doom patch in its own buffer, drawn to RGBA with a palette.
function patchToPNG(buf, palette) {
    const size = patchSize(buf);
    if (!size) return null;
    const { width, height } = size;
    const rgba = Buffer.alloc(width * height * 4, 0);
    for (let col = 0; col < width; col++) {
        if (8 + col * 4 + 4 > buf.length) break;
        let pos = buf.readUInt32LE(8 + col * 4);
        let safety = 0;
        while (pos < buf.length && safety++ < 512) {
            const topDelta = buf[pos];
            if (topDelta === 0xff) break;
            const length = buf[pos + 1];
            pos += 3;
            for (let row = 0; row < length && pos + row < buf.length; row++) {
                const y = topDelta + row;
                if (y >= height) continue;
                const rgb = palette[buf[pos + row]] || [128, 128, 128];
                const idx = (y * width + col) * 4;
                rgba[idx] = rgb[0]; rgba[idx + 1] = rgb[1]; rgba[idx + 2] = rgb[2]; rgba[idx + 3] = 255;
            }
            pos += length + 1;
        }
    }
    return encodePNG(width, height, rgba);
}

class ModFolder {
    constructor(modDir, { groupOf } = {}) {
        this.modDir = modDir;
        this.materials = new Map();   // NAME -> { file, group }
        this.sprites = new Map();     // NAME -> file
        for (const sub of MATERIAL_DIRS) {
            const root = path.join(modDir, sub);
            for (const file of walkFiles(root)) {
                const name = lumpNameOf(file);
                if (this.materials.has(name)) continue;    // the first one found wins, like a lump directory
                const rel = path.relative(modDir, file).split(path.sep).join('/');
                this.materials.set(name, { file, group: groupOf ? groupOf(rel) : sub });
            }
        }
        for (const sub of SPRITE_DIRS) {
            for (const file of walkFiles(path.join(modDir, sub))) {
                const name = lumpNameOf(file);
                if (!this.sprites.has(name)) this.sprites.set(name, file);
            }
        }
        this.sizeCache = new Map();
    }

    materialSize(name) {
        if (this.sizeCache.has(name)) return this.sizeCache.get(name);
        const entry = this.materials.get(name);
        let size = null;
        if (entry) {
            try {
                const head = Buffer.alloc(24);
                const fd = fs.openSync(entry.file, 'r');
                try { fs.readSync(fd, head, 0, 24, 0); } finally { fs.closeSync(fd); }
                size = pngSize(head) || patchSize(fs.readFileSync(entry.file));
            } catch { size = null; }
        }
        this.sizeCache.set(name, size);
        return size;
    }
}

// The asset stack the editor works from: the mod folder over the IWAD, the way the engine loads them
// (`-iwad freedoom2.wad -file <mod>`). It answers the same calls as WadReader.
class ResourceStack {
    constructor({ iwadPath, modDir, groupOf, iwadGroup = 'freedoom' }) {
        this.iwad = new WadReader(iwadPath);
        this.iwadGroup = iwadGroup;
        this.mod = modDir && fs.existsSync(modDir) ? new ModFolder(modDir, { groupOf }) : null;
        this.pngCache = new Map();
    }

    _modPNG(file) {
        if (this.pngCache.has(file)) return this.pngCache.get(file);
        let png = null;
        try {
            const buf = fs.readFileSync(file);
            png = buf.subarray(0, 4).equals(PNG_MAGIC) ? buf : patchToPNG(buf, this.iwad.palette);
        } catch { png = null; }
        this.pngCache.set(file, png);
        return png;
    }

    hasMaterial(name) {
        const upper = String(name || '').toUpperCase();
        return Boolean(this.mod?.materials.has(upper) || this.iwad.textures.has(upper) || this.iwad.flats.has(upper));
    }

    // In UZDoom any texture can be a flat and any flat a wall texture; the mod's own come first.
    getTexturePNG(name) {
        const upper = String(name || '').toUpperCase();
        const own = this.mod?.materials.get(upper);
        if (own) return this._modPNG(own.file);
        return this.iwad.getTexturePNG(upper) || this.iwad.getFlatPNG(upper);
    }

    getFlatPNG(name) {
        const upper = String(name || '').toUpperCase();
        const own = this.mod?.materials.get(upper);
        if (own) return this._modPNG(own.file);
        return this.iwad.getFlatPNG(upper) || this.iwad.getTexturePNG(upper);
    }

    getSpritePNG(prefix) {
        const upper = String(prefix || '').toUpperCase();
        if (this.mod) {
            const candidates = [upper, `${upper}A1`, `${upper}A0`, `${upper}A1D1`, `${upper}A1C1`, `${upper}A1A5`, `${upper}A2A8`, `${upper}B1`, `${upper}B0`];
            for (const name of candidates) {
                const file = this.mod.sprites.get(name);
                if (file) return this._modPNG(file);
            }
            if (upper.length === 4) {
                for (const [name, file] of this.mod.sprites) if (name.startsWith(upper)) return this._modPNG(file);
            }
        }
        return this.iwad.getSpritePNG(upper);
    }

    // textures and flats as names (the editor's existing shape) plus each name's source group
    getCatalog() {
        const base = this.iwad.getCatalog();
        const groups = {};
        const textures = [];
        const flats = [];
        const seen = new Set();
        if (this.mod) {
            for (const [name, entry] of this.mod.materials) {
                const size = this.mod.materialSize(name) || { width: 64, height: 64 };
                textures.push({ name, width: size.width, height: size.height, group: entry.group });
                flats.push(name);
                groups[name] = entry.group;
                seen.add(name);
            }
        }
        for (const texture of base.textures) {
            if (seen.has(texture.name)) continue;
            textures.push({ ...texture, group: this.iwadGroup });
            groups[texture.name] = this.iwadGroup;
        }
        for (const flat of base.flats) {
            if (seen.has(flat)) continue;
            flats.push(flat);
            groups[flat] = this.iwadGroup;
        }
        return { textures, flats, groups, modLoaded: Boolean(this.mod) };
    }
}

module.exports = { ResourceStack, ModFolder, lumpNameOf, patchToPNG, walkFiles };
