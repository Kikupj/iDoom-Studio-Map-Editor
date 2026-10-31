#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

const ROOT_DIR = path.resolve(__dirname, '..');
const MAPS_DIR = process.env.IDOOM_MAPS_DIR ? path.resolve(process.env.IDOOM_MAPS_DIR) : path.join(ROOT_DIR, 'maps');
const TOKEN_FILE = path.join(MAPS_DIR, '.agent-token');
const PORT = process.env.PORT || '3456';
const BASE_URL = process.env.IDOOM_STUDIO_URL || `http://127.0.0.1:${PORT}`;

const serviceUrl = new URL(BASE_URL);
if (serviceUrl.protocol !== 'http:' || !['localhost', '127.0.0.1', '::1', '[::1]'].includes(serviceUrl.hostname)) {
    throw new Error('IDOOM_STUDIO_URL must point to the local HTTP editor service (localhost or loopback only).');
}

function formatToolResult(result) {
    return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        structuredContent: result
    };
}

function formatToolError(error) {
    const detail = error?.message || String(error);
    return { content: [{ type: 'text', text: detail }], isError: true };
}

async function startMcpServer() {
    if (!fs.existsSync(TOKEN_FILE)) {
        throw new Error('The iDoom Studio server must be started once before launching MCP. Expected maps/.agent-token.');
    }
    const token = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    if (!/^[0-9a-f]{64}$/i.test(token)) throw new Error('maps/.agent-token is invalid; restart the editor server to regenerate it.');

    async function call(action, args = {}) {
        const response = await fetch(`${BASE_URL}/api/agent/action`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ action, args })
        });
        const data = await response.json();
        if (!response.ok) {
            const error = new Error(data.error || `Editor service returned HTTP ${response.status}.`);
            error.status = response.status;
            error.details = data;
            throw error;
        }
        return data;
    }

    const server = new McpServer({ name: 'idoom-studio', version: '1.0.0' }, { maxToolInputElements: 10000 });
    const rev = z.number().int().nonnegative().describe('Current project revision from idoom_get_project. Every write requires this exact revision.');

    function register(name, description, inputSchema, action, getArgs = value => value) {
        server.registerTool(name, {
            title: name.replaceAll('_', ' '),
            description,
            inputSchema,
            annotations: { readOnlyHint: ['idoom_get_project', 'idoom_get_catalog', 'idoom_validate_project', 'idoom_map_check'].includes(name), destructiveHint: ['idoom_create_project', 'idoom_delete_object', 'idoom_load_project', 'idoom_playtest'].includes(name) }
        }, async args => {
            try { return formatToolResult(await call(action, getArgs(args))); }
            catch (error) { return formatToolError(error); }
        });
    }

    register('idoom_get_project', 'Read the live map and its revision before editing. Returns the complete rooms, objects, links, things, validation findings, and non-blocking missing-keycard warnings.', {}, 'project_get', () => ({}));
    register('idoom_get_catalog', 'List the game profile (mod, scale, map naming), starter maps, material themes, skyboxes, map thing types (including the mod\'s own), textures and flats with their source groups, and the door lock values with matching pickup types.', {}, 'catalog_get', () => ({}));
    register('idoom_create_project', 'Replace the live map with a named starter project. The update is pushed to the open editor immediately.', {
        revision: rev,
        template: z.string().max(64).default('blank_studio').describe('A starter map id from idoom_get_catalog (the game profile adds its own, e.g. nbc_block).'),
        name: z.string().max(120).optional()
    }, 'project_create');
    register('idoom_attach_room', 'Attach a collision-checked themed room, door/stairs connection, and optional encounter to the current map.', {
        revision: rev,
        theme: z.string().max(64).optional().describe('A material theme id from idoom_get_catalog; the profile default when omitted.'),
        connection: z.enum(['door', 'stairs']).default('door'),
        shape: z.enum(['rect', 'octagon']).default('rect'),
        encounter: z.enum(['none', 'light', 'balanced', 'ambush']).default('none'),
        fromRoomId: z.string().optional(),
        direction: z.enum(['E', 'N', 'S', 'W']).optional(),
        width: z.number().positive().max(2048).optional(),
        height: z.number().positive().max(2048).optional()
    }, 'room_attach');
    register('idoom_set_project_settings', 'Set project-level fields: the map name, the skybox preset, and the map lump the WAD and playtest use (e.g. NBC_HUB; up to 8 letters, digits and underscores). Pass an empty string to clear a field.', {
        revision: rev,
        name: z.string().max(120).optional(),
        skybox: z.string().max(64).optional(),
        mapLump: z.string().max(8).optional()
    }, 'project_settings');
    register('idoom_add_object', 'Add a room, smart object, or Doom thing using its normal editor project fields. The id may be omitted and generated automatically.', {
        revision: rev,
        collection: z.enum(['room', 'smartObject', 'thing']),
        object: z.record(z.any())
    }, 'object_add');
    register('idoom_update_object', 'Update fields of an existing room, smart object, or thing without changing its id.', {
        revision: rev,
        id: z.string(),
        patch: z.record(z.any())
    }, 'object_update');
    register('idoom_apply_batch', 'Apply up to 100 room attachment, object add/update/delete, or trigger-link operations as one validated revision. If any edit is invalid, none are applied.', {
        revision: rev,
        operations: z.array(z.record(z.any())).min(1).max(100)
    }, 'batch_edit');
    register('idoom_delete_object', 'Delete a room, smart object, or thing by id and remove links that reference it.', {
        revision: rev,
        id: z.string()
    }, 'object_delete');
    register('idoom_link_objects', 'Link a trigger object to a target such as a door or lift.', {
        revision: rev,
        sourceId: z.string(),
        targetId: z.string(),
        action: z.enum(['door', 'lift']).default('door')
    }, 'objects_link');
    register('idoom_validate_project', 'Validate project structure, IDs, geometry, links, Freedoom texture references, compiler compatibility, and report non-blocking missing door-keycard warnings without modifying the map.', {
        revision: rev
    }, 'project_validate');
    register('idoom_map_check', 'Run the shared beginner-facing Map Check. Returns structured errors, warnings, and informational limits; connectivity, actor clearance, key progression, dynamic 3D geometry, and gameplay physics remain estimates that must be checked in UZDoom.', {
        revision: rev
    }, 'map_check');
    register('idoom_undo', 'Undo the most recent committed project revision. This creates a new revision and is pushed live to the editor.', {
        revision: rev
    }, 'project_undo');
    register('idoom_redo', 'Redo the most recently undone project revision, if any.', {
        revision: rev
    }, 'project_redo');
    register('idoom_save_project', 'Validate and atomically save the current project JSON under maps/. A compiled WAD is also refreshed when the draft has playable geometry; autosaves remain separate and never replace named saves.', {
        revision: rev,
        name: z.string().max(120).optional(),
        saveAs: z.boolean().optional().describe('Create a separate named project identity even when saving over an existing filename.')
    }, 'project_save');
    register('idoom_load_project', 'Load a previously saved maps/<name>.json into the live editor. The name is a simple map filename, not a path.', {
        revision: rev,
        name: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/)
    }, 'project_load');
    register('idoom_export_wad', 'Compile and write the current validated project as maps/<name>.wad. Under a game profile that exports to its mod, a map lump the profile accepts (NBC_* for New Bricks City) is also written to the mod as <LUMP>.wad, and the result carries the MAPINFO entry the mod needs for a new map.', {
        revision: rev,
        name: z.string().max(120).optional()
    }, 'project_export');
    register('idoom_playtest', 'Explicitly launch UZDoom with the current map. This is the only MCP tool that starts the game.', {
        revision: rev
    }, 'map_playtest');

    server.registerResource('live-project', 'doom://project/current', {
        title: 'Current iDoom Studio map',
        description: 'Current revisioned project open in iDoom Studio.',
        mimeType: 'application/json'
    }, async uri => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await call('project_get'), null, 2) }] }));
    server.registerResource('catalog', 'doom://catalog', {
        title: 'Doom map editor catalog',
        description: 'Starter maps, supported themes, skyboxes, and Doom thing catalog.',
        mimeType: 'application/json'
    }, async uri => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await call('catalog_get'), null, 2) }] }));

    const transport = new StdioServerTransport();
    await server.connect(transport);
    return server;
}

if (require.main === module) {
    startMcpServer().catch(error => {
        console.error(`[iDoom Studio MCP] ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = { startMcpServer };
