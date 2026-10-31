const test = require('node:test');
const assert = require('node:assert/strict');
const { VALID_OBJECT_TYPES } = require('../src/project-session');
const { createReferenceProject, compileReferenceProject } = require('../scripts/smart-object-reference-map');

test('separate UZDoom reference fixture covers every smart object and all locked door actions', () => {
    const project = createReferenceProject();
    const { compiled, wad } = compileReferenceProject(project);
    assert.deepEqual([...new Set(project.smartObjects.map(object => object.type))].sort(), [...VALID_OBJECT_TYPES].sort());
    assert.equal(wad.toString('ascii', 0, 4), 'PWAD');
    assert.ok(compiled.stats.sectors > 0);
    assert.ok(compiled.stats.linedefs > 0);
    assert.ok(compiled.things.some(thing => thing.type === 13));
    assert.ok(compiled.things.some(thing => thing.type === 5));
    assert.ok(compiled.things.some(thing => thing.type === 6));
});
