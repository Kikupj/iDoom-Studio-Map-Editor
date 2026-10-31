const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const ROOT = path.resolve(__dirname, '..');

async function reservePort() {
    const probe = net.createServer();
    await new Promise((resolve, reject) => probe.listen(0, '127.0.0.1', resolve).once('error', reject));
    const { port } = probe.address();
    await new Promise(resolve => probe.close(resolve));
    return port;
}

async function waitForServer(url, child) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(`Editor test server exited with code ${child.exitCode}.`);
        try {
            const response = await fetch(`${url}/api/session`);
            if (response.ok) return response.json();
        } catch { }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Timed out waiting for the test editor server.');
}

test('MCP tools discover, mutate, validate, and live-sync through revisioned local API', { timeout: 30000 }, async t => {
    const port = await reservePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const mapsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idoom-mcp-server-test-'));
    const serverProcess = spawn(process.execPath, ['server.js'], {
        cwd: ROOT,
        env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', IDOOM_MAPS_DIR: mapsDir },
        stdio: 'ignore'
    });
    let client;
    let eventReader;
    const savedName = 'mcp_integration_test';
    t.after(async () => {
        try { await eventReader?.cancel(); } catch { }
        try { await client?.close(); } catch { }
        if (serverProcess.exitCode === null) {
            serverProcess.kill();
            await new Promise(resolve => serverProcess.once('exit', resolve));
        }
        fs.rmSync(mapsDir, { recursive: true, force: true });
    });

    const initial = await waitForServer(baseUrl, serverProcess);
    const eventResponse = await fetch(`${baseUrl}/api/session/events`);
    eventReader = eventResponse.body.getReader();
    await eventReader.read(); // Initial session snapshot.

    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [path.join(ROOT, 'src', 'mcp-server.js')],
        cwd: ROOT,
        env: { ...process.env, PORT: String(port), IDOOM_STUDIO_URL: baseUrl, IDOOM_MAPS_DIR: mapsDir }
    });
    client = new Client({ name: 'idoom-integration-test', version: '1.0.0' });
    await client.connect(transport);

    const { tools } = await client.listTools();
    assert.ok(tools.some(tool => tool.name === 'idoom_attach_room'));
    assert.ok(tools.some(tool => tool.name === 'idoom_playtest'));
    assert.ok(tools.some(tool => tool.name === 'idoom_map_check'));
    const catalogResponse = await client.callTool({ name: 'idoom_get_catalog', arguments: {} });
    const catalog = catalogResponse.structuredContent || JSON.parse(catalogResponse.content[0].text);
    assert.deepEqual(catalog.doorLocks.map(lock => lock.value), [0, 1, 2, 3]);

    const read = async () => {
        const result = await client.callTool({ name: 'idoom_get_project', arguments: {} });
        return result.structuredContent || JSON.parse(result.content[0].text);
    };
    const createdResult = await client.callTool({
        name: 'idoom_create_project',
        arguments: { revision: initial.revision, template: 'blank_studio', name: 'Integration Map' }
    });
    const created = createdResult.structuredContent || JSON.parse(createdResult.content[0].text);
    assert.equal(created.revision, initial.revision + 1);

    const attachedResult = await client.callTool({
        name: 'idoom_attach_room',
        arguments: { revision: created.revision, fromRoomId: 'room_1', theme: 'techbase', connection: 'door', encounter: 'none' }
    });
    const attached = attachedResult.structuredContent || JSON.parse(attachedResult.content[0].text);
    assert.ok(attached.createdRoomId);

    const batchResult = await client.callTool({
        name: 'idoom_apply_batch',
        arguments: {
            revision: attached.revision,
            operations: [
                { type: 'add', collection: 'thing', object: { id: 'agent_imp', type: 3001, x: 32, y: 32, angle: 0 } },
                { type: 'update', id: 'agent_imp', patch: { angle: 180 } },
                { type: 'add', collection: 'smartObject', object: { id: 'agent_exit', type: 'exit', name: 'Arena Exit', x: 300, y: 0, width: 32, height: 64, floorHeight: 0, ceilingHeight: 128, theme: 'techbase' } },
                { type: 'add', collection: 'smartObject', object: { id: 'agent_red_door', type: 'door', name: 'Red-locked Door', x: 512, y: 512, width: 32, height: 64, theme: 'techbase', lock: 1 } }
            ]
        }
    });
    const batched = batchResult.structuredContent || JSON.parse(batchResult.content[0].text);
    assert.ok(batched.project.things.some(thing => thing.id === 'agent_imp' && thing.angle === 180));
    assert.equal(batched.warnings.length, 1);
    assert.equal(batched.warnings[0].keyName, 'Red Keycard');

    const liveChunk = await eventReader.read();
    assert.match(new TextDecoder().decode(liveChunk.value), /Integration Map/);

    const browserProject = cloneForTest(batched.project);
    browserProject.name = 'Browser live edit';
    const browserCommit = await fetch(`${baseUrl}/api/session/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: baseUrl },
        body: JSON.stringify({ project: browserProject, revision: batched.revision })
    });
    assert.equal(browserCommit.status, 200);
    const afterBrowser = await read();
    assert.equal(afterBrowser.project.name, 'Browser live edit');

    const stale = await fetch(`${baseUrl}/api/session/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: baseUrl },
        body: JSON.stringify({ project: created.project, revision: created.revision })
    });
    assert.equal(stale.status, 409);
    const blocked = await fetch(`${baseUrl}/api/session/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://example.com' },
        body: JSON.stringify({ project: created.project, revision: afterBrowser.revision })
    });
    assert.equal(blocked.status, 403);

    const validation = await client.callTool({
        name: 'idoom_validate_project',
        arguments: { revision: afterBrowser.revision }
    });
    const result = validation.structuredContent || JSON.parse(validation.content[0].text);
    assert.equal(result.valid, true);
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0].keyType, 13);
    assert.ok(result.mapCheck.diagnostics.some(finding => finding.code === 'LOCKED_DOOR_KEY_MISSING'));
    assert.ok(afterBrowser.project.things.some(thing => thing.type === 1), 'map contains a player start');
    assert.ok(afterBrowser.project.smartObjects.some(object => object.type === 'exit'), 'map contains an exit');

    const checked = await client.callTool({ name: 'idoom_map_check', arguments: { revision: afterBrowser.revision } });
    const checkResult = checked.structuredContent || JSON.parse(checked.content[0].text);
    assert.ok(Array.isArray(checkResult.diagnostics));
    assert.ok(Array.isArray(checkResult.limits));

    const saved = await client.callTool({
        name: 'idoom_save_project',
        arguments: { revision: afterBrowser.revision, name: savedName }
    });
    const savedResult = saved.structuredContent || JSON.parse(saved.content[0].text);
    assert.equal(savedResult.ok, true);
    assert.equal(fs.existsSync(path.join(mapsDir, `${savedName}.json`)), true);
    const exported = await client.callTool({
        name: 'idoom_export_wad',
        arguments: { revision: afterBrowser.revision, name: savedName }
    });
    const exportResult = exported.structuredContent || JSON.parse(exported.content[0].text);
    assert.equal(exportResult.wadPath, `maps/${savedName}.wad`);
    const loaded = await client.callTool({
        name: 'idoom_load_project',
        arguments: { revision: afterBrowser.revision, name: savedName }
    });
    const loadResult = loaded.structuredContent || JSON.parse(loaded.content[0].text);
    assert.equal(loadResult.project.name, 'Browser live edit');

    const resource = await client.readResource({ uri: 'doom://project/current' });
    assert.equal(resource.contents.length, 1);
});

function cloneForTest(value) {
    return JSON.parse(JSON.stringify(value));
}
