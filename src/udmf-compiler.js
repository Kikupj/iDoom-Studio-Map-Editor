const fs = require('fs');

// Curated Apple-style Material Themes using authentic Freedoom2 textures & flats
const MATERIAL_THEMES = {
  techbase: {
    id: 'techbase',
    name: 'Starbase Clean',
    subtitle: 'Crisp UAC modular panels & recessed lighting',
    wall: 'STARTAN2',
    trim: 'SHAWN2',
    door: 'BIGDOOR2',
    track: 'DOORTRAK',
    step: 'STEP1',
    support: 'SUPPORT2',
    floor: 'FLOOR4_8',
    ceiling: 'CEIL3_5',
    light: 168,
    accentColor: '#38bdf8'
  },
  industrial: {
    id: 'industrial',
    name: 'Heavy Industrial',
    subtitle: 'Riveted steel, hazard stripes & grime',
    wall: 'METAL1',
    trim: 'SUPPORT3',
    door: 'BIGDOOR4',
    track: 'DOORTRAK',
    step: 'STEP4',
    support: 'SUPPORT3',
    floor: 'FLOOR5_1',
    ceiling: 'CEIL5_2',
    light: 144,
    accentColor: '#f59e0b'
  },
  bunker: {
    id: 'bunker',
    name: 'Concrete Bunker',
    subtitle: 'Brutalist reinforced concrete & security grates',
    wall: 'BROWN1',
    trim: 'BROWN96',
    door: 'SPCDOOR3',
    track: 'DOORTRAK',
    step: 'STEP2',
    support: 'SUPPORT2',
    floor: 'FLAT5_4',
    ceiling: 'FLAT19',
    light: 152,
    accentColor: '#a8a29e'
  },
  hell: {
    id: 'hell',
    name: 'Hellfire Sanctum',
    subtitle: 'Carved green/red marble, runes & brimstone',
    wall: 'GSTVINE1',
    trim: 'MARBLE1',
    door: 'BIGDOOR6',
    track: 'DOORTRAK',
    step: 'MARBLE2',
    support: 'SUPPORT3',
    floor: 'DEM1_6',
    ceiling: 'FLOOR7_2',
    light: 136,
    accentColor: '#ef4444'
  },
  outdoor: {
    id: 'outdoor',
    name: 'Open Courtyard',
    subtitle: 'Natural rock walls under open skybox ceiling',
    wall: 'ASHWALL2',
    trim: 'STONE2',
    door: 'BIGDOOR2',
    track: 'DOORTRAK',
    step: 'STEP6',
    support: 'SUPPORT2',
    floor: 'GRASS1',
    ceiling: 'F_SKY1',
    light: 192,
    accentColor: '#22c55e'
  },
  toxic: {
    id: 'toxic',
    name: 'Bio-Lab Containment',
    subtitle: 'High-tech laboratory with radiation shielding',
    wall: 'COMPTALL',
    trim: 'LITE5',
    door: 'SPCDOOR1',
    track: 'DOORTRAK',
    step: 'STEP1',
    support: 'SHAWN2',
    floor: 'FLAT14',
    ceiling: 'TLITE6_5',
    light: 176,
    accentColor: '#10b981'
  }
};

// Curated Skybox Presets
const SKYBOX_PRESETS = {
  sky1: {
    id: 'sky1',
    name: 'Earth Overcast (SKY1)',
    texture: 'SKY1',
    scrollSpeed: 0,
    use3DSkybox: false,
    topColor: [0.12, 0.22, 0.42],
    horizonColor: [0.45, 0.58, 0.75]
  },
  sky2: {
    id: 'sky2',
    name: 'Crimson City Dusk (SKY2)',
    texture: 'SKY2',
    scrollSpeed: 0.2,
    use3DSkybox: false,
    topColor: [0.28, 0.08, 0.14],
    horizonColor: [0.72, 0.28, 0.22]
  },
  sky3: {
    id: 'sky3',
    name: 'Hellfire Storm (SKY3)',
    texture: 'SKY3',
    scrollSpeed: 0.6,
    use3DSkybox: false,
    topColor: [0.18, 0.04, 0.04],
    horizonColor: [0.85, 0.22, 0.08]
  },
  diorama_tech: {
    id: 'diorama_tech',
    name: '3D Skybox: Orbital Towers',
    texture: 'SKY1',
    scrollSpeed: 0.15,
    use3DSkybox: true,
    dioramaStyle: 'tech',
    topColor: [0.06, 0.12, 0.26],
    horizonColor: [0.25, 0.48, 0.72]
  },
  diorama_hell: {
    id: 'diorama_hell',
    name: '3D Skybox: Obsidian Monoliths',
    texture: 'SKY3',
    scrollSpeed: 0.4,
    use3DSkybox: true,
    dioramaStyle: 'hell',
    topColor: [0.14, 0.02, 0.05],
    horizonColor: [0.68, 0.14, 0.12]
  }
};

// What a room, object or project without its own theme or sky falls back to. A game profile (src/game-profile.js)
// changes these, and adds its own themes and skies to the tables above.
const DEFAULTS = { theme: 'techbase', skybox: 'sky1', mapLump: 'MAP01', roomCeiling: 128, roomLight: 176, wingCeiling: 160, encounter: null, minDoorWidth: 56 };

function getTheme(themeId) {
  return MATERIAL_THEMES[themeId] || MATERIAL_THEMES[DEFAULTS.theme] || MATERIAL_THEMES.techbase;
}

// A map lump name the engine accepts: up to 8 letters, digits and underscores, upper-case.
function mapLumpOf(project) {
  const lump = String(project?.mapLump || '').toUpperCase();
  return /^[A-Z0-9_]{1,8}$/.test(lump) ? lump : DEFAULTS.mapLump;
}

// Convert a shape definition into polygon vertices [{x, y}] in counter-clockwise order
function shapeToPolygon(item) {
  if (Array.isArray(item.points) && item.points.length >= 3) {
    return item.points.map(p => ({ x: Math.round(p.x), y: Math.round(p.y) }));
  }
  const x = Math.round(item.x || 0);
  const y = Math.round(item.y || 0);
  const w = Math.max(8, Math.round(item.width || 128));
  const h = Math.max(8, Math.round(item.height || 128));

  if (item.shape === 'octagon') {
    const cut = Math.min(Math.round(Math.min(w, h) * 0.25), 128);
    return [
      { x: x + cut, y },
      { x: x + w - cut, y },
      { x: x + w, y: y + cut },
      { x: x + w, y: y + h - cut },
      { x: x + w - cut, y: y + h },
      { x: x + cut, y: y + h },
      { x, y: y + h - cut },
      { x, y: y + cut }
    ];
  }

  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x: x, y: y + h }
  ];
}

function signedArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p1 = poly[i];
    const p2 = poly[(i + 1) % poly.length];
    a += (p1.x * p2.y - p2.x * p1.y);
  }
  return a * 0.5;
}

function ensureCCW(poly) {
  return signedArea(poly) < 0 ? [...poly].reverse() : poly;
}

