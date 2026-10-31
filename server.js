const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { WadReader } = require('./src/wad-reader');
const { MATERIAL_THEMES, SKYBOX_PRESETS, compileProject, buildUdmfWadBuffer } = require('./src/udmf-compiler');
const { THING_CATALOG, STARTER_MAPS } = require('./src/starter-maps');
const { generateRoomAttachment } = require('./src/smart-generator');
const { clone, createProjectSession, validateProject } = require('./src/project-session');
const { makeAgentApi } = require('./src/agent-api');
const { DOOR_LOCKS, getDoorKeyWarnings } = require('./src/door-keys');
const { createProjectStorage } = require('./src/project-storage');
const { makeProjectPipeline } = require('./src/project-pipeline');

const PORT = process.env.PORT || 3456;
const HOST = process.env.HOST || '127.0.0.1';
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const MAPS_DIR = process.env.IDOOM_MAPS_DIR ? path.resolve(process.env.IDOOM_MAPS_DIR) : path.join(ROOT_DIR, 'maps');
const IWAD_PATH = path.join(ROOT_DIR, 'freedoom-0.13.0', 'freedoom2.wad');
const UZDOOM_PATH = path.join(ROOT_DIR, 'uzdoom.exe');
const AGENT_TOKEN_PATH = path.join(MAPS_DIR, '.agent-token');

if (!fs.existsSync(MAPS_DIR)) {
  fs.mkdirSync(MAPS_DIR, { recursive: true });
}

let agentToken = fs.existsSync(AGENT_TOKEN_PATH) ? fs.readFileSync(AGENT_TOKEN_PATH, 'utf8').trim() : '';
if (!/^[0-9a-f]{64}$/i.test(agentToken)) {
  agentToken = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(AGENT_TOKEN_PATH, agentToken, { mode: 0o600 });
}

console.log('[iDoom Studio] Loading Freedoom2 IWAD textures, flats, and sprites...');
const wadReader = new WadReader(IWAD_PATH);
const wadCatalog = wadReader.getCatalog();
console.log(`[iDoom Studio] Loaded ${wadCatalog.textures.length} textures and ${wadCatalog.flats.length} flats from freedoom2.wad.`);

const projectStorage = createProjectStorage({ mapsDir: MAPS_DIR });
const startupRecovery = projectStorage.getStartupRecovery();
const startupNamedCandidate = startupRecovery.named && !startupRecovery.named.problem ? startupRecovery.named : null;
const startupProjectErrors = startupNamedCandidate ? validateProject(clone(startupNamedCandidate.project), { requireRoom: false, wadCatalog }) : [];
const startupNamed = startupProjectErrors.length ? null : startupNamedCandidate;
const activeProjectId = !startupRecovery.named ? projectStorage.getActiveProjectId() : null;
const initialProjectId = startupNamed?.projectId || activeProjectId || crypto.randomUUID();
const initialProject = clone(startupNamed?.project || STARTER_MAPS.uac_outpost);
const initialRevision = Math.max(
  projectStorage.getSessionRevision(initialProjectId),
  projectStorage.getNamedSavedRevision(initialProjectId) || 0,
  startupRecovery.autosave && !startupRecovery.autosave.problem && startupRecovery.autosave.projectId === initialProjectId
    ? startupRecovery.autosave.revision : 0
);
projectStorage.rememberActiveProjectId(initialProjectId);
projectStorage.saveSessionRevision(initialProjectId, initialRevision);
const projectSession = createProjectSession(initialProject, { wadCatalog, projectId: initialProjectId, revision: initialRevision });
const playtestWadPath = path.join(MAPS_DIR, 'live_playtest.wad');
const launchPlaytest = options => {
  if (!fs.existsSync(UZDOOM_PATH)) throw new Error('uzdoom.exe not found in workspace root.');
  const psArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'src/focus-uzdoom.ps1', '-WadRelPath', 'maps/live_playtest.wad'];
  if (options?.skill) psArgs.push('-Skill', String(options.skill));
  if (options?.nomonsters) psArgs.push('-NoMonsters');
  const child = spawn('powershell.exe', psArgs, { cwd: ROOT_DIR, windowsHide: true });
  child.on('error', err => console.error('[UZDoom Playtest Error]', err));
  child.unref();
};
const projectPipeline = makeProjectPipeline({
  storage: projectStorage,
  mapsDir: MAPS_DIR,
  wadPath: playtestWadPath,
  wadCatalog,
  launchPlaytest
});
const agentApi = makeAgentApi({
  session: projectSession,
  starterMaps: STARTER_MAPS,
  themes: MATERIAL_THEMES,
  skyboxes: SKYBOX_PRESETS,
  things: THING_CATALOG,
  wadCatalog,
  mapsDir: MAPS_DIR,
  wadPath: playtestWadPath,
  launchPlaytest,
  storage: projectStorage,
  pipeline: projectPipeline
});

