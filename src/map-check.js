const { clone, validateProject } = require('./project-session');
const { THING_CATALOG } = require('./starter-maps');
const { getDoorKeyWarnings } = require('./door-keys');

const THING_BY_TYPE = new Map(THING_CATALOG.map(thing => [thing.type, thing]));

function roomPolygon(room) {
    const x = Number(room.x) || 0;
    const y = Number(room.y) || 0;
    const width = Number(room.width) || 0;
    const height = Number(room.height) || 0;
    if (Array.isArray(room.points) && room.points.length >= 3) return room.points;
    if (room.shape !== 'octagon') return [
        { x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }
    ];
    const cut = Math.min(Math.round(Math.min(width, height) * 0.25), 128);
    return [
        { x: x + cut, y }, { x: x + width - cut, y }, { x: x + width, y: y + cut },
        { x: x + width, y: y + height - cut }, { x: x + width - cut, y: y + height },
        { x: x + cut, y: y + height }, { x, y: y + height - cut }, { x, y: y + cut }
    ];
}

function pointInPolygon(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[i], b = polygon[j];
        const crosses = ((a.y > point.y) !== (b.y > point.y)) &&
            point.x < ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || Number.EPSILON) + a.x;
        if (crosses) inside = !inside;
    }
    return inside;
}

function distanceToSegment(point, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq)) : 0;
    return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function roomAtPoint(point, rooms) {
    return rooms.find(room => pointInPolygon(point, roomPolygon(room))) || null;
}

function rectanglesTouch(a, b) {
    const ax1 = a.x, ay1 = a.y, ax2 = a.x + a.width, ay2 = a.y + a.height;
    const bx1 = b.x, by1 = b.y, bx2 = b.x + b.width, by2 = b.y + b.height;
    const gapX = Math.max(0, bx1 - ax2, ax1 - bx2);
    const gapY = Math.max(0, by1 - ay2, ay1 - by2);
    return gapX <= 1 && gapY <= 1;
}

function roomsOverlapWalkableFloor(a, b) {
    const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    const floorA = Number.isFinite(a.floorHeight) ? a.floorHeight : 0;
    const floorB = Number.isFinite(b.floorHeight) ? b.floorHeight : 0;
    return overlapX > 1 && overlapY > 1 && Math.abs(floorA - floorB) < 24;
}

