const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { clone, validateProject, createProjectSession } = require('../src/project-session');
const { makeAgentApi } = require('../src/agent-api');
const { STARTER_MAPS, THING_CATALOG } = require('../src/starter-maps');
const { MATERIAL_THEMES, SKYBOX_PRESETS, compileProject, buildUdmfWadBuffer } = require('../src/udmf-compiler');
const { DOOR_LOCKS, getDoorKeyWarnings } = require('../src/door-keys');

const KEY_TYPES = new Map([[1, 13], [2, 5], [3, 6]]);

function twoRoomDoorProject(lock = 1) {
    return {
        id: 'door-key-test',
        name: 'Door Key Test',
        skybox: 'sky1',
        rooms: [
            { id: 'west', name: 'West Room', shape: 'rect', x: 0, y: 0, width: 256, height: 256, floorHeight: 0, ceilingHeight: 128, theme: 'techbase' },
            { id: 'east', name: 'East Room', shape: 'rect', x: 256, y: 0, width: 256, height: 256, floorHeight: 0, ceilingHeight: 128, theme: 'techbase' }
        ],
        smartObjects: [
            { id: 'locked_door', name: 'Locked Door', type: 'door', x: 240, y: 96, width: 32, height: 64, theme: 'techbase', lock },
            { id: 'door_switch', name: 'Door Switch', type: 'switch', x: 64, y: 64, width: 32, height: 32, theme: 'techbase' }
        ],
        things: [{ id: 'start', type: 1, x: 96, y: 96, angle: 0 }],
        links: [{ sourceId: 'door_switch', targetId: 'locked_door', action: 'door' }]
    };
}

test('door locks retain the established red, blue, and yellow keycard type mapping', () => {
    assert.deepEqual(DOOR_LOCKS.map(lock => lock.value), [0, 1, 2, 3]);
    for (const [lock, type] of KEY_TYPES) {
        const project = twoRoomDoorProject(lock);
        project.things.push({ id: `key_${lock}`, type, x: 32, y: 32, angle: 0 });
        assert.deepEqual(validateProject(clone(project)), []);
        const compiled = compileProject(project);
        const doorLines = compiled.linedefs.filter(line => line.front.texturetop === 'BIGDOOR2' && line.special === 13);
        assert.ok(doorLines.length >= 1, `lock ${lock} compiles a locked door action`);
        assert.ok(doorLines.every(line => line.arg3 === lock), `lock ${lock} is encoded as Door_LockedRaise lock ${lock}`);

        const pickup = compiled.things.find(thing => thing.type === type);
        assert.ok(pickup, `Doom thing type ${type} is exported for lock ${lock}`);
        assert.match(compiled.textmap, new RegExp(`type = ${type};`));
    }
});

test('linked switches honor target door keycards instead of issuing an unlocked door action', () => {
    for (const lock of [1, 2, 3]) {
        const project = twoRoomDoorProject(lock);
        project.smartObjects[0].remoteOnly = true;
        const compiled = compileProject(project);
        const keyLockedSwitchLines = compiled.linedefs.filter(line => line.special === 13 && line.arg0 > 0 && line.arg3 === lock);
        assert.ok(keyLockedSwitchLines.length > 0, `linked switch enforces key lock ${lock}`);
        assert.ok(!compiled.linedefs.some(line => line.special === 12 && line.arg0 > 0), 'linked locked target is not opened by an unlocked raise action');
    }
});

test('unlocked doors and remote-only doors preserve their previous trigger behavior', () => {
    const unlocked = compileProject(twoRoomDoorProject(0));
    assert.ok(unlocked.linedefs.some(line => line.special === 12));
    assert.ok(!unlocked.linedefs.some(line => line.special === 13));

    const remote = twoRoomDoorProject(2);
    remote.smartObjects[0].remoteOnly = true;
    remote.links = [];
    const compiledRemote = compileProject(remote);
    const panelFaces = compiledRemote.linedefs.filter(line => line.front.texturetop === 'BIGDOOR2');
    assert.ok(panelFaces.length > 0);
    assert.ok(panelFaces.every(line => line.special === 0));
});

test('project validation rejects unknown lock ids while missing-key diagnostics remain non-blocking', () => {
    const project = twoRoomDoorProject(2);
    const warnings = getDoorKeyWarnings(project);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0].message, /Blue Keycard/);
    assert.deepEqual(validateProject(clone(project)), []);

    project.things.push({ id: 'blue_key', type: 5, x: 32, y: 32, angle: 0 });
    assert.deepEqual(getDoorKeyWarnings(project), []);
    project.smartObjects[0].lock = 4;
    assert.ok(validateProject(clone(project)).some(error => error.includes('lock must be 0')));
});

test('MCP API reports missing keycards and preserves door/keycard edits through save, load, and WAD export', async t => {
    const mapsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idoom-key-test-'));
    t.after(() => fs.rmSync(mapsDir, { recursive: true, force: true }));
    const session = createProjectSession(clone(STARTER_MAPS.blank_studio));
    const api = makeAgentApi({
        session,
        starterMaps: STARTER_MAPS,
        themes: MATERIAL_THEMES,
        skyboxes: SKYBOX_PRESETS,
        things: THING_CATALOG,
        mapsDir,
        wadPath: path.join(mapsDir, 'live_playtest.wad')
    });

    let revision = session.snapshot().revision;
    let result = await api.execute('batch_edit', {
        revision,
        operations: [
            { type: 'add', collection: 'smartObject', object: { id: 'red_locked_door', name: 'Red Access Door', type: 'door', x: 80, y: 16, width: 32, height: 128, theme: 'techbase', lock: 1 } }
        ]
    });
    revision = result.revision;
    let validation = await api.execute('project_validate', { revision });
    assert.equal(validation.valid, true);
    assert.equal(validation.warnings.length, 1);
    assert.equal(validation.warnings[0].keyType, 13);

    result = await api.execute('object_add', {
        revision,
        collection: 'thing',
        object: { id: 'red_keycard', type: 13, x: 32, y: 64, angle: 0 }
    });
    revision = result.revision;
    validation = await api.execute('project_validate', { revision });
    assert.deepEqual(validation.warnings, []);

    result = await api.execute('project_undo', { revision });
    revision = result.revision;
    assert.equal(result.project.things.some(thing => thing.id === 'red_keycard'), false);
    assert.equal((await api.execute('project_validate', { revision })).warnings.length, 1);
    result = await api.execute('project_redo', { revision });
    revision = result.revision;
    assert.equal(result.project.things.some(thing => thing.id === 'red_keycard'), true);

    await assert.rejects(api.execute('object_update', {
        revision,
        id: 'red_locked_door',
        patch: { lock: 99 }
    }), error => error.statusCode === 400 && /lock must be 0/.test(error.message));

    await api.execute('project_save', { revision, name: 'keycard_mcp_roundtrip' });
    result = await api.execute('project_load', { revision, name: 'keycard_mcp_roundtrip' });
    revision = result.revision;
    assert.equal(result.project.smartObjects.find(object => object.id === 'red_locked_door').lock, 1);
    assert.equal(result.project.things.find(thing => thing.id === 'red_keycard').type, 13);
    await api.execute('project_export', { revision, name: 'keycard_mcp_roundtrip' });
    const wad = fs.readFileSync(path.join(mapsDir, 'keycard_mcp_roundtrip.wad'));
    assert.equal(wad.toString('ascii', 0, 4), 'PWAD');
    assert.deepEqual(validateProject(clone(STARTER_MAPS.blank_studio)), []);
});
