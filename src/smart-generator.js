/**
 * Apple Intelligence-style Smart Architectural Generator for Doom Maps
 * Generates connected rooms, doors, stairs, pillars, and balanced combat encounters.
 */

const crypto = require('crypto');
const { MATERIAL_THEMES } = require('./udmf-compiler');

function generateRoomAttachment(project, options = {}) {
  const style = options.theme || 'techbase';
  const encounter = options.encounter || 'balanced'; // 'none', 'light', 'balanced', 'ambush'
  const connectionType = options.connection || 'door'; // 'door', 'stairs', 'window_lift'
  const targetRoomId = options.fromRoomId;

  if (!MATERIAL_THEMES[style]) throw new Error(`Unknown room theme "${style}".`);
  if (!['none', 'light', 'balanced', 'ambush'].includes(encounter)) throw new Error(`Unknown encounter level "${encounter}".`);
  if (!['door', 'stairs'].includes(connectionType)) throw new Error(`Unknown room connection "${connectionType}".`);
  if (options.shape && !['rect', 'octagon'].includes(options.shape)) throw new Error('Room shape must be rect or octagon.');

  const rooms = [...(project.rooms || [])];
  const smartObjects = [...(project.smartObjects || [])];
  const things = [...(project.things || [])];
  const links = [...(project.links || [])];

  // Find anchor room (either selected room or rightmost room)
  let anchor = rooms.find(r => r.id === targetRoomId);
  if (targetRoomId && !anchor) throw new Error(`Anchor room "${targetRoomId}" does not exist.`);
  if (!anchor && rooms.length > 0) {
    anchor = rooms.reduce((best, r) => ((r.x + (r.width || 256)) > (best.x + (best.width || 256)) ? r : best), rooms[0]);
  }
  if (!anchor) {
    anchor = { id: 'room_base', x: -192, y: -192, width: 384, height: 384, floorHeight: 0, ceilingHeight: 128, lightLevel: 176, theme: 'techbase' };
    rooms.push(anchor);
  }

  // Try candidate directions (E, N, S, W) to find free space that doesn't overlap existing rooms
  const w = options.width === undefined ? 384 : options.width;
  const h = options.height === undefined ? 384 : options.height;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 64 || h < 64 || w > 2048 || h > 2048) {
    throw new Error('Generated room width and height must be finite values between 64 and 2048 units.');
  }
  const gap = connectionType === 'stairs' ? 128 : 32;

  const ax = anchor.x || 0;
  const ay = anchor.y || 0;
  const aw = anchor.width || 384;
  const ah = anchor.height || 384;
  const aFloor = Number.isFinite(anchor.floorHeight) ? anchor.floorHeight : 0;

  const dirs = [
    {
      dir: 'E',
      rx: ax + aw + gap,
      ry: ay + Math.round((ah - h) / 2 / 32) * 32,
      cx: ax + aw,
      cy: ay + Math.round((ah - 128) / 2 / 32) * 32,
      cw: gap,
      ch: 128,
      angle: 180
    },
    {
      dir: 'N',
      rx: ax + Math.round((aw - w) / 2 / 32) * 32,
      ry: ay + ah + gap,
      cx: ax + Math.round((aw - 128) / 2 / 32) * 32,
      cy: ay + ah,
      cw: 128,
      ch: gap,
      angle: 270
    },
    {
      dir: 'S',
      rx: ax + Math.round((aw - w) / 2 / 32) * 32,
      ry: ay - h - gap,
      cx: ax + Math.round((aw - 128) / 2 / 32) * 32,
      cy: ay - gap,
      cw: 128,
      ch: gap,
      angle: 90
    },
    {
      dir: 'W',
      rx: ax - w - gap,
      ry: ay + Math.round((ah - h) / 2 / 32) * 32,
      cx: ax - gap,
      cy: ay + Math.round((ah - 128) / 2 / 32) * 32,
      cw: gap,
      ch: 128,
      angle: 0
    }
  ];

  function boxesOverlap(x1, y1, w1, h1, x2, y2, w2, h2) {
    return x1 < x2 + w2 - 16 && x1 + w1 > x2 + 16 && y1 < y2 + h2 - 16 && y1 + h1 > y2 + 16;
  }

  const requestedDirection = options.direction ? String(options.direction).toUpperCase() : null;
  if (requestedDirection && !['E', 'N', 'S', 'W'].includes(requestedDirection)) {
    throw new Error('Room attachment direction must be E, N, S, or W.');
  }
  const candidates = requestedDirection ? dirs.filter(d => d.dir === requestedDirection) : dirs;
  let chosen = null;
  for (const d of candidates) {
    const overlaps = rooms.some(r => boxesOverlap(d.rx, d.ry, w, h, r.x || 0, r.y || 0, r.width || 256, r.height || 256));
    if (!overlaps) {
      chosen = d;
      break;
    }
  }
  if (!chosen) {
    throw new Error(requestedDirection
      ? `There is not enough free space to attach a room to the ${requestedDirection} side.`
      : 'There is not enough free space around the selected room. Move or resize nearby rooms, or choose an explicit attachment direction.');
  }

  const stamp = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const newFloor = connectionType === 'stairs' ? aFloor + 64 : aFloor;
  const newCeil = newFloor + (style === 'outdoor' || style === 'hell' ? 224 : 160);

  const newRoom = {
    id: `room_${stamp}`,
    name: `${style.charAt(0).toUpperCase() + style.slice(1)} Wing`,
    shape: options.shape || (style === 'hell' ? 'octagon' : 'rect'),
    x: chosen.rx,
    y: chosen.ry,
    width: w,
    height: h,
    floorHeight: newFloor,
    ceilingHeight: newCeil,
    lightLevel: style === 'outdoor' ? 208 : 168,
    theme: style
  };
  rooms.push(newRoom);

  if (connectionType === 'stairs') {
    smartObjects.push({
      id: `stairs_${stamp}`,
      name: 'Access Stairs',
      type: 'stairs',
      x: chosen.cx,
      y: chosen.cy,
      width: chosen.cw,
      height: chosen.ch,
      steps: 4,
      direction: chosen.dir,
      startFloor: aFloor,
      endFloor: newFloor,
      ceilingHeight: newCeil,
      theme: style
    });
  } else {
    smartObjects.push({
      id: `door_${stamp}`,
      name: 'Security Door',
      type: 'door',
      x: chosen.cx,
      y: chosen.cy,
      width: chosen.cw,
      height: chosen.ch,
      theme: style,
      lock: 0
    });
  }

  // Add architectural centerpiece (pool or symmetric pillars)
  const midX = chosen.rx + Math.round(w / 2);
  const midY = chosen.ry + Math.round(h / 2);

  if (style === 'toxic' || style === 'hell') {
    smartObjects.push({
      id: `pool_${stamp}`,
      name: style === 'hell' ? 'Lava Pit' : 'Nukage Pool',
      type: 'pool',
      hazard: style === 'hell' ? 'lava' : 'nukage',
      x: midX - 64,
      y: midY - 64,
      width: 128,
      height: 128,
      floorHeight: newFloor - 16,
      ceilingHeight: newCeil,
      theme: style
    });
  } else if (w >= 320 && h >= 320) {
    smartObjects.push(
      {
        id: `pil_${stamp}_1`,
        name: 'Pillar NW',
        type: 'pillar',
        solid: true,
        x: midX - 96,
        y: midY + 48,
        width: 48,
        height: 48,
        wallTexture: 'SHAWN2'
      },
      {
        id: `pil_${stamp}_2`,
        name: 'Pillar SE',
        type: 'pillar',
        solid: true,
        x: midX + 48,
        y: midY - 96,
        width: 48,
        height: 48,
        wallTexture: 'SHAWN2'
      }
    );
  }

  // Add combat encounter & pickups
  if (encounter !== 'none') {
    const monsterType = style === 'hell' ? 3001 : 9; // Imp or Shotgun Sergeant
    const heavyType = style === 'hell' ? 69 : 3001; // Hell Knight or Imp

    things.push(
      {
        id: `th_${stamp}_m1`,
        type: monsterType,
        x: midX - 64,
        y: midY - 64,
        angle: chosen.angle
      },
      {
        id: `th_${stamp}_m2`,
        type: encounter === 'ambush' ? heavyType : monsterType,
        x: midX + 64,
        y: midY + 64,
        angle: chosen.angle,
        ambush: encounter === 'ambush'
      },
      {
        id: `th_${stamp}_item`,
        type: 2012, // Medikit
        x: midX,
        y: chosen.ry + 48,
        angle: 0
      },
      {
        id: `th_${stamp}_ammo`,
        type: 2008, // Shells
        x: midX,
        y: chosen.ry + h - 48,
        angle: 0
      }
    );
  }

  return {
    project: {
      ...project,
      rooms,
      smartObjects,
      things,
      links
    },
    createdRoomId: newRoom.id
  };
}

module.exports = {
  generateRoomAttachment
};
