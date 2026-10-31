const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createProjectStorage, safeProjectName } = require('../src/project-storage');

test('project storage keeps named projects separate from atomic recovery autosaves', t => {
    const mapsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idoom-storage-test-'));
    t.after(() => fs.rmSync(mapsDir, { recursive: true, force: true }));
    const storage = createProjectStorage({ mapsDir });
    const project = { name: 'A Safe Map', rooms: [{ id: 'room_1' }] };

    const saved = storage.saveNamed(project, { name: 'safe_map', overwrite: false });
    assert.equal(fs.existsSync(path.join(mapsDir, 'safe_map.json')), true);
    assert.equal(storage.getLastNamedProject().project.name, 'A Safe Map');
    assert.throws(() => storage.saveNamed({ name: 'replacement' }, { name: 'safe_map', overwrite: false }), error => error.statusCode === 409);

    const original = fs.readFileSync(path.join(mapsDir, 'safe_map.json'), 'utf8');
    storage.saveAutosave({ projectId: saved.projectId, project: { ...project, name: 'Recovered draft' }, revision: 3 });
    assert.equal(fs.readFileSync(path.join(mapsDir, 'safe_map.json'), 'utf8'), original);
    assert.equal(storage.getAutosave(saved.projectId).project.name, 'Recovered draft');
    assert.equal(storage.getStartupRecovery().autosave.project.name, 'Recovered draft');
    assert.equal(storage.listProjects()[0].name, 'safe_map');
});

test('project storage confines names and reports corrupt autosaves without clobbering named files', t => {
    const mapsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idoom-storage-corrupt-'));
    t.after(() => fs.rmSync(mapsDir, { recursive: true, force: true }));
    const storage = createProjectStorage({ mapsDir });
    const saved = storage.saveNamed({ name: 'Keep me' }, { name: 'keep_me' });
    assert.equal(safeProjectName('../../Keep me'), '______keep_me');
    assert.throws(() => storage.readNamed('../keep_me'), error => error.statusCode === 400);
    const autoPath = path.join(storage.autosaveDir, `${saved.projectId}.json`);
    fs.mkdirSync(storage.autosaveDir, { recursive: true });
    fs.writeFileSync(autoPath, '{broken json');
    assert.match(storage.getAutosave(saved.projectId).problem, /could not be read/i);
    assert.equal(storage.readNamed('keep_me').project.name, 'Keep me');
});

test('Save As creates a distinct stable project identity while Save keeps the current identity', t => {
    const mapsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idoom-storage-identity-'));
    t.after(() => fs.rmSync(mapsDir, { recursive: true, force: true }));
    const storage = createProjectStorage({ mapsDir });
    const project = { name: 'First Name', rooms: [] };
    const first = storage.saveNamed(project, { name: 'first_name', projectId: 'draft-project-0001', revision: 2 });
    const same = storage.saveNamed(project, { name: 'first_name', projectId: first.projectId, revision: 3 });
    const copy = storage.saveNamed(project, { name: 'second_name', projectId: same.projectId, revision: 3 });
    assert.equal(same.projectId, first.projectId);
    assert.notEqual(copy.projectId, first.projectId);
    assert.equal(storage.getProjectNameById(copy.projectId), 'second_name');
});

test('named project corruption is surfaced as a recoverable read error', t => {
    const mapsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idoom-storage-bad-project-'));
    t.after(() => fs.rmSync(mapsDir, { recursive: true, force: true }));
    const storage = createProjectStorage({ mapsDir });
    fs.writeFileSync(path.join(mapsDir, 'broken_map.json'), '{invalid json');
    assert.throws(() => storage.readNamed('broken_map'), error => error.statusCode === 422 && /could not be read/i.test(error.message));
});
