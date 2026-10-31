const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createProjectSession, clone } = require('../src/project-session');
const { makeAgentApi } = require('../src/agent-api');
const { STARTER_MAPS, THING_CATALOG } = require('../src/starter-maps');
const { MATERIAL_THEMES, SKYBOX_PRESETS } = require('../src/udmf-compiler');

test('agent actions create, edit, validate, save, export, and load maps using revision checks', async t => {
    const mapsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idoom-agent-test-'));
    t.after(() => fs.rmSync(mapsDir, { recursive: true, force: true }));
    const session = createProjectSession(clone(STARTER_MAPS.blank_studio));
    let playtestLaunches = 0;
    const api = makeAgentApi({
        session,
        starterMaps: STARTER_MAPS,
        themes: MATERIAL_THEMES,
        skyboxes: SKYBOX_PRESETS,
        things: THING_CATALOG,
        mapsDir,
        wadPath: path.join(mapsDir, 'live_playtest.wad'),
        launchPlaytest: async () => { playtestLaunches += 1; }
    });

    let result = await api.execute('project_create', { revision: 0, template: 'blank_studio', name: 'Agent Map' });
    assert.equal(result.revision, 1);
    await assert.rejects(api.execute('batch_edit', {
        revision: result.revision,
        operations: [
            { type: 'add', collection: 'thing', object: { id: 'temporary_thing', type: 3001, x: 16, y: 16 } },
            { type: 'add', collection: 'thing', object: { id: 'invalid_thing', type: -1, x: 16, y: 16 } }
        ]
    }), error => error.statusCode === 400);
    assert.equal(session.snapshot().revision, 1);
    assert.equal(session.snapshot().project.things.some(thing => thing.id === 'temporary_thing'), false);

    result = await api.execute('object_add', {
        revision: result.revision,
        collection: 'thing',
        object: { type: 1, x: 32, y: 32, angle: 90 }
    });
    assert.equal(result.revision, 2);
    const thingId = result.createdId;

    await assert.rejects(api.execute('object_update', {
        revision: 1,
        id: thingId,
        patch: { x: 64 }
    }), error => error.statusCode === 409);

    const validation = await api.execute('project_validate', { revision: result.revision });
    assert.equal(validation.valid, true);
    result = await api.execute('project_save', { revision: result.revision, name: 'Agent Map' });
    assert.equal(fs.existsSync(path.join(mapsDir, 'agent_map.json')), true);
    assert.equal(fs.existsSync(path.join(mapsDir, 'agent_map.wad')), true);
    const loaded = await api.execute('project_load', { revision: result.revision, name: 'agent_map' });
    assert.equal(loaded.project.name, 'Agent Map');
    const exported = await api.execute('project_export', { revision: loaded.revision, name: '../../outside' });
    assert.equal(exported.wadPath, 'maps/______outside.wad');
    const playtest = await api.execute('map_playtest', { revision: loaded.revision });
    assert.equal(playtest.launched, true);
    assert.equal(playtestLaunches, 1);
});

test('unfinished structurally valid drafts can be named and saved but cannot be exported as playable WADs', async t => {
    const mapsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idoom-draft-save-test-'));
    t.after(() => fs.rmSync(mapsDir, { recursive: true, force: true }));
    const draft = clone(STARTER_MAPS.blank_studio);
    draft.name = 'Unfinished Draft';
    draft.rooms = [];
    const session = createProjectSession(draft);
    const api = makeAgentApi({
        session,
        starterMaps: STARTER_MAPS,
        themes: MATERIAL_THEMES,
        skyboxes: SKYBOX_PRESETS,
        things: THING_CATALOG,
        mapsDir,
        wadPath: path.join(mapsDir, 'live_playtest.wad')
    });
    const saved = await api.execute('project_save', { revision: 0, name: 'unfinished_draft' });
    assert.equal(saved.ok, true);
    assert.equal(saved.wadPath, null);
    assert.equal(fs.existsSync(path.join(mapsDir, 'unfinished_draft.json')), true);
    await assert.rejects(api.execute('project_export', { revision: 0, name: 'unfinished_draft' }), error => error.statusCode === 400);
});
