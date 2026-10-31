const fs = require('fs');
const path = require('path');
const { MATERIAL_THEMES, SKYBOX_PRESETS, DEFAULTS } = require('./udmf-compiler');
const { THING_CATALOG, STARTER_MAPS } = require('./starter-maps');
const { ResourceStack } = require('./mod-resources');
const { readModThings } = require('./mod-things');

// A game profile points the editor at a mod: where the mod folder is, its material themes and skies, its map
// things (read from the mod itself), how its maps are named, exported and playtested. The default profile is
// New Bricks City (profiles/new-bricks-city.json); IDOOM_PROFILE=freedoom gives the plain Freedoom editor.
//
// Where the mod is, first match wins: the IDOOM_MOD_DIR environment variable, "modDir" in studio.config.json
// (next to server.js, not in git), then the profile's modDirCandidates (relative to the editor's folder).

const ROOT_DIR = path.resolve(__dirname, '..');
const PROFILES_DIR = path.join(ROOT_DIR, 'profiles');

function readLocalConfig(rootDir = ROOT_DIR) {
    const file = path.join(rootDir, 'studio.config.json');
    if (!fs.existsSync(file)) return {};
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) {
        console.error(`[iDoom Studio] studio.config.json is not valid JSON: ${error.message}`);
        return {};
    }
}

function freedoomProfile() {
    return { id: 'freedoom', name: 'Freedoom', description: 'The plain Freedoom 2 editor, no mod.', themes: {}, skyboxes: {}, starterMaps: {}, map: {} };
}

function loadProfile({ rootDir = ROOT_DIR, env = process.env } = {}) {
    const config = readLocalConfig(rootDir);
    const id = env.IDOOM_PROFILE || config.profile || 'new-bricks-city';
    let profile;
    if (id === 'freedoom') profile = freedoomProfile();
    else {
        const file = path.join(PROFILES_DIR, `${path.basename(id)}.json`);
        if (!fs.existsSync(file)) throw new Error(`Unknown game profile "${id}" (no ${path.relative(rootDir, file)}).`);
        profile = JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    const candidates = [env.IDOOM_MOD_DIR, config.modDir, ...(profile.modDirCandidates || [])].filter(Boolean);
    profile.modDir = null;
    for (const candidate of candidates) {
        const full = path.resolve(rootDir, candidate);
        if (fs.existsSync(full) && fs.statSync(full).isDirectory()) { profile.modDir = full; break; }
    }
    profile.modDirSearched = candidates.map(candidate => path.resolve(rootDir, candidate));
    profile.iwadPath = path.resolve(rootDir, env.IDOOM_IWAD || config.iwad || profile.iwad || 'freedoom-0.13.0/freedoom2.wad');
    profile.enginePath = env.IDOOM_ENGINE || config.engine || null;
    return profile;
}

// the texture group a mod file belongs to, by its path inside the mod (profile.textureGroups)
function makeGroupOf(profile) {
    const groups = (profile.textureGroups || []).filter(group => group.pathPrefix);
    return rel => {
        const lower = rel.toLowerCase();
        const group = groups.find(item => lower.startsWith(item.pathPrefix.toLowerCase()));
        return group ? group.id : 'mod';
    };
}

function createResources(profile) {
    const iwadGroup = (profile.textureGroups || []).find(group => group.iwad)?.id || 'freedoom';
    return new ResourceStack({ iwadPath: profile.iwadPath, modDir: profile.modDir, groupOf: makeGroupOf(profile), iwadGroup });
}

// Adds the profile's themes, skies, starter maps and things to the editor's shared tables (they're module-level
// objects every other module reads), sets the defaults, and checks the profile's materials exist.
function applyProfile(profile, resources) {
    const warnings = [];
    for (const [id, theme] of Object.entries(profile.themes || {})) {
        MATERIAL_THEMES[id] = { id, ...theme, source: 'profile' };
        if (resources) {
            for (const field of ['wall', 'trim', 'door', 'track', 'step', 'support', 'floor', 'ceiling']) {
                const name = theme[field];
                if (name && name !== 'F_SKY1' && !resources.hasMaterial(name)) warnings.push(`theme ${id}.${field}: no texture or flat "${name}"`);
            }
        }
    }
    for (const [id, sky] of Object.entries(profile.skyboxes || {})) SKYBOX_PRESETS[id] = { id, ...sky, source: 'profile' };
    for (const [id, map] of Object.entries(profile.starterMaps || {})) STARTER_MAPS[id] = { id, schemaVersion: 1, ...map, source: 'profile' };

    const defaults = profile.defaults || {};
    if (defaults.theme && MATERIAL_THEMES[defaults.theme]) DEFAULTS.theme = defaults.theme;
    if (defaults.skybox && SKYBOX_PRESETS[defaults.skybox]) DEFAULTS.skybox = defaults.skybox;
    if (defaults.mapLump) DEFAULTS.mapLump = defaults.mapLump;
    if (Number.isFinite(defaults.roomCeiling)) DEFAULTS.roomCeiling = defaults.roomCeiling;
    if (Number.isFinite(defaults.roomLight)) DEFAULTS.roomLight = defaults.roomLight;
    if (defaults.encounter) DEFAULTS.encounter = { ...defaults.encounter };
    if (Number.isFinite(defaults.wingCeiling)) DEFAULTS.wingCeiling = defaults.wingCeiling;
    if (Number.isFinite(profile.scale?.doorWidth)) DEFAULTS.minDoorWidth = profile.scale.doorWidth;

    // the base Doom things the profile keeps up front (renamed for the mod); the rest stay valid, so maps made
    // before stay loadable, but move to the profile's "other" category (baseThings.otherCategory), then the mod's own
    const base = profile.baseThings;
    if (base?.keep) {
        const keep = new Set(base.keep);
        const kept = THING_CATALOG.filter(thing => keep.has(thing.type)).map(thing => ({ ...thing, ...(base.rename?.[thing.type] || {}) }));
        const others = THING_CATALOG.filter(thing => !keep.has(thing.type)).map(thing => ({ ...thing, category: base.otherCategory || thing.category }));
        THING_CATALOG.splice(0, THING_CATALOG.length, ...kept, ...others);
    }
    let modThings = [];
    if (profile.modDir) {
        const known = new Set(THING_CATALOG.map(thing => thing.type));
        const hasSprite = resources ? prefix => Boolean(resources.getSpritePNG(prefix)) : null;
        modThings = readModThings(profile.modDir, { categories: profile.thingCategories || [], hasSprite }).filter(thing => !known.has(thing.type));
        THING_CATALOG.push(...modThings);
    }
    return { warnings, modThings: modThings.length };
}

// The profile as the browser and agents see it (no absolute paths beyond the mod folder's)
function describeProfile(profile, resourceCatalog) {
    return {
        id: profile.id,
        name: profile.name,
        description: profile.description || '',
        modDir: profile.modDir,
        modLoaded: Boolean(profile.modDir && resourceCatalog?.modLoaded),
        defaults: { ...DEFAULTS },
        scale: profile.scale || null,
        heightPresets: Array.isArray(profile.heightPresets) ? profile.heightPresets : null,
        map: profile.map || {},
        textureGroups: (profile.textureGroups || []).map(({ id, label }) => ({ id, label })),
        thingCategories: (profile.thingCategories || []).filter(category => !category.skip).map(({ id, label }) => ({ id, label })),
        // the base game's things the profile set aside: valid in maps, left out of the palette's "All"
        otherThingCategory: profile.baseThings?.otherCategory || null
    };
}

module.exports = { loadProfile, applyProfile, createResources, describeProfile, readLocalConfig };
