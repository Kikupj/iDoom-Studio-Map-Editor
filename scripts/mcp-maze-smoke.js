#!/usr/bin/env node

const path = require('path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const ROOT_DIR = path.resolve(__dirname, '..');
const MAZE_NAME = 'Copper Circuit Labyrinth';
const SAVE_NAME = 'copper_circuit_labyrinth';
const SIZE = 7;
const CELL = 96;
const PASSAGE = 48;
const WALL = 16;
const ORIGIN = -(SIZE * CELL) / 2;

function seededRandom() {
    let seed = 0xC1AC017;
    return () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 0x100000000;
    };
}

function edgeKey(a, b) {
    return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function buildMaze() {
    const random = seededRandom();
    const nodeId = (row, col) => row * SIZE + col;
    const adjacency = Array.from({ length: SIZE * SIZE }, () => []);
    const visited = new Set([0]);
    const stack = [0];
    const passages = new Set();
    const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];

    while (stack.length) {
        const current = stack[stack.length - 1];
        const row = Math.floor(current / SIZE);
        const col = current % SIZE;
        const candidates = directions
            .map(([dr, dc]) => ({ row: row + dr, col: col + dc }))
            .filter(next => next.row >= 0 && next.row < SIZE && next.col >= 0 && next.col < SIZE)
            .filter(next => !visited.has(nodeId(next.row, next.col)));
        for (let i = candidates.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
        }
        if (!candidates.length) {
            stack.pop();
            continue;
        }
        const next = candidates[0];
        const nextId = nodeId(next.row, next.col);
        visited.add(nextId);
        passages.add(edgeKey(current, nextId));
        adjacency[current].push(nextId);
        adjacency[nextId].push(current);
        stack.push(nextId);
    }

    // Add a handful of cycles to create alternate routes, while keeping the maze legible.
    const possibleLoops = [];
    for (let row = 0; row < SIZE; row++) {
        for (let col = 0; col < SIZE; col++) {
            const current = nodeId(row, col);
            for (const [dr, dc] of [[1, 0], [0, 1]]) {
                const nr = row + dr, nc = col + dc;
                if (nr < SIZE && nc < SIZE) {
                    const next = nodeId(nr, nc);
                    if (!passages.has(edgeKey(current, next))) possibleLoops.push([current, next]);
                }
            }
        }
    }
    for (let i = possibleLoops.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [possibleLoops[i], possibleLoops[j]] = [possibleLoops[j], possibleLoops[i]];
    }
    for (const [a, b] of possibleLoops.slice(0, 5)) {
        passages.add(edgeKey(a, b));
        adjacency[a].push(b);
        adjacency[b].push(a);
    }

    const distances = Array(SIZE * SIZE).fill(-1);
    distances[0] = 0;
    const queue = [0];
    for (let i = 0; i < queue.length; i++) {
        const current = queue[i];
        for (const next of adjacency[current]) {
            if (distances[next] !== -1) continue;
            distances[next] = distances[current] + 1;
            queue.push(next);
        }
    }
    const exitNode = distances.indexOf(Math.max(...distances));
    if (visited.size !== SIZE * SIZE || distances[exitNode] < SIZE * 2) {
        throw new Error('Generated maze failed its connectivity/path-length precheck.');
    }

    function addPillar(operations, id, x, y, width, height) {
        if (width < WALL || height < WALL) return;
        operations.push({
            type: 'add',
            collection: 'smartObject',
            object: { id, name: 'Maze Bulkhead', type: 'pillar', solid: true, x, y, width, height, theme: 'industrial', wallTexture: 'METAL1' }
        });
    }

    const walls = [];
    let wallIndex = 0;
    for (let boundaryCol = 0; boundaryCol < SIZE - 1; boundaryCol++) {
        const x = ORIGIN + (boundaryCol + 1) * CELL - WALL / 2;
        let row = 0;
        while (row < SIZE) {
            const left = row * SIZE + boundaryCol;
            const right = left + 1;
            if (passages.has(edgeKey(left, right))) {
                const y = ORIGIN + row * CELL;
                const side = (CELL - PASSAGE) / 2;
                addPillar(walls, `maze_wall_${wallIndex++}`, x, y, WALL, side);
                addPillar(walls, `maze_wall_${wallIndex++}`, x, y + side + PASSAGE, WALL, side);
                row++;
                continue;
            }
            const start = row;
            while (row < SIZE) {
                const a = row * SIZE + boundaryCol;
                if (passages.has(edgeKey(a, a + 1))) break;
                row++;
            }
            const y = ORIGIN + start * CELL;
            addPillar(walls, `maze_wall_${wallIndex++}`, x, y, WALL, (row - start) * CELL);
        }
    }

    for (let boundaryRow = 0; boundaryRow < SIZE - 1; boundaryRow++) {
        const y = ORIGIN + (boundaryRow + 1) * CELL - WALL / 2;
        let col = 0;
        while (col < SIZE) {
            const top = boundaryRow * SIZE + col;
            const bottom = top + SIZE;
            if (passages.has(edgeKey(top, bottom))) {
                const x = ORIGIN + col * CELL;
                const side = (CELL - PASSAGE) / 2;
                addPillar(walls, `maze_wall_${wallIndex++}`, x, y, side, WALL);
                addPillar(walls, `maze_wall_${wallIndex++}`, x + side + PASSAGE, y, side, WALL);
                col++;
                continue;
            }
            const start = col;
            while (col < SIZE) {
                const a = boundaryRow * SIZE + col;
                if (passages.has(edgeKey(a, a + SIZE))) break;
                col++;
            }
            const x = ORIGIN + start * CELL;
            addPillar(walls, `maze_wall_${wallIndex++}`, x, y, (col - start) * CELL, WALL);
        }
    }

    // Seal the maze's perimeter. The 8-unit buffer to the room boundary is too narrow to walk through.
    const perimeter = ORIGIN - WALL / 2;
    const perimeterLength = SIZE * CELL + WALL;
    const farPerimeter = ORIGIN + SIZE * CELL - WALL / 2;
    addPillar(walls, `maze_wall_${wallIndex++}`, perimeter, perimeter, WALL, perimeterLength);
    addPillar(walls, `maze_wall_${wallIndex++}`, farPerimeter, perimeter, WALL, perimeterLength);
    addPillar(walls, `maze_wall_${wallIndex++}`, perimeter, perimeter, perimeterLength, WALL);
    addPillar(walls, `maze_wall_${wallIndex++}`, perimeter, farPerimeter, perimeterLength, WALL);

    const centerOf = id => ({
        x: ORIGIN + (id % SIZE) * CELL + CELL / 2,
        y: ORIGIN + Math.floor(id / SIZE) * CELL + CELL / 2
    });
    const deadEnds = adjacency
        .map((edges, id) => ({ id, degree: edges.length, distance: distances[id] }))
        .filter(node => node.degree === 1 && node.id !== 0 && node.id !== exitNode)
        .sort((a, b) => b.distance - a.distance);
    const pickups = deadEnds.slice(0, 6).map((node, index) => ({
        id: `maze_pickup_${index + 1}`,
        type: index % 2 === 0 ? 2012 : 2008,
        ...centerOf(node.id),
        angle: 0
    }));

    const start = centerOf(0);
    const finish = centerOf(exitNode);
    return {
        adjacency,
        distances,
        exitNode,
        finish,
        start,
        walls,
        pickups,
        passageCount: passages.size,
        deadEndCount: adjacency.filter(edges => edges.length === 1).length
    };
}

