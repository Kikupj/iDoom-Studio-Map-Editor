const test = require('node:test');
const assert = require('node:assert/strict');
const { clone, createProjectSession, validateProject, PROJECT_SCHEMA_VERSION } = require('../src/project-session');
const { STARTER_MAPS } = require('../src/starter-maps');

test('project contract supplies schema version and checks required fields/catalog ids', () => {
    const project = clone(STARTER_MAPS.blank_studio);
    assert.deepEqual(validateProject(project), []);
    assert.equal(project.schemaVersion, PROJECT_SCHEMA_VERSION);

    project.rooms[0].id = '';
    project.things[0].type = 999999;
    const errors = validateProject(project);
    assert.ok(errors.some(error => error.includes('rooms[0].id is required')));
    assert.ok(errors.some(error => error.includes('thing catalog')));
});

test('session rejects stale revisions and invalid replacements atomically', () => {
    const session = createProjectSession(clone(STARTER_MAPS.blank_studio));
    const first = session.snapshot();
    const next = clone(first.project);
    next.name = 'Revised map';
    const committed = session.replace(next, first.revision);
    assert.equal(committed.revision, 1);
    assert.throws(() => session.replace(first.project, first.revision), error => error.statusCode === 409);

    const invalid = clone(committed.project);
    invalid.rooms[0].x = Infinity;
    assert.throws(() => session.replace(invalid, committed.revision), error => error.statusCode === 400);
    assert.equal(session.snapshot().project.name, 'Revised map');
    assert.equal(session.snapshot().revision, 1);
});

test('project session publishes updates and bounds undo history', () => {
    const session = createProjectSession(clone(STARTER_MAPS.blank_studio));
    let received;
    const stop = session.subscribe(update => { received = update; });
    const current = session.snapshot();
    const project = clone(current.project);
    project.name = 'Changed';
    session.replace(project, current.revision, 'agent');
    stop();
    assert.equal(received.revision, 1);
    assert.equal(received.source, 'agent');
    assert.equal(session.historyDepth(), 1);
});

test('shared undo and redo each create a new revision and reject stale requests', () => {
    const session = createProjectSession(clone(STARTER_MAPS.blank_studio));
    const before = session.snapshot();
    const next = clone(before.project);
    next.name = 'Undo target';
    const edited = session.replace(next, before.revision);
    const undone = session.undo(edited.revision);
    assert.equal(undone.revision, 2);
    assert.equal(undone.project.name, before.project.name);
    const redone = session.redo(undone.revision);
    assert.equal(redone.revision, 3);
    assert.equal(redone.project.name, 'Undo target');
    assert.throws(() => session.undo(edited.revision), error => error.statusCode === 409);
});