function pointInPolygon(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > pt.y) !== (yj > pt.y)) &&
      (pt.x < (xj - xi) * (pt.y - yi) / ((yj - yi) || 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function getInteriorPointWithHoles(outerPoly, holes = []) {
  const isValid = (pt) => {
    if (!pointInPolygon(pt, outerPoly)) return false;
    for (const h of holes) {
      if (pointInPolygon(pt, h)) return false;
    }
    return true;
  };

  let cx = 0, cy = 0;
  for (const p of outerPoly) {
    cx += p.x;
    cy += p.y;
  }
  cx /= outerPoly.length;
  cy /= outerPoly.length;
  if (isValid({ x: cx, y: cy })) return { x: cx, y: cy };

  const ccw = ensureCCW(outerPoly);
  for (let i = 0; i < ccw.length; i++) {
    const p0 = ccw[i];
    const p1 = ccw[(i + 1) % ccw.length];
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-3) continue;
    for (const dist of [0.5, 2.0, 8.0]) {
      const candidate = {
        x: (p0.x + p1.x) * 0.5 - (dy / len) * dist,
        y: (p0.y + p1.y) * 0.5 + (dx / len) * dist
      };
      if (isValid(candidate)) return candidate;
    }
  }
  return { x: cx, y: cy };
}

function getInteriorPoint(poly) {
  return getInteriorPointWithHoles(poly, []);
}

/**
 * Triangulate a simple polygon with holes (Earcut / Hole-bridging algorithm)
 */
function triangulateFace(outer, holes = []) {
  let ring = ensureCCW(outer).map(p => ({ x: p.x, y: p.y }));
  if (ring.length < 3) return [];

  if (holes && holes.length > 0) {
    const holeRings = holes
      .filter(h => h && h.length >= 3)
      .map(h => {
        const area = signedArea(h);
        const cw = area > 0 ? [...h].reverse() : [...h];
        let maxIdx = 0;
        for (let i = 1; i < cw.length; i++) {
          if (cw[i].x > cw[maxIdx].x || (cw[i].x === cw[maxIdx].x && cw[i].y > cw[maxIdx].y)) {
            maxIdx = i;
          }
        }
        return { cw, maxIdx, maxX: cw[maxIdx].x, maxY: cw[maxIdx].y };
      })
      .sort((a, b) => b.maxX - a.maxX);

    for (const hr of holeRings) {
      const M = hr.cw[hr.maxIdx];
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < ring.length; i++) {
        const v = ring[i];
        const d = Math.hypot(v.x - M.x, v.y - M.y) + (v.x < M.x ? 10000 : 0);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      const orderedHole = [];
      for (let i = 0; i < hr.cw.length; i++) {
        orderedHole.push(hr.cw[(hr.maxIdx + i) % hr.cw.length]);
      }
      ring = [
        ...ring.slice(0, bestIdx + 1),
        ...orderedHole,
        { x: M.x, y: M.y },
        { x: ring[bestIdx].x, y: ring[bestIdx].y },
        ...ring.slice(bestIdx + 1)
      ];
    }
  }

  const triangles = [];
  const verts = ring.map(p => ({ x: p.x, y: p.y }));

  function isPointInTri(p, a, b, c) {
    const v0x = c.x - a.x, v0y = c.y - a.y;
    const v1x = b.x - a.x, v1y = b.y - a.y;
    const v2x = p.x - a.x, v2y = p.y - a.y;
    const dot00 = v0x * v0x + v0y * v0y;
    const dot01 = v0x * v1x + v0y * v1y;
    const dot02 = v0x * v2x + v0y * v2y;
    const dot11 = v1x * v1x + v1y * v1y;
    const dot12 = v1x * v2x + v1y * v2y;
    const denom = dot00 * dot11 - dot01 * dot01;
    if (Math.abs(denom) < 1e-8) return false;
    const inv = 1 / denom;
    const u = (dot11 * dot02 - dot01 * dot12) * inv;
    const v = (dot00 * dot12 - dot01 * dot02) * inv;
    return u > 1e-5 && v > 1e-5 && (u + v) < 1 - 1e-5;
  }

  let guard = 0;
  while (verts.length > 3 && guard++ < 5000) {
    let earFound = false;
    const n = verts.length;
    for (let i = 0; i < n; i++) {
      const prev = verts[(i + n - 1) % n];
      const curr = verts[i];
      const next = verts[(i + 1) % n];
      const cross = (curr.x - prev.x) * (next.y - prev.y) - (curr.y - prev.y) * (next.x - prev.x);
      if (cross <= 1e-4) continue;

      let hasPointInside = false;
      for (let j = 0; j < n; j++) {
        if (j === (i + n - 1) % n || j === i || j === (i + 1) % n) continue;
        const p = verts[j];
        if ((p.x === prev.x && p.y === prev.y) ||
          (p.x === curr.x && p.y === curr.y) ||
          (p.x === next.x && p.y === next.y)) continue;
        if (isPointInTri(p, prev, curr, next)) {
          hasPointInside = true;
          break;
        }
      }
      if (!hasPointInside) {
        triangles.push([prev, curr, next]);
        verts.splice(i, 1);
        earFound = true;
        break;
      }
    }
    if (!earFound) {
      let clipped = false;
      for (let i = 0; i < verts.length; i++) {
        const prev = verts[(i + verts.length - 1) % verts.length];
        const curr = verts[i];
        const next = verts[(i + 1) % verts.length];
        const cross = (curr.x - prev.x) * (next.y - prev.y) - (curr.y - prev.y) * (next.x - prev.x);
        if (cross > 0) {
          triangles.push([prev, curr, next]);
          verts.splice(i, 1);
          clipped = true;
          break;
        }
      }
      if (!clipped) break;
    }
  }
  if (verts.length === 3) {
    const [a, b, c] = verts;
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(cross) > 1e-3) {
      triangles.push([a, b, c]);
    }
  }
  return triangles;
}

function intersectSegments(a, b, c, d) {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const rxs = r.x * s.y - r.y * s.x;

  if (Math.abs(rxs) < 1e-7) {
    return null;
  }
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / rxs;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / rxs;
  if (t >= -1e-6 && t <= 1 + 1e-6 && u >= -1e-6 && u <= 1 + 1e-6) {
    return {
      x: Math.round(a.x + t * r.x),
      y: Math.round(a.y + t * r.y)
    };
  }
  return null;
}

function pointOnSegmentParameter(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) return null;
  const cross = Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / Math.sqrt(lenSq);
  if (cross > 0.6) return null;
  const dot = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  if (dot > 1e-5 && dot < 1 - 1e-5) {
    return dot;
  }
  return null;
}

/**
 * Expand high-level Rooms & Smart Objects into layered Sector Footprints & 3D Floor Volumes
 */