function getResult(response, toolName) {
    if (response.isError) throw new Error(`${toolName}: ${response.content?.map(entry => entry.text).join('\n') || 'MCP tool failed.'}`);
    return response.structuredContent || JSON.parse(response.content[0].text);
}

async function main() {
    const client = new Client({ name: 'copper-circuit-maze-runner', version: '1.0.0' });
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [path.join(ROOT_DIR, 'src', 'mcp-server.js')],
        cwd: ROOT_DIR,
        env: process.env
    });
    await client.connect(transport);

    try {
        const call = async (name, args) => getResult(await client.callTool({ name, arguments: args }), name);
        const current = await call('idoom_get_project', {});
        const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
        const backup = await call('idoom_save_project', { revision: current.revision, name: `pre_maze_backup_${stamp}` });
        const catalog = await call('idoom_get_catalog', {});
        const validThingTypes = new Set(catalog.things.map(thing => thing.type));
        for (const type of [1, 2008, 2012]) {
            if (!validThingTypes.has(type)) throw new Error(`The Doom thing type ${type} is not available in the agent catalog.`);
        }
        if (!catalog.wad.textures.some(texture => texture.name === 'METAL1')) throw new Error('Expected maze wall texture METAL1 is unavailable.');

        const maze = buildMaze();
        const created = await call('idoom_create_project', {
            revision: current.revision,
            template: 'blank_studio',
            name: MAZE_NAME
        });
        let revision = created.revision;

        const foundations = [
            {
                type: 'update', id: 'room_1', patch: {
                    name: 'The Copper Circuit', x: ORIGIN - 8, y: ORIGIN - 8,
                    width: SIZE * CELL + 16, height: SIZE * CELL + 16,
                    floorHeight: 0, ceilingHeight: 160, lightLevel: 176,
                    theme: 'industrial', shape: 'rect', floorTexture: 'FLOOR5_1', ceilingTexture: 'CEIL5_2'
                }
            },
            { type: 'update', id: 'th_start', patch: { x: maze.start.x, y: maze.start.y, angle: 0 } },
            {
                type: 'add', collection: 'smartObject', object: {
                    id: 'maze_exit', name: 'Exit Lift', type: 'exit',
                    x: maze.finish.x - 24, y: maze.finish.y - 24, width: 48, height: 48,
                    floorHeight: 0, ceilingHeight: 128, theme: 'industrial', wallTexture: 'SW1EXIT'
                }
            },
            ...maze.pickups.map(thing => ({ type: 'add', collection: 'thing', object: thing }))
        ];

        const operations = [...foundations, ...maze.walls];
        for (let offset = 0; offset < operations.length; offset += 100) {
            const result = await call('idoom_apply_batch', {
                revision,
                operations: operations.slice(offset, offset + 100)
            });
            revision = result.revision;
        }

        const validation = await call('idoom_validate_project', { revision });
        if (!validation.valid) throw new Error(`Maze validation failed: ${validation.errors.join(' ')}`);
        const saved = await call('idoom_save_project', { revision, name: SAVE_NAME });
        const exported = await call('idoom_export_wad', { revision, name: SAVE_NAME });
        const final = await call('idoom_get_project', {});
        if (final.project.rooms.length !== 1 || final.project.rooms[0].floorHeight !== 0) {
            throw new Error('The generated project is not a single-floor, single-room maze layout.');
        }
        if (!final.project.things.some(thing => thing.type === 1) || !final.project.smartObjects.some(object => object.type === 'exit')) {
            throw new Error('Maze must contain both a player start and an exit.');
        }

        console.log(JSON.stringify({
            mcp: 'connected; all map edits, validation, saving, and export used MCP tools',
            name: final.project.name,
            revision: final.revision,
            rooms: final.project.rooms.length,
            floorHeight: final.project.rooms[0].floorHeight,
            mazeGrid: `${SIZE}x${SIZE}`,
            reachableCells: maze.distances.filter(distance => distance >= 0).length,
            farthestExitPath: maze.distances[maze.exitNode],
            mazeConnections: maze.passageCount,
            deadEnds: maze.deadEndCount,
            solidWallSegments: maze.walls.length,
            pickups: maze.pickups.length,
            compilerStats: validation.stats,
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
    console.error(`[MCP maze run] ${error.message}`);
    process.exitCode = 1;
});
