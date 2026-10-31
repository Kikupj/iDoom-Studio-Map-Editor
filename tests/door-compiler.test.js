const test = require('node:test');
const assert = require('node:assert/strict');
const { compileProject } = require('../src/udmf-compiler');
const { STARTER_MAPS } = require('../src/starter-maps');

function doorFixture() {
    const project = JSON.parse(JSON.stringify(STARTER_MAPS.uac_outpost));
    project.smartObjects = project.smartObjects.filter(item => item.type === 'door');
    return project;
}

function getDoorFaces(project) {
    const door = project.smartObjects.find(item => item.type === 'door');
    const compiled = compileProject(project);
    const faces = compiled.linedefs.filter(line => line.front.texturetop === door.wallTexture && line.special === (door.lock ? 13 : 12));
    return { door, compiled, faces };
}

test('moving door face stays top-pegged to its sector so it translates as a solid panel', () => {
    const { door, compiled, faces } = getDoorFaces(doorFixture());
    assert.equal(faces.length, 2, 'door has a face on each room boundary');
    for (const line of faces) {
        assert.equal(line.dontpegtop, false);
        assert.equal(line.front.texturetop, door.wallTexture);
        assert.equal(line.back.texturebottom, 'DOORTRAK');
    }
    assert.match(compiled.textmap, /texturetop = "BIGDOOR2";/);
});

test('door panel pegging remains stable for unequal room elevations and reversed side orientation', () => {
    const project = doorFixture();
    project.rooms.find(room => room.id === 'room_hub').floorHeight = 64;
    project.rooms.find(room => room.id === 'room_hub').ceilingHeight = 224;
    const { faces } = getDoorFaces(project);
    assert.equal(faces.length, 2);
    assert.ok(faces.every(line => line.dontpegtop === false));
});

test('locked door still uses locked door action and keeps solid-panel pegging', () => {
    const project = doorFixture();
    project.smartObjects[0].lock = 1;
    const { door, faces } = getDoorFaces(project);
    assert.equal(faces.length, 2);
    assert.ok(faces.every(line => line.special === 13 && !line.dontpegtop));
    assert.ok(faces.every(line => line.arg3 === door.lock));
});

test('remote-only door has no local trigger and retains moving-face pegging', () => {
    const project = doorFixture();
    project.smartObjects[0].remoteOnly = true;
    const compiled = compileProject(project);
    const faces = compiled.linedefs.filter(line => line.front.texturetop === 'BIGDOOR2');
    assert.equal(faces.length, 2);
    assert.ok(faces.every(line => line.special === 0 && line.dontpegtop === false));
});