function expandProjectToFootprints(project) {
  const footprints = [];
  const threeDVolumes = []; // Floating 3D floors / half-floors / bridges / swimmable water volumes
  let nextAutoTag = 100;

  const rooms = project.rooms || [];
  const smartObjects = project.smartObjects || [];
  const links = project.links || [];

  const objectTagMap = new Map();
  for (const link of links) {
    if (link.targetId && !objectTagMap.has(link.targetId)) {
      objectTagMap.set(link.targetId, nextAutoTag++);
    }
  }

  rooms.forEach((room, idx) => {
    const theme = getTheme(room.theme || DEFAULTS.theme);
    const poly = ensureCCW(shapeToPolygon(room));
    const tag = room.tag || objectTagMap.get(room.id) || 0;
    const baseFloor = Number.isFinite(room.floorHeight) ? room.floorHeight : 0;
    const baseCeil = Number.isFinite(room.ceilingHeight) ? room.ceilingHeight : 128;

    footprints.push({
      id: room.id || `room_${idx}`,
      sourceId: room.id || `room_${idx}`,
      kind: 'room',
      priority: 10 + idx,
      polygon: poly,
      isSolidVoid: false,
      floorHeight: baseFloor,
      ceilingHeight: baseCeil,
      lightLevel: Number.isFinite(room.lightLevel) ? room.lightLevel : theme.light,
      floorTexture: room.floorTexture || theme.floor,
      ceilingTexture: room.ceilingTexture || theme.ceiling,
      wallTexture: room.wallTexture || theme.wall,
      upperTexture: room.upperTexture || theme.wall,
      lowerTexture: room.lowerTexture || theme.step,
      sectorSpecial: room.sectorSpecial || 0,
      horizonWalls: Boolean(room.horizonWalls),
      tag
    });

    // Optional Room-level Half-Floor / Mezzanine toggle!
    if (room.hasHalfFloor) {
      const rx = Math.round(room.x || 0);
      const ry = Math.round(room.y || 0);
      const rw = Math.round(room.width || 256);
      const rh = Math.round(room.height || 256);
      const side = room.halfFloorSide || 'N'; // 'N', 'S', 'E', 'W', 'FULL'
      let hx = rx, hy = ry, hw = rw, hh = rh;
      if (side === 'N') { hy = ry + Math.round(rh * 0.5); hh = Math.round(rh * 0.5); }
      else if (side === 'S') { hh = Math.round(rh * 0.5); }
      else if (side === 'E') { hx = rx + Math.round(rw * 0.5); hw = Math.round(rw * 0.5); }
      else if (side === 'W') { hw = Math.round(rw * 0.5); }

      const topZ = Number.isFinite(room.halfFloorHeight) ? room.halfFloorHeight : Math.round((baseFloor + baseCeil) * 0.5);
      const thick = Number.isFinite(room.halfFloorThickness) ? room.halfFloorThickness : 8;

      threeDVolumes.push({
        id: `${room.id}_mezzanine`,
        sourceId: room.id,
        name: `${room.name || 'Room'} Mezzanine`,
        polygon: ensureCCW([
          { x: hx, y: hy },
          { x: hx + hw, y: hy },
          { x: hx + hw, y: hy + hh },
          { x: hx, y: hy + hh }
        ]),
        topZ,
        bottomZ: topZ - thick,
        topTexture: room.halfFloorTexture || 'FLOOR4_8',
        bottomTexture: room.ceilingTexture === 'F_SKY1' ? 'CEIL3_5' : (room.ceilingTexture || 'CEIL3_5'),
        edgeTexture: theme.support || 'SHAWN2',
        underLight: Math.max(80, (room.lightLevel || theme.light) - 24),
        opacity: 255,
        floorType: 1 // 1 = Solid walkable 3D floor
      });
    }
  });

  function getAdjacentRoomHeights(poly) {
    let minFloor = Infinity;
    let maxFloor = -Infinity;
    let maxCeil = -Infinity;
    const samplePts = [...poly, getInteriorPoint(poly)];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const mx = (a.x + b.x) * 0.5, my = (a.y + b.y) * 0.5;
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      samplePts.push({ x: mx + (dy / len) * 16, y: my - (dx / len) * 16 });
      samplePts.push({ x: mx - (dy / len) * 16, y: my + (dx / len) * 16 });
    }
    for (const fp of footprints) {
      if (fp.kind !== 'room') continue;
      for (const sp of samplePts) {
        if (pointInPolygon(sp, fp.polygon)) {
          if (fp.floorHeight < minFloor) minFloor = fp.floorHeight;
          if (fp.floorHeight > maxFloor) maxFloor = fp.floorHeight;
          if (fp.ceilingHeight > maxCeil) maxCeil = fp.ceilingHeight;
        }
      }
    }
    if (!Number.isFinite(minFloor)) minFloor = 0;
    if (!Number.isFinite(maxFloor)) maxFloor = 0;
    if (!Number.isFinite(maxCeil)) maxCeil = 128;
    return { minFloor, maxFloor, maxCeil };
  }

  smartObjects.forEach((obj, idx) => {
    const theme = getTheme(obj.theme || DEFAULTS.theme);
    const poly = ensureCCW(shapeToPolygon(obj));
    const adj = getAdjacentRoomHeights(poly);
    const linkedTag = obj.tag || objectTagMap.get(obj.id) || 0;
    const basePriority = 1000 + idx * 20;

    // True Multi-Level 3D Floor / Bridge / Half-Floor / Catwalk
    if (obj.type === '3dfloor') {
      const topZ = Number.isFinite(obj.topZ) ? obj.topZ : (adj.maxFloor + 64);
      const thick = Math.max(4, Number.isFinite(obj.thickness) ? obj.thickness : 8);
      const bottomZ = Number.isFinite(obj.bottomZ) ? obj.bottomZ : (topZ - thick);
      const style = obj.style || 'solid'; // 'solid' | 'glass' | 'water'

      threeDVolumes.push({
        id: obj.id || `3dfloor_${idx}`,
        sourceId: obj.id || `3dfloor_${idx}`,
        name: obj.name || '3D Bridge / Half-Floor',
        polygon: poly,
        topZ,
        bottomZ,
        topTexture: obj.topTexture || (style === 'water' ? 'FWATER1' : 'STEP2'),
        bottomTexture: obj.bottomTexture || (style === 'water' ? 'FWATER1' : 'FLAT20'),
        edgeTexture: obj.edgeTexture || (style === 'glass' ? 'SHAWN2' : 'SUPPORT3'),
        underLight: Number.isFinite(obj.underLight) ? obj.underLight : 144,
        opacity: style === 'glass' ? 160 : (style === 'water' ? 185 : (obj.opacity || 255)),
        floorType: style === 'water' ? 2 : 1 // 1 = Solid Walkable, 2 = Swimmable 3D Liquid
      });
      return;
    }

    if (obj.type === 'door') {
      const floorH = Number.isFinite(obj.floorHeight) ? obj.floorHeight : adj.maxFloor;
      const doorTex = obj.wallTexture || theme.door || 'BIGDOOR2';
      const trackTex = obj.trackTexture || theme.track || 'DOORTRAK';
      const lockType = obj.lock || 0;

      footprints.push({
        id: obj.id || `door_${idx}`,
        sourceId: obj.id || `door_${idx}`,
        kind: 'door',
        priority: basePriority,
        polygon: poly,
        isSolidVoid: false,
        floorHeight: floorH,
        ceilingHeight: floorH,
        lightLevel: obj.lightLevel || 160,
        floorTexture: obj.floorTexture || 'FLAT23',
        ceilingTexture: obj.ceilingTexture || 'FLAT20',
        wallTexture: trackTex,
        upperTexture: doorTex,
        lowerTexture: trackTex,
        sectorSpecial: 0,
        tag: linkedTag,
        doorAction: {
          remoteOnly: Boolean(obj.remoteOnly),
          lock: lockType,
          speed: obj.speed || 16,
          wait: obj.wait || 150,
          doorTex,
          trackTex,
          // the door texture scaled to fit its face (UDMF scalex_top / scaley_top): a texture drawn for one door
          // height shows whole in a doorway of another
          scaleX: Number.isFinite(obj.textureScaleX) && obj.textureScaleX > 0 ? obj.textureScaleX : undefined,
          scaleY: Number.isFinite(obj.textureScaleY) && obj.textureScaleY > 0 ? obj.textureScaleY : undefined
        }
      });
    } else if (obj.type === 'window') {
      const sillH = Number.isFinite(obj.floorHeight) ? obj.floorHeight : (adj.maxFloor + 48);
      const topH = Number.isFinite(obj.ceilingHeight) ? obj.ceilingHeight : Math.max(sillH + 48, adj.maxCeil - 32);
      const frameTex = obj.wallTexture || theme.trim || 'SHAWN2';
      const midTex = obj.midTexture !== undefined
        ? obj.midTexture
        : (obj.grate ? 'MIDBARS3' : '-');
      footprints.push({
        id: obj.id || `window_${idx}`,
        sourceId: obj.id || `window_${idx}`,
        kind: 'window',
        priority: basePriority,
        polygon: poly,
        isSolidVoid: false,
        floorHeight: sillH,
        ceilingHeight: topH,
        lightLevel: obj.lightLevel || 176,
        floorTexture: obj.floorTexture || 'FLAT23',
        ceilingTexture: obj.skyWindow ? 'F_SKY1' : (obj.ceilingTexture || 'FLAT23'),
        wallTexture: frameTex,
        upperTexture: obj.upperTexture || frameTex,
        lowerTexture: obj.lowerTexture || frameTex,
        midTexture: midTex,
        midGrate: Boolean(obj.grate) || (midTex && midTex !== '-'),
        midWrap: Boolean(obj.midWrap),
        windowBlocking: obj.blocking !== undefined ? Boolean(obj.blocking) : Boolean(obj.grate || (midTex && midTex !== '-')),
        windowAlpha: Number.isFinite(obj.alpha) ? obj.alpha : 1.0,
        sectorSpecial: 0,
        tag: linkedTag
      });
    } else if (obj.type === 'lift') {
      const lowFloor = Number.isFinite(obj.lowFloor) ? obj.lowFloor : adj.minFloor;
      const highFloor = Number.isFinite(obj.floorHeight) ? obj.floorHeight : Math.max(adj.maxFloor, lowFloor + 64);
      const liftTag = linkedTag || nextAutoTag++;
      footprints.push({
        id: obj.id || `lift_${idx}`,
        sourceId: obj.id || `lift_${idx}`,
        kind: 'lift',
        priority: basePriority,
        polygon: poly,
        isSolidVoid: false,
        floorHeight: highFloor,
        ceilingHeight: Number.isFinite(obj.ceilingHeight) ? obj.ceilingHeight : Math.max(adj.maxCeil, highFloor + 96),
        lightLevel: obj.lightLevel || 176,
        floorTexture: obj.floorTexture || 'STEP2',
        ceilingTexture: obj.ceilingTexture || theme.ceiling,
        wallTexture: obj.wallTexture || theme.support,
        upperTexture: obj.upperTexture || theme.support,
        lowerTexture: obj.lowerTexture || theme.support,
        sectorSpecial: 0,
        tag: liftTag,
        liftAction: {
          tag: liftTag,
          speed: 16,
          wait: 105
        }
      });
    } else if (obj.type === 'stairs') {
      const steps = Math.max(2, Math.min(32, Math.round(obj.steps || 6)));
      const startFloor = Number.isFinite(obj.startFloor) ? obj.startFloor : adj.minFloor;
      const endFloor = Number.isFinite(obj.endFloor) ? obj.endFloor : (adj.maxFloor > adj.minFloor ? adj.maxFloor : startFloor + 64);
      const ceilH = Number.isFinite(obj.ceilingHeight) ? obj.ceilingHeight : Math.max(adj.maxCeil, Math.max(startFloor, endFloor) + 96);
      const dir = obj.direction || (obj.width >= obj.height ? 'E' : 'N');
      const x = Math.round(obj.x || 0);
      const y = Math.round(obj.y || 0);
      const w = Math.max(16, Math.round(obj.width || 128));
      const h = Math.max(16, Math.round(obj.height || 128));

      for (let s = 0; s < steps; s++) {
        const t0 = s / steps;
        const t1 = (s + 1) / steps;
        const frac = (s + 1) / steps;
        const stepFloor = Math.round(startFloor + (endFloor - startFloor) * frac);
        let sx0 = x, sy0 = y, sx1 = x + w, sy1 = y + h;
        if (dir === 'E') {
          sx0 = Math.round(x + w * t0);
          sx1 = Math.round(x + w * t1);
        } else if (dir === 'W') {
          sx0 = Math.round(x + w * (1 - t1));
          sx1 = Math.round(x + w * (1 - t0));
        } else if (dir === 'N') {
          sy0 = Math.round(y + h * t0);
          sy1 = Math.round(y + h * t1);
        } else if (dir === 'S') {
          sy0 = Math.round(y + h * (1 - t1));
          sy1 = Math.round(y + h * (1 - t0));
        }
        const stepPoly = [
          { x: sx0, y: sy0 },
          { x: sx1, y: sy0 },
          { x: sx1, y: sy1 },
          { x: sx0, y: sy1 }
        ];
        footprints.push({
          id: `${obj.id || `stairs_${idx}`}_step_${s}`,
          sourceId: obj.id || `stairs_${idx}`,
          kind: 'stair_step',
          priority: basePriority + s,
          polygon: stepPoly,
          isSolidVoid: false,
          floorHeight: stepFloor,
          ceilingHeight: ceilH,
          lightLevel: obj.lightLevel || 168,
          floorTexture: obj.floorTexture || 'FLOOR0_1',
          ceilingTexture: obj.ceilingTexture || theme.ceiling,
          wallTexture: obj.wallTexture || theme.wall,
          upperTexture: obj.upperTexture || theme.wall,
          lowerTexture: obj.lowerTexture || theme.step || 'STEP1',
          sectorSpecial: 0,
          tag: 0
        });
      }
    } else if (obj.type === 'pillar') {
      const isSolid = obj.solid !== false;
      if (isSolid) {
        footprints.push({
          id: obj.id || `pillar_${idx}`,
          sourceId: obj.id || `pillar_${idx}`,
          kind: 'pillar',
          priority: basePriority,
          polygon: poly,
          isSolidVoid: true,
          wallTexture: obj.wallTexture || theme.trim || 'SHAWN2'
        });
      } else {
        footprints.push({
          id: obj.id || `pillar_${idx}`,
          sourceId: obj.id || `pillar_${idx}`,
          kind: 'pedestal',
          priority: basePriority,
          polygon: poly,
          isSolidVoid: false,
          floorHeight: Number.isFinite(obj.floorHeight) ? obj.floorHeight : (adj.maxFloor + 64),
          ceilingHeight: Number.isFinite(obj.ceilingHeight) ? obj.ceilingHeight : adj.maxCeil,
          lightLevel: obj.lightLevel || 176,
          floorTexture: obj.floorTexture || 'CRATOP1',
          ceilingTexture: obj.ceilingTexture || theme.ceiling,
          wallTexture: obj.wallTexture || 'CRATE1',
          upperTexture: obj.wallTexture || 'CRATE1',
          lowerTexture: obj.wallTexture || 'CRATE1',
          sectorSpecial: 0,
          tag: linkedTag
        });
      }
    } else if (obj.type === 'pool') {
      const hazardType = obj.hazard || 'nukage';
      const hazardPresets = {
        nukage: { floor: 'NUKAGE1', special: 84, light: 192, depth: -16 },
        lava: { floor: 'LAVA1', special: 71, light: 216, depth: -16 },
        blood: { floor: 'BLOOD1', special: 69, light: 160, depth: -16 },
        water: { floor: 'FWATER1', special: 0, light: 168, depth: -16 },
        skylight: { floor: theme.floor, ceil: 'F_SKY1', special: 0, light: 224, depth: 0, raiseCeil: 32 }
      };
      const preset = hazardPresets[hazardType] || hazardPresets.nukage;
      footprints.push({
        id: obj.id || `pool_${idx}`,
        sourceId: obj.id || `pool_${idx}`,
        kind: 'pool',
        priority: basePriority,
        polygon: poly,
        isSolidVoid: false,
        floorHeight: Number.isFinite(obj.floorHeight) ? obj.floorHeight : (adj.minFloor + preset.depth),
        ceilingHeight: Number.isFinite(obj.ceilingHeight) ? obj.ceilingHeight : (adj.maxCeil + (preset.raiseCeil || 0)),
        lightLevel: obj.lightLevel || preset.light,
        floorTexture: obj.floorTexture || preset.floor,
        ceilingTexture: obj.ceilingTexture || preset.ceil || theme.ceiling,
        wallTexture: obj.wallTexture || theme.wall,
        upperTexture: obj.upperTexture || theme.wall,
        lowerTexture: obj.lowerTexture || theme.step,
        sectorSpecial: obj.sectorSpecial !== undefined ? obj.sectorSpecial : preset.special,
        tag: linkedTag
      });
    } else if (obj.type === 'teleporter' || obj.type === 'exit' || obj.type === 'switch') {
      const outLink = links.find(l => l.sourceId === obj.id);
      const targetTag = outLink && outLink.targetId ? (objectTagMap.get(outLink.targetId) || 0) : (obj.targetTag || 0);
      const targetObject = outLink && smartObjects.find(target => target.id === outLink.targetId);
      const selfTag = linkedTag || (obj.type === 'teleporter' ? nextAutoTag++ : 0);
      if (obj.id && selfTag) objectTagMap.set(obj.id, selfTag);

      footprints.push({
        id: obj.id || `special_${idx}`,
        sourceId: obj.id || `special_${idx}`,
        kind: obj.type,
        priority: basePriority,
        polygon: poly,
        isSolidVoid: false,
        floorHeight: Number.isFinite(obj.floorHeight) ? obj.floorHeight : (adj.minFloor + 8),
        ceilingHeight: Number.isFinite(obj.ceilingHeight) ? obj.ceilingHeight : adj.maxCeil,
        lightLevel: obj.lightLevel || 208,
        floorTexture: obj.floorTexture || (obj.type === 'teleporter' ? 'GATE1' : 'FLOOR1_1'),
        ceilingTexture: obj.ceilingTexture || 'TLITE6_6',
        wallTexture: obj.wallTexture || (obj.type === 'exit' ? 'SW1EXIT' : 'SW1COMP'),
        upperTexture: obj.wallTexture || 'SHAWN2',
        lowerTexture: obj.lowerTexture || (obj.type === 'exit' ? 'SW1EXIT' : (obj.type === 'switch' ? 'SW1COMM' : 'STEP2')),
        sectorSpecial: obj.type === 'teleporter' ? 65 : 0,
        tag: selfTag,
        specialAction: {
          type: obj.type,
          actionKind: outLink?.action || obj.action || 'door',
          targetTag,
          lock: targetObject?.type === 'door' ? (targetObject.lock || 0) : 0
        }
      });
    }
  });

  return { footprints, threeDVolumes, objectTagMap, nextAutoTag };
}

