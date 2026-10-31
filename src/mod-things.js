const fs = require('fs');
const path = require('path');
const { walkFiles } = require('./mod-resources');

// The map things a mod defines: every editor number (MAPINFO DoomEdNums blocks, including the files they
// include, and DECORATE actors with a number on their header line) and, for each class, its size, its look
// (the first frame of its Spawn state) and a readable name ($Title / Tag / the class name). Inherited values
// come from the parent class. Read from the mod's own files at startup, so new props show up without
// touching the editor.

function readText(file) {
    try { return fs.readFileSync(file, 'latin1'); }
    catch { return ''; }
}

function stripBlockComments(text) {
    return text.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

// MAPINFO and its includes: "<number> = <class>" inside DoomEdNums { }
function readDoomEdNums(modDir, file = 'MAPINFO.txt', seen = new Set(), out = new Map()) {
    const full = path.join(modDir, file);
    const key = full.toLowerCase();
    if (seen.has(key) || !fs.existsSync(full)) return out;
    seen.add(key);
    const text = stripBlockComments(readText(full)).replace(/\/\/[^\n]*/g, '');
    for (const match of text.matchAll(/^\s*include\s+"([^"]+)"/gim)) readDoomEdNums(modDir, match[1], seen, out);
    for (const block of text.matchAll(/DoomEdNums\s*\{([^}]*)\}/gi)) {
        for (const entry of block[1].matchAll(/(\d+)\s*=\s*"?([A-Za-z0-9_&.\-]+)"?/g)) out.set(Number(entry[1]), entry[2]);
    }
    return out;
}

function matchingBrace(text, open) {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        const c = text[i];
        if (c === '{') depth++;
        else if (c === '}' && --depth === 0) return i;
        else if (c === '"') {
            const end = text.indexOf('"', i + 1);
            if (end < 0) return text.length;
            i = end;
        }
    }
    return text.length;
}

