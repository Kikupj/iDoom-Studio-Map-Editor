/**
 * iDoom Studio — Main Application Controller
 * Keynote/Freeform-inspired 2D Blueprint Canvas + Multi-Level 3D Floors + Skyboxes + Live 3D Sync
 */

(function () {
  const FALLBACK_DOOR_LOCKS = [
    { value: 0, id: 'unlocked', label: 'Unlocked', color: '#94a3b8', thingType: null, keyName: null },
    { value: 1, id: 'red', label: 'Red Keycard', color: '#ef4444', thingType: 13, keyName: 'Red Keycard' },
    { value: 2, id: 'blue', label: 'Blue Keycard', color: '#3b82f6', thingType: 5, keyName: 'Blue Keycard' },
    { value: 3, id: 'yellow', label: 'Yellow Keycard', color: '#eab308', thingType: 6, keyName: 'Yellow Keycard' }
  ];

  const state = {
    catalog: {
      themes: {},
      skyboxes: {},
      things: [],
      doorLocks: [],
      starterMaps: {},
      wad: { textures: [], flats: [] }
    },
    project: null,
    compiled: null,
    projectRevision: 0,
    projectId: null,
    namedProject: null,
    diskSavedRevision: null,
    diskDirty: true,
    projectDirty: false,
    syncConflict: false,
    syncQueue: Promise.resolve(),
    eventSource: null,
    history: [],
    redoStack: [],
    mapCheck: null,
    mapCheckFilter: 'all',
    storage: null,

    activeTool: 'select', // 'select', 'room', 'octagon', '3dfloor', 'door', 'window', 'stairs', 'lift', 'pillar', 'pool', 'teleporter', 'exit', 'link', 'thing'
    activeThingType: 3001,
    activeActorCategory: 'all',
    viewMode: 'split', // '2d', 'split', '3d', 'walk'

    selectedId: null,
    hoveredId: null,

    // 2D Viewport transform
    cam2D: { x: 256, y: 32, zoom: 0.42 },
    snapGrid: 16,
    mouseWorld: { x: 0, y: 0 },
    contextWorld: { x: 0, y: 0 },

    drag: null,
    spacePressed: false,

    flatImages: new Map(),
    spriteImages: new Map()
  };

  // DOM Elements
  const canvas2D = document.getElementById('canvas2D');
  const ctx2D = canvas2D.getContext('2d');
  const canvas3D = document.getElementById('canvas3D');
  const inspectorContent = document.getElementById('inspectorContent');
  const statusMetrics = document.getElementById('statusMetrics');
  const cursorCoordsBadge = document.getElementById('cursorCoordsBadge');
  const projectNameInput = document.getElementById('projectNameInput');
  const saveStateStatus = document.getElementById('saveStateStatus');
  const projectMenu = document.getElementById('projectMenu');
  const openProjectSelect = document.getElementById('openProjectSelect');
  const mapCheckPanel = document.getElementById('mapCheckPanel');
  const skyboxSelect = document.getElementById('skyboxSelect');
  const stageContainer = document.getElementById('stageContainer');
  const walkthroughOverlay = document.getElementById('walkthroughOverlay');
  const badge3DMode = document.getElementById('badge3DMode');
  const hud3DHint = document.getElementById('hud3DHint');
  const contextMenu = document.getElementById('contextMenu');

  // Initialize 3D Renderer
  const renderer3D = new window.DoomRenderer3D(canvas3D, (pickedId) => {
    selectObject(pickedId);
  });

  function showToast(msg) {
    const container = document.getElementById('toastContainer');
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => el.remove(), 3400);
  }

  function updateSaveStatus() {
    if (!saveStateStatus) return;
    let syncText = state.syncConflict ? 'Sync conflict' : state.projectDirty ? 'Sync pending' : 'Synced to editor';
    const diskOutOfDate = state.diskDirty || (state.namedProject && state.projectRevision !== state.diskSavedRevision);
    const diskText = diskOutOfDate ? 'Not saved to disk' : 'Saved to disk';
    saveStateStatus.textContent = `${syncText} · ${diskText}`;
    saveStateStatus.dataset.state = state.syncConflict ? 'error' : diskOutOfDate ? 'dirty' : 'saved';
    saveStateStatus.title = `${syncText}. ${diskText}. Autosave is a recovery copy and does not replace a named save.`;
  }

  async function refreshDiskMetadata() {
    try {
      const response = await fetch('/api/session');
      if (!response.ok) return;
      const snapshot = await response.json();
      if (snapshot.projectId !== state.projectId || !snapshot.storage) return;
      state.storage = snapshot.storage;
      state.namedProject = snapshot.storage.namedProject || null;
      state.diskSavedRevision = snapshot.storage.savedRevision ?? null;
      state.diskDirty = !snapshot.storage.diskSaved;
      updateSaveStatus();
    } catch { }
  }

  function keepLocalDraft() {
    if (!state.project || (!state.projectDirty && !state.diskDirty && !state.syncConflict)) return;
    try {
      if (projectNameInput.value.trim()) state.project.name = projectNameInput.value.trim();
      localStorage.setItem('idoom-studio-recoverable-draft', JSON.stringify({
        savedAt: new Date().toISOString(),
        projectId: state.projectId,
        project: state.project
      }));
    } catch (error) {
      console.warn('Could not preserve a browser-local recovery draft:', error);
    }
  }

  function clearLocalDraft() {
    try { localStorage.removeItem('idoom-studio-recoverable-draft'); } catch { }
  }

  function renderMapCheck(result = state.mapCheck) {
    if (!result) return;
    state.mapCheck = result;
    const summary = result.summary || { error: 0, warning: 0, info: 0 };
    document.getElementById('mapCheckSummary').textContent = `${summary.error || 0} errors · ${summary.warning || 0} warnings · ${summary.info || 0} notes`;
    const limits = result.limits || [];
    document.getElementById('mapCheckLimit').textContent = limits.length
      ? `Limits: ${limits.join(' ')}`
      : 'Map Check is a static estimate, not Doom physics. Verify gameplay in UZDoom.';
    const list = document.getElementById('mapCheckFindings');
    list.replaceChildren();
    const filter = state.mapCheckFilter || 'all';
    const findings = (result.diagnostics || []).filter(item => filter === 'all' || item.severity === filter);
    if (!findings.length) {
      const empty = document.createElement('p');
      empty.className = 'map-check-limit';
      empty.textContent = filter === 'all' ? 'No static findings. Verify your map in UZDoom before shipping.' : `No ${filter} findings.`;
      list.appendChild(empty);
      return;
    }
    for (const finding of findings) {
      const row = document.createElement('article');
      row.className = 'map-check-item';
      row.dataset.severity = finding.severity;
      const affectedId = finding.affectedIds?.find(id => findItemById(id));
      row.dataset.selectable = String(Boolean(affectedId));
      const severity = document.createElement('span');
      severity.className = 'map-check-severity';
      severity.textContent = finding.severity;
      const content = document.createElement('div');
      content.className = 'map-check-content';
      const title = document.createElement('strong');
      title.textContent = finding.title || finding.code;
      const message = document.createElement('p');
      message.textContent = finding.message || '';
      content.append(title, message);
      if (finding.suggestion) {
        const suggestion = document.createElement('small');
        suggestion.textContent = `Try: ${finding.suggestion}`;
        content.appendChild(suggestion);
      }
      row.append(severity, content);
      if (affectedId) row.addEventListener('click', () => {
        const found = findItemById(affectedId);
        if (found) {
          const item = found.item;
          state.cam2D.x = (item.x || 0) + (item.width || 0) / 2;
          state.cam2D.y = (item.y || 0) + (item.height || 0) / 2;
          state.cam2D.zoom = Math.min(1.2, Math.max(state.cam2D.zoom, 0.65));
          selectObject(affectedId);
          draw2D();
        }
      });
      list.appendChild(row);
    }
  }

  async function runMapCheck({ reveal = true } = {}) {
    if (!state.project) return null;
    try {
      const response = await fetch('/api/map-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: state.project })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Map Check could not run.');
      renderMapCheck(result);
      if (reveal) mapCheckPanel.classList.remove('hidden');
      return result;
    } catch (error) {
      showToast(`Map Check failed: ${error.message}`);
      return null;
    }
  }

  async function checkBeforePlayable(action) {
    const result = await runMapCheck({ reveal: true });
    if (!result) return false;
    if (result.summary.error) {
      showToast(`${action} blocked: Map Check found ${result.summary.error} defined error(s).`);
      return false;
    }
    const warnings = result.summary.warning || 0;
    const notes = result.summary.info || 0;
    if (warnings || notes) {
      return window.confirm(`Map Check found ${warnings} warning(s) and ${notes} informational note(s). These static checks cannot prove gameplay. Continue to ${action.toLowerCase()} and verify the result in UZDoom?`);
    }
    return true;
  }

  async function confirmLeaveCurrentProject() {
    if (!state.projectDirty && !state.diskDirty && !state.syncConflict) return true;
    const saveFirst = window.confirm('This project has changes not saved to its named file. Save it before continuing?');
    if (saveFirst) {
      const saved = await saveCurrentProject();
      if (!saved) return false;
      return true;
    }
    return window.confirm('Discard the unsaved project changes? A server autosave may remain available for recovery.');
  }

  function getDoorLockInfo(value) {
    const locks = state.catalog.doorLocks?.length ? state.catalog.doorLocks : FALLBACK_DOOR_LOCKS;
    return locks.find(lock => lock.value === Number(value)) || FALLBACK_DOOR_LOCKS[0];
  }

  function getDoorKeyWarnings(project = state.project) {
    if (!project) return [];
    const counts = new Map();
    for (const thing of project.things || []) counts.set(thing.type, (counts.get(thing.type) || 0) + 1);
    return (project.smartObjects || []).flatMap(door => {
      if (door.type !== 'door') return [];
      const lock = getDoorLockInfo(door.lock ?? 0);
      if (!lock.value || counts.get(lock.thingType)) return [];
      return [{ doorId: door.id, doorName: door.name || 'Door', lock, message: `${door.name || 'Door'} needs a ${lock.keyName}; no matching keycard is placed.` }];
    });
  }

  function snap(val) {
    const g = document.getElementById('snapGridToggle').checked ? state.snapGrid : 1;
    return Math.round(val / g) * g;
  }

  function screenToWorld(sx, sy) {
    const rect = canvas2D.getBoundingClientRect();
    const cx = rect.width * 0.5;
    const cy = rect.height * 0.5;
    return {
      x: (sx - cx) / state.cam2D.zoom + state.cam2D.x,
      y: -(sy - cy) / state.cam2D.zoom + state.cam2D.y
    };
  }

  function worldToScreen(wx, wy) {
    const rect = canvas2D.getBoundingClientRect();
    const cx = rect.width * 0.5;
    const cy = rect.height * 0.5;
    return {
      x: (wx - state.cam2D.x) * state.cam2D.zoom + cx,
      y: -(wy - state.cam2D.y) * state.cam2D.zoom + cy
    };
  }

  function getFlatImg(name) {
    if (!name) return null;
    const key = name.toUpperCase();
    if (state.flatImages.has(key)) return state.flatImages.get(key);
    const img = new Image();
    img.src = `/api/flat/${encodeURIComponent(key)}`;
    img.onload = () => draw2D();
    state.flatImages.set(key, img);
    return img;
  }

  function getSpriteImg(prefix) {
    if (!prefix) return null;
    const key = prefix.toUpperCase();
    if (state.spriteImages.has(key)) return state.spriteImages.get(key);
    const img = new Image();
    img.src = `/api/sprite/${encodeURIComponent(key)}`;
    img.onload = () => draw2D();
    state.spriteImages.set(key, img);
    return img;
  }

  function pushHistory() {
    if (!state.project) return;
    state.history.push(JSON.stringify(state.project));
    if (state.history.length > 50) state.history.shift();
    state.redoStack = [];
  }

  function undo() {
    if (state.history.length === 0) return;
    state.redoStack.push(JSON.stringify(state.project));
    state.project = JSON.parse(state.history.pop());
    if (skyboxSelect && state.project.skybox) skyboxSelect.value = state.project.skybox;
    compileAndSync();
    renderInspector();
    showToast('Undid last change');
  }

  function redo() {
    if (state.redoStack.length === 0) return;
    state.history.push(JSON.stringify(state.project));
    state.project = JSON.parse(state.redoStack.pop());
    if (skyboxSelect && state.project.skybox) skyboxSelect.value = state.project.skybox;
    compileAndSync();
    renderInspector();
    showToast('Redid change');
  }

  function findItemById(id) {
    if (!state.project || !id) return null;
    for (const r of state.project.rooms || []) {
      if (r.id === id) return { kind: 'room', item: r };
    }
    for (const o of state.project.smartObjects || []) {
      if (o.id === id) return { kind: 'smartObject', item: o };
    }
    for (const t of state.project.things || []) {
      if (t.id === id) return { kind: 'thing', item: t };
    }
    return null;
  }

  function selectObject(id) {
    const changed = state.selectedId !== id;
    state.selectedId = id;
    renderer3D.setSelectedId(id);
    if (changed) inspectorContent.scrollTop = 0;
    renderInspector();
    draw2D();
  }

  async function compileAndSync({ publish = true } = {}) {
    if (!state.project) return;
    if (publish) {
      state.projectDirty = true;
      state.diskDirty = true;
      updateSaveStatus();
    }
    const run = async () => {
      try {
        if (publish) {
          const projectJson = JSON.stringify(state.project);
          const commitRes = await fetch('/api/session/commit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ project: JSON.parse(projectJson), revision: state.projectRevision })
          });
          const commit = await commitRes.json();
          if (!commitRes.ok) {
            state.syncConflict = commitRes.status === 409;
            keepLocalDraft();
            updateSaveStatus();
            if (state.syncConflict) showToast('Another editor/agent change arrived first. Your local map is kept; reload to review the latest revision before continuing.');
            else showToast(`Map sync failed: ${commit.error || 'unknown error'}`);
            return;
          }
          state.projectRevision = commit.revision;
          state.projectId = commit.projectId || state.projectId;
          state.syncConflict = false;
          if (JSON.stringify(state.project) === projectJson) {
            state.projectDirty = false;
            clearLocalDraft();
          }
          state.diskDirty = !state.namedProject || state.projectRevision !== state.diskSavedRevision;
          updateSaveStatus();
        }

        const res = await fetch('/api/compile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project: state.project })
        });
        const compiled = await res.json();
        if (!res.ok) throw new Error(compiled.error || 'Compilation failed.');
        state.compiled = compiled;
        if (compiled.mapCheck) renderMapCheck(compiled.mapCheck);
        const st = compiled.stats || { sectors: 0, linedefs: 0, vertices: 0, things: 0, threeDFloors: 0 };
        const f3d = st.threeDFloors ? ` · ${st.threeDFloors} 3D Floors` : '';
        const keyWarnings = compiled.doorKeyWarnings || getDoorKeyWarnings();
        const warningSummary = keyWarnings.length ? ` · ⚠ ${keyWarnings.length} locked door${keyWarnings.length === 1 ? '' : 's'} missing keycard` : '';
        statusMetrics.textContent = `${st.sectors} Sectors${f3d} · ${st.linedefs} Linedefs · ${st.things} Actors${warningSummary}`;
        statusMetrics.title = keyWarnings.map(warning => warning.message).join('\n') || 'Map compiled successfully.';
        renderer3D.updateScene(compiled, state.selectedId);
        draw2D();
      } catch (err) {
        console.error('Compile/sync error:', err);
        if (publish) {
          state.projectDirty = true;
          state.diskDirty = true;
          keepLocalDraft();
          updateSaveStatus();
          showToast(`Editor sync failed: ${err.message || 'connection unavailable'}. A browser recovery draft was kept.`);
        }
      }
    };
    state.syncQueue = state.syncQueue.catch(() => { }).then(run);
    return state.syncQueue;
  }

  async function applyRemoteProject(update) {
    if (!update || !Number.isInteger(update.revision) || update.revision < state.projectRevision) return;
    if (update.revision === state.projectRevision && (!update.projectId || update.projectId === state.projectId)) return;
    if (JSON.stringify(update.project) === JSON.stringify(state.project)) {
      state.projectRevision = update.revision;
      state.projectId = update.projectId || state.projectId;
      if (state.namedProject && state.storage?.projectId !== state.projectId) state.namedProject = null;
      state.diskDirty = !state.namedProject || state.projectRevision !== state.diskSavedRevision;
      updateSaveStatus();
      refreshDiskMetadata();
      return;
    }
    if (state.projectDirty || state.drag) {
      state.syncConflict = true;
      showToast('An agent updated the shared map while you had local edits. Your edits are preserved; reload to reconcile.');
      return;
    }
    const selected = state.selectedId;
    state.history = [];
    state.redoStack = [];
    state.project = update.project;
    state.projectRevision = update.revision;
    state.projectId = update.projectId || state.projectId;
    if (state.storage?.projectId !== state.projectId) {
      state.namedProject = null;
      state.diskSavedRevision = null;
    }
    state.diskDirty = !state.namedProject || state.projectRevision !== state.diskSavedRevision;
    state.syncConflict = false;
    if (!findItemById(selected)) state.selectedId = null;
    projectNameInput.value = state.project.name || 'Untitled map';
    if (skyboxSelect && state.project.skybox) skyboxSelect.value = state.project.skybox;
    await compileAndSync({ publish: false });
    await refreshDiskMetadata();
    updateSaveStatus();
    renderInspector();
    showToast(`Live map updated by ${update.source === 'browser' ? 'another editor' : 'an AI agent'} (revision ${update.revision}).`);
  }

  function fitView2D() {
    if (!state.project) return;
    const allBoxes = [...(state.project.rooms || []), ...(state.project.smartObjects || [])];
    if (allBoxes.length === 0) {
      state.cam2D = { x: 0, y: 0, zoom: 0.5 };
      draw2D();
      return;
    }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const b of allBoxes) {
      minX = Math.min(minX, b.x || 0);
      minY = Math.min(minY, b.y || 0);
      maxX = Math.max(maxX, (b.x || 0) + (b.width || 256));
      maxY = Math.max(maxY, (b.y || 0) + (b.height || 256));
    }
    state.cam2D.x = (minX + maxX) * 0.5;
    state.cam2D.y = (minY + maxY) * 0.5;
    const rect = canvas2D.getBoundingClientRect();
    const spanX = Math.max(512, (maxX - minX) * 1.35);
    const spanY = Math.max(512, (maxY - minY) * 1.35);
    state.cam2D.zoom = Math.max(0.12, Math.min(1.5, Math.min((rect.width || 600) / spanX, (rect.height || 500) / spanY)));
    draw2D();
  }

  function hitTest2D(wx, wy) {
    if (!state.project) return null;

    const sel = findItemById(state.selectedId);
    if (sel && (sel.kind === 'room' || sel.kind === 'smartObject')) {
      const handles = getBoxHandles(sel.item);
      const tol = 9 / state.cam2D.zoom;
      for (const h of handles) {
        if (Math.abs(wx - h.x) <= tol && Math.abs(wy - h.y) <= tol) {
          return { kind: 'handle', handle: h.id, target: sel.item, targetKind: sel.kind };
        }
      }
    }

    const things = state.project.things || [];
    for (let i = things.length - 1; i >= 0; i--) {
      const t = things[i];
      const cat = state.catalog.things.find(c => c.type === t.type);
      const r = Math.max(18, cat?.radius || 20);
      if (Math.hypot(wx - t.x, wy - t.y) <= r) {
        return { kind: 'thing', item: t, id: t.id };
      }
    }

    const objs = state.project.smartObjects || [];
    for (let i = objs.length - 1; i >= 0; i--) {
      const o = objs[i];
      if (wx >= o.x && wx <= o.x + o.width && wy >= o.y && wy <= o.y + o.height) {
        return { kind: 'smartObject', item: o, id: o.id };
      }
    }

    const rooms = state.project.rooms || [];
    for (let i = rooms.length - 1; i >= 0; i--) {
      const r = rooms[i];
      if (wx >= r.x && wx <= r.x + r.width && wy >= r.y && wy <= r.y + r.height) {
        return { kind: 'room', item: r, id: r.id };
      }
    }

    return null;
  }

  function getBoxHandles(box) {
    const x = box.x || 0, y = box.y || 0, w = box.width || 128, h = box.height || 128;
    return [
      { id: 'nw', x: x, y: y + h },
      { id: 'n', x: x + w * 0.5, y: y + h },
      { id: 'ne', x: x + w, y: y + h },
      { id: 'e', x: x + w, y: y + h * 0.5 },
      { id: 'se', x: x + w, y: y },
      { id: 's', x: x + w * 0.5, y: y },
      { id: 'sw', x: x, y: y },
      { id: 'w', x: x, y: y + h * 0.5 }
    ];
  }

  function draw2D() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas2D.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    if (canvas2D.width !== Math.floor(rect.width * dpr) || canvas2D.height !== Math.floor(rect.height * dpr)) {
      canvas2D.width = Math.floor(rect.width * dpr);
      canvas2D.height = Math.floor(rect.height * dpr);
    }

    const ctx = ctx2D;
    ctx.save();
    ctx.scale(dpr, dpr);

    const W = rect.width;
    const H = rect.height;

    ctx.fillStyle = '#090c12';
    ctx.fillRect(0, 0, W, H);

    const topLeft = screenToWorld(0, 0);
    const botRight = screenToWorld(W, H);
    const minWX = Math.floor(Math.min(topLeft.x, botRight.x) / 64) * 64;
    const maxWX = Math.ceil(Math.max(topLeft.x, botRight.x) / 64) * 64;
    const minWY = Math.floor(Math.min(topLeft.y, botRight.y) / 64) * 64;
    const maxWY = Math.ceil(Math.max(topLeft.y, botRight.y) / 64) * 64;

    ctx.lineWidth = 1;
    for (let gx = minWX; gx <= maxWX; gx += 64) {
      const s = worldToScreen(gx, 0);
      ctx.strokeStyle = (gx === 0)
        ? 'rgba(56, 189, 248, 0.28)'
        : (gx % 256 === 0 ? 'rgba(255, 255, 255, 0.07)' : 'rgba(255, 255, 255, 0.025)');
      ctx.beginPath();
      ctx.moveTo(s.x, 0);
      ctx.lineTo(s.x, H);
      ctx.stroke();
    }
    for (let gy = minWY; gy <= maxWY; gy += 64) {
      const s = worldToScreen(0, gy);
      ctx.strokeStyle = (gy === 0)
        ? 'rgba(56, 189, 248, 0.28)'
        : (gy % 256 === 0 ? 'rgba(255, 255, 255, 0.07)' : 'rgba(255, 255, 255, 0.025)');
      ctx.beginPath();
      ctx.moveTo(0, s.y);
      ctx.lineTo(W, s.y);
      ctx.stroke();
    }

    if (!state.project) {
      ctx.restore();
      return;
    }

    const traceShapePath = (item) => {
      const x = item.x || 0, y = item.y || 0, w = item.width || 128, h = item.height || 128;
      ctx.beginPath();
      if (item.shape === 'octagon') {
        const cut = Math.min(Math.round(Math.min(w, h) * 0.25), 128);
        const pts = [
          { x: x + cut, y },
          { x: x + w - cut, y },
          { x: x + w, y: y + cut },
          { x: x + w, y: y + h - cut },
          { x: x + w - cut, y: y + h },
          { x: x + cut, y: y + h },
          { x, y: y + h - cut },
          { x, y: y + cut }
        ];
        pts.forEach((p, idx) => {
          const sp = worldToScreen(p.x, p.y);
          if (idx === 0) ctx.moveTo(sp.x, sp.y);
          else ctx.lineTo(sp.x, sp.y);
        });
        ctx.closePath();
      } else {
        const p0 = worldToScreen(x, y + h);
        const p1 = worldToScreen(x + w, y);
        ctx.rect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
      }
    };

    // 3. Draw Rooms (and Room Half-Floors / Mezzanines)
    for (const room of state.project.rooms || []) {
      const theme = state.catalog.themes[room.theme || 'techbase'] || {};
      const isSel = room.id === state.selectedId;
      const isHov = room.id === state.hoveredId;

      traceShapePath(room);
      ctx.save();
      ctx.clip();

      ctx.fillStyle = isSel ? 'rgba(10, 132, 255, 0.14)' : 'rgba(30, 41, 59, 0.55)';
      ctx.fill();

      const flatName = room.floorTexture || theme.floor || 'FLOOR4_8';
      const flatImg = getFlatImg(flatName);
      if (flatImg && flatImg.complete && flatImg.naturalWidth > 0) {
        ctx.globalAlpha = 0.26;
        const p0 = worldToScreen(room.x, room.y + room.height);
        const p1 = worldToScreen(room.x + room.width, room.y);
        ctx.drawImage(flatImg, p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
        ctx.globalAlpha = 1.0;
      }

      // Draw Room Half-Floor / Mezzanine overlay if enabled
      if (room.hasHalfFloor) {
        const rx = room.x || 0, ry = room.y || 0, rw = room.width || 256, rh = room.height || 256;
        const side = room.halfFloorSide || 'N';
        let hx = rx, hy = ry, hw = rw, hh = rh;
        if (side === 'N') { hy = ry + rh * 0.5; hh = rh * 0.5; }
        else if (side === 'S') { hh = rh * 0.5; }
        else if (side === 'E') { hx = rx + rw * 0.5; hw = rw * 0.5; }
        else if (side === 'W') { hw = rw * 0.5; }
        const hp0 = worldToScreen(hx, hy + hh);
        const hp1 = worldToScreen(hx + hw, hy);
        ctx.fillStyle = 'rgba(56, 189, 248, 0.18)';
        ctx.fillRect(hp0.x, hp0.y, hp1.x - hp0.x, hp1.y - hp0.y);
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.75)';
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1.5;
        ctx.strokeRect(hp0.x, hp0.y, hp1.x - hp0.x, hp1.y - hp0.y);
        ctx.setLineDash([]);
        ctx.fillStyle = '#bae6fd';
        ctx.font = '700 9.5px "SF Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`MEZZANINE Z:${room.halfFloorHeight ?? 64}u`, (hp0.x + hp1.x) * 0.5, (hp0.y + hp1.y) * 0.5);
      }

      ctx.restore();

      traceShapePath(room);
      ctx.lineWidth = isSel ? 2.5 : (isHov ? 2 : 1.5);
      ctx.strokeStyle = isSel ? '#38bdf8' : (theme.accentColor || '#64748b');
      ctx.stroke();

      const centerS = worldToScreen(room.x + room.width * 0.5, room.y + room.height * 0.5);
      if (room.width * state.cam2D.zoom > 70) {
        ctx.fillStyle = 'rgba(243, 245, 248, 0.85)';
        ctx.font = '600 11.5px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(room.name || 'Room', centerS.x, centerS.y - 4);

        const skyBadge = (room.ceilingTexture === 'F_SKY1' || room.theme === 'outdoor') ? ' · ☁ SKY' : '';
        ctx.fillStyle = 'rgba(155, 163, 180, 0.72)';
        ctx.font = '10px "SF Mono", Consolas, monospace';
        ctx.fillText(`${room.width}×${room.height}u · F:${room.floorHeight ?? 0} C:${room.ceilingHeight ?? 128}${skyBadge}`, centerS.x, centerS.y + 10);
      }
    }

    // 4. Draw Smart Architectural Objects (including Multi-Level 3D Floors / Bridges!)
    const objStyles = {
      '3dfloor': { fill: 'rgba(14, 165, 233, 0.26)', stroke: '#38bdf8', badge: '3D FLOOR' },
      door: { fill: 'rgba(245, 158, 11, 0.28)', stroke: '#f59e0b', badge: 'DOOR' },
      window: { fill: 'rgba(56, 189, 248, 0.24)', stroke: '#38bdf8', badge: 'WIN' },
      stairs: { fill: 'rgba(168, 85, 247, 0.24)', stroke: '#c084fc', badge: 'STAIRS' },
      lift: { fill: 'rgba(234, 179, 8, 0.28)', stroke: '#facc15', badge: 'LIFT' },
      pillar: { fill: 'rgba(15, 23, 42, 0.92)', stroke: '#94a3b8', badge: 'PILLAR' },
      pool: { fill: 'rgba(16, 185, 129, 0.28)', stroke: '#10b981', badge: 'POOL' },
      teleporter: { fill: 'rgba(236, 72, 153, 0.32)', stroke: '#f472b6', badge: 'TELE' },
      exit: { fill: 'rgba(239, 68, 68, 0.34)', stroke: '#f87171', badge: 'EXIT' },
      switch: { fill: 'rgba(59, 130, 246, 0.32)', stroke: '#60a5fa', badge: 'SWITCH' }
    };

    for (const obj of state.project.smartObjects || []) {
      const st = objStyles[obj.type] || objStyles.door;
      const doorLock = obj.type === 'door' ? getDoorLockInfo(obj.lock ?? 0) : null;
      const isSel = obj.id === state.selectedId;
      const p0 = worldToScreen(obj.x, obj.y + obj.height);
      const p1 = worldToScreen(obj.x + obj.width, obj.y);
      const sw = p1.x - p0.x;
      const sh = p1.y - p0.y;

      ctx.fillStyle = st.fill;
      ctx.fillRect(p0.x, p0.y, sw, sh);

      // Diagonal catwalk grating pattern for 3D Floors / Bridges
      if (obj.type === '3dfloor') {
        ctx.save();
        ctx.beginPath();
        ctx.rect(p0.x, p0.y, sw, sh);
        ctx.clip();
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
        ctx.lineWidth = 1;
        for (let d = -sh; d < sw + sh; d += 14) {
          ctx.beginPath();
          ctx.moveTo(p0.x + d, p0.y);
          ctx.lineTo(p0.x + d - sh, p1.y);
          ctx.stroke();
        }
        ctx.restore();
      }

      if (obj.type === 'stairs') {
        const steps = Math.max(2, obj.steps || 4);
        const dir = obj.direction || (obj.width >= obj.height ? 'E' : 'N');
        ctx.strokeStyle = 'rgba(192, 132, 252, 0.55)';
        ctx.lineWidth = 1;
        for (let s = 1; s < steps; s++) {
          const t = s / steps;
          ctx.beginPath();
          if (dir === 'E' || dir === 'W') {
            const lx = p0.x + sw * t;
            ctx.moveTo(lx, p0.y);
            ctx.lineTo(lx, p1.y);
          } else {
            const ly = p0.y + sh * t;
            ctx.moveTo(p0.x, ly);
            ctx.lineTo(p1.x, ly);
          }
          ctx.stroke();
        }
      }

      if (obj.type === 'pillar' && obj.solid !== false) {
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.4)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y);
        ctx.moveTo(p1.x, p0.y); ctx.lineTo(p0.x, p1.y);
        ctx.stroke();
      }

      ctx.save();
      if (obj.type === '3dfloor') ctx.setLineDash([6, 3]);
      ctx.lineWidth = isSel ? 2.5 : 1.6;
      ctx.strokeStyle = isSel ? '#ffffff' : (doorLock?.value ? doorLock.color : st.stroke);
      ctx.strokeRect(p0.x, p0.y, sw, sh);
      ctx.restore();

      if (Math.max(sw, sh) > 28) {
        ctx.fillStyle = '#fff';
        ctx.font = '700 9.5px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        const label = obj.type === '3dfloor' ? `3D BRIDGE (Z:${obj.topZ ?? 64}u)` : (doorLock?.value ? `${doorLock.id.toUpperCase()} KEY` : st.badge);
        if (doorLock?.value) ctx.fillStyle = doorLock.color;
        ctx.fillText(label, p0.x + sw * 0.5, p0.y + sh * 0.5 + 3);
      }
    }

    // 5. Draw Compiled Linedef Overlay
    if (state.compiled && state.compiled.linedefs && state.compiled.vertices) {
      const verts = state.compiled.vertices;
      for (const ld of state.compiled.linedefs) {
        const va = verts[ld.v1];
        const vb = verts[ld.v2];
        if (!va || !vb) continue;
        const sa = worldToScreen(va.x, va.y);
        const sb = worldToScreen(vb.x, vb.y);
        ctx.beginPath();
        ctx.moveTo(sa.x, sa.y);
        ctx.lineTo(sb.x, sb.y);
        if (ld.special > 0) {
          ctx.strokeStyle = '#fbbf24';
          ctx.lineWidth = 2.2;
        } else if (!ld.twoSided) {
          ctx.strokeStyle = 'rgba(226, 232, 240, 0.78)';
          ctx.lineWidth = 1.8;
        } else {
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.32)';
          ctx.lineWidth = 1.0;
        }
        ctx.stroke();
      }
    }

    // 6. Draw Smart Logic Connection Curves
    for (const link of state.project.links || []) {
      const src = findItemById(link.sourceId)?.item;
      const dst = findItemById(link.targetId)?.item;
      if (!src || !dst) continue;
      const sx = (src.x || 0) + (src.width || 0) * 0.5;
      const sy = (src.y || 0) + (src.height || 0) * 0.5;
      const dx = (dst.x || 0) + (dst.width || 0) * 0.5;
      const dy = (dst.y || 0) + (dst.height || 0) * 0.5;
      const pA = worldToScreen(sx, sy);
      const pB = worldToScreen(dx, dy);

      ctx.save();
      ctx.strokeStyle = '#c084fc';
      ctx.lineWidth = 2.2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(pA.x, pA.y);
      ctx.quadraticCurveTo((pA.x + pB.x) * 0.5, Math.min(pA.y, pB.y) - 36, pB.x, pB.y);
      ctx.stroke();
      ctx.restore();
    }

    // 7. Draw Things / Actors
    for (const th of state.project.things || []) {
      const cat = state.catalog.things.find(c => c.type === th.type) || {
        name: `Thing ${th.type}`,
        color: '#38bdf8',
        radius: 16
      };
      const sp = worldToScreen(th.x, th.y);
      const rad = Math.max(9, (cat.radius || 16) * state.cam2D.zoom);
      const isSel = th.id === state.selectedId;

      ctx.beginPath();
      ctx.arc(sp.x, sp.y, rad, 0, Math.PI * 2);
      ctx.fillStyle = isSel ? 'rgba(56, 189, 248, 0.38)' : 'rgba(15, 23, 42, 0.78)';
      ctx.fill();
      ctx.lineWidth = isSel ? 2.5 : 1.5;
      ctx.strokeStyle = isSel ? '#ffffff' : (cat.color || '#38bdf8');
      ctx.stroke();

      if (cat.sprite) {
        const sprImg = getSpriteImg(cat.sprite);
        if (sprImg && sprImg.complete && sprImg.naturalWidth > 0) {
          const size = Math.max(16, rad * 1.6);
          ctx.drawImage(sprImg, sp.x - size * 0.5, sp.y - size * 0.5, size, size);
        }
      }

      const angRad = ((th.angle || 0) * Math.PI) / 180;
      const ax = sp.x + Math.cos(angRad) * (rad + 6);
      const ay = sp.y - Math.sin(angRad) * (rad + 6);
      ctx.strokeStyle = isSel ? '#ffffff' : (cat.color || '#38bdf8');
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sp.x + Math.cos(angRad) * (rad * 0.5), sp.y - Math.sin(angRad) * (rad * 0.5));
      ctx.lineTo(ax, ay);
      ctx.stroke();
    }

    // 8. Selection Handles
    const sel = findItemById(state.selectedId);
    if (sel && (sel.kind === 'room' || sel.kind === 'smartObject')) {
      const handles = getBoxHandles(sel.item);
      for (const h of handles) {
        const sp = worldToScreen(h.x, h.y);
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#0a84ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.rect(sp.x - 4.5, sp.y - 4.5, 9, 9);
        ctx.fill();
        ctx.stroke();
      }
    }

    // 9. Active Creation / Link Rubberband
    if (state.drag && state.drag.kind === 'create') {
      const p0 = worldToScreen(state.drag.box.x, state.drag.box.y + state.drag.box.height);
      const p1 = worldToScreen(state.drag.box.x + state.drag.box.width, state.drag.box.y);
      ctx.fillStyle = 'rgba(10, 132, 255, 0.22)';
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.fillRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
      ctx.strokeRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);

      ctx.fillStyle = '#fff';
      ctx.font = '600 11px "SF Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(
        `${state.drag.box.width} × ${state.drag.box.height} u`,
        (p0.x + p1.x) * 0.5,
        (p0.y + p1.y) * 0.5 + 4
      );
    } else if (state.drag && state.drag.kind === 'link') {
      const pA = worldToScreen(state.drag.startX, state.drag.startY);
      const pB = worldToScreen(state.mouseWorld.x, state.mouseWorld.y);
      ctx.strokeStyle = '#f472b6';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(pA.x, pA.y);
      ctx.lineTo(pB.x, pB.y);
      ctx.stroke();
    }

    ctx.restore();
  }

  // Contextual Apple Inspector
  function renderInspector() {
    const sel = findItemById(state.selectedId);

    // 1. Actor / Thing Inspector
    if (state.activeTool === 'thing' || (sel && sel.kind === 'thing')) {
      const th = sel?.kind === 'thing' ? sel.item : null;
      const currentType = th ? th.type : state.activeThingType;

      let html = '';
      if (th) {
        const cat = state.catalog.things.find(c => c.type === th.type) || { name: 'Actor' };
        html += `
          <div class="insp-card">
            <div class="insp-header">
              <span class="insp-title">${cat.name}</span>
              <span class="insp-badge">Actor</span>
            </div>
            <div class="field-row">
              <label>Position X / Y</label>
              <span class="range-val" style="width:auto">${th.x}, ${th.y}</span>
            </div>
            <div class="field-row">
              <label>Facing Angle</label>
              <input type="range" id="inspThingAngle" min="0" max="315" step="45" value="${th.angle || 0}" />
              <span class="range-val">${th.angle || 0}°</span>
            </div>
            <div class="preset-pills">
              ${[0, 45, 90, 135, 180, 225, 270, 315].map(a =>
          `<button class="mini-pill ${th.angle === a ? 'active' : ''}" data-angle="${a}">${a}°</button>`
        ).join('')}
            </div>
            <div class="field-row">
              <label>Ambush (Deaf)</label>
              <input type="checkbox" id="inspThingAmbush" ${th.ambush ? 'checked' : ''} />
            </div>
            <button id="inspDeleteBtn" class="pill-btn subtle-btn full-width" style="color:#ff6b6b">Delete Actor</button>
          </div>
        `;
      }

      const actorCategories = [
        { id: 'all', label: 'All' }, { id: 'keys', label: 'Keys' }, { id: 'pickups', label: 'Pickups' },
        { id: 'weapons', label: 'Weapons' }, { id: 'monsters', label: 'Monsters' }, { id: 'props', label: 'Props' }, { id: 'starts', label: 'Starts' }
      ];
      const visibleActors = state.catalog.things.filter(item => state.activeActorCategory === 'all' || item.category === state.activeActorCategory);
      html += `
        <div class="insp-card">
          <div class="insp-section-title">Actor Palette (Click Canvas to Place)</div>
          <div class="actor-category-tabs">
            ${actorCategories.map(category => `<button class="mini-pill ${state.activeActorCategory === category.id ? 'active' : ''}" data-actor-category="${category.id}">${category.label}</button>`).join('')}
          </div>
          <div class="actor-grid">
            ${visibleActors.map(item => `
              <button class="actor-card ${item.type === currentType ? 'active' : ''}" data-thing-type="${item.type}">
                <img src="/api/sprite/${item.sprite}" alt="${item.name}" />
                <span>${item.name}</span>
              </button>
            `).join('')}
          </div>
        </div>
      `;

      inspectorContent.innerHTML = html;

      inspectorContent.querySelectorAll('[data-actor-category]').forEach(btn => {
        btn.addEventListener('click', () => {
          state.activeActorCategory = btn.dataset.actorCategory;
          const filtered = state.catalog.things.filter(item => state.activeActorCategory === 'all' || item.category === state.activeActorCategory);
          if (filtered.length && !filtered.some(item => item.type === state.activeThingType)) state.activeThingType = filtered[0].type;
          renderInspector();
        });
      });

      inspectorContent.querySelectorAll('[data-thing-type]').forEach(btn => {
        btn.addEventListener('click', () => {
          const tType = Number(btn.dataset.thingType);
          state.activeThingType = tType;
          if (th) {
            pushHistory();
            th.type = tType;
            compileAndSync();
          }
          renderInspector();
        });
      });

      inspectorContent.querySelectorAll('[data-angle]').forEach(btn => {
        btn.addEventListener('click', () => {
          if (!th) return;
          pushHistory();
          th.angle = Number(btn.dataset.angle);
          compileAndSync();
          renderInspector();
        });
      });

      const angSlider = document.getElementById('inspThingAngle');
      if (angSlider && th) {
        angSlider.addEventListener('input', () => {
          th.angle = Number(angSlider.value);
          compileAndSync();
          renderInspector();
        });
      }

      const ambushChk = document.getElementById('inspThingAmbush');
      if (ambushChk && th) {
        ambushChk.addEventListener('change', () => {
          pushHistory();
          th.ambush = ambushChk.checked;
          compileAndSync();
        });
      }

      document.getElementById('inspDeleteBtn')?.addEventListener('click', deleteSelected);
      return;
    }

    // 2. Room Space Inspector (with Multi-Level / Half-Floor Mezzanine & Skybox Controls!)
    if (sel && sel.kind === 'room') {
      const r = sel.item;
      const theme = state.catalog.themes[r.theme || 'techbase'] || state.catalog.themes.techbase || {};
      const wallTex = r.wallTexture || theme.wall || 'STARTAN2';
      const floorTex = r.floorTexture || theme.floor || 'FLOOR4_8';
      const ceilTex = r.ceilingTexture || theme.ceiling || 'CEIL3_5';
      const floorH = Number.isFinite(r.floorHeight) ? r.floorHeight : 0;
      const ceilH = Number.isFinite(r.ceilingHeight) ? r.ceilingHeight : 128;
      const roomHeight = Math.max(16, ceilH - floorH);
      const lockRoomHeight = r.lockRoomHeight !== false;
      const defaultMezzH = Math.round((floorH + ceilH) * 0.5);

      inspectorContent.innerHTML = `
        <div class="insp-card">
          <div class="insp-header">
            <span class="insp-title">Room Space</span>
            <span class="insp-badge">${r.shape === 'octagon' ? 'Octagon' : 'Rectangle'}</span>
          </div>
          <div class="field-row">
            <label>Name</label>
            <input type="text" id="inspRoomName" value="${r.name || 'Room'}" />
          </div>
          <div class="field-row">
            <label>Geometry</label>
            <select id="inspRoomShape">
              <option value="rect" ${r.shape !== 'octagon' ? 'selected' : ''}>Rectangle</option>
              <option value="octagon" ${r.shape === 'octagon' ? 'selected' : ''}>Octagonal Chamber</option>
            </select>
          </div>
          <div class="field-row">
            <label>Footprint (W × H)</label>
            <span class="range-val" style="width:auto">${r.width} × ${r.height} u</span>
          </div>
        </div>

        <div class="insp-card">
          <div class="insp-section-title">Room Heights & Elevation</div>

          <!-- 1. Room Height (Headroom = Ceiling - Floor) -->
          <div class="height-control-group">
            <div class="height-top-row">
              <label>Room Height (Headroom)</label>
              <div class="stepper-cluster">
                <button class="step-btn" data-step-target="height" data-step="-16">-16</button>
                <input type="number" id="numRoomHeight" class="num-input-compact" step="8" min="16" max="2048" value="${roomHeight}" />
                <button class="step-btn" data-step-target="height" data-step="16">+16</button>
              </div>
            </div>
            <div class="field-row">
              <input type="range" id="inspRoomHeight" min="32" max="768" step="8" value="${roomHeight}" />
            </div>
            <div class="preset-pills">
              ${[96, 128, 160, 192, 256, 384].map(h =>
        `<button class="mini-pill ${roomHeight === h ? 'active' : ''}" data-preset-height="${h}">${h}u</button>`
      ).join('')}
            </div>
          </div>

          <!-- 2. Floor Elevation -->
          <div class="height-control-group">
            <div class="height-top-row">
              <label>Floor Elevation (Z)</label>
              <div class="stepper-cluster">
                <button class="step-btn" data-step-target="floor" data-step="-16">-16</button>
                <input type="number" id="numFloorH" class="num-input-compact" step="8" min="-1024" max="1024" value="${floorH}" />
                <button class="step-btn" data-step-target="floor" data-step="16">+16</button>
              </div>
            </div>
            <div class="field-row">
              <input type="range" id="inspFloorH" min="-256" max="512" step="8" value="${floorH}" />
            </div>
            <label style="font-size:11px;color:var(--text-secondary);display:flex;align-items:center;gap:6px;cursor:pointer">
              <input type="checkbox" id="chkLockRoomHeight" ${lockRoomHeight ? 'checked' : ''} />
              <span>Move Ceiling with Floor (keep ${roomHeight}u height)</span>
            </label>
          </div>

          <!-- 3. Ceiling Elevation -->
          <div class="height-control-group">
            <div class="height-top-row">
              <label>Ceiling Elevation (Z)</label>
              <div class="stepper-cluster">
                <button class="step-btn" data-step-target="ceiling" data-step="-16">-16</button>
                <input type="number" id="numCeilH" class="num-input-compact" step="8" min="-512" max="2048" value="${ceilH}" />
                <button class="step-btn" data-step-target="ceiling" data-step="16">+16</button>
              </div>
            </div>
            <div class="field-row">
              <input type="range" id="inspCeilH" min="0" max="1024" step="8" value="${ceilH}" />
            </div>
          </div>

          <!-- 4. Brightness & Skybox -->
          <div class="field-row">
            <label>Brightness</label>
            <input type="range" id="inspLight" min="64" max="255" step="8" value="${r.lightLevel ?? 168}" />
            <span class="range-val" id="valLight">${r.lightLevel ?? 168}</span>
          </div>
          <div class="preset-pills">
            <button class="mini-pill ${ceilTex === 'F_SKY1' ? 'active' : ''}" id="btnToggleSky">
              ${ceilTex === 'F_SKY1' ? '🌌 Skybox Ceiling ON' : '🌌 Open Skybox Ceiling'}
            </button>
            <button class="mini-pill ${r.horizonWalls ? 'active' : ''}" id="btnToggleHorizon" title="Render outer walls as infinite panoramic skybox horizon">
              ${r.horizonWalls ? '🌅 Horizon Walls ON' : '🌅 Sky Horizon Walls'}
            </button>
          </div>
        </div>

        <div class="insp-card">
          <div class="insp-section-title">Multi-Level / Half-Floor Mezzanine</div>
          <div class="field-row">
            <label>Enable 3D Half-Floor</label>
            <input type="checkbox" id="inspHalfFloorToggle" ${r.hasHalfFloor ? 'checked' : ''} />
          </div>
          ${r.hasHalfFloor ? `
            <div class="field-row">
              <label>Mezzanine Span</label>
              <select id="inspHalfFloorSide">
                <option value="N" ${r.halfFloorSide === 'N' ? 'selected' : ''}>North Half (Balcony)</option>
                <option value="S" ${r.halfFloorSide === 'S' ? 'selected' : ''}>South Half (Balcony)</option>
                <option value="E" ${r.halfFloorSide === 'E' ? 'selected' : ''}>East Half (Balcony)</option>
                <option value="W" ${r.halfFloorSide === 'W' ? 'selected' : ''}>West Half (Balcony)</option>
                <option value="FULL" ${r.halfFloorSide === 'FULL' ? 'selected' : ''}>Full 2nd Story Deck</option>
              </select>
            </div>
            <div class="field-row">
              <label>Deck Height (Z)</label>
              <input type="range" id="inspHalfFloorH" min="-64" max="512" step="8" value="${r.halfFloorHeight ?? defaultMezzH}" />
              <span class="range-val" id="valHalfFloorH">${r.halfFloorHeight ?? defaultMezzH}u</span>
            </div>
            <div class="field-row">
              <label>Slab Thickness</label>
              <input type="range" id="inspHalfFloorThick" min="4" max="32" step="4" value="${r.halfFloorThickness ?? 8}" />
              <span class="range-val" id="valHalfFloorThick">${r.halfFloorThickness ?? 8}u</span>
            </div>
          ` : ''}
        </div>

        <div class="insp-card">
          <div class="insp-section-title">Curated Material Theme</div>
          <div class="theme-grid">
            ${Object.values(state.catalog.themes).map(t => `
              <button class="theme-card ${(r.theme || 'techbase') === t.id ? 'active' : ''}" data-theme="${t.id}">
                <img class="theme-thumb" src="/api/texture/${t.wall}" alt="${t.name}" />
                <div class="theme-meta">
                  <strong>${t.name}</strong>
                  <span>${t.wall}</span>
                </div>
              </button>
            `).join('')}
          </div>
        </div>

        <div class="insp-card">
          <div class="insp-section-title">Surface Textures (Click to Browse WAD)</div>
          <div class="swatch-row">
            <button class="swatch-btn" data-pick-surface="wall">
              <img src="/api/texture/${wallTex}" alt="${wallTex}" />
              <span class="swatch-label">Walls</span>
              <span class="swatch-name">${wallTex}</span>
            </button>
            <button class="swatch-btn" data-pick-surface="floor">
              <img src="/api/flat/${floorTex}" alt="${floorTex}" />
              <span class="swatch-label">Floor</span>
              <span class="swatch-name">${floorTex}</span>
            </button>
            <button class="swatch-btn" data-pick-surface="ceiling">
              <img src="${ceilTex === 'F_SKY1' ? `/api/texture/${state.compiled?.skybox?.texture || 'SKY1'}` : `/api/flat/${ceilTex}`}" alt="${ceilTex}" />
              <span class="swatch-label">Ceiling</span>
              <span class="swatch-name">${ceilTex}</span>
            </button>
          </div>
        </div>

        <div class="insp-card">
          <button id="inspAddSmartWingHere" class="pill-btn magic-btn full-width">✨ Attach Smart Wing to Room</button>
          <button id="inspDeleteBtn" class="pill-btn subtle-btn full-width" style="color:#ff6b6b">Delete Room</button>
        </div>
      `;

      document.getElementById('inspRoomName').addEventListener('change', e => {
        pushHistory();
        r.name = e.target.value;
        draw2D();
      });

      document.getElementById('inspRoomShape').addEventListener('change', e => {
        pushHistory();
        r.shape = e.target.value;
        compileAndSync();
        renderInspector();
      });

      // Synchronized Room Height / Floor / Ceiling Controls
      const syncRoomHeightUI = () => {
        const fh = Number.isFinite(r.floorHeight) ? r.floorHeight : 0;
        const ch = Number.isFinite(r.ceilingHeight) ? r.ceilingHeight : 128;
        const rh = Math.max(16, ch - fh);
        document.getElementById('numRoomHeight').value = rh;
        document.getElementById('inspRoomHeight').value = rh;
        document.getElementById('numFloorH').value = fh;
        document.getElementById('inspFloorH').value = fh;
        document.getElementById('numCeilH').value = ch;
        document.getElementById('inspCeilH').value = ch;
      };

      const applyRoomHeight = (newRH) => {
        const clampedRH = Math.max(16, Math.round(newRH));
        r.ceilingHeight = (r.floorHeight ?? 0) + clampedRH;
        syncRoomHeightUI();
        compileAndSync();
      };

      const applyFloorH = (newFH) => {
        const oldFH = r.floorHeight ?? 0;
        const oldCH = r.ceilingHeight ?? 128;
        const oldRH = Math.max(16, oldCH - oldFH);
        r.floorHeight = Math.round(newFH);
        if (r.lockRoomHeight !== false) {
          r.ceilingHeight = r.floorHeight + oldRH;
        } else if (r.ceilingHeight < r.floorHeight + 16) {
          r.ceilingHeight = r.floorHeight + 16;
        }
        syncRoomHeightUI();
        compileAndSync();
      };

      const applyCeilH = (newCH) => {
        r.ceilingHeight = Math.max((r.floorHeight ?? 0) + 16, Math.round(newCH));
        syncRoomHeightUI();
        compileAndSync();
      };

      document.getElementById('chkLockRoomHeight').addEventListener('change', e => {
        r.lockRoomHeight = e.target.checked;
      });

      document.getElementById('inspRoomHeight').addEventListener('change', () => pushHistory());
      document.getElementById('inspRoomHeight').addEventListener('input', e => applyRoomHeight(Number(e.target.value)));
      document.getElementById('numRoomHeight').addEventListener('change', e => { pushHistory(); applyRoomHeight(Number(e.target.value)); });

      document.getElementById('inspFloorH').addEventListener('change', () => pushHistory());
      document.getElementById('inspFloorH').addEventListener('input', e => applyFloorH(Number(e.target.value)));
      document.getElementById('numFloorH').addEventListener('change', e => { pushHistory(); applyFloorH(Number(e.target.value)); });

      document.getElementById('inspCeilH').addEventListener('change', () => pushHistory());
      document.getElementById('inspCeilH').addEventListener('input', e => applyCeilH(Number(e.target.value)));
      document.getElementById('numCeilH').addEventListener('change', e => { pushHistory(); applyCeilH(Number(e.target.value)); });

      inspectorContent.querySelectorAll('[data-preset-height]').forEach(btn => {
        btn.addEventListener('click', () => {
          pushHistory();
          applyRoomHeight(Number(btn.dataset.presetHeight));
          renderInspector();
        });
      });

      inspectorContent.querySelectorAll('[data-step-target]').forEach(btn => {
        btn.addEventListener('click', () => {
          pushHistory();
          const step = Number(btn.dataset.step);
          const target = btn.dataset.stepTarget;
          if (target === 'height') applyRoomHeight(roomHeight + step);
          else if (target === 'floor') applyFloorH((r.floorHeight ?? 0) + step);
          else if (target === 'ceiling') applyCeilH((r.ceilingHeight ?? 128) + step);
          renderInspector();
        });
      });

      // Multi-Level Half-Floor Mezzanine listeners
      document.getElementById('inspHalfFloorToggle').addEventListener('change', e => {
        pushHistory();
        r.hasHalfFloor = e.target.checked;
        if (r.hasHalfFloor && !Number.isFinite(r.halfFloorHeight)) {
          r.halfFloorHeight = defaultMezzH;
          r.halfFloorSide = r.halfFloorSide || 'N';
          r.halfFloorThickness = 8;
        }
        compileAndSync();
        renderInspector();
      });

      const hfSide = document.getElementById('inspHalfFloorSide');
      if (hfSide) {
        hfSide.addEventListener('change', () => {
          pushHistory();
          r.halfFloorSide = hfSide.value;
          compileAndSync();
          draw2D();
        });
      }

      const bindSlider = (id, valId, prop, suffix = '') => {
        const el = document.getElementById(id);
        const vEl = document.getElementById(valId);
        if (!el || !vEl) return;
        el.addEventListener('change', () => pushHistory());
        el.addEventListener('input', () => {
          r[prop] = Number(el.value);
          vEl.textContent = `${r[prop]}${suffix}`;
          compileAndSync();
        });
      };
      bindSlider('inspHalfFloorH', 'valHalfFloorH', 'halfFloorHeight', 'u');
      bindSlider('inspHalfFloorThick', 'valHalfFloorThick', 'halfFloorThickness', 'u');
      bindSlider('inspLight', 'valLight', 'lightLevel', '');

      inspectorContent.querySelectorAll('[data-theme]').forEach(btn => {
        btn.addEventListener('click', () => {
          pushHistory();
          const tId = btn.dataset.theme;
          const thObj = state.catalog.themes[tId];
          r.theme = tId;
          delete r.wallTexture;
          delete r.floorTexture;
          delete r.ceilingTexture;
          if (thObj) r.lightLevel = thObj.light;
          compileAndSync();
          renderInspector();
        });
      });

      document.getElementById('btnToggleSky').addEventListener('click', () => {
        pushHistory();
        r.ceilingTexture = (ceilTex === 'F_SKY1') ? 'CEIL3_5' : 'F_SKY1';
        compileAndSync();
        renderInspector();
      });

      document.getElementById('btnToggleHorizon').addEventListener('click', () => {
        pushHistory();
        r.horizonWalls = !r.horizonWalls;
        if (r.horizonWalls) r.ceilingTexture = 'F_SKY1';
        compileAndSync();
        renderInspector();
      });

      inspectorContent.querySelectorAll('[data-pick-surface]').forEach(btn => {
        btn.addEventListener('click', () => {
          const surf = btn.dataset.pickSurface;
          openTextureModal(surf === 'wall' ? 'texture' : 'flat', chosen => {
            pushHistory();
            if (surf === 'wall') r.wallTexture = chosen;
            else if (surf === 'floor') r.floorTexture = chosen;
            else if (surf === 'ceiling') r.ceilingTexture = chosen;
            compileAndSync();
            renderInspector();
          });
        });
      });

      document.getElementById('inspAddSmartWingHere').addEventListener('click', openMagicModal);
      document.getElementById('inspDeleteBtn').addEventListener('click', deleteSelected);
      return;
    }

    // 3. Smart Object Selected (including 3D Floor / Bridge!)
    if (sel && sel.kind === 'smartObject') {
      const o = sel.item;
      let controlsHtml = '';

      if (o.type === '3dfloor') {
        const topTex = o.topTexture || 'STEP2';
        const botTex = o.bottomTexture || 'FLAT20';
        const edgeTex = o.edgeTexture || 'SUPPORT3';
        controlsHtml = `
          <div class="field-row">
            <label>3D Volume Style</label>
            <select id="insp3DStyle">
              <option value="solid" ${(o.style || 'solid') === 'solid' ? 'selected' : ''}>🌉 Solid Walkable Bridge / Deck</option>
              <option value="glass" ${o.style === 'glass' ? 'selected' : ''}>💠 Translucent Energy / Glass Bridge</option>
              <option value="water" ${o.style === 'water' ? 'selected' : ''}>🌊 Swimmable 3D Deep Water Volume</option>
            </select>
          </div>
          <div class="field-row">
            <label>Walkable Top Z</label>
            <input type="range" id="insp3DTopZ" min="-64" max="320" step="8" value="${o.topZ ?? 64}" />
            <span class="range-val" id="val3DTopZ">${o.topZ ?? 64}u</span>
          </div>
          <div class="field-row">
            <label>Slab Thickness</label>
            <input type="range" id="insp3DThick" min="4" max="64" step="4" value="${o.thickness ?? 8}" />
            <span class="range-val" id="val3DThick">${o.thickness ?? 8}u</span>
          </div>
          <div class="field-row">
            <label>Under-Bridge Light</label>
            <input type="range" id="insp3DUnderLight" min="64" max="255" step="8" value="${o.underLight ?? 136}" />
            <span class="range-val" id="val3DUnderLight">${o.underLight ?? 136}</span>
          </div>
          <div class="swatch-row" style="margin-top:4px">
            <button class="swatch-btn" id="pick3DTop">
              <img src="/api/flat/${topTex}" alt="${topTex}" />
              <span class="swatch-label">Top Deck</span>
              <span class="swatch-name">${topTex}</span>
            </button>
            <button class="swatch-btn" id="pick3DEdge">
              <img src="/api/texture/${edgeTex}" alt="${edgeTex}" />
              <span class="swatch-label">Edge Trim</span>
              <span class="swatch-name">${edgeTex}</span>
            </button>
            <button class="swatch-btn" id="pick3DBot">
              <img src="/api/flat/${botTex}" alt="${botTex}" />
              <span class="swatch-label">Underside</span>
              <span class="swatch-name">${botTex}</span>
            </button>
          </div>
        `;
      } else if (o.type === 'door') {
        const doorTex = o.wallTexture || 'BIGDOOR2';
        const currentLock = getDoorLockInfo(o.lock ?? 0);
        const matchingKeys = state.project.things.filter(thing => thing.type === currentLock.thingType).length;
        const doorKeyWarning = currentLock.value && matchingKeys === 0;
        controlsHtml = `
          <div class="field-row">
            <label>Required Keycard</label>
            <select id="inspDoorLock">
              ${(state.catalog.doorLocks?.length ? state.catalog.doorLocks : FALLBACK_DOOR_LOCKS).map(lock => `<option value="${lock.value}" ${lock.value === Number(o.lock || 0) ? 'selected' : ''}>${lock.value ? lock.label : 'No lock'}</option>`).join('')}
            </select>
          </div>
          ${currentLock.value ? `
            <div class="key-lock-summary" style="--key-color:${currentLock.color}">
              <span class="key-lock-dot"></span><strong>${currentLock.label} required</strong>
              <span>${matchingKeys} placed</span>
            </div>
            ${doorKeyWarning ? `<div class="key-warning" role="status">No ${currentLock.label} is placed. The door will stay locked until the player finds one.</div>` : ''}
            <button id="inspPlaceMatchingKey" class="pill-btn full-width" style="border-color:${currentLock.color};color:${currentLock.color}">Place Matching Keycard</button>
          ` : '<div class="subtle-note">This door opens without a keycard.</div>'}
          <div class="field-row">
            <label>Door Texture</label>
            <button id="inspPickDoorTex" class="mini-pill">${doorTex} ▾</button>
          </div>
          <div class="preset-pills">
            ${['BIGDOOR1', 'BIGDOOR2', 'BIGDOOR4', 'BIGDOOR6', 'SPCDOOR1', 'SPCDOOR3'].map(dt =>
          `<button class="mini-pill ${doorTex === dt ? 'active' : ''}" data-doortex="${dt}">${dt}</button>`
        ).join('')}
          </div>
        `;
      } else if (o.type === 'stairs') {
        controlsHtml = `
          <div class="field-row">
            <label>Steps</label>
            <input type="range" id="inspStairSteps" min="2" max="16" step="1" value="${o.steps || 4}" />
            <span class="range-val">${o.steps || 4}</span>
          </div>
          <div class="field-row">
            <label>Climb Direction</label>
            <select id="inspStairDir">
              <option value="E" ${o.direction === 'E' ? 'selected' : ''}>East (→)</option>
              <option value="W" ${o.direction === 'W' ? 'selected' : ''}>West (←)</option>
              <option value="N" ${o.direction === 'N' ? 'selected' : ''}>North (↑)</option>
              <option value="S" ${o.direction === 'S' ? 'selected' : ''}>South (↓)</option>
            </select>
          </div>
          <div class="field-row">
            <label>Start Floor</label>
            <input type="number" id="inspStairStart" step="8" value="${o.startFloor ?? 0}" />
          </div>
          <div class="field-row">
            <label>End Floor</label>
            <input type="number" id="inspStairEnd" step="8" value="${o.endFloor ?? 64}" />
          </div>
        `;
      } else if (o.type === 'window') {
        const theme = state.catalog.themes[o.theme || 'techbase'] || {};
        const frameTex = o.wallTexture || theme.trim || 'SHAWN2';
        const sillFlat = o.floorTexture || 'FLAT23';
        const topFlat = o.skyWindow ? 'F_SKY1' : (o.ceilingTexture || 'FLAT23');
        const midTex = o.midTexture !== undefined ? o.midTexture : (o.grate ? 'MIDBARS3' : '-');
        const winAlpha = Math.round((Number.isFinite(o.alpha) ? o.alpha : 1.0) * 100);

        controlsHtml = `
          <div class="field-row">
            <label>Sill Height (Z)</label>
            <input type="range" id="inspWinFloor" min="-64" max="256" step="8" value="${o.floorHeight ?? 32}" />
            <span class="range-val" id="valWinFloor">${o.floorHeight ?? 32}u</span>
          </div>
          <div class="field-row">
            <label>Top Height (Z)</label>
            <input type="range" id="inspWinCeil" min="16" max="384" step="8" value="${o.ceilingHeight ?? 112}" />
            <span class="range-val" id="valWinCeil">${o.ceilingHeight ?? 112}u</span>
          </div>
          <div class="field-row">
            <label>Mid Grate / Glass</label>
            <select id="inspWinMidPreset">
              <option value="-" ${midTex === '-' ? 'selected' : ''}>Open Air (No Mid Texture)</option>
              <option value="MIDBARS3" ${midTex === 'MIDBARS3' ? 'selected' : ''}>Iron Bars (MIDBARS3)</option>
              <option value="MIDGRATE" ${midTex === 'MIDGRATE' ? 'selected' : ''}>Security Grate (MIDGRATE)</option>
              <option value="MIDBRONZ" ${midTex === 'MIDBRONZ' ? 'selected' : ''}>Bronze Bars (MIDBRONZ)</option>
              <option value="MIDSPACE" ${midTex === 'MIDSPACE' ? 'selected' : ''}>Space Grid (MIDSPACE)</option>
              <option value="SHAWN2" ${midTex === 'SHAWN2' ? 'selected' : ''}>Tinted Glass (SHAWN2)</option>
              <option value="LITE5" ${midTex === 'LITE5' ? 'selected' : ''}>Forcefield (LITE5)</option>
            </select>
          </div>
          ${midTex !== '-' ? `
            <div class="field-row">
              <label>Mid Opacity</label>
              <input type="range" id="inspWinAlpha" min="20" max="100" step="5" value="${winAlpha}" />
              <span class="range-val" id="valWinAlpha">${winAlpha}%</span>
            </div>
            <div class="field-row">
              <label>Block Player / Shots</label>
              <input type="checkbox" id="inspWinBlock" ${o.blocking !== false ? 'checked' : ''} />
            </div>
          ` : ''}
          <div class="field-row">
            <label>Skybox Lintel</label>
            <input type="checkbox" id="inspWinSky" ${o.skyWindow ? 'checked' : ''} />
          </div>
          <div class="insp-section-title" style="margin-top:4px">Window Textures (Click to Browse WAD)</div>
          <div class="swatch-row cols-4">
            <button class="swatch-btn" id="pickWinFrame">
              <img src="/api/texture/${frameTex}" alt="${frameTex}" />
              <span class="swatch-label">Wall Frame</span>
              <span class="swatch-name">${frameTex}</span>
            </button>
            <button class="swatch-btn" id="pickWinMid">
              <img src="/api/texture/${midTex === '-' ? 'MIDBARS3' : midTex}" style="opacity:${midTex === '-' ? 0.25 : 1}" alt="${midTex}" />
              <span class="swatch-label">Mid Glass</span>
              <span class="swatch-name">${midTex === '-' ? 'NONE' : midTex}</span>
            </button>
            <button class="swatch-btn" id="pickWinSill">
              <img src="/api/flat/${sillFlat}" alt="${sillFlat}" />
              <span class="swatch-label">Sill Flat</span>
              <span class="swatch-name">${sillFlat}</span>
            </button>
            <button class="swatch-btn" id="pickWinTop">
              <img src="${topFlat === 'F_SKY1' ? `/api/texture/${state.compiled?.skybox?.texture || 'SKY1'}` : `/api/flat/${topFlat}`}" alt="${topFlat}" />
              <span class="swatch-label">Top Flat</span>
              <span class="swatch-name">${topFlat}</span>
            </button>
          </div>
        `;
      } else if (o.type === 'pool') {
        controlsHtml = `
          <div class="field-row">
            <label>Pool / Zone Type</label>
            <select id="inspPoolHazard">
              <option value="nukage" ${o.hazard === 'nukage' ? 'selected' : ''}>☢ Toxic Nukage (-10% HP)</option>
              <option value="lava" ${o.hazard === 'lava' ? 'selected' : ''}>🔥 Molten Lava (-20% HP)</option>
              <option value="blood" ${o.hazard === 'blood' ? 'selected' : ''}>🩸 Blood Trench (-5% HP)</option>
              <option value="water" ${o.hazard === 'water' ? 'selected' : ''}>💧 Deep Water (Safe)</option>
              <option value="skylight" ${o.hazard === 'skylight' ? 'selected' : ''}>☀ Open Skybox Skylight</option>
            </select>
          </div>
          <div class="field-row">
            <label>Floor Height</label>
            <input type="number" id="inspPoolFloor" step="8" value="${o.floorHeight ?? -16}" />
          </div>
        `;
      } else if (o.type === 'pillar') {
        controlsHtml = `
          <div class="field-row">
            <label>Column Type</label>
            <select id="inspPillarSolid">
              <option value="true" ${o.solid !== false ? 'selected' : ''}>Solid Floor-to-Ceiling Pillar</option>
              <option value="false" ${o.solid === false ? 'selected' : ''}>Raised Crate / Pedestal</option>
            </select>
          </div>
          <div class="field-row">
            <label>Wall Texture</label>
            <button id="inspPickPillarTex" class="mini-pill">${o.wallTexture || 'SHAWN2'} ▾</button>
          </div>
        `;
      }

      inspectorContent.innerHTML = `
        <div class="insp-card">
          <div class="insp-header">
            <span class="insp-title">${o.name || o.type.toUpperCase()}</span>
            <span class="insp-badge">Smart ${o.type === '3dfloor' ? '3D Floor' : o.type}</span>
          </div>
          <div class="field-row">
            <label>Dimensions</label>
            <span class="range-val" style="width:auto">${o.width} × ${o.height} u</span>
          </div>
          ${controlsHtml}
          <button id="inspDeleteBtn" class="pill-btn subtle-btn full-width" style="color:#ff6b6b">Delete Smart Object</button>
        </div>
      `;

      // Bind 3D Floor Listeners
      const style3D = document.getElementById('insp3DStyle');
      if (style3D) {
        style3D.addEventListener('change', () => {
          pushHistory();
          o.style = style3D.value;
          compileAndSync();
          renderInspector();
        });
      }
      const bindObjSlider = (id, valId, prop, suffix = '') => {
        const el = document.getElementById(id);
        const vEl = document.getElementById(valId);
        if (!el || !vEl) return;
        el.addEventListener('change', () => pushHistory());
        el.addEventListener('input', () => {
          o[prop] = Number(el.value);
          vEl.textContent = `${o[prop]}${suffix}`;
          compileAndSync();
        });
      };
      bindObjSlider('insp3DTopZ', 'val3DTopZ', 'topZ', 'u');
      bindObjSlider('insp3DThick', 'val3DThick', 'thickness', 'u');
      bindObjSlider('insp3DUnderLight', 'val3DUnderLight', 'underLight', '');

      document.getElementById('pick3DTop')?.addEventListener('click', () => {
        openTextureModal('flat', chosen => {
          pushHistory();
          o.topTexture = chosen;
          compileAndSync();
          renderInspector();
        });
      });
      document.getElementById('pick3DEdge')?.addEventListener('click', () => {
        openTextureModal('texture', chosen => {
          pushHistory();
          o.edgeTexture = chosen;
          compileAndSync();
          renderInspector();
        });
      });
      document.getElementById('pick3DBot')?.addEventListener('click', () => {
        openTextureModal('flat', chosen => {
          pushHistory();
          o.bottomTexture = chosen;
          compileAndSync();
          renderInspector();
        });
      });

      const lockSel = document.getElementById('inspDoorLock');
      if (lockSel) {
        lockSel.addEventListener('change', () => {
          pushHistory();
          o.lock = Number(lockSel.value);
          compileAndSync();
          renderInspector();
        });
      }
      document.getElementById('inspPlaceMatchingKey')?.addEventListener('click', () => {
        const lock = getDoorLockInfo(o.lock ?? 0);
        if (!lock.thingType) return;
        state.activeActorCategory = 'keys';
        state.activeThingType = lock.thingType;
        selectObject(null);
        setActiveTool('thing');
        showToast(`Click the map to place a ${lock.keyName}. It can unlock every matching door.`);
      });
      inspectorContent.querySelectorAll('[data-doortex]').forEach(btn => {
        btn.addEventListener('click', () => {
          pushHistory();
          o.wallTexture = btn.dataset.doortex;
          compileAndSync();
          renderInspector();
        });
      });
      document.getElementById('inspPickDoorTex')?.addEventListener('click', () => {
        openTextureModal('texture', chosen => {
          pushHistory();
          o.wallTexture = chosen;
          compileAndSync();
          renderInspector();
        });
      });

      const stairSteps = document.getElementById('inspStairSteps');
      if (stairSteps) {
        stairSteps.addEventListener('input', () => {
          o.steps = Number(stairSteps.value);
          compileAndSync();
          renderInspector();
        });
      }
      const stairDir = document.getElementById('inspStairDir');
      if (stairDir) {
        stairDir.addEventListener('change', () => {
          pushHistory();
          o.direction = stairDir.value;
          compileAndSync();
        });
      }
      const stairStart = document.getElementById('inspStairStart');
      if (stairStart) {
        stairStart.addEventListener('change', () => {
          pushHistory();
          o.startFloor = Number(stairStart.value);
          compileAndSync();
        });
      }
      const stairEnd = document.getElementById('inspStairEnd');
      if (stairEnd) {
        stairEnd.addEventListener('change', () => {
          pushHistory();
          o.endFloor = Number(stairEnd.value);
          compileAndSync();
        });
      }

      const winFloor = document.getElementById('inspWinFloor');
      if (winFloor) {
        winFloor.addEventListener('change', () => pushHistory());
        winFloor.addEventListener('input', () => {
          o.floorHeight = Number(winFloor.value);
          const vEl = document.getElementById('valWinFloor');
          if (vEl) vEl.textContent = `${o.floorHeight}u`;
          compileAndSync();
        });
      }
      const winCeil = document.getElementById('inspWinCeil');
      if (winCeil) {
        winCeil.addEventListener('change', () => pushHistory());
        winCeil.addEventListener('input', () => {
          o.ceilingHeight = Number(winCeil.value);
          const vEl = document.getElementById('valWinCeil');
          if (vEl) vEl.textContent = `${o.ceilingHeight}u`;
          compileAndSync();
        });
      }
      const winMidPreset = document.getElementById('inspWinMidPreset');
      if (winMidPreset) {
        winMidPreset.addEventListener('change', () => {
          pushHistory();
          o.midTexture = winMidPreset.value;
          o.grate = winMidPreset.value !== '-';
          if (winMidPreset.value === 'SHAWN2' || winMidPreset.value === 'LITE5') {
            o.alpha = 0.55;
            o.blocking = true;
          } else {
            o.alpha = 1.0;
          }
          compileAndSync();
          renderInspector();
        });
      }
      const winAlpha = document.getElementById('inspWinAlpha');
      if (winAlpha) {
        winAlpha.addEventListener('change', () => pushHistory());
        winAlpha.addEventListener('input', () => {
          o.alpha = Number(winAlpha.value) / 100;
          const vEl = document.getElementById('valWinAlpha');
          if (vEl) vEl.textContent = `${winAlpha.value}%`;
          compileAndSync();
        });
      }
      const winBlock = document.getElementById('inspWinBlock');
      if (winBlock) {
        winBlock.addEventListener('change', () => {
          pushHistory();
          o.blocking = winBlock.checked;
          compileAndSync();
        });
      }
      const winSky = document.getElementById('inspWinSky');
      if (winSky) {
        winSky.addEventListener('change', () => {
          pushHistory();
          o.skyWindow = winSky.checked;
          compileAndSync();
          renderInspector();
        });
      }
      document.getElementById('pickWinFrame')?.addEventListener('click', () => {
        openTextureModal('texture', chosen => {
          pushHistory();
          o.wallTexture = chosen;
          o.upperTexture = chosen;
          o.lowerTexture = chosen;
          compileAndSync();
          renderInspector();
        });
      });
      document.getElementById('pickWinMid')?.addEventListener('click', () => {
        openTextureModal('texture', chosen => {
          pushHistory();
          o.midTexture = chosen;
          o.grate = true;
          compileAndSync();
          renderInspector();
        });
      });
      document.getElementById('pickWinSill')?.addEventListener('click', () => {
        openTextureModal('flat', chosen => {
          pushHistory();
          o.floorTexture = chosen;
          compileAndSync();
          renderInspector();
        });
      });
      document.getElementById('pickWinTop')?.addEventListener('click', () => {
        openTextureModal('flat', chosen => {
          pushHistory();
          o.skyWindow = chosen === 'F_SKY1';
          o.ceilingTexture = chosen;
          compileAndSync();
          renderInspector();
        });
      });

      const poolHaz = document.getElementById('inspPoolHazard');
      if (poolHaz) {
        poolHaz.addEventListener('change', () => {
          pushHistory();
          o.hazard = poolHaz.value;
          delete o.floorTexture;
          delete o.ceilingTexture;
          compileAndSync();
          renderInspector();
        });
      }
      const poolFloor = document.getElementById('inspPoolFloor');
      if (poolFloor) {
        poolFloor.addEventListener('change', () => {
          pushHistory();
          o.floorHeight = Number(poolFloor.value);
          compileAndSync();
        });
      }

      const pilSolid = document.getElementById('inspPillarSolid');
      if (pilSolid) {
        pilSolid.addEventListener('change', () => {
          pushHistory();
          o.solid = pilSolid.value === 'true';
          compileAndSync();
          renderInspector();
        });
      }
      document.getElementById('inspPickPillarTex')?.addEventListener('click', () => {
        openTextureModal('texture', chosen => {
          pushHistory();
          o.wallTexture = chosen;
          compileAndSync();
          renderInspector();
        });
      });

      document.getElementById('inspDeleteBtn').addEventListener('click', deleteSelected);
      return;
    }

    // Default Map Overview Inspector
    const st = state.compiled?.stats || { sectors: 0, linedefs: 0, things: 0, threeDFloors: 0 };
    inspectorContent.innerHTML = `
      <div class="insp-card">
        <div class="insp-header">
          <span class="insp-title">iDoom Studio Guide</span>
          <span class="insp-badge">Ready</span>
        </div>
        <p style="font-size:12px;color:var(--text-secondary);line-height:1.45">
          Click any <strong>Room</strong>, <strong>3D Bridge</strong>, <strong>Door</strong>, or <strong>Actor</strong> in 2D or 3D to customize its materials, multi-level floors, and skybox.
        </p>
        <div class="field-row">
          <label>Compiled Sectors</label>
          <span class="range-val">${st.sectors}</span>
        </div>
        <div class="field-row">
          <label>3D Floors / Bridges</label>
          <span class="range-val">${st.threeDFloors || 0}</span>
        </div>
        <div class="field-row">
          <label>Compiled Linedefs</label>
          <span class="range-val">${st.linedefs}</span>
        </div>
        <div class="field-row">
          <label>Placed Actors</label>
          <span class="range-val">${st.things}</span>
        </div>
      </div>

      <div class="insp-card">
        <div class="insp-section-title">Quick Actions</div>
        <button id="overviewMagicBtn" class="pill-btn magic-btn full-width">✨ Generate Smart Room Wing</button>
        <button id="overviewPlayBtn" class="pill-btn play-btn full-width">▶ Play Map in UZDoom</button>
      </div>
    `;

    document.getElementById('overviewMagicBtn')?.addEventListener('click', openMagicModal);
    document.getElementById('overviewPlayBtn')?.addEventListener('click', () => playInUzdoom());
  }

  function deleteSelected() {
    if (!state.selectedId || !state.project) return;
    pushHistory();
    state.project.rooms = (state.project.rooms || []).filter(r => r.id !== state.selectedId);
    state.project.smartObjects = (state.project.smartObjects || []).filter(o => o.id !== state.selectedId);
    state.project.things = (state.project.things || []).filter(t => t.id !== state.selectedId);
    state.project.links = (state.project.links || []).filter(l => l.sourceId !== state.selectedId && l.targetId !== state.selectedId);
    state.selectedId = null;
    compileAndSync();
    renderInspector();
    showToast('Deleted selected item');
  }

  function duplicateSelected() {
    const sel = findItemById(state.selectedId);
    if (!sel) return;
    pushHistory();
    const copy = JSON.parse(JSON.stringify(sel.item));
    copy.id = `${sel.kind}_${Date.now().toString(36)}`;
    copy.x = (copy.x || 0) + 64;
    copy.y = (copy.y || 0) - 64;
    if (sel.kind === 'room') state.project.rooms.push(copy);
    else if (sel.kind === 'smartObject') state.project.smartObjects.push(copy);
    else if (sel.kind === 'thing') state.project.things.push(copy);
    selectObject(copy.id);
    compileAndSync();
    showToast('Duplicated item');
  }

  // Texture & Flat Browser Modal
  let textureModalCallback = null;
  let currentModalKind = 'texture';

  function openTextureModal(kind, onSelect) {
    currentModalKind = kind;
    textureModalCallback = onSelect;
    const modal = document.getElementById('textureModal');
    const title = document.getElementById('textureModalTitle');
    const search = document.getElementById('textureSearchInput');
    title.textContent = kind === 'texture' ? 'Select Wall Texture (Freedoom2 WAD)' : 'Select Floor / Ceiling Flat (Freedoom2 WAD)';
    search.value = '';
    modal.classList.remove('hidden');
    renderTextureGrid('');
    search.focus();
  }

  function renderTextureGrid(filterText) {
    const grid = document.getElementById('textureGrid');
    const q = (filterText || '').trim().toUpperCase();
    const items = currentModalKind === 'texture'
      ? state.catalog.wad.textures.map(t => t.name)
      : ['F_SKY1', ...state.catalog.wad.flats];

    const filtered = items.filter(name => !q || name.includes(q)).slice(0, 120);
    grid.innerHTML = filtered.map(name => {
      const imgUrl = name === 'F_SKY1'
        ? `/api/texture/${state.compiled?.skybox?.texture || 'SKY1'}`
        : (currentModalKind === 'texture' ? `/api/texture/${name}` : `/api/flat/${name}`);
      return `
        <button class="tex-tile" data-tex-name="${name}">
          <img src="${imgUrl}" loading="lazy" alt="${name}" />
          <span>${name}</span>
        </button>
      `;
    }).join('');

    grid.querySelectorAll('[data-tex-name]').forEach(btn => {
      btn.addEventListener('click', () => {
        const chosen = btn.dataset.texName;
        document.getElementById('textureModal').classList.add('hidden');
        if (textureModalCallback) textureModalCallback(chosen);
      });
    });
  }

  document.getElementById('textureSearchInput').addEventListener('input', e => {
    renderTextureGrid(e.target.value);
  });
  document.getElementById('closeTextureModalBtn').addEventListener('click', () => {
    document.getElementById('textureModal').classList.add('hidden');
  });

  // Topbar Skybox Selector
  if (skyboxSelect) {
    skyboxSelect.addEventListener('change', () => {
      if (!state.project) return;
      pushHistory();
      state.project.skybox = skyboxSelect.value;
      compileAndSync();
      showToast(`🌌 Skybox updated: ${skyboxSelect.options[skyboxSelect.selectedIndex].text}`);
    });
  }

  projectNameInput.addEventListener('change', () => {
    if (!state.project) return;
    pushHistory();
    state.project.name = projectNameInput.value.trim() || 'Untitled map';
    state.diskDirty = true;
    compileAndSync();
    updateSaveStatus();
  });
  projectNameInput.addEventListener('input', () => {
    if (!state.project) return;
    state.diskDirty = true;
    updateSaveStatus();
  });

  // Smart Architectural Wing Generator Modal
  function openMagicModal() {
    document.getElementById('magicModal').classList.remove('hidden');
  }

  document.getElementById('magicRoomBtn').addEventListener('click', openMagicModal);
  document.getElementById('closeMagicModalBtn').addEventListener('click', () => {
    document.getElementById('magicModal').classList.add('hidden');
  });

  document.getElementById('confirmMagicBtn').addEventListener('click', async () => {
    const theme = document.getElementById('magicThemeSelect').value;
    const connection = document.getElementById('magicConnectionSelect').value;
    const shape = document.getElementById('magicShapeSelect').value;
    const encounter = document.getElementById('magicEncounterSelect').value;
    document.getElementById('magicModal').classList.add('hidden');

    pushHistory();
    const sel = findItemById(state.selectedId);
    const fromRoomId = sel?.kind === 'room' ? sel.item.id : undefined;

    const res = await fetch('/api/generate-room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project: state.project,
        revision: state.projectRevision,
        options: {
          theme,
          connection,
          shape,
          encounter,
          width: shape === 'octagon' ? 448 : 384,
          height: shape === 'octagon' ? 448 : 384,
          fromRoomId
        }
      })
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(`Room generation failed: ${data.error || 'project changed; reload before retrying'}`);
      return;
    }
    state.project = data.project;
    state.projectRevision = data.revision;
    state.projectId = data.projectId || state.projectId;
    state.projectDirty = false;
    state.diskDirty = true;
    state.syncConflict = false;
    state.compiled = data.compiled;
    selectObject(data.createdRoomId);
    renderer3D.updateScene(data.compiled, state.selectedId);
    draw2D();
    updateSaveStatus();
    showToast(`✨ Generated & linked ${theme} wing!`);
  });

  async function syncCurrentProject() {
    if (!state.project || state.syncConflict) return false;
    await compileAndSync({ publish: true });
    await state.syncQueue;
    return !state.projectDirty && !state.syncConflict;
  }

  async function refreshRecentProjects() {
    try {
      const response = await fetch('/api/projects');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not list saved projects.');
      const selected = openProjectSelect.value;
      openProjectSelect.replaceChildren(new Option('Choose a saved project…', ''));
      for (const project of data.projects || []) {
        const option = new Option(`${project.projectName} · ${project.name}`, project.name);
        openProjectSelect.appendChild(option);
      }
      if ([...openProjectSelect.options].some(option => option.value === selected)) openProjectSelect.value = selected;
    } catch (error) {
      console.warn('Could not refresh recent projects:', error);
    }
  }

  async function saveCurrentProject({ saveAs = false } = {}) {
    if (!state.project) return false;
    state.project.name = projectNameInput.value.trim() || 'Untitled map';
    if (!(await syncCurrentProject())) {
      showToast('Save stopped because this map is not synchronized. Your browser recovery draft is preserved.');
      return false;
    }
    const suggestedName = state.namedProject || state.project.name.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const targetName = saveAs || !state.namedProject ? window.prompt('Save project as (letters, numbers, _ or -):', suggestedName) : state.namedProject;
    if (!targetName) return false;
    const normalizedTarget = targetName.toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 64);
    const exists = [...openProjectSelect.options].some(option => option.value === normalizedTarget);
    const overwritingDifferentProject = exists && (saveAs || normalizedTarget !== state.namedProject);
    if (overwritingDifferentProject && !window.confirm(`A saved project named "${normalizedTarget}" already exists. Replace its named JSON and WAD files?`)) return false;
    try {
      const response = await fetch('/api/project/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          revision: state.projectRevision,
          name: targetName,
          saveAs: Boolean(saveAs),
          overwrite: !overwritingDifferentProject || exists
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Project could not be saved.');
      state.projectId = result.projectId;
      state.namedProject = result.name;
      state.diskSavedRevision = result.revision;
      state.diskDirty = false;
      state.storage = { ...(state.storage || {}), projectId: result.projectId, namedProject: result.name, savedRevision: result.revision };
      clearLocalDraft();
      updateSaveStatus();
      await refreshRecentProjects();
      renderMapCheck(result.diagnostics);
      showToast(`Saved ${result.name}.json${result.wadPath ? ' and compiled WAD' : ' as a draft (no playable WAD yet)'}.`);
      return true;
    } catch (error) {
      state.diskDirty = true;
      updateSaveStatus();
      showToast(`Save failed: ${error.message}`);
      return false;
    }
  }

  async function openSavedProject(name = openProjectSelect.value) {
    if (!name) return false;
    if (!(await confirmLeaveCurrentProject())) return false;
    try {
      const response = await fetch('/api/project/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, revision: state.projectRevision })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Project could not be opened.');
      state.project = result.project;
      state.projectRevision = result.revision;
      state.projectId = result.projectId;
      state.namedProject = result.namedProject || name;
      state.diskSavedRevision = result.revision;
      state.diskDirty = false;
      state.projectDirty = false;
      state.syncConflict = false;
      state.history = [];
      state.redoStack = [];
      state.storage = { ...(state.storage || {}), projectId: result.projectId, namedProject: state.namedProject, savedRevision: result.revision };
      projectNameInput.value = state.project.name || name;
      if (skyboxSelect && state.project.skybox) skyboxSelect.value = state.project.skybox;
      state.selectedId = null;
      await compileAndSync({ publish: false });
      fitView2D();
      renderer3D.resetCamera();
      renderInspector();
      await runMapCheck({ reveal: false });
      updateSaveStatus();
      await refreshRecentProjects();
      clearLocalDraft();
      projectMenu.classList.add('hidden');
      showToast(`Opened ${state.namedProject}.`);
      return true;
    } catch (error) {
      showToast(`Open failed: ${error.message}`);
      return false;
    }
  }

  async function createNewProject(template = 'blank_studio', successMessage = 'Started a new unsaved project.') {
    if (!(await confirmLeaveCurrentProject())) return false;
    try {
      const response = await fetch('/api/project/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template, revision: state.projectRevision })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'New project could not be created.');
      state.project = result.project;
      state.projectRevision = result.revision;
      state.projectId = result.projectId;
      state.namedProject = null;
      state.diskSavedRevision = null;
      state.diskDirty = true;
      state.projectDirty = false;
      state.syncConflict = false;
      state.history = [];
      state.redoStack = [];
      state.selectedId = null;
      projectNameInput.value = state.project.name || 'Untitled map';
      if (skyboxSelect && state.project.skybox) skyboxSelect.value = state.project.skybox;
      await compileAndSync({ publish: false });
      fitView2D();
      renderer3D.resetCamera();
      renderInspector();
      await runMapCheck({ reveal: false });
      updateSaveStatus();
      projectMenu.classList.add('hidden');
      showToast(successMessage);
      return true;
    } catch (error) {
      showToast(`New project failed: ${error.message}`);
      return false;
    }
  }

  async function recoverAutosave(candidate) {
    if (!candidate?.available || !window.confirm(`A newer autosave for "${candidate.projectName || 'this project'}" is available from ${new Date(candidate.savedAt).toLocaleString()}. Recover it? The named save will not be changed.`)) return false;
    try {
      const response = await fetch('/api/project/recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: state.projectId, revision: state.projectRevision })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Autosave recovery failed.');
      state.project = result.project;
      state.projectRevision = result.revision;
      state.projectId = result.projectId || state.projectId;
      state.diskDirty = true;
      state.projectDirty = false;
      state.syncConflict = false;
      state.history = [];
      state.redoStack = [];
      projectNameInput.value = state.project.name || 'Recovered map';
      await compileAndSync({ publish: false });
      fitView2D();
      renderInspector();
      await runMapCheck({ reveal: false });
      updateSaveStatus();
      showToast('Recovered autosave. The named project file remains unchanged; save when ready.');
      return true;
    } catch (error) {
      showToast(`Recovery failed: ${error.message}`);
      return false;
    }
  }

  document.getElementById('projectMenuBtn').addEventListener('click', event => {
    event.stopPropagation();
    projectMenu.classList.toggle('hidden');
    if (!projectMenu.classList.contains('hidden')) refreshRecentProjects();
  });
  document.getElementById('newProjectBtn').addEventListener('click', () => createNewProject());
  document.getElementById('openProjectBtn').addEventListener('click', () => openSavedProject());
  document.getElementById('saveProjectBtn').addEventListener('click', () => saveCurrentProject());
  document.getElementById('saveAsProjectBtn').addEventListener('click', () => saveCurrentProject({ saveAs: true }));
  document.getElementById('mapCheckBtn').addEventListener('click', () => {
    if (mapCheckPanel.classList.contains('hidden')) runMapCheck();
    else mapCheckPanel.classList.add('hidden');
  });
  document.getElementById('refreshMapCheckBtn').addEventListener('click', () => runMapCheck());
  document.getElementById('closeMapCheckBtn').addEventListener('click', () => mapCheckPanel.classList.add('hidden'));
  document.getElementById('mapCheckFilter').addEventListener('change', event => {
    state.mapCheckFilter = event.target.value;
    renderMapCheck();
  });

  window.addEventListener('beforeunload', event => {
    if (state.project && projectNameInput.value.trim()) state.project.name = projectNameInput.value.trim();
    if (!state.projectDirty && !state.diskDirty && !state.syncConflict) return;
    keepLocalDraft();
    event.preventDefault();
    event.returnValue = '';
  });

  // One-Click Play in UZDoom
  async function playInUzdoom(spawnAt = null) {
    if (!state.project) return;
    if (!(await syncCurrentProject())) return;
    if (!(await checkBeforePlayable('Play in UZDoom'))) return;
    showToast('Compiling UDMF WAD & launching UZDoom...');
    try {
      const res = await fetch('/api/play', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: state.project,
          spawnAt,
          revision: state.projectRevision
        })
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        showToast(`⚠️ ${data.error}`);
      } else {
        showToast('🚀 Launched UZDoom with your map!');
      }
    } catch (err) {
      showToast('Failed to launch UZDoom');
    }
  }

  document.getElementById('playUzdoomBtn').addEventListener('click', () => playInUzdoom());

  // Export .WAD file
  document.getElementById('exportWadBtn').addEventListener('click', async () => {
    if (!state.project) return;
    if (!(await syncCurrentProject())) return;
    if (!(await checkBeforePlayable('Export WAD'))) return;
    state.project.name = projectNameInput.value || 'custom_map';
    try {
      const res = await fetch('/api/export-wad', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: state.project, revision: state.projectRevision })
      });
      if (!res.ok) {
        const problem = await res.json();
        throw new Error(problem.error || 'WAD export failed.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeName = state.project.name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase() || 'custom_map';
      a.href = url;
      a.download = `${safeName}.wad`;
      a.click();
      URL.revokeObjectURL(url);
      showToast(`Exported ${safeName}.wad (also saved in maps/)`);
    } catch (error) {
      showToast(`Export failed: ${error.message}`);
    }
  });

  // UDMF Code Inspector Modal
  document.getElementById('inspectUdmfBtn').addEventListener('click', () => {
    const zmap = state.compiled?.zmapinfo ? `// --- ZMAPINFO ---\n${state.compiled.zmapinfo}\n\n// --- TEXTMAP ---\n` : '';
    document.getElementById('udmfCodePreview').textContent = zmap + (state.compiled?.textmap || '// No map compiled');
    document.getElementById('udmfModal').classList.remove('hidden');
  });
  document.getElementById('closeUdmfModalBtn').addEventListener('click', () => {
    document.getElementById('udmfModal').classList.add('hidden');
  });

  // Templates Dropdown
  const templatesBtn = document.getElementById('templatesBtn');
  const templatesMenu = document.getElementById('templatesMenu');
  templatesBtn.addEventListener('click', e => {
    e.stopPropagation();
    templatesMenu.classList.toggle('hidden');
  });
  window.addEventListener('click', () => {
    templatesMenu.classList.add('hidden');
    projectMenu.classList.add('hidden');
    contextMenu.classList.add('hidden');
  });

  document.querySelectorAll('[data-template]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tplId = btn.dataset.template;
      const tpl = state.catalog.starterMaps[tplId];
      if (!tpl) return;
      await createNewProject(tplId, `Loaded template: ${tpl.name}`);
    });
  });

  // View Switcher
  document.querySelectorAll('#viewModeControl .seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#viewModeControl .seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const v = btn.dataset.view;
      state.viewMode = v;
      stageContainer.className = `stage-container mode-${v}`;

      if (v === 'walk') {
        renderer3D.setMode('walk');
        walkthroughOverlay.classList.remove('hidden');
        badge3DMode.textContent = 'First-Person Walkthrough (3D Floors + Skybox)';
        hud3DHint.textContent = 'Click or drag 3D viewport to look · WASD to move · E/Q to fly up/down · Esc to release cursor';
      } else {
        if (document.pointerLockElement) document.exitPointerLock?.();
        renderer3D.setMode('orbit');
        walkthroughOverlay.classList.add('hidden');
        badge3DMode.textContent = '3D Live Preview (Freedoom2 Textures)';
        hud3DHint.textContent = 'Left-drag to Orbit · Right-drag to Pan (1:1 screen direction) · Scroll to Zoom · Click in 3D to select';
      }
      setTimeout(() => {
        draw2D();
        renderer3D.render();
      }, 20);
    });
  });

  function setActiveTool(toolName) {
    state.activeTool = toolName;
    document.querySelectorAll('.tool-dock .tool-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.tool === toolName);
    });
    renderInspector();
  }

  document.querySelectorAll('.tool-dock .tool-btn').forEach(btn => {
    btn.addEventListener('click', () => setActiveTool(btn.dataset.tool));
  });

  // 2D Canvas Interaction Events
  canvas2D.addEventListener('contextmenu', e => {
    e.preventDefault();
    const rect = canvas2D.getBoundingClientRect();
    const wPt = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    state.contextWorld = { x: snap(wPt.x), y: snap(wPt.y) };

    const hit = hitTest2D(wPt.x, wPt.y);
    if (hit && hit.id) selectObject(hit.id);

    contextMenu.style.left = `${Math.min(window.innerWidth - 235, e.clientX)}px`;
    contextMenu.style.top = `${Math.min(window.innerHeight - 240, e.clientY)}px`;
    contextMenu.classList.remove('hidden');
  });

  document.getElementById('ctxPlayHere').addEventListener('click', () => {
    playInUzdoom({ x: state.contextWorld.x, y: state.contextWorld.y, angle: 0 });
  });
  document.getElementById('ctxAddWing').addEventListener('click', openMagicModal);
  document.getElementById('ctxAddPlayer').addEventListener('click', () => {
    pushHistory();
    let p1 = (state.project.things || []).find(t => t.type === 1);
    if (!p1) {
      p1 = { id: 'th_p1', type: 1, x: state.contextWorld.x, y: state.contextWorld.y, angle: 0 };
      state.project.things.push(p1);
    } else {
      p1.x = state.contextWorld.x;
      p1.y = state.contextWorld.y;
    }
    selectObject(p1.id);
    compileAndSync();
  });
  document.getElementById('ctxAddImp').addEventListener('click', () => {
    pushHistory();
    const id = `th_${Date.now().toString(36)}`;
    state.project.things.push({ id, type: 3001, x: state.contextWorld.x, y: state.contextWorld.y, angle: 0 });
    selectObject(id);
    compileAndSync();
  });
  document.getElementById('ctxAddShotgun').addEventListener('click', () => {
    pushHistory();
    const id = `th_${Date.now().toString(36)}`;
    state.project.things.push({ id, type: 2001, x: state.contextWorld.x, y: state.contextWorld.y, angle: 0 });
    selectObject(id);
    compileAndSync();
  });
  document.getElementById('ctxDuplicate').addEventListener('click', duplicateSelected);
  document.getElementById('ctxDelete').addEventListener('click', deleteSelected);

  canvas2D.addEventListener('mousedown', e => {
    contextMenu.classList.add('hidden');
    if (e.button === 2) return;

    const rect = canvas2D.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const wPt = screenToWorld(sx, sy);

    if (e.button === 1 || state.spacePressed) {
      state.drag = {
        kind: 'pan',
        startSX: sx,
        startSY: sy,
        origCamX: state.cam2D.x,
        origCamY: state.cam2D.y
      };
      return;
    }

    if (state.activeTool === 'thing') {
      pushHistory();
      const id = `th_${Date.now().toString(36)}`;
      const newThing = {
        id,
        type: state.activeThingType || 3001,
        x: snap(wPt.x),
        y: snap(wPt.y),
        angle: 0
      };
      state.project.things.push(newThing);
      selectObject(id);
      compileAndSync();
      return;
    }

    if (state.activeTool === 'link') {
      const hit = hitTest2D(wPt.x, wPt.y);
      if (hit && hit.id) {
        state.drag = {
          kind: 'link',
          sourceId: hit.id,
          startX: wPt.x,
          startY: wPt.y
        };
      }
      return;
    }

    if (state.activeTool === 'select') {
      const hit = hitTest2D(wPt.x, wPt.y);
      if (!hit) {
        selectObject(null);
        state.drag = {
          kind: 'pan',
          startSX: sx,
          startSY: sy,
          origCamX: state.cam2D.x,
          origCamY: state.cam2D.y
        };
        return;
      }

      if (hit.kind === 'handle') {
        pushHistory();
        state.drag = {
          kind: 'resize',
          handle: hit.handle,
          target: hit.target,
          origBox: { x: hit.target.x, y: hit.target.y, width: hit.target.width, height: hit.target.height }
        };
        return;
      }

      selectObject(hit.id);
      pushHistory();
      state.drag = {
        kind: 'move',
        target: hit.item,
        startWX: snap(wPt.x),
        startWY: snap(wPt.y),
        origX: hit.item.x,
        origY: hit.item.y
      };
      return;
    }

    const startX = snap(wPt.x);
    const startY = snap(wPt.y);
    const defaults = {
      room: { w: 256, h: 256 },
      octagon: { w: 384, h: 384 },
      '3dfloor': { w: 256, h: 96 },
      door: { w: 32, h: 128 },
      window: { w: 128, h: 32 },
      stairs: { w: 128, h: 128 },
      lift: { w: 64, h: 64 },
      pillar: { w: 48, h: 48 },
      pool: { w: 128, h: 128 },
      teleporter: { w: 64, h: 64 },
      exit: { w: 32, h: 64 }
    };
    const def = defaults[state.activeTool] || { w: 128, h: 128 };

    state.drag = {
      kind: 'create',
      tool: state.activeTool,
      startX,
      startY,
      defaultW: def.w,
      defaultH: def.h,
      box: { x: startX, y: startY, width: def.w, height: def.h }
    };
    draw2D();
  });

  window.addEventListener('mousemove', e => {
    const rect = canvas2D.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const wPt = screenToWorld(sx, sy);
    state.mouseWorld = { x: snap(wPt.x), y: snap(wPt.y) };
    cursorCoordsBadge.textContent = `X: ${state.mouseWorld.x} · Y: ${state.mouseWorld.y}`;

    if (!state.drag) {
      const hit = hitTest2D(wPt.x, wPt.y);
      const newHov = hit?.id || null;
      if (newHov !== state.hoveredId) {
        state.hoveredId = newHov;
        draw2D();
      }
      return;
    }

    if (state.drag.kind === 'pan') {
      state.cam2D.x = state.drag.origCamX - (sx - state.drag.startSX) / state.cam2D.zoom;
      state.cam2D.y = state.drag.origCamY + (sy - state.drag.startSY) / state.cam2D.zoom;
      draw2D();
      return;
    }

    if (state.drag.kind === 'move') {
      const dx = snap(wPt.x) - state.drag.startWX;
      const dy = snap(wPt.y) - state.drag.startWY;
      state.drag.target.x = state.drag.origX + dx;
      state.drag.target.y = state.drag.origY + dy;
      draw2D();
      return;
    }

    if (state.drag.kind === 'resize') {
      const ob = state.drag.origBox;
      const h = state.drag.handle;
      const wx = snap(wPt.x);
      const wy = snap(wPt.y);
      let x0 = ob.x, y0 = ob.y, x1 = ob.x + ob.width, y1 = ob.y + ob.height;

      if (h.includes('w')) x0 = Math.min(wx, x1 - 16);
      if (h.includes('e')) x1 = Math.max(wx, x0 + 16);
      if (h.includes('s')) y0 = Math.min(wy, y1 - 16);
      if (h.includes('n')) y1 = Math.max(wy, y0 + 16);

      state.drag.target.x = x0;
      state.drag.target.y = y0;
      state.drag.target.width = Math.max(16, x1 - x0);
      state.drag.target.height = Math.max(16, y1 - y0);
      draw2D();
      return;
    }

    if (state.drag.kind === 'create') {
      const wx = snap(wPt.x);
      const wy = snap(wPt.y);
      const dx = wx - state.drag.startX;
      const dy = wy - state.drag.startY;
      if (Math.abs(dx) < 16 && Math.abs(dy) < 16) {
        state.drag.box = {
          x: state.drag.startX - Math.round(state.drag.defaultW * 0.5 / 16) * 16,
          y: state.drag.startY - Math.round(state.drag.defaultH * 0.5 / 16) * 16,
          width: state.drag.defaultW,
          height: state.drag.defaultH
        };
      } else {
        state.drag.box = {
          x: Math.min(state.drag.startX, wx),
          y: Math.min(state.drag.startY, wy),
          width: Math.max(16, Math.abs(dx)),
          height: Math.max(16, Math.abs(dy))
        };
      }
      draw2D();
      return;
    }

    if (state.drag.kind === 'link') {
      draw2D();
    }
  });

  window.addEventListener('mouseup', e => {
    if (!state.drag) return;
    const d = state.drag;
    state.drag = null;

    if (d.kind === 'move' || d.kind === 'resize') {
      compileAndSync();
      renderInspector();
      return;
    }

    if (d.kind === 'link') {
      const rect = canvas2D.getBoundingClientRect();
      const wPt = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      const hit = hitTest2D(wPt.x, wPt.y);
      if (hit && hit.id && hit.id !== d.sourceId) {
        pushHistory();
        state.project.links = (state.project.links || []).filter(l => l.sourceId !== d.sourceId);
        state.project.links.push({
          sourceId: d.sourceId,
          targetId: hit.id,
          action: hit.item?.type === 'lift' ? 'lift' : 'door'
        });
        compileAndSync();
        showToast('↝ Linked trigger to target!');
      }
      setActiveTool('select');
      draw2D();
      return;
    }

    if (d.kind === 'create') {
      pushHistory();
      const b = d.box;
      const id = `${d.tool}_${Date.now().toString(36)}`;

      if (d.tool === 'room' || d.tool === 'octagon') {
        const newRoom = {
          id,
          name: d.tool === 'octagon' ? 'Octagon Arena' : 'New Space',
          shape: d.tool === 'octagon' ? 'octagon' : 'rect',
          x: b.x,
          y: b.y,
          width: Math.max(64, b.width),
          height: Math.max(64, b.height),
          floorHeight: 0,
          ceilingHeight: 128,
          lightLevel: 168,
          theme: 'techbase'
        };
        state.project.rooms.push(newRoom);
        selectObject(id);
      } else {
        const newObj = {
          id,
          name: d.tool === '3dfloor' ? '3D Bridge / Mezzanine' : `Smart ${d.tool.charAt(0).toUpperCase() + d.tool.slice(1)}`,
          type: d.tool,
          x: b.x,
          y: b.y,
          width: b.width,
          height: b.height,
          theme: 'techbase'
        };
        if (d.tool === '3dfloor') {
          newObj.style = 'solid';
          newObj.topZ = 64;
          newObj.thickness = 8;
          newObj.topTexture = 'STEP2';
          newObj.bottomTexture = 'FLAT20';
          newObj.edgeTexture = 'SUPPORT3';
          newObj.underLight = 136;
        } else if (d.tool === 'stairs') {
          newObj.steps = 4;
          newObj.direction = b.width >= b.height ? 'E' : 'N';
        } else if (d.tool === 'pool') {
          newObj.hazard = 'nukage';
        } else if (d.tool === 'pillar') {
          newObj.solid = true;
        }
        state.project.smartObjects.push(newObj);
        selectObject(id);
      }

      setActiveTool('select');
      compileAndSync();
    }
  });

  canvas2D.addEventListener('wheel', e => {
    e.preventDefault();
    const rect = canvas2D.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const before = screenToWorld(sx, sy);
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    state.cam2D.zoom = Math.max(0.08, Math.min(3.5, state.cam2D.zoom * factor));
    const after = screenToWorld(sx, sy);
    state.cam2D.x += before.x - after.x;
    state.cam2D.y += before.y - after.y;
    draw2D();
  }, { passive: false });

  document.getElementById('fitView2DBtn').addEventListener('click', fitView2D);
  document.getElementById('resetCam3DBtn').addEventListener('click', () => renderer3D.resetCamera());
  document.getElementById('toggleWireframeBtn').addEventListener('click', e => {
    renderer3D.showWireframe = !renderer3D.showWireframe;
    e.currentTarget.classList.toggle('active', renderer3D.showWireframe);
  });
  document.getElementById('toggleCeilingCutBtn').addEventListener('click', e => {
    renderer3D.cutawayCeilings = !renderer3D.cutawayCeilings;
    e.currentTarget.classList.toggle('active', renderer3D.cutawayCeilings);
    renderer3D._rebuildGeometry();
  });

  document.getElementById('undoBtn').addEventListener('click', undo);
  document.getElementById('redoBtn').addEventListener('click', redo);

  window.addEventListener('keydown', e => {
    if (e.code === 'Space') state.spacePressed = true;
    if (document.activeElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      duplicateSelected();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'r') {
      e.preventDefault();
      playInUzdoom();
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      if (state.selectedId) {
        e.preventDefault();
        deleteSelected();
      }
      return;
    }

    // Quick Height adjustment hotkeys: [ / ] or PageDown / PageUp
    if (e.key === '[' || e.key === ']' || e.key === 'PageUp' || e.key === 'PageDown') {
      const sel = findItemById(state.selectedId);
      if (sel && sel.kind === 'room') {
        e.preventDefault();
        pushHistory();
        const r = sel.item;
        const delta = (e.key === ']' || e.key === 'PageUp') ? 16 : -16;
        if (e.shiftKey) {
          r.floorHeight = (r.floorHeight ?? 0) + delta;
          r.ceilingHeight = (r.ceilingHeight ?? 128) + delta;
        } else {
          r.ceilingHeight = Math.max((r.floorHeight ?? 0) + 16, (r.ceilingHeight ?? 128) + delta);
        }
        compileAndSync();
        renderInspector();
        return;
      } else if (sel && sel.kind === 'smartObject' && sel.item.type === '3dfloor') {
        e.preventDefault();
        pushHistory();
        const delta = (e.key === ']' || e.key === 'PageUp') ? 8 : -8;
        sel.item.topZ = (sel.item.topZ ?? 64) + delta;
        compileAndSync();
        renderInspector();
        return;
      }
    }

    if (state.viewMode !== 'walk') {
      const keyMap = {
        v: 'select',
        r: 'room',
        o: 'octagon',
        b: '3dfloor',
        d: 'door',
        w: 'window',
        s: 'stairs',
        l: 'lift',
        p: 'pillar',
        h: 'pool',
        t: 'teleporter',
        e: 'exit',
        k: 'link',
        a: 'thing'
      };
      const k = e.key.toLowerCase();
      if (keyMap[k]) setActiveTool(keyMap[k]);
    }
  });

  window.addEventListener('keyup', e => {
    if (e.code === 'Space') state.spacePressed = false;
  });

  // Inspector Panel Drag-to-Resize Handle
  const inspectorPanel = document.getElementById('inspectorPanel');
  const inspectorResizer = document.getElementById('inspectorResizer');
  if (inspectorPanel && inspectorResizer) {
    let resizingInspector = false;
    inspectorResizer.addEventListener('mousedown', e => {
      e.preventDefault();
      resizingInspector = true;
      inspectorResizer.classList.add('dragging');
    });
    window.addEventListener('mousemove', e => {
      if (!resizingInspector) return;
      const newWidth = Math.max(280, Math.min(540, window.innerWidth - e.clientX));
      inspectorPanel.style.width = `${newWidth}px`;
      draw2D();
      renderer3D.render();
    });
    window.addEventListener('mouseup', () => {
      if (resizingInspector) {
        resizingInspector = false;
        inspectorResizer.classList.remove('dragging');
      }
    });
  }

  window.addEventListener('resize', () => {
    draw2D();
    renderer3D.render();
  });

  async function init() {
    const res = await fetch('/api/catalog');
    const catalog = await res.json();
    state.catalog = catalog;
    renderer3D.setThingCatalog(catalog.things);

    const sessionRes = await fetch('/api/session');
    const session = await sessionRes.json();
    state.project = session.project;
    state.projectRevision = session.revision;
    state.projectId = session.projectId;
    state.storage = session.storage || null;
    state.namedProject = session.storage?.namedProject || null;
    state.diskSavedRevision = session.storage?.savedRevision ?? null;
    state.diskDirty = !session.storage?.diskSaved;
    state.mapCheck = session.mapCheck || null;
    projectNameInput.value = state.project.name;
    if (skyboxSelect) skyboxSelect.value = state.project.skybox || 'diorama_tech';
    selectObject('room_entry');

    state.eventSource = new EventSource('/api/session/events');
    state.eventSource.addEventListener('project', event => {
      try { applyRemoteProject(JSON.parse(event.data)); }
      catch (err) { console.error('Invalid live project update:', err); }
    });

    await compileAndSync({ publish: false });
    fitView2D();
    renderer3D.resetCamera();
    renderInspector();
    renderMapCheck(state.mapCheck);
    updateSaveStatus();
    await refreshRecentProjects();
    if (session.storage?.autosave?.available) await recoverAutosave(session.storage.autosave);
    else if (session.storage?.autosave?.problem) showToast(`Autosave recovery unavailable: ${session.storage.autosave.problem}`);
    if (session.storage?.recoveryProblem) showToast(session.storage.recoveryProblem);
    try {
      const localDraft = JSON.parse(localStorage.getItem('idoom-studio-recoverable-draft') || 'null');
      if (localDraft?.project && window.confirm(`A browser-local recovery draft from ${new Date(localDraft.savedAt).toLocaleString()} is available. Restore it over the open project?`)) {
        state.project = localDraft.project;
        state.projectDirty = true;
        state.diskDirty = true;
        await compileAndSync();
        renderInspector();
        showToast('Restored the browser-local draft and synchronized it to the editor service.');
      }
    } catch (error) {
      showToast(`Browser recovery draft could not be read: ${error.message}`);
    }
  }

  init();
})();