/**
 * Extract exact elementary 2D faces (outer CCW loop + inner CW hole loops) from split PSLG edges
 */
function extractElementaryFaces(vertices, edgeSet) {
  const halfEdges = [];
  const outgoing = new Map();

  for (const edge of edgeSet.values()) {
    const he1 = { id: halfEdges.length, u: edge.u, v: edge.v, twin: halfEdges.length + 1, visited: false };
    const he2 = { id: halfEdges.length + 1, u: edge.v, v: edge.u, twin: halfEdges.length, visited: false };
    halfEdges.push(he1, he2);
    if (!outgoing.has(edge.u)) outgoing.set(edge.u, []);
    if (!outgoing.has(edge.v)) outgoing.set(edge.v, []);
    outgoing.get(edge.u).push(he1.id);
    outgoing.get(edge.v).push(he2.id);
  }

  for (const [vIdx, list] of outgoing.entries()) {
    const vp = vertices[vIdx];
    list.sort((aId, bId) => {
      const va = vertices[halfEdges[aId].v];
      const vb = vertices[halfEdges[bId].v];
      const angA = Math.atan2(va.y - vp.y, va.x - vp.x);
      const angB = Math.atan2(vb.y - vp.y, vb.x - vp.x);
      return angA - angB;
    });
  }

  const positiveFaces = [];
  const negativeCycles = [];

  for (const he of halfEdges) {
    if (he.visited) continue;
    const cycleVerts = [];
    let curr = he;
    let safety = 0;
    while (!curr.visited && safety++ < 4096) {
      curr.visited = true;
      cycleVerts.push(vertices[curr.u]);
      const outList = outgoing.get(curr.v) || [];
      if (outList.length === 0) break;
      const twinPos = outList.indexOf(curr.twin);
      const nextIdx = (twinPos - 1 + outList.length) % outList.length;
      curr = halfEdges[outList[nextIdx]];
    }
    if (cycleVerts.length >= 3) {
      const area = signedArea(cycleVerts);
      if (area > 1) {
        positiveFaces.push({ outer: cycleVerts, area, holes: [] });
      } else if (area < -1) {
        negativeCycles.push({ poly: cycleVerts, absArea: Math.abs(area) });
      }
    }
  }

  positiveFaces.sort((a, b) => a.area - b.area);

  for (const neg of negativeCycles) {
    const sampleVert = neg.poly[0];
    for (const pf of positiveFaces) {
      if (pf.area <= neg.absArea + 1) continue;
      const onOuter = pf.outer.some(v => v.x === sampleVert.x && v.y === sampleVert.y);
      if (!onOuter && pointInPolygon(sampleVert, pf.outer)) {
        pf.holes.push(neg.poly);
        break;
      }
    }
  }

  return positiveFaces;
}

/**
 * Compile high-level project JSON into UDMF text + 3D preview geometry (including 3D Floors & Skyboxes)
 */
