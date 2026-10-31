const crypto = require('crypto');
const { generateRoomAttachment } = require('./smart-generator');
const { clone, validateProject, createId } = require('./project-session');
const { DOOR_LOCKS, getDoorKeyWarnings } = require('./door-keys');
const { createProjectStorage, safeProjectName } = require('./project-storage');
const { makeProjectPipeline } = require('./project-pipeline');

function safeMapName(value, fallback = 'agent_map') {
    return safeProjectName(value, fallback);
}

function assertSafePatch(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || 'id' in patch) {
        throw new Error('patch must be an object and cannot change id.');
    }
    if (Object.keys(patch).some(key => ['__proto__', 'prototype', 'constructor'].includes(key))) {
        throw new Error('patch contains a forbidden property name.');
    }
}

function applyBatchOperations(project, operations) {
    if (!Array.isArray(operations) || operations.length < 1 || operations.length > 100) {
        throw new Error('operations must contain between 1 and 100 edits.');
    }
    const createdIds = [];
    const createdRoomIds = [];

    for (const operation of operations) {
        if (!operation || typeof operation !== 'object' || typeof operation.type !== 'string') {
            throw new Error('Every batch operation needs a type.');
        }
        if (operation.type === 'attach_room') {
            const generated = generateRoomAttachment(project, operation.options || {});
            project.rooms = generated.project.rooms;
            project.smartObjects = generated.project.smartObjects;
            project.things = generated.project.things;
            project.links = generated.project.links;
            createdRoomIds.push(generated.createdRoomId);
            continue;
        }
        if (operation.type === 'add') {
            const collections = { room: 'rooms', smartObject: 'smartObjects', thing: 'things' };
            const collection = collections[operation.collection];
            if (!collection) throw new Error(`Unsupported add collection "${operation.collection}".`);
            const object = clone(operation.object || {});
            object.id = object.id || createId(operation.collection);
            if (project[collection].some(existing => existing.id === object.id)) throw new Error(`Object id "${object.id}" already exists.`);
            project[collection].push(object);
            createdIds.push(object.id);
            continue;
        }
        if (operation.type === 'update') {
            assertSafePatch(operation.patch);
            const target = [...project.rooms, ...project.smartObjects, ...project.things].find(item => item.id === operation.id);
            if (!target) throw new Error(`Cannot update missing object "${operation.id}".`);
            Object.assign(target, clone(operation.patch));
            continue;
        }
        if (operation.type === 'delete') {
            const count = project.rooms.length + project.smartObjects.length + project.things.length;
            project.rooms = project.rooms.filter(item => item.id !== operation.id);
            project.smartObjects = project.smartObjects.filter(item => item.id !== operation.id);
            project.things = project.things.filter(item => item.id !== operation.id);
            if (count === project.rooms.length + project.smartObjects.length + project.things.length) {
                throw new Error(`Cannot delete missing object "${operation.id}".`);
            }
            project.links = project.links.filter(link => link.sourceId !== operation.id && link.targetId !== operation.id);
            continue;
        }
        if (operation.type === 'link') {
            project.links.push({ sourceId: operation.sourceId, targetId: operation.targetId, action: operation.action || 'door' });
            continue;
        }
        throw new Error(`Unsupported batch operation type "${operation.type}".`);
    }
    return { project, createdIds, createdRoomIds };
}

