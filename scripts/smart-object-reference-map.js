#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { compileProject, buildUdmfWadBuffer } = require('../src/udmf-compiler');
const { validateProject, VALID_OBJECT_TYPES } = require('../src/project-session');
const { writeAtomically } = require('../src/project-storage');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_NAME = 'smart_object_reference_test';

function makeObject(id, type, x, y, width, height, extra = {}) {
    return { id, name: id.replaceAll('_', ' '), type, x, y, width, height, theme: 'techbase', ...extra };
}

function createReferenceProject() {
    return {
        id: OUTPUT_NAME,
        name: 'Smart Object Reference Test',
        skybox: 'sky1',
        rooms: [{
            id: 'reference_room', name: 'All Smart Object Test Bay', shape: 'rect',
            x: -1792, y: -640, width: 3584, height: 1280,
            floorHeight: 0, ceilingHeight: 192, lightLevel: 184, theme: 'techbase',
            floorTexture: 'FLOOR4_8', ceilingTexture: 'CEIL3_5', wallTexture: 'STARTAN2'
        }],
        smartObjects: [
            makeObject('reference_red_door', 'door', -1536, -64, 32, 128, { lock: 1, remoteOnly: true, wallTexture: 'BIGDOOR2' }),
            makeObject('reference_blue_door', 'door', -1184, -64, 32, 128, { lock: 2, wallTexture: 'BIGDOOR2' }),
            makeObject('reference_yellow_door', 'door', -832, -64, 32, 128, { lock: 3, wallTexture: 'BIGDOOR2' }),
            makeObject('reference_window', 'window', -512, -96, 192, 32, { floorHeight: 48, ceilingHeight: 128 }),
            makeObject('reference_stairs', 'stairs', -192, -128, 160, 160, { steps: 5, direction: 'E', startFloor: 0, endFloor: 64 }),
            makeObject('reference_lift', 'lift', 128, -128, 96, 96, { lowFloor: 0, floorHeight: 64 }),
            makeObject('reference_pillar', 'pillar', 416, -96, 64, 64, { solid: true, wallTexture: 'SHAWN2' }),
            makeObject('reference_pool', 'pool', 704, -128, 160, 160, { hazard: 'nukage' }),
            makeObject('reference_3dfloor', '3dfloor', 1056, -64, 192, 128, { style: 'solid', topZ: 72, thickness: 8, topTexture: 'STEP2' }),
            makeObject('reference_teleporter', 'teleporter', 1376, -128, 128, 128),
            makeObject('reference_exit', 'exit', -1280, 256, 64, 64),
            makeObject('reference_switch', 'switch', -1088, 256, 48, 48)
        ],
        links: [{ sourceId: 'reference_switch', targetId: 'reference_red_door', action: 'door' }],
        things: [
            { id: 'reference_player_start', type: 1, x: -1600, y: 480, angle: 0 },
            { id: 'reference_red_keycard', type: 13, x: -1472, y: 480, angle: 0 },
            { id: 'reference_blue_keycard', type: 5, x: -1120, y: 480, angle: 0 },
            { id: 'reference_yellow_keycard', type: 6, x: -768, y: 480, angle: 0 }
        ]
    };
}

function compileReferenceProject(project = createReferenceProject()) {
    const errors = validateProject(JSON.parse(JSON.stringify(project)));
    if (errors.length) throw new Error(`Reference project is invalid: ${errors.join(' ')}`);
    const compiled = compileProject(project);
    const types = new Set(project.smartObjects.map(object => object.type));
    const missingTypes = [...VALID_OBJECT_TYPES].filter(type => !types.has(type));
    if (missingTypes.length) throw new Error(`Reference project is missing smart objects: ${missingTypes.join(', ')}.`);
    for (const lock of [1, 2, 3]) {
        if (!compiled.linedefs.some(line => line.special === 13 && line.arg3 === lock)) {
            throw new Error(`Reference project is missing the compiled locked-door action for key value ${lock}.`);
        }
    }
    if (!compiled.linedefs.some(line => line.special === 13 && line.arg0 > 0 && line.arg3 === 1)) {
        throw new Error('The linked switch does not retain the red locked-door action.');
    }
    return { project, compiled, wad: buildUdmfWadBuffer(compiled.textmap, 'MAP01', compiled.zmapinfo) };
}

if (require.main === module) {
    const mapsDir = process.env.IDOOM_MAPS_DIR ? path.resolve(process.env.IDOOM_MAPS_DIR) : path.join(ROOT, 'maps');
    const { project, compiled, wad } = compileReferenceProject();
    fs.mkdirSync(mapsDir, { recursive: true });
    writeAtomically(path.join(mapsDir, `${OUTPUT_NAME}.json`), `${JSON.stringify(project, null, 2)}\n`);
    writeAtomically(path.join(mapsDir, `${OUTPUT_NAME}.wad`), wad);
    console.log(JSON.stringify({
        project: `maps/${OUTPUT_NAME}.json`,
        wad: `maps/${OUTPUT_NAME}.wad`,
        smartObjectTypes: [...new Set(project.smartObjects.map(object => object.type))],
        keycardLocks: [1, 2, 3],
        linkedLockedSwitch: true,
        stats: compiled.stats
    }, null, 2));
}

module.exports = { createReferenceProject, compileReferenceProject, OUTPUT_NAME };