// A 3D skybox city (dioramaStyle 'city'): rings of towers round the SkyViewpoint, nearer ones lower and wider,
// farther ones taller and thinner, some with a stepped top. The rings, heights, widths and facade textures come from
// the skybox preset's "diorama" settings (a game profile's); the layout is seeded by the project's name, so a map
// keeps its skyline. Towers are raised-floor sectors under the sky, their faces the facade textures.
function addCityDiorama({ skyboxConfig, project, sx, sy, sz, skySecIdx, compiledSectors, compiledLinedefs, getVertexIndex }) {
  const cfg = skyboxConfig.diorama || {};
  let seed = 2166136261;
  for (const ch of String(project.name || 'city')) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619) >>> 0;
  const rand = () => {
    seed = (seed + 0x6D2B79F5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const between = (range) => range[0] + rand() * (range[1] - range[0]);
  const textures = cfg.facades && cfg.facades.length ? cfg.facades : ['STARTAN2'];
  const rings = cfg.rings || [
    { radius: [380, 560], height: [160, 320], width: [64, 144], count: 14 },
    { radius: [600, 800], height: [300, 620], width: [72, 160], count: 18 },
    { radius: [820, 980], height: [520, 980], width: [56, 128], count: 22 }
  ];
  const placed = [];
  const limit = sz - 24;
  const box = (x, y, w, h, floor, tex, parentIdx) => {
    const v0 = getVertexIndex(x, y), v1 = getVertexIndex(x + w, y), v2 = getVertexIndex(x + w, y + h), v3 = getVertexIndex(x, y + h);
    const idx = compiledSectors.length;
    compiledSectors.push({
      index: idx, id: `sky_city_${idx}`, sourceId: 'skybox', kind: 'skybox_tower',
      floorHeight: Math.round(floor), ceilingHeight: cfg.ceiling || 2048, lightLevel: cfg.towerLight || 168,
      floorTexture: cfg.roof || 'FLAT20', ceilingTexture: 'F_SKY1', sectorSpecial: 0, tag: 0, faces: []
    });
    for (const [u, v] of [[v0, v1], [v1, v2], [v2, v3], [v3, v0]]) {
      compiledLinedefs.push({
        v1: u, v2: v, twoSided: true, blocking: true, special: 0, arg0: 0, arg1: 0, arg2: 0, arg3: 0,
        front: { sector: parentIdx, texturetop: '-', texturemiddle: '-', texturebottom: tex },
        back: { sector: idx, texturetop: '-', texturemiddle: '-', texturebottom: tex }
      });
    }
    return idx;
  };
  for (const ring of rings) {
    const count = ring.count || 12;
    const offset = rand() * Math.PI * 2;
    for (let i = 0; i < count; i++) {
      const angle = offset + (i + rand() * 0.6) * (Math.PI * 2 / count);
      const r = between(ring.radius);
      const w = Math.round(between(ring.width) / 8) * 8;
      const d = Math.round(between(ring.width) / 8) * 8;
      const x = Math.round((sx + Math.cos(angle) * r - w / 2) / 8) * 8;
      const y = Math.round((sy + Math.sin(angle) * r - d / 2) / 8) * 8;
      if (x < sx - limit || y < sy - limit || x + w > sx + limit || y + d > sy + limit) continue;
      if (placed.some(p => x < p.x + p.w + 16 && p.x < x + w + 16 && y < p.y + p.h + 16 && p.y < y + d + 16)) continue;
      placed.push({ x, y, w, h: d });
      const tex = textures[Math.floor(rand() * textures.length)];
      const height = between(ring.height);
      const idx = box(x, y, w, d, height, tex, skySecIdx);
      // a stepped top: a narrower block on the roof
      if (w >= 64 && d >= 64 && rand() < (ring.steps ?? 0.4)) {
        const iw = Math.round(w * 0.5 / 8) * 8, id = Math.round(d * 0.5 / 8) * 8;
        box(x + Math.round((w - iw) / 16) * 8, y + Math.round((d - id) / 16) * 8, iw, id, height + between([64, 200]), tex, idx);
      }
    }
  }
}

function compileProject(project) {
  let { footprints, threeDVolumes, nextAutoTag } = expandProjectToFootprints(project);

  const skyboxConfig = SKYBOX_PRESETS[project.skybox || DEFAULTS.skybox] || SKYBOX_PRESETS[DEFAULTS.skybox] || SKYBOX_PRESETS.sky1;

  if (footprints.length === 0) {
    return {
      textmap: 'namespace = "zdoom";\n',
      zmapinfo: '',
      skybox: skyboxConfig,
      sectors: [],
      threeDFloors: [],
      linedefs: [],
      vertices: [],
      things: [],
      stats: { vertices: 0, linedefs: 0, sectors: 0, things: 0, threeDFloors: 0 }
    };
  }

  // 1. Collect all raw segments from both base footprints AND 3D floor volumes
  const rawSegments = [];
  for (const fp of footprints) {
    const poly = fp.polygon;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      if (a.x !== b.x || a.y !== b.y) {
        rawSegments.push({ a, b });
      }
    }
  }
  for (const vol of threeDVolumes) {
    const poly = vol.polygon;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      if (a.x !== b.x || a.y !== b.y) {
        rawSegments.push({ a, b });
      }
    }
  }

  // 2. Find all intersection points & split points on every segment
  const splitPointsPerSeg = rawSegments.map(s => [
    { x: s.a.x, y: s.a.y, t: 0 },
    { x: s.b.x, y: s.b.y, t: 1 }
  ]);

  for (let i = 0; i < rawSegments.length; i++) {
    const s1 = rawSegments[i];
    for (let j = i + 1; j < rawSegments.length; j++) {
      const s2 = rawSegments[j];
      const pt = intersectSegments(s1.a, s1.b, s2.a, s2.b);
      if (pt) {
        const len1 = Math.hypot(s1.b.x - s1.a.x, s1.b.y - s1.a.y) || 1;
        const t1 = Math.hypot(pt.x - s1.a.x, pt.y - s1.a.y) / len1;
        splitPointsPerSeg[i].push({ x: pt.x, y: pt.y, t: t1 });

        const len2 = Math.hypot(s2.b.x - s2.a.x, s2.b.y - s2.a.y) || 1;
        const t2 = Math.hypot(pt.x - s2.a.x, pt.y - s2.a.y) / len2;
        splitPointsPerSeg[j].push({ x: pt.x, y: pt.y, t: t2 });
      }
      for (const endPt of [s2.a, s2.b]) {
        const t = pointOnSegmentParameter(endPt, s1.a, s1.b);
        if (t !== null) splitPointsPerSeg[i].push({ x: endPt.x, y: endPt.y, t });
      }
      for (const endPt of [s1.a, s1.b]) {
        const t = pointOnSegmentParameter(endPt, s2.a, s2.b);
        if (t !== null) splitPointsPerSeg[j].push({ x: endPt.x, y: endPt.y, t });
      }
    }
  }

  // 3. Deduplicate vertices and elementary undirected edges
  const vertices = [];
  const vertexMap = new Map();
  function getVertexIndex(x, y) {
    const rx = Math.round(x);
    const ry = Math.round(y);
    const key = `${rx},${ry}`;
    if (vertexMap.has(key)) return vertexMap.get(key);
    const idx = vertices.length;
    vertices.push({ x: rx, y: ry, index: idx });
    vertexMap.set(key, idx);
    return idx;
  }

  const edgeSet = new Map();
  for (let i = 0; i < rawSegments.length; i++) {
    const pts = splitPointsPerSeg[i];
    pts.sort((p1, p2) => p1.t - p2.t);
    for (let k = 0; k < pts.length - 1; k++) {
      const u = getVertexIndex(pts[k].x, pts[k].y);
      const v = getVertexIndex(pts[k + 1].x, pts[k + 1].y);
      if (u === v) continue;
      const eKey = u < v ? `${u}_${v}` : `${v}_${u}`;
      if (!edgeSet.has(eKey)) {
        edgeSet.set(eKey, { u: Math.min(u, v), v: Math.max(u, v), key: eKey });
      }
    }
  }

  function getFootprintAtPoint(pt) {
    let best = null;
    for (const fp of footprints) {
      if (pointInPolygon(pt, fp.polygon)) {
        if (!best || fp.priority >= best.priority) {
          best = fp;
        }
      }
    }
    return best;
  }

  function get3DVolumesAtPoint(pt) {
    const list = [];
    for (const vol of threeDVolumes) {
      if (pointInPolygon(pt, vol.polygon)) {
        list.push(vol);
      }
    }
    return list;
  }

  const sectorMap = new Map(); // compositeKey -> sectorIdx
  const compiledSectors = [];

  function getOrCreateSectorAtPoint(pt) {
    const fp = getFootprintAtPoint(pt);
    if (!fp || fp.isSolidVoid) return { secIdx: null, fp };

    const vols = get3DVolumesAtPoint(pt);
    const volKey = vols.map(v => v.id).join('+');
    const compositeKey = volKey ? `${fp.id}::3D::${volKey}` : fp.id;

    if (sectorMap.has(compositeKey)) {
      return { secIdx: sectorMap.get(compositeKey), fp };
    }

    const secIdx = compiledSectors.length;
    const assignedTag = vols.length > 0 ? (nextAutoTag++) : (fp.tag || 0);

    compiledSectors.push({
      index: secIdx,
      id: compositeKey,
      sourceId: vols.length > 0 ? vols[vols.length - 1].sourceId : fp.sourceId,
      baseSourceId: fp.sourceId,
      kind: fp.kind,
      floorHeight: fp.floorHeight,
      ceilingHeight: fp.ceilingHeight,
      lightLevel: fp.lightLevel,
      floorTexture: fp.floorTexture,
      ceilingTexture: fp.ceilingTexture,
      sectorSpecial: fp.sectorSpecial || 0,
      tag: assignedTag,
      threeDVolumes: vols,
      faces: [],
      fp
    });
    sectorMap.set(compositeKey, secIdx);
    return { secIdx, fp };
  }

  const compiledLinedefs = [];

  for (const edge of edgeSet.values()) {
    const va = vertices[edge.u];
    const vb = vertices[edge.v];
    const mx = (va.x + vb.x) * 0.5;
    const my = (va.y + vb.y) * 0.5;
    const dx = vb.x - va.x;
    const dy = vb.y - va.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-3) continue;

    const eps = 0.25;
    const rightPt = { x: mx + (dy / len) * eps, y: my - (dx / len) * eps };
    const leftPt = { x: mx - (dy / len) * eps, y: my + (dx / len) * eps };

    const { secIdx: rightSecIdx, fp: rightFp } = getOrCreateSectorAtPoint(rightPt);
    const { secIdx: leftSecIdx, fp: leftFp } = getOrCreateSectorAtPoint(leftPt);

    if (rightSecIdx === null && leftSecIdx === null) continue;
    if (rightSecIdx === leftSecIdx) continue;

    let v1 = edge.u;
    let v2 = edge.v;
    let frontFp = rightFp;
    let backFp = leftFp;
    let frontSec = rightSecIdx;
    let backSec = leftSecIdx;

    if (frontSec === null && backSec !== null) {
      v1 = edge.v;
      v2 = edge.u;
      frontFp = leftFp;
      backFp = rightFp;
      frontSec = leftSecIdx;
      backSec = null;
    }

    if (backSec !== null && frontFp && backFp) {
      if (frontFp.kind === 'door' && backFp.kind !== 'door') {
        [v1, v2] = [v2, v1];
        [frontFp, backFp] = [backFp, frontFp];
        [frontSec, backSec] = [backSec, frontSec];
      } else if (frontFp.kind === 'lift' && backFp.kind !== 'lift') {
        [v1, v2] = [v2, v1];
        [frontFp, backFp] = [backFp, frontFp];
        [frontSec, backSec] = [backSec, frontSec];
      } else if (
        (frontFp.kind === 'teleporter' || frontFp.kind === 'exit' || frontFp.kind === 'switch') &&
        backFp.kind === 'room'
      ) {
        [v1, v2] = [v2, v1];
        [frontFp, backFp] = [backFp, frontFp];
        [frontSec, backSec] = [backSec, frontSec];
      }
    }

    const twoSided = backSec !== null;
    let special = 0;
    let arg0 = 0, arg1 = 0, arg2 = 0, arg3 = 0;
    let playeruse = false;
    let playercross = false;
    let repeatspecial = false;
    let dontpegtop = false;
    let dontpegbottom = false;
    let blocking = !twoSided;
    let lineAlpha = 1.0;
    let wrapMid = false;
    let frontTopScale = null;      // a door face's texture scale

    let frontMid = !twoSided ? (backFp?.isSolidVoid ? backFp.wallTexture : frontFp.wallTexture) : '-';
    let frontUpper = twoSided ? (frontFp.upperTexture || frontFp.wallTexture) : '-';
    let frontLower = twoSided ? (frontFp.lowerTexture || frontFp.wallTexture) : '-';
    let backMid = '-';
    let backUpper = twoSided ? (backFp.upperTexture || backFp.wallTexture) : '-';
    let backLower = twoSided ? (backFp.lowerTexture || backFp.wallTexture) : '-';

    // Support Skybox Horizon Walls on single-sided outdoor rooms
    if (!twoSided && frontFp.horizonWalls && !backFp?.isSolidVoid) {
      special = 9; // Line_Horizon
    }

    if (!twoSided && frontFp.kind === 'door') {
      frontMid = frontFp.doorAction?.trackTex || 'DOORTRAK';
      dontpegbottom = true;
    }

    if (twoSided && backFp.kind === 'door') {
      const da = backFp.doorAction || {};
      frontUpper = da.doorTex || 'BIGDOOR2';
      if (da.scaleX || da.scaleY) frontTopScale = { x: da.scaleX, y: da.scaleY };
      // Keep the upper-face texture pegged to the moving door sector ceiling.
      // DONTPEGTOP would anchor it to the stationary surrounding ceiling, making
      // the texture appear to wipe away instead of moving as one solid panel.
      if (!da.remoteOnly) {
        playeruse = true;
        repeatspecial = true;
        if (da.lock && da.lock > 0) {
          special = 13;
          arg0 = 0;
          arg1 = da.speed || 16;
          arg2 = da.wait || 150;
          arg3 = da.lock;
        } else {
          special = 12;
          arg0 = 0;
          arg1 = da.speed || 16;
          arg2 = da.wait || 150;
        }
      }
    }

    if (twoSided && (frontFp.kind === 'window' || backFp.kind === 'window')) {
      const winFp = backFp.kind === 'window' ? backFp : frontFp;
      dontpegtop = true;
      dontpegbottom = true;
      frontUpper = winFp.upperTexture || winFp.wallTexture;
      frontLower = winFp.lowerTexture || winFp.wallTexture;
      backUpper = winFp.upperTexture || winFp.wallTexture;
      backLower = winFp.lowerTexture || winFp.wallTexture;
      if (winFp.midTexture && winFp.midTexture !== '-') {
        frontMid = winFp.midTexture;
        backMid = winFp.midTexture;
        blocking = Boolean(winFp.windowBlocking);
        lineAlpha = Number.isFinite(winFp.windowAlpha) ? winFp.windowAlpha : 1.0;
        wrapMid = Boolean(winFp.midWrap);
      } else if (winFp.midGrate) {
        frontMid = 'MIDBARS3';
        backMid = 'MIDBARS3';
        blocking = true;
      }
      // A door behind a window (a doorway header in front of it) keeps its own face: the door texture, moving with
      // the door, not the window's frame
      if (frontFp.kind === 'window' && backFp.kind === 'door') {
        const da = backFp.doorAction || {};
        frontUpper = da.doorTex || 'BIGDOOR2';
        if (da.scaleX || da.scaleY) frontTopScale = { x: da.scaleX, y: da.scaleY };
        dontpegtop = false;
      }
    }

    if (twoSided && backFp.kind === 'lift') {
      const la = backFp.liftAction || {};
      frontLower = backFp.lowerTexture || 'SUPPORT2';
      backLower = backFp.lowerTexture || 'SUPPORT2';
      special = 62;
      arg0 = la.tag || backFp.tag || 0;
      arg1 = la.speed || 16;
      arg2 = la.wait || 105;
      playeruse = true;
      playercross = true;
      repeatspecial = true;
    }

    if (twoSided && backFp.kind === 'teleporter') {
      const sa = backFp.specialAction || {};
      if (sa.targetTag > 0) {
        special = 70;
        arg0 = 0;
        arg1 = sa.targetTag;
        playercross = true;
        repeatspecial = true;
      }
    }

    if (twoSided && backFp.kind === 'exit') {
      frontLower = backFp.lowerTexture || 'SW1EXIT';
      frontUpper = backFp.upperTexture || 'SW1EXIT';
      special = 243;
      playeruse = true;
    }

    if (twoSided && backFp.kind === 'switch') {
      const sa = backFp.specialAction || {};
      frontLower = backFp.lowerTexture || 'SW1COMM';
      frontUpper = backFp.upperTexture || 'SW1COMM';
      playeruse = true;
      repeatspecial = true;
      if (sa.actionKind === 'lift') {
        special = 62;
        arg0 = sa.targetTag || 0;
        arg1 = 16;
        arg2 = 105;
      } else if (sa.lock > 0) {
        // A linked switch must not bypass the target door's keycard requirement.
        special = 13;
        arg0 = sa.targetTag || 0;
        arg1 = 16;
        arg2 = 150;
        arg3 = sa.lock;
      } else {
        special = 12;
        arg0 = sa.targetTag || 0;
        arg1 = 16;
        arg2 = 150;
      }
    }

    compiledLinedefs.push({
      v1,
      v2,
      twoSided,
      blocking,
      dontpegtop,
      dontpegbottom,
      wrapMid,
      alpha: lineAlpha,
      special,
      arg0,
      arg1,
      arg2,
      arg3,
      playeruse,
      playercross,
      repeatspecial,
      front: {
        sector: frontSec,
        texturetop: frontUpper,
        texturemiddle: frontMid,
        texturebottom: frontLower,
        scaleXTop: frontTopScale?.x,
        scaleYTop: frontTopScale?.y
      },
      back: twoSided ? {
        sector: backSec,
        texturetop: backUpper,
        texturemiddle: backMid,
        texturebottom: backLower
      } : null
    });
  }

  // Extract elementary non-overlapping 2D faces + holes for 3D rendering
  const elementaryFaces = extractElementaryFaces(vertices, edgeSet);
  for (const face of elementaryFaces) {
    const samplePt = getInteriorPointWithHoles(face.outer, face.holes);
    const { secIdx } = getOrCreateSectorAtPoint(samplePt);
    if (secIdx !== null && compiledSectors[secIdx]) {
      compiledSectors[secIdx].faces.push({
        outer: face.outer,
        holes: face.holes
      });
    }
  }

  // Build 3D previewsectors BEFORE adding hidden off-map control sectors so 3D viewport doesn't render off-map dummy triangles
  const previewSectors = compiledSectors.map(sec => {
    const rawFaces = sec.faces.length > 0 ? sec.faces : [{ outer: sec.fp.polygon, holes: [] }];
    const faces = rawFaces.map(f => ({
      outer: f.outer,
      holes: f.holes || [],
      triangles: triangulateFace(f.outer, f.holes || [])
    }));
    return {
      index: sec.index,
      id: sec.id,
      sourceId: sec.sourceId,
      baseSourceId: sec.baseSourceId,
      kind: sec.kind,
      floorHeight: sec.floorHeight,
      ceilingHeight: sec.ceilingHeight,
      lightLevel: sec.lightLevel,
      floorTexture: sec.floorTexture,
      ceilingTexture: sec.ceilingTexture,
      tag: sec.tag,
      threeDVolumes: sec.threeDVolumes || [],
      polygon: sec.fp.polygon,
      faces
    };
  });

  // Also prepare 3D Floor Slabs for the WebGL 3D Renderer
  const preview3DFloors = threeDVolumes.map(vol => ({
    id: vol.id,
    sourceId: vol.sourceId,
    name: vol.name,
    topZ: vol.topZ,
    bottomZ: vol.bottomZ,
    topTexture: vol.topTexture,
    bottomTexture: vol.bottomTexture,
    edgeTexture: vol.edgeTexture,
    underLight: vol.underLight,
    opacity: vol.opacity,
    floorType: vol.floorType,
    polygon: vol.polygon,
    triangles: triangulateFace(vol.polygon, [])
  }));

  // Snapshot clean on-map vertices and linedefs for the 3D Editor viewport before adding off-map UDMF control sectors
  const previewVertices = vertices.map(v => ({ ...v }));
  const previewLinedefs = compiledLinedefs.map(ld => ({ ...ld }));

  // 4B. Emit Hidden UDMF Control Sectors for all 3D Floors (`Sector_Set3DFloor`, special = 160)
  let dummyIndex = 0;
  for (const sec of [...compiledSectors]) {
    if (!sec.threeDVolumes || sec.threeDVolumes.length === 0) continue;
    for (const vol of sec.threeDVolumes) {
      const dx = -16384 + (dummyIndex % 32) * 64;
      const dy = -16384 - Math.floor(dummyIndex / 32) * 64;
      dummyIndex++;

      const dv0 = getVertexIndex(dx, dy);
      const dv1 = getVertexIndex(dx, dy + 32);
      const dv2 = getVertexIndex(dx + 32, dy);

      const ctrlSecIdx = compiledSectors.length;
      compiledSectors.push({
        index: ctrlSecIdx,
        id: `ctrl_3dfloor_${dummyIndex}`,
        sourceId: vol.sourceId,
        kind: 'control_3dfloor',
        floorHeight: vol.bottomZ,
        ceilingHeight: vol.topZ,
        lightLevel: vol.underLight,
        floorTexture: vol.bottomTexture,
        ceilingTexture: vol.topTexture,
        sectorSpecial: 0,
        tag: 0,
        faces: []
      });

      // Linedef 1 carries Sector_Set3DFloor (160, targetTag, type, flags, opacity)
      compiledLinedefs.push(
        {
          v1: dv0,
          v2: dv1,
          twoSided: false,
          blocking: true,
          special: 160, // Sector_Set3DFloor
          arg0: sec.tag,
          arg1: vol.floorType || 1,
          arg2: 0,
          arg3: vol.opacity || 255,
          front: {
            sector: ctrlSecIdx,
            texturetop: '-',
            texturemiddle: vol.edgeTexture || 'SUPPORT3',
            texturebottom: '-'
          },
          back: null
        },
        {
          v1: dv1,
          v2: dv2,
          twoSided: false,
          blocking: true,
          special: 0,
          arg0: 0, arg1: 0, arg2: 0, arg3: 0,
          front: { sector: ctrlSecIdx, texturetop: '-', texturemiddle: vol.edgeTexture || 'SUPPORT3', texturebottom: '-' },
          back: null
        },
        {
          v1: dv2,
          v2: dv0,
          twoSided: false,
          blocking: true,
          special: 0,
          arg0: 0, arg1: 0, arg2: 0, arg3: 0,
          front: { sector: ctrlSecIdx, texturetop: '-', texturemiddle: vol.edgeTexture || 'SUPPORT3', texturebottom: '-' },
          back: null
        }
      );
    }
  }

  // 5. Compile Things
  const compiledThings = [];
  const rawThings = project.things || [];
  let hasPlayer1 = false;

  for (const t of rawThings) {
    if (t.type === 1) hasPlayer1 = true;
    compiledThings.push({
      id: t.id,
      x: Math.round(t.x || 0),
      y: Math.round(t.y || 0),
      z: Number.isFinite(t.z) ? t.z : undefined,     // height above the floor (wall decor up a facade)
      args: Array.isArray(t.args) ? t.args.slice(0, 5).map(v => Math.round(Number(v) || 0)) : undefined,   // arg0-arg4 (a marker's room number)
      angle: Math.round(t.angle || 0),
      type: t.type || 1,
      skill1: true,
      skill2: true,
      skill3: true,
      skill4: true,
      skill5: true,
      single: true,
      coop: true,
      dm: true,
      ambush: Boolean(t.ambush)
    });
  }

  for (const sec of previewSectors) {
    if (sec.kind === 'teleporter' && sec.tag > 0) {
      const center = getInteriorPoint(sec.polygon);
      compiledThings.push({
        x: Math.round(center.x),
        y: Math.round(center.y),
        angle: 0,
        type: 14,
        tid: sec.tag,
        skill1: true,
        skill2: true,
        skill3: true,
        skill4: true,
        skill5: true,
        single: true,
        coop: true,
        dm: true,
        ambush: false
      });
    }
  }

  if (!hasPlayer1 && previewSectors.length > 0) {
    const firstRoom = previewSectors.find(s => s.kind === 'room') || previewSectors[0];
    const pt = getInteriorPoint(firstRoom.polygon);
    compiledThings.unshift({
      x: Math.round(pt.x),
      y: Math.round(pt.y),
      angle: 0,
      type: 1,
      skill1: true,
      skill2: true,
      skill3: true,
      skill4: true,
      skill5: true,
      single: true,
      coop: true,
      dm: true,
      ambush: false
    });
  }

  // 5B. Optional 3D Architectural Skybox Diorama (with ZDoom SkyViewpoint Thing 9080)
  if (skyboxConfig.use3DSkybox) {
    const sx = -12000, sy = -12000, sz = 1024;
    const sv0 = getVertexIndex(sx - sz, sy - sz);
    const sv1 = getVertexIndex(sx - sz, sy + sz);
    const sv2 = getVertexIndex(sx + sz, sy + sz);
    const sv3 = getVertexIndex(sx + sz, sy - sz);
    const skySecIdx = compiledSectors.length;
    const isHell = skyboxConfig.dioramaStyle === 'hell';

    const city = skyboxConfig.dioramaStyle === 'city' ? (skyboxConfig.diorama || {}) : null;
    compiledSectors.push({
      index: skySecIdx,
      id: 'skybox_diorama',
      sourceId: 'skybox',
      kind: 'skybox',
      floorHeight: 0,
      ceilingHeight: city ? (city.ceiling || 2048) : 512,
      lightLevel: city ? (city.light || 144) : (isHell ? 160 : 192),
      floorTexture: city ? (city.ground || 'FLAT5_4') : (isHell ? 'LAVA1' : 'GRASS1'),
      ceilingTexture: 'F_SKY1',
      sectorSpecial: 0,
      tag: 0,
      faces: []
    });

    const skyEdges = [[sv0, sv1], [sv1, sv2], [sv2, sv3], [sv3, sv0]];
    for (const [u, v] of skyEdges) {
      compiledLinedefs.push({
        v1: u,
        v2: v,
        twoSided: false,
        blocking: true,
        special: 9, // Line_Horizon on outer skybox boundary!
        arg0: 0, arg1: 0, arg2: 0, arg3: 0,
        front: {
          sector: skySecIdx,
          texturetop: '-',
          texturemiddle: city ? (city.edge || city.ground || 'STARTAN2') : (isHell ? 'MARBLE1' : 'STARTAN2'),
          texturebottom: '-'
        },
        back: null
      });
    }

    if (skyboxConfig.dioramaStyle === 'city') {
      addCityDiorama({ skyboxConfig, project, sx, sy, sz, skySecIdx, compiledSectors, compiledLinedefs, getVertexIndex });
    }
    // Add 4 towering monoliths/skyscrapers in the 3D Skybox Diorama around the SkyViewpoint
    const towers = skyboxConfig.dioramaStyle === 'city' ? [] : [
      { ox: -384, oy: 256, w: 128, h: 128, top: 384 },
      { ox: 256, oy: 320, w: 160, h: 160, top: 448 },
      { ox: -320, oy: -384, w: 144, h: 144, top: 320 },
      { ox: 320, oy: -256, w: 128, h: 128, top: 416 }
    ];
    for (let t = 0; t < towers.length; t++) {
      const tw = towers[t];
      const tv0 = getVertexIndex(sx + tw.ox, sy + tw.oy);
      const tv1 = getVertexIndex(sx + tw.ox + tw.w, sy + tw.oy);
      const tv2 = getVertexIndex(sx + tw.ox + tw.w, sy + tw.oy + tw.h);
      const tv3 = getVertexIndex(sx + tw.ox, sy + tw.oy + tw.h);
      const tSecIdx = compiledSectors.length;
      compiledSectors.push({
        index: tSecIdx,
        id: `sky_tower_${t}`,
        sourceId: 'skybox',
        kind: 'skybox_tower',
        floorHeight: tw.top,
        ceilingHeight: 512,
        lightLevel: 208,
        floorTexture: isHell ? 'DEM1_6' : 'FLAT23',
        ceilingTexture: 'F_SKY1',
        sectorSpecial: 0,
        tag: 0,
        faces: []
      });
      const tEdges = [[tv0, tv1], [tv1, tv2], [tv2, tv3], [tv3, tv0]];
      const towerTex = isHell ? 'GSTVINE1' : 'COMPTALL';
      for (const [u, v] of tEdges) {
        compiledLinedefs.push({
          v1: u,
          v2: v,
          twoSided: true,
          blocking: true,
          special: 0,
          arg0: 0, arg1: 0, arg2: 0, arg3: 0,
          front: { sector: skySecIdx, texturetop: '-', texturemiddle: '-', texturebottom: towerTex },
          back: { sector: tSecIdx, texturetop: '-', texturemiddle: '-', texturebottom: towerTex }
        });
      }
    }

    // Place SkyViewpoint (DoomEdNum 9080) at the center of the 3D Skybox Diorama
    compiledThings.push({
      x: sx,
      y: sy,
      z: city ? (city.viewHeight || 40) : 64,
      angle: 0,
      type: 9080, // ZDoom SkyViewpoint
      skill1: true,
      skill2: true,
      skill3: true,
      skill4: true,
      skill5: true,
      single: true,
      coop: true,
      dm: true,
      ambush: false
    });
  }

  // 6. Generate UDMF TEXTMAP string
  const lines = [];
  lines.push('// Generated by iDoom Studio (Apple-inspired UDMF Map Compiler)');
  lines.push('namespace = "zdoom";\n');

  for (const v of vertices) {
    lines.push(`vertex // ${v.index}`);
    lines.push('{');
    lines.push(`  x = ${v.x.toFixed(1)};`);
    lines.push(`  y = ${v.y.toFixed(1)};`);
    lines.push('}\n');
  }

  const sidedefs = [];
  compiledLinedefs.forEach((ld, idx) => {
    const frontSideIdx = sidedefs.length;
    sidedefs.push(ld.front);
    let backSideIdx = -1;
    if (ld.back) {
      backSideIdx = sidedefs.length;
      sidedefs.push(ld.back);
    }

    lines.push(`linedef // ${idx}`);
    lines.push('{');
    lines.push(`  v1 = ${ld.v1};`);
    lines.push(`  v2 = ${ld.v2};`);
    lines.push(`  sidefront = ${frontSideIdx};`);
    if (backSideIdx >= 0) lines.push(`  sideback = ${backSideIdx};`);
    if (ld.twoSided) lines.push('  twosided = true;');
    if (ld.blocking) lines.push('  blocking = true;');
    if (ld.dontpegtop) lines.push('  dontpegtop = true;');
    if (ld.dontpegbottom) lines.push('  dontpegbottom = true;');
    if (ld.wrapMid) lines.push('  wrapmidtex = true;');
    if (ld.alpha !== undefined && ld.alpha < 0.99) {
      lines.push(`  alpha = ${ld.alpha.toFixed(2)};`);
      lines.push('  renderstyle = "translucent";');
    }
    if (ld.special > 0) {
      lines.push(`  special = ${ld.special};`);
      if (ld.arg0) lines.push(`  arg0 = ${ld.arg0};`);
      if (ld.arg1) lines.push(`  arg1 = ${ld.arg1};`);
      if (ld.arg2) lines.push(`  arg2 = ${ld.arg2};`);
      if (ld.arg3) lines.push(`  arg3 = ${ld.arg3};`);
      if (ld.playeruse) lines.push('  playeruse = true;');
      if (ld.playercross) lines.push('  playercross = true;');
      if (ld.repeatspecial) lines.push('  repeatspecial = true;');
    }
    lines.push('}\n');
  });

  sidedefs.forEach((sd, idx) => {
    lines.push(`sidedef // ${idx}`);
    lines.push('{');
    lines.push(`  sector = ${sd.sector};`);
    if (sd.texturetop && sd.texturetop !== '-') lines.push(`  texturetop = "${sd.texturetop}";`);
    if (sd.texturemiddle && sd.texturemiddle !== '-') lines.push(`  texturemiddle = "${sd.texturemiddle}";`);
    if (sd.texturebottom && sd.texturebottom !== '-') lines.push(`  texturebottom = "${sd.texturebottom}";`);
    if (sd.scaleXTop) lines.push(`  scalex_top = ${Number(sd.scaleXTop).toFixed(4)};`);
    if (sd.scaleYTop) lines.push(`  scaley_top = ${Number(sd.scaleYTop).toFixed(4)};`);
    lines.push('}\n');
  });

  compiledSectors.forEach((sec, idx) => {
    lines.push(`sector // ${idx} (${sec.id})`);
    lines.push('{');
    lines.push(`  heightfloor = ${Math.round(sec.floorHeight)};`);
    lines.push(`  heightceiling = ${Math.round(sec.ceilingHeight)};`);
    lines.push(`  texturefloor = "${sec.floorTexture}";`);
    lines.push(`  textureceiling = "${sec.ceilingTexture}";`);
    lines.push(`  lightlevel = ${Math.round(sec.lightLevel)};`);
    if (sec.sectorSpecial) lines.push(`  special = ${sec.sectorSpecial};`);
    if (sec.tag) lines.push(`  id = ${sec.tag};`);
    lines.push('}\n');
  });

  compiledThings.forEach((th, idx) => {
    lines.push(`thing // ${idx}`);
    lines.push('{');
    lines.push(`  x = ${th.x.toFixed(1)};`);
    lines.push(`  y = ${th.y.toFixed(1)};`);
    if (Number.isFinite(th.z)) lines.push(`  height = ${th.z.toFixed(1)};`);
    lines.push(`  angle = ${th.angle};`);
    lines.push(`  type = ${th.type};`);
    if (th.tid) lines.push(`  id = ${th.tid};`);
    if (th.args) th.args.forEach((v, i) => { if (v) lines.push(`  arg${i} = ${v};`); });
    lines.push('  skill1 = true;');
    lines.push('  skill2 = true;');
    lines.push('  skill3 = true;');
    lines.push('  skill4 = true;');
    lines.push('  skill5 = true;');
    lines.push('  single = true;');
    lines.push('  coop = true;');
    lines.push('  dm = true;');
    if (th.ambush) lines.push('  ambush = true;');
    lines.push('}\n');
  });

  // 7. Generate ZMAPINFO lump for Skybox texture, scroll speed & level title
  const safeTitle = (project.name || 'iDoom Studio Map').replace(/"/g, '');
  const mapLump = mapLumpOf(project);
  const zmapinfo = [
    `map ${mapLump} "${safeTitle}"`,
    '{',
    `  sky1 = "${skyboxConfig.texture}", ${skyboxConfig.scrollSpeed || 0}`,
    '  evenlighting',
    '}'
  ].join('\n');
  // the same entry for a mod's own MAPINFO, when the map is exported into the mod without a ZMAPINFO of its own
  const mapinfo = [
    `map ${mapLump} "${safeTitle}"`,
    '{',
    `\tsky1 = "${skyboxConfig.texture}", ${skyboxConfig.scrollSpeed || 0}`,
    '}'
  ].join('\n');

  return {
    textmap: lines.join('\n'),
    zmapinfo,
    mapinfo,
    mapLump,
    skybox: skyboxConfig,
    vertices: previewVertices,
    linedefs: previewLinedefs,
    sectors: previewSectors,
    threeDFloors: preview3DFloors,
    things: compiledThings.filter(t => t.type !== 9080),
    stats: {
      vertices: vertices.length,
      linedefs: compiledLinedefs.length,
      sectors: compiledSectors.length,
      things: compiledThings.length,
      threeDFloors: preview3DFloors.length
    }
  };
}

