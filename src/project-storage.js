const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STATE_VERSION = 1;

function safeProjectName(value, fallback = 'untitled_map') {
    const cleaned = String(value || fallback)
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .slice(0, 64)
        .toLowerCase();
    return cleaned || fallback;
}

function writeAtomically(filePath, data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
        fs.writeFileSync(tempPath, data);
        fs.renameSync(tempPath, filePath);
    } finally {
        try { fs.unlinkSync(tempPath); } catch { }
    }
}

function createProjectStorage({ mapsDir }) {
    if (!mapsDir) throw new Error('mapsDir is required.');
    fs.mkdirSync(mapsDir, { recursive: true });
    const statePath = path.join(mapsDir, '.studio-state.json');
    const autosaveDir = path.join(mapsDir, '.autosaves');

    function emptyState() {
        return { version: STATE_VERSION, lastProject: null, activeProjectId: null, recentProjects: [], identities: {}, sessionRevisions: {}, namedSavedRevisions: {} };
    }

    function readState() {
        try {
            const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
            if (state.version !== STATE_VERSION || !state.identities || typeof state.identities !== 'object') return emptyState();
            state.recentProjects = Array.isArray(state.recentProjects) ? state.recentProjects.filter(name => typeof name === 'string') : [];
            state.sessionRevisions = state.sessionRevisions && typeof state.sessionRevisions === 'object' ? state.sessionRevisions : {};
            state.namedSavedRevisions = state.namedSavedRevisions && typeof state.namedSavedRevisions === 'object' ? state.namedSavedRevisions : {};
            return state;
        } catch {
            return emptyState();
        }
    }

    function writeState(state) {
        writeAtomically(statePath, JSON.stringify(state, null, 2));
    }

    function projectPath(name) {
        const safeName = safeProjectName(name, '');
        if (!safeName || safeName !== name) {
            const error = new Error('Project name may contain only letters, numbers, underscores, and hyphens.');
            error.statusCode = 400;
            throw error;
        }
        return path.join(mapsDir, `${safeName}.json`);
    }

    function touchProject(state, name) {
        state.lastProject = name;
        state.recentProjects = [name, ...state.recentProjects.filter(item => item !== name)].slice(0, 12);
    }

    function identityFor(state, name) {
        if (!state.identities[name] || typeof state.identities[name].id !== 'string' || !/^[a-zA-Z0-9-]{12,64}$/.test(state.identities[name].id)) {
            state.identities[name] = { id: crypto.randomUUID(), updatedAt: new Date().toISOString() };
        }
        return state.identities[name].id;
    }

    function readNamed(name) {
        const filePath = projectPath(name);
        let project;
        try { project = JSON.parse(fs.readFileSync(filePath, 'utf8')); }
        catch (cause) {
            const error = new Error(`Saved project "${name}" could not be read: ${cause.message}`);
            error.statusCode = cause.code === 'ENOENT' ? 404 : 422;
            throw error;
        }
        if (!project || typeof project !== 'object' || Array.isArray(project)) {
            const error = new Error(`Saved project "${name}" is not a project object.`);
            error.statusCode = 422;
            throw error;
        }
        const state = readState();
        const hadIdentity = typeof state.identities[name]?.id === 'string' && /^[a-zA-Z0-9-]{12,64}$/.test(state.identities[name].id);
        const projectId = identityFor(state, name);
        if (!hadIdentity) writeState(state);
        return { project, projectId, name, filePath };
    }

    function listProjects() {
        const state = readState();
        const recentRank = new Map(state.recentProjects.map((name, index) => [name, index]));
        return fs.readdirSync(mapsDir, { withFileTypes: true })
            .filter(entry => entry.isFile() && /^[a-zA-Z0-9_-]{1,64}\.json$/.test(entry.name))
            .map(entry => {
                const name = entry.name.slice(0, -5);
                const filePath = path.join(mapsDir, entry.name);
                let projectName = name;
                try {
                    const project = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                    if (project && typeof project.name === 'string') projectName = project.name;
                } catch { }
                return {
                    name,
                    projectName,
                    updatedAt: fs.statSync(filePath).mtime.toISOString(),
                    recent: recentRank.get(name) ?? null
                };
            })
            .sort((a, b) => (a.recent ?? Infinity) - (b.recent ?? Infinity) || b.updatedAt.localeCompare(a.updatedAt));
    }

    function saveNamed(project, { name, projectId, revision, overwrite = true, saveAs = false } = {}) {
        const safeName = safeProjectName(name || project?.name);
        const filePath = projectPath(safeName);
        if (fs.existsSync(filePath) && !overwrite) {
            const error = new Error(`A project named "${safeName}" already exists. Confirm overwrite to replace it.`);
            error.statusCode = 409;
            throw error;
        }
        const state = readState();
        const existingIdentity = state.identities[safeName]?.id;
        const currentName = Object.entries(state.identities).find(([, info]) => info?.id === projectId)?.[0] || null;
        let id;
        if (!saveAs && currentName === safeName && projectId) id = projectId;
        else if (!saveAs && currentName === null && !existingIdentity && projectId) id = projectId;
        else if (!saveAs && existingIdentity) id = existingIdentity;
        else id = crypto.randomUUID();
        state.identities[safeName] = { id, updatedAt: new Date().toISOString() };
        if (Number.isSafeInteger(revision) && revision >= 0) state.namedSavedRevisions[id] = revision;
        touchProject(state, safeName);
        writeAtomically(filePath, JSON.stringify(project, null, 2));
        writeState(state);
        return { name: safeName, projectId: id, filePath, exists: true };
    }

    function markLastProject(name) {
        const state = readState();
        if (!fs.existsSync(projectPath(name))) {
            const error = new Error(`Saved project "${name}" was not found.`);
            error.statusCode = 404;
            throw error;
        }
        identityFor(state, name);
        touchProject(state, name);
        writeState(state);
        return { name, projectId: state.identities[name].id };
    }

    function getLastNamedProject() {
        const state = readState();
        if (!state.lastProject) return null;
        try {
            const filePath = projectPath(state.lastProject);
            if (!fs.existsSync(filePath)) return { problem: `Last project "${state.lastProject}" no longer exists.` };
            const project = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            if (!project || typeof project !== 'object' || Array.isArray(project)) return { problem: `Last project "${state.lastProject}" is not a valid project object.` };
            const hadIdentity = typeof state.identities[state.lastProject]?.id === 'string';
            const projectId = identityFor(state, state.lastProject);
            if (!hadIdentity) writeState(state);
            return { project, projectId, name: state.lastProject, filePath };
        } catch (error) {
            return { problem: `Could not reopen last project: ${error.message}` };
        }
    }

    function saveAutosave({ projectId, project, revision, projectName }) {
        if (typeof projectId !== 'string' || !/^[a-zA-Z0-9-]{12,64}$/.test(projectId)) {
            throw new Error('Autosave requires a stable project identity.');
        }
        const record = {
            version: STATE_VERSION,
            projectId,
            projectName: String(projectName || project?.name || 'Untitled map').slice(0, 120),
            revision: Number.isInteger(revision) ? revision : 0,
            savedAt: new Date().toISOString(),
            project
        };
        writeAtomically(path.join(autosaveDir, `${projectId}.json`), JSON.stringify(record, null, 2));
        return record;
    }

    function saveSessionRevision(projectId, revision) {
        if (typeof projectId !== 'string' || !/^[a-zA-Z0-9-]{12,64}$/.test(projectId) || !Number.isSafeInteger(revision) || revision < 0) return;
        const state = readState();
        state.sessionRevisions[projectId] = revision;
        writeState(state);
    }

    function getSessionRevision(projectId) {
        const revision = readState().sessionRevisions[projectId];
        return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
    }

    function getNamedSavedRevision(projectId) {
        const revision = readState().namedSavedRevisions[projectId];
        return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
    }

    function markNamedSavedRevision(projectId, revision) {
        if (typeof projectId !== 'string' || !Number.isSafeInteger(revision) || revision < 0) return;
        const state = readState();
        state.namedSavedRevisions[projectId] = revision;
        writeState(state);
    }

    function getActiveProjectId() {
        const id = readState().activeProjectId;
        return typeof id === 'string' && /^[a-zA-Z0-9-]{12,64}$/.test(id) ? id : null;
    }

    function rememberActiveProjectId(projectId) {
        if (typeof projectId !== 'string' || !/^[a-zA-Z0-9-]{12,64}$/.test(projectId)) return;
        const state = readState();
        state.activeProjectId = projectId;
        writeState(state);
    }

    function getProjectNameById(projectId) {
        const state = readState();
        return Object.entries(state.identities).find(([, info]) => info?.id === projectId)?.[0] || null;
    }

    function getAutosave(projectId) {
        if (typeof projectId !== 'string' || !/^[a-zA-Z0-9-]{12,64}$/.test(projectId)) return null;
        const filePath = path.join(autosaveDir, `${projectId}.json`);
        if (!fs.existsSync(filePath)) return null;
        try {
            const record = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            if (record.version !== STATE_VERSION || record.projectId !== projectId || !Number.isInteger(record.revision) || !record.project || typeof record.project !== 'object') {
                return { problem: 'Autosave contents are incomplete or unsupported.' };
            }
            return { ...record, filePath };
        } catch (error) {
            return { problem: `Autosave could not be read: ${error.message}` };
        }
    }

    function getStartupRecovery() {
        const named = getLastNamedProject();
        if (!named || named.problem) return { named, autosave: null };
        const autosave = getAutosave(named.projectId);
        if (!autosave || autosave.problem) return { named, autosave };
        const namedRevision = getNamedSavedRevision(named.projectId);
        const isNewer = namedRevision === null
            ? JSON.stringify(autosave.project) !== JSON.stringify(named.project)
            : autosave.revision > namedRevision;
        return { named, autosave: isNewer ? autosave : null };
    }

    function hasProject(name) {
        try { return fs.existsSync(projectPath(name)); } catch { return false; }
    }

    return {
        autosaveDir,
        statePath,
        listProjects,
        readNamed,
        saveNamed,
        markLastProject,
        getLastNamedProject,
        saveAutosave,
        saveSessionRevision,
        getSessionRevision,
        getNamedSavedRevision,
        markNamedSavedRevision,
        getActiveProjectId,
        rememberActiveProjectId,
        getProjectNameById,
        getAutosave,
        getStartupRecovery,
        hasProject
    };
}

module.exports = { createProjectStorage, safeProjectName, writeAtomically };
