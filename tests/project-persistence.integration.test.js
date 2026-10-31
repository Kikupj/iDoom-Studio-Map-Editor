const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

async function reservePort() {
    const probe = net.createServer();
    await new Promise((resolve, reject) => probe.listen(0, '127.0.0.1', resolve).once('error', reject));
    const { port } = probe.address();
    await new Promise(resolve => probe.close(resolve));
    return port;
}

async function waitForServer(url, child) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(`Editor server exited with code ${child.exitCode}.`);
        try {
            const response = await fetch(`${url}/api/session`);
            if (response.ok) return response.json();
        } catch { }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Timed out waiting for the editor server.');
}

async function stopServer(child) {
    if (child.exitCode !== null) return;
    child.kill();
    await new Promise(resolve => child.once('exit', resolve));
}

async function post(url, route, payload) {
    return fetch(`${url}${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: url },
        body: JSON.stringify(payload)
    });
}

test('server restart reopens named project and offers isolated newer autosave with monotonic revision', { timeout: 45000 }, async t => {
    const port = await reservePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const mapsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idoom-persistence-test-'));
    let child;
    const start = () => spawn(process.execPath, ['server.js'], {
        cwd: ROOT,
        env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', IDOOM_MAPS_DIR: mapsDir, IDOOM_PROFILE: 'freedoom' },
        stdio: 'ignore'
    });
    t.after(async () => {
        await stopServer(child);
        fs.rmSync(mapsDir, { recursive: true, force: true });
    });

    child = start();
    let session = await waitForServer(baseUrl, child);
    const createdResponse = await post(baseUrl, '/api/project/new', { template: 'blank_studio', revision: session.revision });
    assert.equal(createdResponse.status, 200);
    const created = await createdResponse.json();
    const projectId = created.projectId;
    const project = { ...created.project, name: 'Persistence Baseline' };
    const commitResponse = await post(baseUrl, '/api/session/commit', { project, revision: created.revision });
    assert.equal(commitResponse.status, 200);
    const committed = await commitResponse.json();

    const saveResponse = await post(baseUrl, '/api/project/save', {
        revision: committed.revision, name: 'persistence_map', overwrite: false, saveAs: false
    });
    assert.equal(saveResponse.status, 200);
    const saved = await saveResponse.json();
    assert.equal(saved.projectId, projectId);
    const namedJsonPath = path.join(mapsDir, 'persistence_map.json');
    const namedJsonBeforeEdit = fs.readFileSync(namedJsonPath, 'utf8');

    const changedProject = { ...project, name: 'Unsaved Recovery Copy' };
    const changedResponse = await post(baseUrl, '/api/session/commit', { project: changedProject, revision: saved.revision });
    assert.equal(changedResponse.status, 200);
    const changed = await changedResponse.json();

    const autosavePath = path.join(mapsDir, '.autosaves', `${projectId}.json`);
    const autosaveDeadline = Date.now() + 5000;
    while (Date.now() < autosaveDeadline && !fs.existsSync(autosavePath)) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(fs.existsSync(autosavePath), true, 'committed edits must be autosaved separately');
    assert.equal(fs.readFileSync(namedJsonPath, 'utf8'), namedJsonBeforeEdit, 'autosave must not modify the named project');

    await stopServer(child);
    child = start();
    session = await waitForServer(baseUrl, child);
    assert.equal(session.project.name, 'Persistence Baseline', 'startup should reopen the last named project');
    assert.ok(session.revision >= changed.revision, 'revision must not reset after restart');
    assert.equal(session.storage.namedProject, 'persistence_map');
    assert.equal(session.storage.autosave.available, true, 'newer autosave should be explicitly offered');
    assert.equal(session.storage.autosave.projectName, 'Unsaved Recovery Copy');

    const recoveryResponse = await post(baseUrl, '/api/project/recover', { projectId, revision: session.revision });
    assert.equal(recoveryResponse.status, 200);
    const recovered = await recoveryResponse.json();
    assert.equal(recovered.project.name, 'Unsaved Recovery Copy');
    assert.equal(fs.readFileSync(namedJsonPath, 'utf8'), namedJsonBeforeEdit, 'recovery must leave the named save unchanged');

    const checkedResponse = await post(baseUrl, '/api/map-check', { project: recovered.project });
    assert.equal(checkedResponse.status, 200);
    const checked = await checkedResponse.json();
    assert.ok(Array.isArray(checked.diagnostics));
    assert.ok(Array.isArray(checked.limits));
    const staleResponse = await post(baseUrl, '/api/session/commit', { project: changedProject, revision: changed.revision });
    assert.equal(staleResponse.status, 409);

    const saveAsResponse = await post(baseUrl, '/api/project/save', {
        revision: recovered.revision, name: 'recovered_copy', overwrite: false, saveAs: true
    });
    assert.equal(saveAsResponse.status, 200);
    const copy = await saveAsResponse.json();
    assert.notEqual(copy.projectId, projectId, 'Save As must start a distinct autosave identity');
    assert.equal(fs.readFileSync(namedJsonPath, 'utf8'), namedJsonBeforeEdit, 'Save As must preserve the original named project');

    const overwriteResponse = await post(baseUrl, '/api/project/save', {
        revision: copy.revision, name: 'persistence_map', overwrite: false, saveAs: true
    });
    assert.equal(overwriteResponse.status, 409, 'an existing named save cannot be overwritten without confirmation');

    const openResponse = await post(baseUrl, '/api/project/open', { name: 'persistence_map', revision: copy.revision });
    assert.equal(openResponse.status, 200);
    const reopened = await openResponse.json();
    assert.equal(reopened.projectId, projectId);
    assert.equal(reopened.project.name, 'Persistence Baseline');
    assert.equal(fs.readFileSync(namedJsonPath, 'utf8'), namedJsonBeforeEdit);
});