function buildUdmfWadBuffer(textmapString, mapName = 'MAP01', zmapinfoString = '') {
  const textmapBuf = Buffer.from(textmapString, 'utf8');
  const zmapinfoBuf = zmapinfoString ? Buffer.from(zmapinfoString, 'utf8') : Buffer.alloc(0);

  const headerSize = 12;
  const textmapOffset = headerSize;
  const textmapSize = textmapBuf.length;
  const zmapinfoOffset = textmapOffset + textmapSize;
  const zmapinfoSize = zmapinfoBuf.length;
  const dirOffset = zmapinfoOffset + zmapinfoSize;

  const numLumps = zmapinfoSize > 0 ? 4 : 3;
  const dirBuf = Buffer.alloc(numLumps * 16, 0);

  // Lump 0: MAP01
  dirBuf.writeInt32LE(headerSize, 0);
  dirBuf.writeInt32LE(0, 4);
  dirBuf.write(mapName.slice(0, 8), 8, 'ascii');

  // Lump 1: TEXTMAP
  dirBuf.writeInt32LE(textmapOffset, 16);
  dirBuf.writeInt32LE(textmapSize, 20);
  dirBuf.write('TEXTMAP', 24, 'ascii');

  // Lump 2: ENDMAP
  dirBuf.writeInt32LE(zmapinfoOffset, 32);
  dirBuf.writeInt32LE(0, 36);
  dirBuf.write('ENDMAP', 40, 'ascii');

  // Lump 3: ZMAPINFO (Skyboxes & Map Title)
  if (zmapinfoSize > 0) {
    dirBuf.writeInt32LE(zmapinfoOffset, 48);
    dirBuf.writeInt32LE(zmapinfoSize, 52);
    dirBuf.write('ZMAPINFO', 56, 'ascii');
  }

  const headerBuf = Buffer.alloc(12);
  headerBuf.write('PWAD', 0, 'ascii');
  headerBuf.writeInt32LE(numLumps, 4);
  headerBuf.writeInt32LE(dirOffset, 8);

  return Buffer.concat([headerBuf, textmapBuf, zmapinfoBuf, dirBuf]);
}

module.exports = {
  MATERIAL_THEMES,
  SKYBOX_PRESETS,
  DEFAULTS,
  mapLumpOf,
  compileProject,
  buildUdmfWadBuffer
};