function analyzeMap(projectInput, { wadCatalog } = {}) {
    const project = clone(projectInput || {});
    const diagnostics = [];
    const add = (severity, code, title, message, suggestion, affectedIds = [], location = null) => {
        diagnostics.push({ severity, code, title, message, suggestion, affectedIds, location });
    };
    const contractErrors = validateProject(clone(project), { requireRoom: false, wadCatalog });
    if (contractErrors.length) {
        add('error', 'PROJECT_CONTRACT_INVALID', 'Project data needs repair', contractErrors.join(' '), 'Correct the listed project fields before exporting or playtesting.');
    }

    const rooms = (project.rooms || []).filter(room => room && Number.isFinite(room.x) && Number.isFinite(room.y) && Number.isFinite(room.width) && Number.isFinite(room.height));
    const things = project.things || [];
    const smartObjects = project.smartObjects || [];
    const starts = things.filter(thing => thing.type === 1);
    if (!rooms.length) {
        add('error', 'ROOMS_REQUIRED', 'Add a playable space', 'This project has no valid room geometry to compile into a playable map.', 'Create at least one room.');
    }
    if (!starts.length) {
        add('warning', 'PLAYER_START_MISSING', 'No player start placed', 'The compiler can insert a fallback start, but its location may not be the one you want.', 'Place a Player 1 Start in a safe, open room.', [], null);
    } else if (starts.length > 1) {
        add('warning', 'PLAYER_START_MULTIPLE', 'Multiple player starts', `Found ${starts.length} Player 1 Starts; the engine may choose any valid start.`, 'Keep one Player 1 Start for predictable single-player testing.', starts.map(thing => thing.id));
    }
    if (!(smartObjects || []).some(object => object?.type === 'exit')) {
        add('info', 'EXIT_NOT_DEFINED', 'No level exit defined', 'No smart exit object is present. This is acceptable for a sandbox or test map.', 'Add an exit switch or exit object if this level should have a finish.');
    }

    for (const thing of things) {
        if (!Number.isFinite(thing.x) || !Number.isFinite(thing.y)) continue;
        const point = { x: thing.x, y: thing.y };
        const room = roomAtPoint(point, rooms);
        if (!room) {
            add('warning', 'THING_OUTSIDE_ROOM', 'Actor is outside room floor space', `${thing.id || `Thing ${thing.type}`} is not inside any authored room footprint.`, 'Move the actor into a room; stacked floors and special geometry may need an in-engine check.', thing.id ? [thing.id] : [], point);
            continue;
        }
        const catalogThing = THING_BY_TYPE.get(thing.type);
        const polygon = roomPolygon(room);
        const nearestEdge = Math.min(...polygon.map((vertex, index) => distanceToSegment(point, vertex, polygon[(index + 1) % polygon.length])));
        if (catalogThing?.radius && nearestEdge < catalogThing.radius) {
            add('warning', 'THING_CLEARANCE_NEAR_WALL', 'Actor is close to a room edge', `${catalogThing.name} is about ${Math.round(nearestEdge)} map units from the nearest room edge; actor radius is approximately ${catalogThing.radius}.`, 'Move the actor farther from walls or verify its spawn/collision in UZDoom.', thing.id ? [thing.id] : [], point);
        }
        const roomClearance = Number.isFinite(room.ceilingHeight) && Number.isFinite(room.floorHeight)
            ? room.ceilingHeight - room.floorHeight : null;
        if (roomClearance !== null && catalogThing?.height && roomClearance < catalogThing.height) {
            add('warning', 'THING_CLEARANCE_LOW', 'Actor may not fit vertically', `${catalogThing.name} is approximately ${catalogThing.height} units tall, while this room has ${roomClearance} units of vertical clearance.`, 'Increase the room height or verify the actor placement and floor height in UZDoom.', thing.id ? [thing.id, room.id].filter(Boolean) : [room.id]);
        }
    }

    const doors = smartObjects.filter(object => object?.type === 'door');
    for (const door of doors) {
        const doorRect = { x: door.x, y: door.y, width: door.width, height: door.height };
        const adjacentRooms = rooms.filter(room => rectanglesTouch(doorRect, room));
        if (adjacentRooms.length < 2) {
            add('warning', 'DOOR_NOT_BETWEEN_ROOMS', 'Door may not connect two rooms', `${door.name || door.id || 'Door'} does not touch two authored room bounds in the static layout.`, 'Check that the door spans the wall opening and verify the connection in UZDoom.', [door.id].filter(Boolean), { x: door.x, y: door.y });
        }
        if (Math.min(door.width, door.height) < 24 || Math.max(door.width, door.height) < 56) {
            add('warning', 'DOOR_OPENING_TOO_SMALL', 'Door opening may be too small', `${door.name || door.id || 'Door'} has a ${door.width}×${door.height} footprint, which may not provide usable player clearance.`, 'Increase the opening dimensions and confirm clearance in UZDoom.', [door.id].filter(Boolean), { x: door.x, y: door.y });
        }
    }

    if (rooms.length > 1) {
        const adjacency = new Map(rooms.map(room => [room.id, new Set()]));
        for (let i = 0; i < rooms.length; i++) {
            for (let j = i + 1; j < rooms.length; j++) {
                const a = rooms[i], b = rooms[j];
                const connected = roomsOverlapWalkableFloor(a, b) || smartObjects.some(object => {
                    if (!['door', 'stairs'].includes(object?.type)) return false;
                    const objectRect = { x: object.x, y: object.y, width: object.width, height: object.height };
                    return rectanglesTouch(objectRect, a) && rectanglesTouch(objectRect, b);
                });
                if (connected && adjacency.has(a.id) && adjacency.has(b.id)) {
                    adjacency.get(a.id).add(b.id);
                    adjacency.get(b.id).add(a.id);
                }
            }
        }
        const visited = new Set();
        const components = [];
        for (const room of rooms) {
            if (visited.has(room.id)) continue;
            const stack = [room.id], component = [];
            visited.add(room.id);
            while (stack.length) {
                const id = stack.pop();
                component.push(id);
                for (const neighbor of adjacency.get(id) || []) {
                    if (visited.has(neighbor)) continue;
                    visited.add(neighbor);
                    stack.push(neighbor);
                }
            }
            components.push(component);
        }
        if (components.length > 1) {
            add('warning', 'ROOMS_MAY_BE_DISCONNECTED', 'Some rooms may be disconnected', `A simple 2D room/door adjacency estimate found ${components.length} separate room groups. Stairs, lifts, teleporters, 3D floors, and custom linedef actions are not fully modeled.`, 'Add or verify a doorway or other connection between the listed groups in UZDoom.', components.flat());
        }
    }

    const missingKeys = getDoorKeyWarnings(project);
    for (const warning of missingKeys) {
        add('warning', 'LOCKED_DOOR_KEY_MISSING', 'Locked door has no matching keycard', warning.message, `Place a ${warning.lock.keyName} or change the door lock.`, [warning.doorId]);
    }
    if (doors.some(door => Number(door.lock) > 0)) {
        add('info', 'KEY_PROGRESSION_UNPROVEN', 'Keycard progression is not proven', 'Static checks can find absent matching key types, but cannot prove that a key is reachable before every locked door.', 'Test the route and lock order in UZDoom, especially with switches and dynamic geometry.', doors.filter(door => Number(door.lock) > 0).map(door => door.id));
    }

    const dynamicTypes = new Set(['stairs', 'lift', 'teleporter', '3dfloor', 'pool', 'window']);
    const dynamicObjects = smartObjects.filter(object => dynamicTypes.has(object?.type));
    if (dynamicObjects.length) {
        add('info', 'DYNAMIC_GEOMETRY_UNCERTAIN', 'Engine geometry needs gameplay verification', `${dynamicObjects.length} smart object(s) use geometry or behavior that this static checker cannot fully simulate.`, 'Treat these findings as estimates and verify collision, floor heights, and interactions in UZDoom.', dynamicObjects.map(object => object.id).filter(Boolean));
    }

    const summary = diagnostics.reduce((counts, finding) => {
        counts[finding.severity] = (counts[finding.severity] || 0) + 1;
        return counts;
    }, { error: 0, warning: 0, info: 0 });
    return {
        valid: summary.error === 0,
        diagnostics,
        summary,
        limits: [
            'Map Check uses authored room footprints and approximate actor catalog dimensions; it is not a Doom physics simulation.',
            'Connectivity and key progression are estimates. Dynamic 3D floors, stairs, lifts, teleporters, switch logic, and engine collision must be verified in UZDoom.'
        ]
    };
}

function validatePlayableProject(project, options = {}) {
    const errors = validateProject(clone(project || {}), { requireRoom: true, ...options });
    if (!errors.length) return [];
    return [{
        severity: 'error',
        code: 'PLAYABLE_PROJECT_INVALID',
        title: 'Project cannot be compiled as a playable map',
        message: errors.join(' '),
        suggestion: 'Fix the project contract errors before export or playtest.',
        affectedIds: [],
        location: null
    }];
}

module.exports = { analyzeMap, validatePlayableProject, pointInPolygon, roomPolygon };
