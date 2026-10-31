const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeMap, validatePlayableProject } = require('../src/map-check');
const { clone } = require('../src/project-session');
const { STARTER_MAPS } = require('../src/starter-maps');

test('Map Check returns structured findings for starts, exits, actors, doors, and uncertain progression', () => {
    const project = clone(STARTER_MAPS.blank_studio);
    project.things = [
        { id: 'stray_imp', type: 3001, x: 900, y: 900 },
        { id: 'wall_imp', type: 3001, x: -188, y: 0 }
    ];
    project.smartObjects = [{ id: 'red_door', type: 'door', name: 'Red Door', x: 700, y: 700, width: 32, height: 64, lock: 1 }];
    const result = analyzeMap(project);
    const byCode = new Map(result.diagnostics.map(finding => [finding.code, finding]));
    assert.equal(byCode.get('PLAYER_START_MISSING').severity, 'warning');
    assert.equal(byCode.get('EXIT_NOT_DEFINED').severity, 'info');
    assert.deepEqual(byCode.get('THING_OUTSIDE_ROOM').affectedIds, ['stray_imp']);
    assert.ok(byCode.has('THING_CLEARANCE_NEAR_WALL'));
    assert.ok(byCode.has('DOOR_NOT_BETWEEN_ROOMS'));
    assert.ok(byCode.has('LOCKED_DOOR_KEY_MISSING'));
    assert.ok(byCode.has('KEY_PROGRESSION_UNPROVEN'));
    assert.equal(result.valid, true, 'non-fatal playability guidance must not block saving a draft');
    assert.equal(validatePlayableProject(project).length, 0, 'a map without a placed start can use compiler fallback');
});

test('Map Check identifies hard project-contract blockers and reports geometry limits', () => {
    const project = clone(STARTER_MAPS.blank_studio);
    project.rooms = [];
    project.smartObjects.push({ id: 'lift_1', type: 'lift', x: 32, y: 32, width: 64, height: 64 });
    const result = analyzeMap(project);
    assert.equal(result.valid, false);
    assert.ok(result.diagnostics.some(finding => finding.code === 'ROOMS_REQUIRED' && finding.severity === 'error'));
    assert.ok(result.diagnostics.some(finding => finding.code === 'DYNAMIC_GEOMETRY_UNCERTAIN'));
    assert.ok(result.limits.some(limit => /not a Doom physics simulation/i.test(limit)));
    assert.equal(validatePlayableProject(project).length, 1);
});

test('Map Check distinguishes touching room boundaries from an explicit door connection', () => {
    const project = clone(STARTER_MAPS.blank_studio);
    project.rooms.push({ ...project.rooms[0], id: 'room_2', name: 'Adjacent Room', x: 192 });
    let result = analyzeMap(project);
    assert.ok(result.diagnostics.some(finding => finding.code === 'ROOMS_MAY_BE_DISCONNECTED'));

    project.smartObjects.push({ id: 'connecting_door', type: 'door', x: 176, y: 128, width: 32, height: 64, lock: 0 });
    result = analyzeMap(project);
    assert.ok(!result.diagnostics.some(finding => finding.code === 'ROOMS_MAY_BE_DISCONNECTED'));
    assert.ok(!result.diagnostics.some(finding => finding.code === 'DOOR_NOT_BETWEEN_ROOMS'));
});
