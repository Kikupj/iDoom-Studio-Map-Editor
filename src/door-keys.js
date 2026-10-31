const DOOR_LOCKS = [
    { value: 0, id: 'unlocked', label: 'Unlocked', color: '#94a3b8', thingType: null, keyName: null },
    { value: 1, id: 'red', label: 'Red Keycard', color: '#ef4444', thingType: 13, keyName: 'Red Keycard' },
    { value: 2, id: 'blue', label: 'Blue Keycard', color: '#3b82f6', thingType: 5, keyName: 'Blue Keycard' },
    { value: 3, id: 'yellow', label: 'Yellow Keycard', color: '#eab308', thingType: 6, keyName: 'Yellow Keycard' }
];

const DOOR_LOCK_BY_VALUE = new Map(DOOR_LOCKS.map(lock => [lock.value, lock]));

function getDoorLockInfo(value) {
    return DOOR_LOCK_BY_VALUE.get(value) || null;
}

function getDoorKeyWarnings(project = {}) {
    const doors = (project.smartObjects || []).filter(item => item?.type === 'door');
    const things = project.things || [];
    const counts = new Map();
    for (const thing of things) counts.set(thing.type, (counts.get(thing.type) || 0) + 1);

    return doors.flatMap(door => {
        const lock = getDoorLockInfo(door.lock ?? 0);
        if (!lock || lock.value === 0 || counts.get(lock.thingType)) return [];
        return [{
            doorId: door.id,
            doorName: door.name || 'Door',
            lock: lock.value,
            keyType: lock.thingType,
            keyName: lock.keyName,
            message: `${door.name || 'Door'} requires a ${lock.keyName}, but this map has no matching keycard pickup.`
        }];
    });
}

module.exports = { DOOR_LOCKS, getDoorLockInfo, getDoorKeyWarnings };
