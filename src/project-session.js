const crypto = require('crypto');
const { MATERIAL_THEMES, SKYBOX_PRESETS } = require('./udmf-compiler');
const { THING_CATALOG } = require('./starter-maps');
const { getDoorLockInfo } = require('./door-keys');

const COLLECTIONS = ['rooms', 'smartObjects', 'things'];
const PROJECT_SCHEMA_VERSION = 1;
const THEME_IDS = new Set(Object.keys(MATERIAL_THEMES));
const SKYBOX_IDS = new Set(Object.keys(SKYBOX_PRESETS));
const THING_TYPES = new Set(THING_CATALOG.map(thing => thing.type));
const TEXTURE_FIELDS = ['wallTexture', 'trackTexture', 'topTexture', 'bottomTexture', 'edgeTexture', 'midTexture', 'upperTexture', 'lowerTexture'];
const FLAT_FIELDS = ['floorTexture', 'ceilingTexture'];
const VALID_OBJECT_TYPES = new Set([
    'door', 'window', 'stairs', 'lift', 'pillar', 'pool', '3dfloor',
    'teleporter', 'exit', 'switch'
]);

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function findUnsafeProperty(value, prefix = 'project') {
    if (!value || typeof value !== 'object') return null;
    for (const key of Object.keys(value)) {
        if (['__proto__', 'prototype', 'constructor'].includes(key)) return `${prefix}.${key}`;
        const nested = findUnsafeProperty(value[key], `${prefix}.${key}`);
        if (nested) return nested;
    }
    return null;
}

