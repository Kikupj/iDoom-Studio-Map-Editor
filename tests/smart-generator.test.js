const test = require('node:test');
const assert = require('node:assert/strict');
const { generateRoomAttachment } = require('../src/smart-generator');

function room(id, x, y, width = 128, height = 128) {
    return { id, shape: 'rect', x, y, width, height, floorHeight: 0, ceilingHeight: 128, theme: 'techbase' };
}

test('room attachment respects explicit free direction and produces collision-resistant ids', () => {
    const project = { rooms: [room('anchor', 0, 0)], smartObjects: [], things: [], links: [] };
    const first = generateRoomAttachment(project, { fromRoomId: 'anchor', direction: 'E', width: 128, height: 128, encounter: 'none' });
    const second = generateRoomAttachment(project, { fromRoomId: 'anchor', direction: 'E', width: 128, height: 128, encounter: 'none' });
    assert.equal(first.project.rooms[1].x, 160);
    assert.notEqual(first.createdRoomId, second.createdRoomId);
});

test('room attachment fails clearly instead of placing an overlapping room when all sides are blocked', () => {
    const anchor = room('anchor', 0, 0);
    const blockers = [room('east', 160, 0), room('north', 0, 160), room('south', 0, -160), room('west', -160, 0)];
    const project = { rooms: [anchor, ...blockers], smartObjects: [], things: [], links: [] };
    assert.throws(() => generateRoomAttachment(project, { fromRoomId: 'anchor', width: 128, height: 128 }), /not enough free space/i);
});

test('room attachment rejects invalid directions and missing requested anchor rooms', () => {
    const project = { rooms: [room('anchor', 0, 0)], smartObjects: [], things: [], links: [] };
    assert.throws(() => generateRoomAttachment(project, { direction: 'NE' }), /direction must be E, N, S, or W/);
    assert.throws(() => generateRoomAttachment(project, { fromRoomId: 'missing' }), /does not exist/);
});