function makeAgentApi({ session, starterMaps, themes, skyboxes, things, wadCatalog, mapsDir, wadPath, launchPlaytest, storage, pipeline, profile = null }) {
    const validate = (project, options = {}) => validateProject(project, { wadCatalog, ...options });
    const projectStorage = storage || createProjectStorage({ mapsDir });
    const projectPipeline = pipeline || makeProjectPipeline({ storage: projectStorage, mapsDir, wadPath, wadCatalog, launchPlaytest });

    function requireRevision(args) {
        const current = session.snapshot();
        if (!Number.isInteger(args.revision) || args.revision !== current.revision) {
            const error = new Error(`Project revision conflict: expected ${args.revision}, current revision is ${current.revision}. Fetch the latest project and retry.`);
            error.statusCode = 409;
            error.currentRevision = current.revision;
            throw error;
        }
        return current;
    }

    function commit(project, args, source = 'agent') {
        const errors = validate(clone(project), { requireRoom: false });
        if (errors.length) {
            const error = new Error(`Project validation failed: ${errors.join(' ')}`);
            error.statusCode = 400;
            error.validationErrors = errors;
            throw error;
        }
        const update = session.replace(project, args.revision, source);
        return { ...update, warnings: getDoorKeyWarnings(update.project) };
    }

    async function execute(action, args = {}) {
        if (action === 'project_get') {
            const current = session.snapshot();
            return {
                ...current,
                validationErrors: validate(clone(current.project)),
                warnings: getDoorKeyWarnings(current.project),
                mapCheck: projectPipeline.check(current.project)
            };
        }
        if (action === 'catalog_get') {
            return {
                themes,
                skyboxes,
                things,
                doorLocks: DOOR_LOCKS,
                profile,
                wad: { textures: wadCatalog?.textures || [], flats: wadCatalog?.flats || [], groups: wadCatalog?.groups || {} },
                starterMaps: Object.fromEntries(Object.entries(starterMaps).map(([id, map]) => [id, { id, name: map.name, description: map.description }]))
            };
        }

        const current = requireRevision(args);
        const project = clone(current.project);
        let result;

        if (action === 'project_undo') return session.undo(args.revision);
        if (action === 'project_redo') return session.redo(args.revision);
        if (action === 'map_check') {
            return { revision: current.revision, ...projectPipeline.check(project) };
        }

        if (action === 'batch_edit') {
            const batch = applyBatchOperations(project, args.operations);
            result = commit(batch.project, args);
            result.createdIds = batch.createdIds;
            result.createdRoomIds = batch.createdRoomIds;
            return result;
        }

        switch (action) {
            case 'project_create': {
                const templateId = args.template || 'blank_studio';
                if (!starterMaps[templateId]) throw new Error(`Unknown starter map "${templateId}".`);
                const fresh = clone(starterMaps[templateId]);
                if (args.name) fresh.name = String(args.name).slice(0, 120);
                session.setProjectIdentity(crypto.randomUUID());
                result = commit(fresh, args);
                break;
            }
            case 'project_settings': {
                // project-level fields: the name, the sky, the map lump the WAD and the playtest use
                for (const field of ['name', 'skybox', 'mapLump']) {
                    if (args[field] === undefined) continue;
                    if (args[field] === null || args[field] === '') delete project[field];
                    else project[field] = field === 'mapLump' ? String(args[field]).toUpperCase() : args[field];
                }
                result = commit(project, args);
                break;
            }
            case 'room_attach': {
                const generated = generateRoomAttachment(project, {
                    theme: args.theme,
                    connection: args.connection,
                    shape: args.shape,
                    encounter: args.encounter,
                    width: args.width,
                    height: args.height,
                    direction: args.direction,
                    fromRoomId: args.fromRoomId
                });
                result = commit(generated.project, args);
                result.createdRoomId = generated.createdRoomId;
                break;
            }
            case 'object_add': {
                const collectionByName = { room: 'rooms', smartObject: 'smartObjects', thing: 'things' };
                const collection = collectionByName[args.collection];
                if (!collection) throw new Error('collection must be room, smartObject, or thing.');
                const object = clone(args.object || {});
                if (object.id !== undefined && typeof object.id !== 'string') throw new Error('object.id must be a string when provided.');
                object.id = object.id || createId(args.collection);
                if (project[collection].some(item => item.id === object.id)) throw new Error(`An object with id "${object.id}" already exists.`);
                project[collection].push(object);
                result = commit(project, args);
                result.createdId = object.id;
                break;
            }
            case 'object_update': {
                assertSafePatch(args.patch);
                const item = [...project.rooms, ...project.smartObjects, ...project.things].find(value => value.id === args.id);
                if (!item) throw new Error(`No room, object, or thing has id "${args.id}".`);
                Object.assign(item, clone(args.patch));
                result = commit(project, args);
                break;
            }
            case 'object_delete': {
                const before = project.rooms.length + project.smartObjects.length + project.things.length;
                project.rooms = project.rooms.filter(item => item.id !== args.id);
                project.smartObjects = project.smartObjects.filter(item => item.id !== args.id);
                project.things = project.things.filter(item => item.id !== args.id);
                const after = project.rooms.length + project.smartObjects.length + project.things.length;
                if (before === after) throw new Error(`No room, object, or thing has id "${args.id}".`);
                project.links = project.links.filter(link => link.sourceId !== args.id && link.targetId !== args.id);
                result = commit(project, args);
                result.deletedId = args.id;
                break;
            }
            case 'objects_link': {
                const ids = new Set([...project.rooms, ...project.smartObjects, ...project.things].map(item => item.id));
                if (!ids.has(args.sourceId) || !ids.has(args.targetId)) throw new Error('Both sourceId and targetId must reference existing project items.');
                project.links = project.links.filter(link => link.sourceId !== args.sourceId);
                project.links.push({ sourceId: args.sourceId, targetId: args.targetId, action: args.action || 'door' });
                result = commit(project, args);
                break;
            }
            case 'project_validate': {
                const errors = validate(project);
                const output = {
                    valid: errors.length === 0,
                    errors,
                    warnings: getDoorKeyWarnings(project),
                    mapCheck: projectPipeline.check(project),
                    revision: current.revision
                };
                if (!errors.length) output.stats = projectPipeline.compilePlayable(project).compiled.stats;
                return output;
            }
            case 'project_save': {
                const saved = projectPipeline.saveNamed(project, {
                    name: args.name || project.name,
                    projectId: current.projectId,
                    revision: current.revision,
                    overwrite: true,
                    saveAs: Boolean(args.saveAs)
                });
                session.setProjectIdentity(saved.projectId);
                return { ...saved, revision: current.revision };
            }
            case 'project_load': {
                const safeName = safeMapName(args.name, '');
                if (!safeName) throw new Error('A saved project name is required.');
                const loaded = projectStorage.readNamed(safeName);
                const errors = validate(clone(loaded.project), { requireRoom: false });
                if (errors.length) throw validationError(errors);
                projectStorage.markLastProject(loaded.name);
                session.setProjectIdentity(loaded.projectId);
                result = commit(loaded.project, args);
                projectStorage.markNamedSavedRevision(loaded.projectId, result.revision);
                result.projectId = loaded.projectId;
                break;
            }
            case 'project_export': {
                const exported = projectPipeline.exportWad(project, args.name || project.name);
                return {
                    ok: true, revision: current.revision, wadPath: exported.wadPath, mapLump: exported.mapLump,
                    modPath: exported.modPath || null, mapinfo: exported.mapinfo || null,
                    stats: exported.stats, diagnostics: exported.diagnostics
                };
            }
            case 'map_playtest': {
                const played = await projectPipeline.playtest(project);
                return { ...played, revision: current.revision };
            }
            default:
                throw new Error(`Unknown agent action "${action}".`);
        }
        return result;
    }

    return { execute };
}

function validationError(errors) {
    const error = new Error(`Project validation failed: ${errors.join(' ')}`);
    error.statusCode = 400;
    error.validationErrors = errors;
    return error;
}

module.exports = { makeAgentApi, safeMapName };