const autosaveTimers = new Map();
projectSession.subscribe(update => {
  try {
    projectStorage.rememberActiveProjectId(update.projectId);
    projectStorage.saveSessionRevision(update.projectId, update.revision);
  } catch (error) {
    console.error('[iDoom Studio] Could not persist session metadata:', error.message);
  }
  if (update.source === 'identity' || update.changed === false) return;
  const projectId = update.projectId;
  clearTimeout(autosaveTimers.get(projectId));
  const timer = setTimeout(() => {
    autosaveTimers.delete(projectId);
    try {
      projectStorage.saveAutosave({
        projectId,
        project: update.project,
        revision: update.revision,
        projectName: update.project.name
      });
    } catch (error) {
      console.error('[iDoom Studio] Autosave failed:', error.message);
    }
  }, 450);
  autosaveTimers.set(projectId, timer);
  timer.unref?.();
});

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    req.on('data', chunk => {
      totalBytes += chunk.length;
      if (totalBytes > 5 * 1024 * 1024) {
        const error = Object.assign(new Error('Request body exceeds the 5 MiB limit.'), { statusCode: 413 });
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function isLoopbackHostname(hostname) {
  const normalized = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function isLoopbackHostHeader(hostHeader) {
  if (!hostHeader) return false;
  try { return isLoopbackHostname(new URL(`http://${hostHeader}`).hostname); }
  catch { return false; }
}

function isSameOriginBrowserMutation(req) {
  const origin = req.headers.origin;
  if (!origin || !isLoopbackHostHeader(req.headers.host)) return false;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'http:' && isLoopbackHostname(parsed.hostname) && parsed.host === req.headers.host;
  } catch {
    return false;
  }
}

function hasAgentAuthorization(req) {
  return req.headers.authorization === `Bearer ${agentToken}`;
}

function sendSseEvent(res, eventName, payload) {
  res.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function sendJson(res, status, data) {
  const payload = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(payload);
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
  try {
    if (!isLoopbackHostHeader(req.headers.host)) {
      res.writeHead(403);
      return res.end('Loopback access only');
    }
    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(urlObj.pathname);

    if (req.method === 'POST' && pathname.startsWith('/api/') &&
      pathname !== '/api/agent/action' && pathname !== '/api/compile' && !isSameOriginBrowserMutation(req)) {
      return sendJson(res, 403, { error: 'Cross-origin mutations are not allowed.' });
    }

    if (req.method === 'GET' && pathname === '/api/session') {
      const current = projectSession.snapshot();
      const autosave = projectStorage.getAutosave(current.projectId);
      const projectName = projectStorage.getProjectNameById(current.projectId);
      const lastNamed = projectStorage.getLastNamedProject();
      let newerAutosave = null;
      if (autosave?.problem) newerAutosave = autosave;
      else if (autosave) {
        const currentRecovery = projectStorage.getStartupRecovery();
        if (currentRecovery.autosave?.projectId === current.projectId) {
          newerAutosave = autosave;
        } else if (!projectName && JSON.stringify(autosave.project) !== JSON.stringify(current.project)) {
          newerAutosave = autosave;
        }
      }
      return sendJson(res, 200, {
        ...current,
        compiled: compileProject(current.project),
        mapCheck: projectPipeline.check(current.project),
        storage: {
          projectId: current.projectId,
          namedProject: projectName,
          savedRevision: projectStorage.getNamedSavedRevision(current.projectId),
          diskSaved: projectStorage.getNamedSavedRevision(current.projectId) === current.revision || (
            projectStorage.getNamedSavedRevision(current.projectId) === null &&
            startupNamed?.projectId === current.projectId &&
            JSON.stringify(startupNamed.project) === JSON.stringify(current.project)
          ),
          lastNamedProject: lastNamed && !lastNamed.problem ? lastNamed.name : null,
          recoveryProblem: lastNamed?.problem || (startupProjectErrors.length ? `Last project failed validation: ${startupProjectErrors.join(' ')}` : null),
          recentProjects: projectStorage.listProjects(),
          autosave: newerAutosave ? {
            available: !newerAutosave.problem,
            problem: newerAutosave.problem || null,
            savedAt: newerAutosave.savedAt || null,
            revision: newerAutosave.revision ?? null,
            projectName: newerAutosave.projectName || null
          } : null
        }
      });
    }

    if (req.method === 'GET' && pathname === '/api/session/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      res.write('retry: 1500\n\n');
      const unsubscribe = projectSession.subscribe(update => sendSseEvent(res, 'project', update));
      sendSseEvent(res, 'project', { ...projectSession.snapshot(), source: 'initial' });
      const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 20000);
      res.on('close', () => {
        clearInterval(keepAlive);
        unsubscribe();
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/session/commit') {
      const body = await readJsonBody(req);
      if (!Number.isInteger(body.revision)) return sendJson(res, 400, { error: 'revision is required.' });
      const update = projectSession.replace(body.project || {}, body.revision, 'browser');
      return sendJson(res, 200, update);
    }

    if (req.method === 'GET' && pathname === '/api/projects') {
      return sendJson(res, 200, { projects: projectStorage.listProjects() });
    }

    if (req.method === 'POST' && pathname === '/api/project/save') {
      const body = await readJsonBody(req);
      const current = projectSession.snapshot();
      if (!Number.isInteger(body.revision) || body.revision !== current.revision) {
        const error = Object.assign(new Error(`Project revision conflict: current revision is ${current.revision}.`), { statusCode: 409, currentRevision: current.revision });
        throw error;
      }
      const saved = projectPipeline.saveNamed(current.project, {
        name: body.name || current.project.name,
        projectId: current.projectId,
        revision: current.revision,
        overwrite: Boolean(body.overwrite),
        saveAs: Boolean(body.saveAs)
      });
      projectSession.setProjectIdentity(saved.projectId);
      projectStorage.rememberActiveProjectId(saved.projectId);
      return sendJson(res, 200, { ...saved, revision: current.revision, projectId: saved.projectId, diskSaved: true });
    }

    if (req.method === 'POST' && pathname === '/api/project/open') {
      const body = await readJsonBody(req);
      const current = projectSession.snapshot();
      if (!Number.isInteger(body.revision) || body.revision !== current.revision) {
        const error = Object.assign(new Error(`Project revision conflict: current revision is ${current.revision}.`), { statusCode: 409, currentRevision: current.revision });
        throw error;
      }
      const loaded = projectStorage.readNamed(String(body.name || ''));
      const validationErrors = projectPipeline.validateDraft(loaded.project);
      if (validationErrors.length) {
        const error = Object.assign(new Error(`Saved project validation failed: ${validationErrors.join(' ')}`), { statusCode: 400, validationErrors });
        throw error;
      }
      projectStorage.markLastProject(loaded.name);
      projectSession.setProjectIdentity(loaded.projectId);
      const update = projectSession.replace(loaded.project, current.revision, 'browser-open');
      projectStorage.markNamedSavedRevision(loaded.projectId, update.revision);
      projectStorage.saveSessionRevision(loaded.projectId, update.revision);
      return sendJson(res, 200, { ...projectSession.snapshot(), changed: update.changed, source: 'browser-open', diskSaved: true, namedProject: loaded.name });
    }

    if (req.method === 'POST' && pathname === '/api/project/new') {
      const body = await readJsonBody(req);
      const current = projectSession.snapshot();
      if (!Number.isInteger(body.revision) || body.revision !== current.revision) {
        const error = Object.assign(new Error(`Project revision conflict: current revision is ${current.revision}.`), { statusCode: 409, currentRevision: current.revision });
        throw error;
      }
      const template = STARTER_MAPS[body.template] || STARTER_MAPS.blank_studio;
      const project = clone(template);
      if (body.name) project.name = String(body.name).slice(0, 120);
      projectSession.setProjectIdentity(crypto.randomUUID());
      const update = projectSession.replace(project, current.revision, 'browser-new');
      return sendJson(res, 200, { ...update, diskSaved: false, namedProject: null });
    }

    if (req.method === 'POST' && pathname === '/api/project/recover') {
      const body = await readJsonBody(req);
      const current = projectSession.snapshot();
      if (body.projectId !== current.projectId || !Number.isInteger(body.revision) || body.revision !== current.revision) {
        const error = Object.assign(new Error(`Project recovery is stale; current revision is ${current.revision}.`), { statusCode: 409, currentRevision: current.revision });
        throw error;
      }
      const autosave = projectStorage.getAutosave(current.projectId);
      if (!autosave || autosave.problem) throw Object.assign(new Error(autosave?.problem || 'No recoverable autosave is available.'), { statusCode: 404 });
      const errors = projectPipeline.validateDraft(autosave.project);
      if (errors.length) throw Object.assign(new Error(`Autosave validation failed: ${errors.join(' ')}`), { statusCode: 400, validationErrors: errors });
      const update = projectSession.replace(autosave.project, current.revision, 'recovery');
      return sendJson(res, 200, { ...update, recovered: true, diskSaved: false });
    }

    if (req.method === 'POST' && pathname === '/api/map-check') {
      const body = await readJsonBody(req);
      return sendJson(res, 200, projectPipeline.check(body.project || projectSession.snapshot().project));
    }

    if (req.method === 'POST' && pathname === '/api/agent/action') {
      if (!hasAgentAuthorization(req)) return sendJson(res, 401, { error: 'Missing or invalid local agent bearer token.' });
      const body = await readJsonBody(req);
      const data = await agentApi.execute(body.action, body.args || {});
      return sendJson(res, 200, data);
    }

    // 1. WAD Asset Image Endpoints
    if (req.method === 'GET' && pathname.startsWith('/api/texture/')) {
      const name = pathname.replace('/api/texture/', '').trim();
      const png = wadReader.getTexturePNG(name) || wadReader.getTexturePNG('STARTAN2');
      if (!png) {
        res.writeHead(404);
        return res.end('Not found');
      }
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400'
      });
      return res.end(png);
    }

    if (req.method === 'GET' && pathname.startsWith('/api/flat/')) {
      const name = pathname.replace('/api/flat/', '').trim();
      const png = wadReader.getFlatPNG(name) || wadReader.getFlatPNG('FLOOR4_8');
      if (!png) {
        res.writeHead(404);
        return res.end('Not found');
      }
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400'
      });
      return res.end(png);
    }

    if (req.method === 'GET' && pathname.startsWith('/api/sprite/')) {
      const prefix = pathname.replace('/api/sprite/', '').trim();
      const png = wadReader.getSpritePNG(prefix);
      if (!png) {
        res.writeHead(404);
        return res.end('Not found');
      }
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400'
      });
      return res.end(png);
    }

    // 2. Catalog Endpoint
    if (req.method === 'GET' && pathname === '/api/catalog') {
      return sendJson(res, 200, {
        themes: MATERIAL_THEMES,
        skyboxes: SKYBOX_PRESETS,
        things: THING_CATALOG,
        doorLocks: DOOR_LOCKS,
        starterMaps: STARTER_MAPS,
        wad: wadCatalog,
        engine: {
          hasUzdoom: fs.existsSync(UZDOOM_PATH),
          hasFreedoom: fs.existsSync(IWAD_PATH)
        }
      });
    }

    // 3. Live UDMF & 3D Preview Compiler Endpoint
    if (req.method === 'POST' && pathname === '/api/compile') {
      const body = await readJsonBody(req);
      const compiled = compileProject(body.project || {});
      return sendJson(res, 200, {
        ...compiled,
        doorKeyWarnings: getDoorKeyWarnings(body.project || {}),
        mapCheck: projectPipeline.check(body.project || {})
      });
    }

    // 4. Smart Room & Encounter Generator Endpoint
    if (req.method === 'POST' && pathname === '/api/generate-room') {
      const body = await readJsonBody(req);
      const current = projectSession.snapshot();
      const expectedRevision = Number.isInteger(body.revision) ? body.revision : current.revision;
      if (expectedRevision !== current.revision) {
        return sendJson(res, 409, { error: `Project revision conflict: current revision is ${current.revision}.`, revision: current.revision });
      }
      const { project, createdRoomId } = generateRoomAttachment(body.project || current.project, body.options || {});
      const update = projectSession.replace(project, expectedRevision, 'browser');
      const compiled = compileProject(project);
      return sendJson(res, 200, { project, createdRoomId, compiled, revision: update.revision });
    }

    // 5. One-Click Play in UZDoom Endpoint
    if (req.method === 'POST' && pathname === '/api/play') {
      const body = await readJsonBody(req);
      const current = projectSession.snapshot();
      if (Number.isInteger(body.revision) && body.revision !== current.revision) {
        throw Object.assign(new Error(`Project revision conflict: current revision is ${current.revision}.`), { statusCode: 409, currentRevision: current.revision });
      }
      const played = await projectPipeline.playtest(Number.isInteger(body.revision) ? current.project : (body.project || current.project), body);
      return sendJson(res, 200, {
        ...played,
        command: `uzdoom.exe -iwad freedoom-0.13.0/freedoom2.wad -file maps/live_playtest.wad +map MAP01`
      });
    }

    // 6. Export WAD File Endpoint
    if (req.method === 'POST' && pathname === '/api/export-wad') {
      const body = await readJsonBody(req);
      const current = projectSession.snapshot();
      if (Number.isInteger(body.revision) && body.revision !== current.revision) {
        throw Object.assign(new Error(`Project revision conflict: current revision is ${current.revision}.`), { statusCode: 409, currentRevision: current.revision });
      }
      const project = Number.isInteger(body.revision) ? current.project : (body.project || {});
      const exported = projectPipeline.exportWad(project, project.name || 'custom_map');
      const safeName = path.basename(exported.wadPath, '.wad');

      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${safeName}.wad"`,
        'X-Saved-Path': exported.filePath,
        'X-Map-Check': JSON.stringify(exported.diagnostics.summary)
      });
      return res.end(exported.buffer);
    }

    // 7. Save / Load Project JSON to disk
    if (req.method === 'POST' && pathname === '/api/save-project') {
      const body = await readJsonBody(req);
      const project = body.project || {};
      const current = projectSession.snapshot();
      const saved = projectPipeline.saveNamed(project, {
        name: body.name || project.name || 'my_map',
        projectId: current.projectId,
        revision: current.revision,
        overwrite: true
      });
      projectSession.setProjectIdentity(saved.projectId);
      return sendJson(res, 200, { ...saved, jsonPath: path.join(MAPS_DIR, `${saved.name}.json`), revision: current.revision });
    }

    // 8. Static files from public/
    let reqFile = pathname === '/' ? '/index.html' : pathname;
    const fullPath = path.normalize(path.join(PUBLIC_DIR, reqFile));
    if (fullPath.startsWith(PUBLIC_DIR) && fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      const ext = path.extname(fullPath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Cache-Control': 'no-store'
      });
      return fs.createReadStream(fullPath).pipe(res);
    }

    res.writeHead(404);
    res.end('Not found');
  } catch (err) {
    if (!err.statusCode || err.statusCode >= 500) console.error('[Server Error]', err);
    if (!res.writableEnded && !res.destroyed) {
      sendJson(res, err.statusCode || 500, {
        error: err.message || 'Internal Server Error',
        revision: err.currentRevision,
        validationErrors: err.validationErrors,
        diagnostics: err.diagnostics
      });
    }
  }
});

if (!isLoopbackHostname(HOST)) {
  throw new Error(`HOST must be localhost, 127.0.0.1, or ::1; received "${HOST}".`);
}

server.listen(PORT, HOST, () => {
  console.log(`\n======================================================`);
  console.log(`   iDoom Studio running at http://localhost:${PORT}`);
  console.log(`  MCP project token is stored locally in maps/.agent-token`);
  console.log(`======================================================\n`);
});
