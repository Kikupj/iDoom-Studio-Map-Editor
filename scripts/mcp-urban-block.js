#!/usr/bin/env node

const path = require('path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const ROOT_DIR = path.resolve(__dirname, '..');
const PROJECT_NAME = 'Copperline Urban Block';
const SAVE_NAME = 'copperline_urban_block';

function getResult(response, tool) {
    if (response.isError) throw new Error(`${tool}: ${response.content?.map(entry => entry.text).join('\n') || 'MCP call failed.'}`);
    return response.structuredContent || JSON.parse(response.content[0].text);
}

function room(id, name, x, y, width, height, ceilingHeight, theme, floorTexture, ceilingTexture, wallTexture, options = {}) {
    return {
        id, name, shape: 'rect', x, y, width, height, floorHeight: 0,
        ceilingHeight, lightLevel: options.lightLevel || 176, theme,
        floorTexture, ceilingTexture, wallTexture,
        ...(options.horizonWalls ? { horizonWalls: true } : {})
    };
}

function bulkhead(id, name, x, y, width, height, texture = 'BRICK1') {
    return {
        type: 'add', collection: 'smartObject',
        object: { id, name, type: 'pillar', solid: true, x, y, width, height, theme: 'industrial', wallTexture: texture }
    };
}

async function main() {
    const client = new Client({ name: 'idoom-urban-block-builder', version: '1.0.0' });
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [path.join(ROOT_DIR, 'src', 'mcp-server.js')],
        cwd: ROOT_DIR,
        env: process.env
    });
    await client.connect(transport);

    try {
        const call = async (name, args = {}) => getResult(await client.callTool({ name, arguments: args }), name);
        const current = await call('idoom_get_project');
        const backup = await call('idoom_save_project', { revision: current.revision, name: 'copper_circuit_maze_backup_urban' });
        const catalog = await call('idoom_get_catalog');
        const textureNames = new Set(catalog.wad.textures.map(texture => texture.name));
        const flatNames = new Set(catalog.wad.flats);
        const requiredTextures = ['BRICK1', 'BRICK2', 'BRICK7', 'METAL1', 'STONE2', 'BIGDOOR2', 'DOORTRAK', 'SHAWN2'];
        const requiredFlats = ['FLAT5_1', 'FLAT5_4', 'CEIL5_2', 'F_SKY1'];
        for (const texture of requiredTextures) if (!textureNames.has(texture)) throw new Error(`Missing required Freedoom texture ${texture}.`);
        for (const flat of requiredFlats) if (!flatNames.has(flat) && flat !== 'F_SKY1') throw new Error(`Missing required Freedoom flat ${flat}.`);

        const created = await call('idoom_create_project', {
            revision: current.revision,
            template: 'blank_studio',
            name: PROJECT_NAME
        });
        let revision = created.revision;

        const rooms = [
            room('room_1', 'Oak Street and Sidewalks', -384, -320, 768, 640, 256, 'outdoor', 'FLAT5_4', 'F_SKY1', 'BRICK1', { lightLevel: 192, horizonWalls: true }),
            room('main_lobby', 'Copperline Market Lobby', -184, 56, 368, 208, 128, 'industrial', 'FLAT5_1', 'CEIL5_2', 'BRICK1'),
            room('rear_shop', 'Market Back Room', -144, 176, 288, 88, 112, 'bunker', 'FLAT5_1', 'CEIL5_2', 'BRICK2', { lightLevel: 160 }),
            room('west_closed_shop', 'West Corner Storefront', -344, 80, 120, 152, 112, 'bunker', 'FLAT5_1', 'CEIL5_2', 'BRICK2'),
            room('east_closed_shop', 'East Corner Storefront', 224, 80, 120, 152, 112, 'bunker', 'FLAT5_1', 'CEIL5_2', 'BRICK7')
        ];
        const { id: _streetRoomId, ...streetRoomPatch } = rooms[0];

        const operations = [
            { type: 'update', id: 'room_1', patch: streetRoomPatch },
            { type: 'update', id: 'th_start', patch: { x: 0, y: -144, angle: 90 } },
            ...rooms.slice(1).map(value => ({ type: 'add', collection: 'room', object: value })),

            // Raised concrete sidewalks and a short apron that meets the storefront threshold.
            { type: 'add', collection: 'room', object: room('north_sidewalk', 'North Concrete Sidewalk', -384, 0, 768, 32, 256, 'bunker', 'FLAT5_1', 'F_SKY1', 'STONE2', { lightLevel: 184 }) },
            { type: 'add', collection: 'room', object: room('south_sidewalk', 'South Concrete Sidewalk', -384, -72, 768, 32, 256, 'bunker', 'FLAT5_1', 'F_SKY1', 'STONE2', { lightLevel: 184 }) },
            { type: 'add', collection: 'room', object: { ...room('storefront_apron', 'Market Entry Apron', -64, -8, 128, 48, 256, 'bunker', 'FLAT5_1', 'F_SKY1', 'STONE2'), floorHeight: 8 } },

            // Main brick market shell: the omitted center opening is filled by the usable sliding door sector.
            bulkhead('market_left_facade', 'Market West Brick Wall', -200, 40, 16, 240, 'BRICK1'),
            bulkhead('market_right_facade', 'Market East Brick Wall', 184, 40, 16, 240, 'BRICK1'),
            bulkhead('market_rear_facade', 'Market Rear Brick Wall', -200, 264, 400, 16, 'BRICK1'),
            bulkhead('market_front_west', 'Market Front Left Facade', -200, 40, 152, 16, 'BRICK2'),
            bulkhead('market_front_east', 'Market Front Right Facade', 48, 40, 152, 16, 'BRICK2'),
            {
                type: 'add', collection: 'smartObject',
                object: { id: 'market_entry_door', name: 'Copperline Market Front Door', type: 'door', x: -48, y: 24, width: 96, height: 48, theme: 'industrial', wallTexture: 'BIGDOOR2', trackTexture: 'DOORTRAK', lock: 0, speed: 16, wait: 150 }
            },

            // A narrow bulkhead leaves a clear 64-unit archway from the lobby to the shop's rear room.
            bulkhead('lobby_partition_west', 'Interior Partition West', -144, 160, 112, 16, 'BRICK2'),
            bulkhead('lobby_partition_east', 'Interior Partition East', 32, 160, 112, 16, 'BRICK2'),

            // Adjacent closed storefront facades make this read as a street block rather than an isolated box.
            bulkhead('west_store_outer', 'West Store Outer Wall', -352, 72, 16, 176, 'BRICK7'),
            bulkhead('west_store_inner', 'West Store Party Wall', -240, 72, 16, 176, 'BRICK2'),
            bulkhead('west_store_front', 'West Store Front', -352, 72, 128, 16, 'BRICK7'),
            bulkhead('west_store_rear', 'West Store Rear Wall', -352, 232, 128, 16, 'BRICK2'),
            bulkhead('east_store_inner', 'East Store Party Wall', 224, 72, 16, 176, 'BRICK2'),
            bulkhead('east_store_outer', 'East Store Outer Wall', 328, 72, 16, 176, 'BRICK7'),
            bulkhead('east_store_front', 'East Store Front', 224, 72, 120, 16, 'BRICK7'),
            bulkhead('east_store_rear', 'East Store Rear Wall', 224, 232, 120, 16, 'BRICK2'),

            // A modest counter in the rear shop leaves generous walking clearance around it.
            bulkhead('market_counter', 'Market Service Counter', -48, 216, 96, 16, 'WOOD1'),

            // Urban street furnishings, kept clear of the entry path and the 48-unit minimum passages.
            { type: 'add', collection: 'thing', object: { id: 'lamp_nw', type: 85, x: -288, y: -112, angle: 0 } },
            { type: 'add', collection: 'thing', object: { id: 'lamp_ne', type: 85, x: 288, y: -112, angle: 0 } },
            { type: 'add', collection: 'thing', object: { id: 'lamp_sw', type: 2028, x: -288, y: -256, angle: 0 } },
            { type: 'add', collection: 'thing', object: { id: 'lamp_se', type: 2028, x: 288, y: -256, angle: 0 } },
            { type: 'add', collection: 'thing', object: { id: 'lobby_medkit', type: 2012, x: 112, y: 96, angle: 0 } },
            { type: 'add', collection: 'thing', object: { id: 'backroom_shells', type: 2008, x: 96, y: 224, angle: 0 } }
        ];

        // Route check for the designed portal chain: street -> front door -> lobby -> arch -> back room.
        const streetToDoor = { from: { x: 0, y: -144 }, through: { x: 0, y: 40 }, to: { x: 0, y: 96 } };
        const lobbyToBackRoom = { lobby: { x: 0, y: 112 }, through: { x: 0, y: 168 }, backRoom: { x: 0, y: 208 } };
        if (streetToDoor.through.x < -48 || streetToDoor.through.x > 48 || lobbyToBackRoom.through.x < -32 || lobbyToBackRoom.through.x > 32) {
            throw new Error('Designed walkable opening geometry did not line up with the entry or interior arch.');
        }

        for (let offset = 0; offset < operations.length; offset += 100) {
            const batch = await call('idoom_apply_batch', {
                revision,
                operations: operations.slice(offset, offset + 100)
            });
            revision = batch.revision;
        }

        const validation = await call('idoom_validate_project', { revision });
        if (!validation.valid) throw new Error(`Urban block validation failed: ${validation.errors.join(' ')}`);
        const saved = await call('idoom_save_project', { revision, name: SAVE_NAME });
        const exported = await call('idoom_export_wad', { revision, name: SAVE_NAME });
        const final = await call('idoom_get_project');
        const latestValidation = await call('idoom_validate_project', { revision: final.revision });
        if (final.project.rooms.length < 4 || !final.project.smartObjects.some(object => object.type === 'door')) {
            throw new Error('The saved map does not contain the expected street block and enterable market.');
        }

        console.log(JSON.stringify({
            mcp: 'connected; project, room geometry, building, props, validation, save and export issued through MCP tools',
            name: final.project.name,
            revision: final.revision,
            roomCount: final.project.rooms.length,
            floorLevels: [...new Set(final.project.rooms.map(value => value.floorHeight))],
            door: final.project.smartObjects.find(object => object.id === 'market_entry_door'),
            interiorRooms: final.project.rooms.filter(value => ['main_lobby', 'rear_shop'].includes(value.id)).map(value => value.name),
            streetPropsAndPickups: final.project.things.length,
            solidFacadesAndInteriorWalls: final.project.smartObjects.filter(object => object.type === 'pillar' && object.solid).length,
            validated: latestValidation.valid,
            stats: validation.stats,
            backup: backup.projectPath,
            savedProject: saved.projectPath,
            savedWad: saved.wadPath,
            exportedWad: exported.wadPath
        }, null, 2));
    } finally {
        await client.close();
    }
}

main().catch(error => {
    console.error(`[MCP urban block] ${error.message}`);
    process.exitCode = 1;
});