function validateProject(input, { requireRoom = true, wadCatalog } = {}) {
    const errors = [];
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return ['Project must be a JSON object.'];
    }

    for (const key of ['rooms', 'smartObjects', 'things', 'links']) {
        if (input[key] !== undefined && !Array.isArray(input[key])) errors.push(`${key} must be an array.`);
    }

    const project = input;
    const unsafeProperty = findUnsafeProperty(project);
    if (unsafeProperty) errors.push(`Forbidden property "${unsafeProperty}" is not allowed.`);
    for (const key of ['rooms', 'smartObjects', 'things', 'links']) {
        if (!Array.isArray(project[key])) project[key] = [];
    }
    if (typeof project.name !== 'string' || !project.name.trim()) project.name = 'Agent-created map';
    if (project.name.length > 120) errors.push('Project name must be at most 120 characters.');
    if (/[<>"'&\u0000-\u001f]/.test(project.name)) errors.push('Project name contains unsupported markup or control characters.');
    if (project.schemaVersion === undefined) project.schemaVersion = PROJECT_SCHEMA_VERSION;
    if (project.schemaVersion !== PROJECT_SCHEMA_VERSION) errors.push(`schemaVersion must be ${PROJECT_SCHEMA_VERSION}; received "${project.schemaVersion}".`);
    if (project.theme && !THEME_IDS.has(project.theme)) errors.push(`Unknown project theme "${project.theme}".`);
    if (project.skybox && !SKYBOX_IDS.has(project.skybox)) errors.push(`Unknown skybox preset "${project.skybox}".`);
    if (requireRoom && project.rooms.length === 0) errors.push('Add at least one room before compiling or saving a playable map.');

    const ids = new Set();
    for (const collection of COLLECTIONS) {
        for (const [index, item] of project[collection].entries()) {
            const label = `${collection}[${index}]`;
            if (!item || typeof item !== 'object' || Array.isArray(item)) {
                errors.push(`${label} must be an object.`);
                continue;
            }
            if (typeof item.id !== 'string' || !item.id.trim()) {
                errors.push(`${label}.id is required.`);
            } else if (item.id.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(item.id)) {
                errors.push(`${label}.id may contain only letters, numbers, underscores, and hyphens (up to 128 characters).`);
            } else if (ids.has(item.id)) {
                errors.push(`Duplicate object id "${item.id}".`);
            } else {
                ids.add(item.id);
            }
            if (collection === 'smartObjects' && !VALID_OBJECT_TYPES.has(item.type)) {
                errors.push(`${label}.type "${item.type}" is not a supported smart object.`);
            }
            if (collection === 'smartObjects' && item.type === 'door' && !getDoorLockInfo(item.lock ?? 0)) {
                errors.push(`${label}.lock must be 0 (unlocked), 1 (red keycard), 2 (blue keycard), or 3 (yellow keycard).`);
            }
            if (typeof item.name === 'string' && (item.name.length > 120 || /[<>"'&\u0000-\u001f]/.test(item.name))) {
                errors.push(`${label}.name must be at most 120 characters and cannot contain markup or control characters.`);
            }
            for (const [field, value] of Object.entries(item)) {
                if (typeof value === 'number' && !Number.isFinite(value)) errors.push(`${label}.${field} must be finite.`);
            }
            for (const field of ['x', 'y']) {
                if (!(field in item)) errors.push(`${label}.${field} is required.`);
            }
            if (collection !== 'things') {
                for (const field of ['width', 'height']) {
                    if (!(field in item)) errors.push(`${label}.${field} is required.`);
                }
            }
            if (collection === 'rooms' && item.shape && !['rect', 'octagon'].includes(item.shape)) {
                errors.push(`${label}.shape must be rect or octagon.`);
            }
            if (collection === 'rooms' && item.theme && !THEME_IDS.has(item.theme)) errors.push(`${label}.theme "${item.theme}" is not a known material theme.`);
            if (collection === 'smartObjects' && item.theme && !THEME_IDS.has(item.theme)) errors.push(`${label}.theme "${item.theme}" is not a known material theme.`);
            for (const field of ['x', 'y', 'width', 'height', 'floorHeight', 'ceilingHeight', 'topZ']) {
                if (item[field] === undefined) continue;
                if (typeof item[field] !== 'number' || !Number.isFinite(item[field])) {
                    errors.push(`${label}.${field} must be a finite number.`);
                } else if (Math.abs(item[field]) > 32768) {
                    errors.push(`${label}.${field} exceeds the supported map coordinate range (±32768).`);
                }
            }
            if ('width' in item && item.width <= 0) errors.push(`${label}.width must be greater than 0.`);
            if ('height' in item && item.height <= 0) errors.push(`${label}.height must be greater than 0.`);
            if (Number.isFinite(item.x) && Number.isFinite(item.width) && Math.abs(item.x + item.width) > 32768) errors.push(`${label} extends beyond the supported X map-coordinate range.`);
            if (Number.isFinite(item.y) && Number.isFinite(item.height) && Math.abs(item.y + item.height) > 32768) errors.push(`${label} extends beyond the supported Y map-coordinate range.`);
            if (collection === 'rooms' && Number.isFinite(item.floorHeight) && Number.isFinite(item.ceilingHeight) && item.ceilingHeight <= item.floorHeight) {
                errors.push(`${label}.ceilingHeight must be above floorHeight.`);
            }
            if (collection === 'things' && (!Number.isInteger(item.type) || item.type <= 0)) {
                errors.push(`${label}.type must be a positive Doom thing number.`);
            }
            if (collection === 'things' && !THING_TYPES.has(item.type)) errors.push(`${label}.type ${item.type} is not in the editor's Doom thing catalog.`);
            if (wadCatalog) {
                const textureNames = new Set((wadCatalog.textures || []).map(texture => texture.name.toUpperCase()));
                const flatNames = new Set((wadCatalog.flats || []).map(flat => String(flat).toUpperCase()));
                for (const field of TEXTURE_FIELDS) {
                    if (item[field] === undefined || item[field] === '-' || item[field] === '') continue;
                    const materialName = typeof item[field] === 'string' ? item[field].toUpperCase() : '';
                    const materialExists = textureNames.has(materialName) || flatNames.has(materialName) || materialName === 'F_SKY1';
                    if (!materialExists) {
                        errors.push(`${label}.${field} "${item[field]}" is not a Freedoom2 texture or flat.`);
                    }
                }
                for (const field of FLAT_FIELDS) {
                    if (item[field] === undefined || item[field] === '-' || item[field] === '') continue;
                    if (typeof item[field] !== 'string' || (!flatNames.has(item[field].toUpperCase()) && item[field].toUpperCase() !== 'F_SKY1')) {
                        errors.push(`${label}.${field} "${item[field]}" is not a Freedoom2 flat.`);
                    }
                }
            }
        }
    }

    for (const [index, link] of project.links.entries()) {
        if (!link || typeof link !== 'object') {
            errors.push(`links[${index}] must be an object.`);
            continue;
        }
        if (!ids.has(link.sourceId)) errors.push(`links[${index}].sourceId "${link.sourceId}" does not exist.`);
        if (!ids.has(link.targetId)) errors.push(`links[${index}].targetId "${link.targetId}" does not exist.`);
        if (link.action !== undefined && !['door', 'lift'].includes(link.action)) errors.push(`links[${index}].action must be door or lift.`);
    }
    return errors;
}

function createProjectSession(initialProject, options = {}) {
    let project = clone(initialProject);
    const wadCatalog = options.wadCatalog;
    validateProject(project, { requireRoom: false, wadCatalog });
    let revision = Number.isSafeInteger(options.revision) && options.revision >= 0 ? options.revision : 0;
    let projectId = typeof options.projectId === 'string' && /^[a-zA-Z0-9-]{12,64}$/.test(options.projectId)
        ? options.projectId
        : crypto.randomUUID();
    const history = [];
    const redoStack = [];
    const subscribers = new Set();

    function snapshot() {
        return { project: clone(project), revision, projectId };
    }

    function publish(source) {
        const update = { ...snapshot(), source };
        for (const subscriber of subscribers) subscriber(update);
    }

    function replace(nextProject, expectedRevision, source = 'agent') {
        if (expectedRevision !== revision) {
            const error = new Error(`Project revision conflict: expected ${expectedRevision}, current revision is ${revision}. Fetch the latest project and retry.`);
            error.statusCode = 409;
            error.currentRevision = revision;
            throw error;
        }
        const candidate = clone(nextProject);
        const errors = validateProject(candidate, { requireRoom: false, wadCatalog });
        if (errors.length) {
            const error = new Error(`Project validation failed: ${errors.join(' ')}`);
            error.statusCode = 400;
            error.validationErrors = errors;
            throw error;
        }
        if (JSON.stringify(candidate) === JSON.stringify(project)) return { ...snapshot(), changed: false };
        history.push(clone(project));
        if (history.length > 50) history.shift();
        redoStack.length = 0;
        project = candidate;
        revision += 1;
        publish(source);
        return { ...snapshot(), changed: true, source };
    }

    function subscribe(subscriber) {
        subscribers.add(subscriber);
        return () => subscribers.delete(subscriber);
    }

    function setProjectIdentity(nextProjectId) {
        if (typeof nextProjectId !== 'string' || !/^[a-zA-Z0-9-]{12,64}$/.test(nextProjectId)) {
            throw new Error('Project identity must be a stable 12-64 character identifier.');
        }
        projectId = nextProjectId;
        const update = { ...snapshot(), source: 'identity' };
        for (const subscriber of subscribers) subscriber(update);
        return update;
    }

    function restoreFrom(stack, oppositeStack, expectedRevision, source) {
        if (expectedRevision !== revision) {
            const error = new Error(`Project revision conflict: expected ${expectedRevision}, current revision is ${revision}. Fetch the latest project and retry.`);
            error.statusCode = 409;
            error.currentRevision = revision;
            throw error;
        }
        if (stack.length === 0) return { ...snapshot(), changed: false, source };
        oppositeStack.push(clone(project));
        if (oppositeStack.length > 50) oppositeStack.shift();
        project = stack.pop();
        revision += 1;
        publish(source);
        return { ...snapshot(), changed: true, source };
    }

    return {
        snapshot,
        setProjectIdentity,
        subscribe,
        replace,
        undo: expectedRevision => restoreFrom(history, redoStack, expectedRevision, 'undo'),
        redo: expectedRevision => restoreFrom(redoStack, history, expectedRevision, 'redo'),
        validate: options => validateProject(clone(project), { wadCatalog, ...options }),
        historyDepth: () => history.length,
        redoDepth: () => redoStack.length
    };
}

function createId(prefix) {
    return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

module.exports = {
    COLLECTIONS,
    PROJECT_SCHEMA_VERSION,
    VALID_OBJECT_TYPES,
    clone,
    validateProject,
    createProjectSession,
    createId
};
