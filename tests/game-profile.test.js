const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { encodePNG } = require('../src/wad-reader');
const { loadProfile, applyProfile, createResources, describeProfile } = require('../src/game-profile');
const { readModThings } = require('../src/mod-things');
const { MATERIAL_THEMES, DEFAULTS, compileProject } = require('../src/udmf-compiler');
const { THING_CATALOG, STARTER_MAPS } = require('../src/starter-maps');
const { validateProject, clone } = require('../src/project-session');
const { createProjectStorage } = require('../src/project-storage');
const { makeProjectPipeline } = require('../src/project-pipeline');

const ROOT = path.resolve(__dirname, '..');

// A tiny mod folder: a wall texture, a sprite, a map thing with its class.
function makeMiniMod() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'idoom-minimod-'));
    const png = encodePNG(64, 128, Buffer.alloc(64 * 128 * 4, 200));
    fs.mkdirSync(path.join(dir, 'textures', 'nbc'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'textures', 'nbc', 'TESTWALL.png'), png);
    fs.mkdirSync(path.join(dir, 'sprites'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'sprites', 'TSTPA0.png'), encodePNG(16, 16, Buffer.alloc(16 * 16 * 4, 255)));
    fs.mkdirSync(path.join(dir, 'maps'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'MAPINFO.txt'), 'include "mapinfo/props.txt"\n');
    fs.mkdirSync(path.join(dir, 'mapinfo'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'mapinfo', 'props.txt'), 'DoomEdNums\n{\n\t26999 = NBC_TestProp\n\t26998 = CW_FTestDesk\n}\n');
    fs.writeFileSync(path.join(dir, 'ZSCRIPT.zs'), [
        'version "4.10"',
        'class NBC_TestProp : Actor { Default { Radius 12; Height 40; Tag "Test prop"; } States { Spawn: TSTP A -1; Stop; } }',
        'class CW_FBase : Actor { Default { Radius 8; Height 32; } States { Spawn: CWMD A -1; Stop; } }',
        'class CW_FTestDesk : CW_FBase { Default { Height 31; CW_Furniture.Footprint 30, 60; } }'
    ].join('\n'));
    return dir;
}

test('the New Bricks City profile loads a mod folder: textures, sprites, things, themes and defaults', t => {
    const modDir = makeMiniMod();
    t.after(() => fs.rmSync(modDir, { recursive: true, force: true }));
    const profile = loadProfile({ rootDir: ROOT, env: { IDOOM_PROFILE: 'new-bricks-city', IDOOM_MOD_DIR: modDir } });
    assert.equal(profile.modDir, modDir);

    const resources = createResources(profile);
    assert.ok(resources.getTexturePNG('TESTWALL'), 'the mod texture is served');
    assert.ok(resources.getFlatPNG('testwall'), 'any mod texture also works as a flat');
    assert.ok(resources.getTexturePNG('STARTAN2'), 'the IWAD is still under the mod');
    assert.ok(resources.getSpritePNG('TSTP'), 'mod sprites are found by their 4-letter name');
    const catalog = resources.getCatalog();
    assert.equal(catalog.groups.TESTWALL, 'nbc');
    assert.equal(catalog.groups.STARTAN2, 'freedoom');
    assert.ok(catalog.flats.includes('TESTWALL'));

    const things = readModThings(modDir, { categories: profile.thingCategories });
    const prop = things.find(thing => thing.type === 26999);
    assert.deepEqual([prop.name, prop.radius, prop.height, prop.sprite, prop.category], ['Test prop', 12, 40, 'TSTP', 'bricks']);
    const desk = things.find(thing => thing.type === 26998);
    assert.deepEqual([desk.radius, desk.height, desk.category], [30, 31, 'furniture'], 'footprint, inherited and own values');

    const applied = applyProfile(profile, resources);
    assert.ok(MATERIAL_THEMES.nbc_tenement, 'the profile themes are added');
    assert.equal(DEFAULTS.theme, 'nbc_tenement');
    assert.ok(STARTER_MAPS.nbc_block);
    assert.ok(THING_CATALOG.some(thing => thing.type === 26999));
    assert.ok(THING_CATALOG.some(thing => thing.type === 3001 && thing.category === 'doom'), 'Doom things stay valid, set aside');
    assert.ok(applied.warnings.length > 0, 'the mini mod lacks the real textures, and the profile says so');
    assert.equal(describeProfile(profile, catalog).modLoaded, true);

    const project = clone(STARTER_MAPS.nbc_block);
    project.things.push({ id: 'prop', type: 26999, x: 0, y: 160, angle: 0 });
    assert.deepEqual(validateProject(clone(project), {}), []);
});

