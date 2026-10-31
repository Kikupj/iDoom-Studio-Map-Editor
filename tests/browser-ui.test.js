const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BROWSER_CANDIDATES = [
    process.env.CHROME_BIN,
    process.env.EDGE_BIN,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean);
const BROWSER = BROWSER_CANDIDATES.find(candidate => fs.existsSync(candidate));

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
            if (response.ok) return;
        } catch { }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Timed out waiting for the editor server.');
}

async function waitForPageTarget(port, child) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(`Browser exited with code ${child.exitCode}.`);
        try {
            const response = await fetch(`http://127.0.0.1:${port}/json/list`);
            const pages = await response.json();
            const page = pages.find(target => target.type === 'page');
            if (page) return page;
        } catch { }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Timed out waiting for the headless browser page.');
}

function makeCdpClient(url) {
    const socket = new WebSocket(url);
    let nextId = 0;
    const pending = new Map();
    const events = [];
    const opened = new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true });
        socket.addEventListener('error', reject, { once: true });
    });
    socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (!message.id) {
            if (message.method === 'Network.requestWillBeSent' || message.method === 'Network.responseReceived' || message.method === 'Runtime.exceptionThrown') events.push(message);
            return;
        }
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        if (message.error) request.reject(new Error(message.error.message));
        else request.resolve(message.result);
    });

    return {
        async send(method, params = {}) {
            await opened;
            const id = ++nextId;
            return new Promise((resolve, reject) => {
                pending.set(id, { resolve, reject });
                socket.send(JSON.stringify({ id, method, params }));
            });
        },
        async evaluate(expression) {
            const response = await this.send('Runtime.evaluate', {
                expression,
                returnByValue: true,
                awaitPromise: true
            });
            if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || 'Browser script failed.');
            return response.result.value;
        },
        events,
        close() { socket.close(); }
    };
}

async function waitFor(client, expression, message) {
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
        if (await client.evaluate(expression)) return;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    let diagnostic = '';
    try {
        diagnostic = ` Browser state: ${await client.evaluate(`JSON.stringify({status:document.getElementById('saveStateStatus')?.textContent,projectName:document.getElementById('projectNameInput')?.value,toasts:[...document.querySelectorAll('.toast')].map(toast=>toast.textContent),prompts:window.__promptMessages,confirms:window.__confirmMessages})`)}`;
    } catch { }
    const responses = client.events
        .filter(event => event.method === 'Network.responseReceived')
        .map(event => ({ url: event.params.response.url, status: event.params.response.status }))
        .filter(event => event.url.includes('/api/'))
        .slice(-16);
    const requests = client.events
        .filter(event => event.method === 'Network.requestWillBeSent' && event.params.request.url.includes('/api/'))
        .map(event => ({ url: event.params.request.url, method: event.params.request.method }))
        .filter(event => /project\/new|session\/commit|project\/save/.test(event.url))
        .slice(-8);
    throw new Error(`${message}.${diagnostic} API responses: ${JSON.stringify(responses)} requests: ${JSON.stringify(requests)}`);
}

async function stopChild(child) {
    if (!child || child.exitCode !== null) return;
    child.kill();
    await Promise.race([
        new Promise(resolve => child.once('exit', resolve)),
        new Promise(resolve => setTimeout(resolve, 3000))
    ]);
}

