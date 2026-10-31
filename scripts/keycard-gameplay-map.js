#!/usr/bin/env node

// Generates a separate, disposable-style linear test map. The normal urban project is untouched.
const fs = require('fs');
const path = require('path');
const { compileProject, buildUdmfWadBuffer } = require('../src/udmf-compiler');
const { validateProject } = require('../src/project-session');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_NAME = 'keycard_gameplay_test';

function room(id, name, x) {
    return {
        id, name, shape: 'rect', x, y: 0, width: 256, height: 256,
        floorHeight: 0, ceilingHeight: 128, lightLevel: 176, theme: 'techbase',
        floorTexture: 'FLOOR4_8', ceilingTexture: 'CEIL3_5', wallTexture: 'STARTAN2'
    };
}

function door(id, name, x, lock, remoteOnly = false) {
    return {
        id, name, type: 'door', x, y: 96, width: 32, height: 64,
        theme: 'techbase', wallTexture: 'BIGDOOR2', trackTexture: 'DOORTRAK',
        lock, speed: 16, wait: 150, ...(remoteOnly ? { remoteOnly: true } : {})
    };
}

const project = {
    id: 'keycard_gameplay_test',
    name: 'Keycard Gameplay Test — Red / Blue / Yellow',
    skybox: 'sky1',
    rooms: [
        room('start_room', 'Start — try red door, then collect the red keycard', 0),
        room('red_room_one', 'Red Lock One', 256),
        room('red_room_two', 'Red Lock Reuse Test', 512),
        room('blue_room', 'Collect blue keycard, then test blue lock', 768),
        room('yellow_room', 'Yellow Lock Test', 1024)
    ],
    smartObjects: [
        door('red_door_one', 'Red Keycard Door — Missing / Wrong Key Test', 240, 1),
        door('red_door_two', 'Second Red Keycard Door — Reuse Test', 496, 1),
        door('blue_door', 'Blue Keycard Door — Wrong Key Test', 752, 2),
        door('yellow_door', 'Yellow Keycard Door — Wrong Key Test', 1008, 3),
        {
            id: 'yellow_remote_door', name: 'Yellow Remote Door — Switch Lock Test',
            type: 'door', x: 1104, y: 176, width: 32, height: 64,
            theme: 'techbase', wallTexture: 'BIGDOOR2', trackTexture: 'DOORTRAK',
            lock: 3, remoteOnly: true, speed: 16, wait: 150
        },
        { id: 'yellow_remote_switch', name: 'Yellow Remote Door Switch', type: 'switch', x: 1168, y: 64, width: 32, height: 32, theme: 'techbase' }
    ],
    things: [
        { id: 'test_player_start', type: 1, x: 32, y: 128, angle: 0 },
        { id: 'test_red_card', type: 13, x: 64, y: 208, angle: 0 },
        { id: 'test_blue_card', type: 5, x: 640, y: 208, angle: 0 },
        { id: 'test_yellow_card', type: 6, x: 896, y: 208, angle: 0 }
    ],
    links: [{ sourceId: 'yellow_remote_switch', targetId: 'yellow_remote_door', action: 'door' }]
};

const errors = validateProject(JSON.parse(JSON.stringify(project)));
if (errors.length) throw new Error(`Gameplay map is invalid: ${errors.join(' ')}`);

const compiled = compileProject(project);
const expected = [
    ['red_door_one', 1], ['red_door_two', 1], ['blue_door', 2],
    ['yellow_door', 3], ['yellow_remote_door', 3]
];
for (const [id, lock] of expected) {
    if (!compiled.linedefs.some(line => line.special === 13 && line.arg3 === lock)) {
        throw new Error(`The exported geometry does not contain a Door_LockedRaise for ${id}.`);
    }
}
if (!compiled.linedefs.some(line => line.special === 13 && line.arg0 > 0 && line.arg3 === 3)) {
    throw new Error('The linked yellow door switch does not carry the target door lock.');
}

const mapsDir = path.join(ROOT, 'maps');
fs.mkdirSync(mapsDir, { recursive: true });
const jsonPath = path.join(mapsDir, `${OUTPUT_NAME}.json`);
const wadPath = path.join(mapsDir, `${OUTPUT_NAME}.wad`);
fs.writeFileSync(jsonPath, `${JSON.stringify(project, null, 2)}\n`);
fs.writeFileSync(wadPath, buildUdmfWadBuffer(compiled.textmap, 'MAP01', compiled.zmapinfo));

console.log(JSON.stringify({
    project: `maps/${OUTPUT_NAME}.json`,
    wad: `maps/${OUTPUT_NAME}.wad`,
    rooms: project.rooms.length,
    lockedDoors: expected.map(([id, lock]) => ({ id, lock })),
    keycardThings: project.things.filter(thing => [13, 5, 6].includes(thing.type)).map(thing => ({ id: thing.id, type: thing.type })),
    linkedLockedSwitch: true,
    stats: compiled.stats
}, null, 2));