test('a profile map exports as its own lump into the mod, without a ZMAPINFO', t => {
    const modDir = makeMiniMod();
    const mapsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idoom-profile-maps-'));
    t.after(() => {
        fs.rmSync(modDir, { recursive: true, force: true });
        fs.rmSync(mapsDir, { recursive: true, force: true });
    });
    const profile = loadProfile({ rootDir: ROOT, env: { IDOOM_PROFILE: 'new-bricks-city', IDOOM_MOD_DIR: modDir } });
    const resources = createResources(profile);
    applyProfile(profile, resources);

    const project = clone(STARTER_MAPS.nbc_block);
    project.mapLump = 'NBC_TS01';
    const compiled = compileProject(project);
    assert.equal(compiled.mapLump, 'NBC_TS01');
    assert.match(compiled.mapinfo, /^map NBC_TS01 "/);

    const pipeline = makeProjectPipeline({ storage: createProjectStorage({ mapsDir }), mapsDir, wadPath: path.join(mapsDir, 'live.wad'), profile });
    const exported = pipeline.exportWad(project, 'test_block');
    assert.equal(exported.modPath, path.join(modDir, 'maps', 'NBC_TS01.wad'));
    const wad = fs.readFileSync(exported.modPath);
    const lumpCount = wad.readInt32LE(4);
    const dir = wad.readInt32LE(8);
    const names = [];
    for (let i = 0; i < lumpCount; i++) names.push(wad.toString('ascii', dir + i * 16 + 8, dir + i * 16 + 16).replace(/\0.*$/, ''));
    assert.deepEqual(names, ['NBC_TS01', 'TEXTMAP', 'ENDMAP']);
    assert.match(exported.mapinfo, /sky1 = "NBCSKYDK"/);

    // a lump outside the profile's pattern stays in maps/ only
    project.mapLump = 'MAP01';
    assert.equal(pipeline.exportWad(project, 'plain').modPath, undefined);
});

test('the profile skies build a 3D skybox city, and things keep a height above the floor', t => {
    const modDir = makeMiniMod();
    t.after(() => fs.rmSync(modDir, { recursive: true, force: true }));
    const profile = loadProfile({ rootDir: ROOT, env: { IDOOM_PROFILE: 'new-bricks-city', IDOOM_MOD_DIR: modDir } });
    applyProfile(profile, createResources(profile));
    const project = clone(STARTER_MAPS.nbc_block);
    project.skybox = 'nbc_dusk';
    project.things.push({ id: 'decor', type: 26999, x: 0, y: -8, angle: 270, z: 160 });
    const compiled = compileProject(project);
    const flat = compileProject({ ...clone(project), skybox: 'sky1' });
    const towers = compiled.stats.sectors - flat.stats.sectors - 1;
    assert.ok(towers >= 30, `rings of towers (${towers})`);
    const heights = [...compiled.textmap.matchAll(/heightfloor = (\d+)/g)].map(m => Number(m[1]));
    assert.ok(heights.some(h => h > 560), 'the far ring stands tall');
    assert.match(compiled.textmap, /type = 9080;/, 'a SkyViewpoint');
    assert.match(compiled.textmap, /height = 160\.0;/, 'the thing keeps its height');
    // the same name gives the same skyline
    assert.equal(compileProject(project).stats.sectors, compiled.stats.sectors);
});