function readBody(def, body) {
    const plain = body.replace(/\/\/[^\n]*/g, '');
    const title = body.match(/\/\/\$Title\s+"?([^"\n]+)"?/i);
    const category = body.match(/\/\/\$Category\s+"?([^"\n]+)"?/i);
    const radius = plain.match(/(?:^|[\s;{])Radius\s+([\d.]+)/i);
    const height = plain.match(/(?:^|[\s;{])Height\s+([\d.]+)/i);
    const tag = plain.match(/(?:^|[\s;{])Tag\s+"([^"]*)"/i);
    const footprint = plain.match(/\.Footprint\s+([\d.]+)\s*,\s*([\d.]+)/i);
    const spawn = plain.match(/\bSpawn\s*:\s*(?:[A-Za-z_][\w.]*\s*:\s*)?"?([A-Za-z0-9_#\-\[\]\\]{4})"?\s+"?([A-Za-z\[\]\\#^]+)"?/);
    if (title) def.title = title[1].trim();
    if (category) def.edCategory = category[1].trim();
    if (radius) def.radius = Number(radius[1]);
    if (height) def.height = Number(height[1]);
    if (tag && tag[1]) def.tag = tag[1];
    if (footprint) def.footprint = [Number(footprint[1]), Number(footprint[2])];
    if (spawn) def.sprite = spawn[1].toUpperCase() === '####' ? null : spawn[1].toUpperCase() + spawn[2][0].toUpperCase();
}

// ZScript classes and DECORATE actors in every .zs / DECORATE / actor .txt file of the mod
function readClasses(modDir) {
    const classes = new Map();
    const numbered = new Map();
    const files = walkFiles(modDir).filter(file => {
        const rel = path.relative(modDir, file).split(path.sep).join('/').toLowerCase();
        if (rel.startsWith('maps/') || rel.startsWith('sprites/') || rel.startsWith('textures/') || rel.startsWith('sounds/')
            || rel.startsWith('music/') || rel.startsWith('models/') || rel.startsWith('voxels/') || rel.startsWith('graphics/')) return false;
        return /\.(zs|zsc|txt|dec)$/i.test(file) || /^decorate/i.test(path.basename(file));
    });
    for (const file of files) {
        const text = stripBlockComments(readText(file));
        const isZScript = /\.zsc?$/i.test(file);
        const header = isZScript
            ? /^\s*class\s+(\w+)\s*(?::\s*(\w+))?[^{;]*\{/gim
            : /^\s*actor\s+([^\s:{]+)\s*(?::\s*([^\s{]+))?\s*(?:replaces\s+[^\s{]+)?\s*(\d+)?[^{\n]*\{?/gim;
        for (const match of text.matchAll(header)) {
            const open = text.indexOf('{', match.index + match[0].length - 1);
            if (open < 0) continue;
            const close = matchingBrace(text, open);
            const name = match[1];
            const def = { className: name, parent: match[2] || null };
            readBody(def, text.slice(open, close + 1));
            if (!classes.has(name.toLowerCase())) classes.set(name.toLowerCase(), def);
            if (!isZScript && match[3]) numbered.set(Number(match[3]), name);
        }
    }
    return { classes, numbered };
}

function resolve(classes, name, field, depth = 0) {
    const def = classes.get(String(name).toLowerCase());
    if (!def || depth > 16) return undefined;
    if (def[field] !== undefined) return def[field];
    return def.parent ? resolve(classes, def.parent, field, depth + 1) : undefined;
}

function prettyName(className) {
    return className
        .replace(/^(NBC_|CWD_|CW_F|CW_K|CW_)/, '')
        .replace(/_/g, ' ')
        .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim();
}

function categoryFor(rules, className, type) {
    for (const rule of rules || []) {
        if (rule.classPrefix && rule.classPrefix.some(prefix => className.toLowerCase().startsWith(prefix.toLowerCase()))) return rule;
        if (rule.numberRange && type >= rule.numberRange[0] && type <= rule.numberRange[1]) return rule;
    }
    return null;
}

// The classes drawn as 3D models (MODELDEF "Model <class>") and the sprites drawn as voxels (voxels/<sprite><frame>):
// their sprite is a placeholder, so the editor shows a labelled marker instead.
function readModelsAndVoxels(modDir) {
    const models = new Set();
    for (const file of fs.readdirSync(modDir).filter(name => /^modeldef/i.test(name))) {
        const text = stripBlockComments(readText(path.join(modDir, file))).replace(/\/\/[^\n]*/g, '');
        for (const match of text.matchAll(/^\s*Model\s+"?([A-Za-z0-9_]+)"?\s*$/gim)) models.add(match[1].toLowerCase());
    }
    const voxels = new Set();
    for (const file of walkFiles(path.join(modDir, 'voxels'))) voxels.add(path.basename(file).replace(/\.[^.]*$/, '').toUpperCase().slice(0, 4));
    return { models, voxels };
}

// -> catalog entries in the editor's THING_CATALOG shape. hasSprite (optional): whether a 4-letter sprite can be
// drawn (the mod's or the IWAD's); things without one get no sprite, and the editor draws a marker.
function readModThings(modDir, { categories = [], defaultCategory = 'props', skipClasses = [], hasSprite = null } = {}) {
    if (!modDir || !fs.existsSync(modDir)) return [];
    const { models, voxels } = readModelsAndVoxels(modDir);
    const numbers = readDoomEdNums(modDir);
    const { classes, numbered } = readClasses(modDir);
    for (const [number, name] of numbered) if (!numbers.has(number)) numbers.set(number, name);
    const skip = new Set(skipClasses.map(name => name.toLowerCase()));
    const things = [];
    for (const [type, className] of [...numbers.entries()].sort((a, b) => a[0] - b[0])) {
        if (skip.has(className.toLowerCase())) continue;
        const rule = categoryFor(categories, className, type);
        if (rule && rule.skip) continue;
        const footprint = resolve(classes, className, 'footprint');
        const radius = footprint && Math.max(...footprint) > 0 ? Math.max(...footprint) / 2 : resolve(classes, className, 'radius');
        let sprite = resolve(classes, className, 'sprite');
        let look = 'sprite';
        if (models.has(className.toLowerCase())) look = 'model';
        else if (sprite && voxels.has(sprite.slice(0, 4))) look = 'voxel';
        if (look !== 'sprite' || (sprite && hasSprite && !hasSprite(sprite.slice(0, 4)))) sprite = null;
        const title = classes.get(className.toLowerCase())?.title;
        const tag = classes.get(className.toLowerCase())?.tag;
        things.push({
            type,
            name: title || tag || prettyName(className),
            className,
            category: rule ? rule.id : defaultCategory,
            sprite: sprite && !sprite.startsWith('TNT1') ? sprite.slice(0, 4) : '',
            spriteFrame: sprite || '',
            look,
            color: rule?.color || '#a3a3a3',
            radius: Math.round(radius || 16),
            height: Math.round(resolve(classes, className, 'height') || 16),
            source: 'mod'
        });
    }
    return things;
}

module.exports = { readModThings, readDoomEdNums, readClasses };