test('headless browser project lifecycle, save status, template cancellation, and Map Check UI', {
    skip: !BROWSER && 'Chrome or Edge is not installed; set CHROME_BIN or EDGE_BIN to enable browser UI tests.',
    timeout: 60000
}, async t => {
    const serverPort = await reservePort();
    const browserPort = await reservePort();
    const baseUrl = `http://127.0.0.1:${serverPort}`;
    const mapsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idoom-browser-ui-'));
    const profileDir = path.join(mapsDir, 'browser-profile');
    let server;
    let browser;
    let client;

    t.after(async () => {
        client?.close();
        await stopChild(browser);
        await stopChild(server);
        fs.rmSync(mapsDir, { recursive: true, force: true });
    });

    server = spawn(process.execPath, ['server.js'], {
        cwd: ROOT,
        env: { ...process.env, PORT: String(serverPort), HOST: '127.0.0.1', IDOOM_MAPS_DIR: mapsDir },
        stdio: 'ignore'
    });
    await waitForServer(baseUrl, server);

    browser = spawn(BROWSER, [
        '--headless=new', '--disable-gpu', '--use-gl=angle', '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage',
        '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
        `--user-data-dir=${profileDir}`, `--remote-debugging-port=${browserPort}`, baseUrl
    ], { stdio: 'ignore' });
    const page = await waitForPageTarget(browserPort, browser);
    client = makeCdpClient(page.webSocketDebuggerUrl);
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Network.enable');
    await waitFor(client, `document.readyState === 'complete' && document.getElementById('saveStateStatus')?.textContent !== 'Starting…'`, 'Editor UI did not finish initialization.');
    await client.evaluate(`(() => {
        window.__confirmQueue = [];
        window.__promptQueue = [];
        window.confirm = message => { (window.__confirmMessages ||= []).push(message); return window.__confirmQueue.length ? window.__confirmQueue.shift() : false; };
        window.prompt = (message, fallback) => { (window.__promptMessages ||= []).push(message); return window.__promptQueue.length ? window.__promptQueue.shift() : fallback; };
    })()`);

    // Canceling a template replacement must not claim the template was loaded.
    await client.evaluate(`(() => {
        window.__confirmQueue = [false, false];
        document.querySelector('[data-template="uac_outpost"]').click();
    })()`);
    await new Promise(resolve => setTimeout(resolve, 250));
    const canceledTemplateToast = await client.evaluate(`[...document.querySelectorAll('.toast')].some(toast => toast.textContent.includes('Loaded template:'))`);
    assert.equal(canceledTemplateToast, false, 'a canceled replacement must not show a template-loaded toast');

    // Start a blank draft, save it by name, rename it, and verify disk status.
    await client.evaluate(`(() => {
        window.__confirmQueue = [false, true];
        document.getElementById('newProjectBtn').click();
    })()`);
    await waitFor(client, `document.getElementById('projectNameInput').value === 'Clean Starter Room' && document.getElementById('saveStateStatus').textContent.includes('Not saved to disk')`, 'New project did not enter the unsaved state.');
    await client.evaluate(`(() => {
        window.__promptQueue = ['browser_ui_test'];
        document.getElementById('saveAsProjectBtn').click();
    })()`);
    await waitFor(client, `document.getElementById('saveStateStatus').textContent.includes('Saved to disk')`, 'Save As did not reach the saved state.');
    assert.equal(fs.existsSync(path.join(mapsDir, 'browser_ui_test.json')), true, 'Save As should create the named JSON project');

    const savedBeforeOverwritePrompt = fs.readFileSync(path.join(mapsDir, 'browser_ui_test.json'), 'utf8');
    await client.evaluate(`(() => {
        window.__promptQueue = ['browser_ui_test'];
        window.__confirmQueue = [false];
        document.getElementById('saveAsProjectBtn').click();
    })()`);
    await waitFor(client, `window.__confirmMessages?.some(message => message.includes('Replace its named JSON'))`, 'Save As did not ask before overwriting an existing project.');
    assert.equal(fs.readFileSync(path.join(mapsDir, 'browser_ui_test.json'), 'utf8'), savedBeforeOverwritePrompt, 'declining overwrite must preserve the existing named save');

    await client.evaluate(`(() => {
        const name = document.getElementById('projectNameInput');
        name.value = 'Browser UI renamed';
        name.dispatchEvent(new Event('input', { bubbles: true }));
        name.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await waitFor(client, `document.getElementById('saveStateStatus').textContent.includes('Not saved to disk')`, 'Typing in the project title should mark the project unsaved immediately.');
    const exitGuard = await client.evaluate(`(() => {
        const event = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(event);
        return { prevented: event.defaultPrevented, draft: JSON.parse(localStorage.getItem('idoom-studio-recoverable-draft') || 'null') };
    })()`);
    assert.equal(exitGuard.prevented, true, 'unsaved title edits should trigger the browser exit guard');
    assert.equal(exitGuard.draft?.project?.name, 'Browser UI renamed', 'exit guard should preserve a browser-local recovery copy');
    await client.evaluate(`document.getElementById('saveProjectBtn').click()`);
    await waitFor(client, `document.getElementById('saveStateStatus').textContent.includes('Saved to disk')`, 'Save did not persist the changed project title.');
    assert.equal(JSON.parse(fs.readFileSync(path.join(mapsDir, 'browser_ui_test.json'), 'utf8')).name, 'Browser UI renamed');

    await client.evaluate(`document.getElementById('mapCheckBtn').click()`);
    await waitFor(client, `!document.getElementById('mapCheckPanel').classList.contains('hidden')`, 'Map Check button did not reveal the findings panel.');
    assert.match(await client.evaluate(`document.getElementById('mapCheckSummary').textContent`), /errors|warnings|notes/);
    assert.equal(await client.evaluate(`document.querySelectorAll('#mapCheckFindings .map-check-item').length`), 1, 'all-severity filter should show the starter map note');
    await client.evaluate(`(() => {
        const filter = document.getElementById('mapCheckFilter');
        filter.value = 'error';
        filter.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    assert.equal(await client.evaluate(`document.querySelectorAll('#mapCheckFindings .map-check-item').length`), 0, 'error filter should hide informational findings');

    // Opening an existing project is guarded by the explicit discard confirmation.
    await client.evaluate(`(() => {
        document.getElementById('projectMenuBtn').click();
        document.getElementById('openProjectSelect').value = 'browser_ui_test';
        window.__confirmQueue = [false, true];
        document.getElementById('openProjectBtn').click();
    })()`);
    await waitFor(client, `document.getElementById('projectNameInput').value === 'Browser UI renamed'`, 'Open did not restore the selected named project.');
    assert.match(await client.evaluate(`document.getElementById('saveStateStatus').textContent`), /Saved to disk/);
});
