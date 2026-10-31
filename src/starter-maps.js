const THING_CATALOG = [
  // Starts & Teleports
  { type: 1, name: 'Player 1 Start', category: 'starts', sprite: 'PLAY', color: '#22c55e', radius: 16, height: 56 },
  { type: 11, name: 'Deathmatch Start', category: 'starts', sprite: 'PLAY', color: '#10b981', radius: 16, height: 56 },

  // Weapons
  { type: 2001, name: 'Shotgun', category: 'weapons', sprite: 'SHOT', color: '#f59e0b', radius: 20, height: 16 },
  { type: 82, name: 'Double-Barreled SSG', category: 'weapons', sprite: 'SGN2', color: '#f97316', radius: 20, height: 16 },
  { type: 2002, name: 'Chaingun', category: 'weapons', sprite: 'MGUN', color: '#eab308', radius: 20, height: 16 },
  { type: 2003, name: 'Rocket Launcher', category: 'weapons', sprite: 'LAUN', color: '#ef4444', radius: 20, height: 16 },
  { type: 2004, name: 'Plasma Rifle', category: 'weapons', sprite: 'PLAS', color: '#38bdf8', radius: 20, height: 16 },
  { type: 2006, name: 'BFG 9000', category: 'weapons', sprite: 'BFUG', color: '#4ade80', radius: 20, height: 16 },
  { type: 2005, name: 'Chainsaw', category: 'weapons', sprite: 'CSAW', color: '#fb923c', radius: 20, height: 16 },

  // Monsters
  { type: 3004, name: 'Zombie Trooper', category: 'monsters', sprite: 'POSS', color: '#fca5a5', radius: 20, height: 56 },
  { type: 9, name: 'Shotgun Sergeant', category: 'monsters', sprite: 'SPOS', color: '#f87171', radius: 20, height: 56 },
  { type: 65, name: 'Heavy Chaingunner', category: 'monsters', sprite: 'CPOS', color: '#ef4444', radius: 20, height: 56 },
  { type: 3001, name: 'Imp / Serpentipede', category: 'monsters', sprite: 'TROO', color: '#fb7185', radius: 20, height: 56 },
  { type: 3002, name: 'Pinky Flesh Worm', category: 'monsters', sprite: 'SARG', color: '#f43f5e', radius: 30, height: 56 },
  { type: 3005, name: 'Cacodemon / Trilobite', category: 'monsters', sprite: 'HEAD', color: '#e11d48', radius: 31, height: 56 },
  { type: 69, name: 'Hell Knight', category: 'monsters', sprite: 'BOS2', color: '#be123c', radius: 24, height: 64 },
  { type: 3003, name: 'Baron of Hell', category: 'monsters', sprite: 'BOSS', color: '#9f1239', radius: 24, height: 64 },
  { type: 66, name: 'Revenant', category: 'monsters', sprite: 'SKEL', color: '#dc2626', radius: 20, height: 56 },
  { type: 67, name: 'Mancubus', category: 'monsters', sprite: 'FATT', color: '#b91c1c', radius: 48, height: 64 },
  { type: 16, name: 'Cyberdemon / Assault Tripod', category: 'monsters', sprite: 'CYBR', color: '#7f1d1d', radius: 40, height: 110 },

  // Health, Armor & Powerups
  { type: 2011, name: 'Stimpack (+10 HP)', category: 'pickups', sprite: 'STIM', color: '#60a5fa', radius: 16, height: 16 },
  { type: 2012, name: 'Medikit (+25 HP)', category: 'pickups', sprite: 'MEDI', color: '#3b82f6', radius: 16, height: 16 },
  { type: 2013, name: 'Soulsphere (+100 HP)', category: 'pickups', sprite: 'SOUL', color: '#2563eb', radius: 16, height: 32 },
  { type: 2018, name: 'Security Armor (100%)', category: 'pickups', sprite: 'ARM1', color: '#34d399', radius: 16, height: 16 },
  { type: 2019, name: 'Combat Armor (200%)', category: 'pickups', sprite: 'ARM2', color: '#38bdf8', radius: 16, height: 16 },
  { type: 2008, name: '4 Shotgun Shells', category: 'pickups', sprite: 'SHEL', color: '#fbbf24', radius: 16, height: 16 },
  { type: 2049, name: 'Box of Shells', category: 'pickups', sprite: 'SBOX', color: '#d97706', radius: 16, height: 16 },
  { type: 2048, name: 'Box of Bullets', category: 'pickups', sprite: 'AMMO', color: '#a3e635', radius: 16, height: 16 },
  { type: 2046, name: 'Box of Rockets', category: 'pickups', sprite: 'BROK', color: '#f87171', radius: 16, height: 16 },
  { type: 17, name: 'Energy Cell Pack', category: 'pickups', sprite: 'CELP', color: '#22d3ee', radius: 16, height: 16 },
  { type: 8, name: 'Backpack', category: 'pickups', sprite: 'BPAK', color: '#c084fc', radius: 16, height: 24 },

  // Keys
  { type: 13, name: 'Red Keycard', category: 'keys', sprite: 'RKEY', color: '#ef4444', radius: 16, height: 16 },
  { type: 5, name: 'Blue Keycard', category: 'keys', sprite: 'BKEY', color: '#3b82f6', radius: 16, height: 16 },
  { type: 6, name: 'Yellow Keycard', category: 'keys', sprite: 'YKEY', color: '#eab308', radius: 16, height: 16 },

  // Props & Lights
  { type: 2035, name: 'Exploding Barrel', category: 'props', sprite: 'BAR1', color: '#84cc16', radius: 10, height: 42 },
  { type: 2028, name: 'Floor Lamp', category: 'props', sprite: 'COLU', color: '#fde047', radius: 16, height: 48 },
  { type: 85, name: 'Tall Tech Lamp', category: 'props', sprite: 'TLMP', color: '#fef08a', radius: 16, height: 80 },
  { type: 48, name: 'Tech Pillar', category: 'props', sprite: 'ELEC', color: '#94a3b8', radius: 16, height: 128 },
  { type: 35, name: 'Candelabra', category: 'props', sprite: 'CBRA', color: '#fb923c', radius: 16, height: 60 }
];

const STARTER_MAPS = {
  uac_outpost: {
    id: 'uac_outpost',
    name: 'UAC Outpost Alpha (Showcase)',
    skybox: 'diorama_tech',
    description: 'Complete multi-room techbase featuring a 3D Catwalk Bridge over a Nukage Pool, Half-Floor Mezzanine, Smart Door, Courtyard Window, Staircase & Lift.',
    rooms: [
      {
        id: 'room_entry',
        name: 'Arrival Bay',
        shape: 'rect',
        x: -256,
        y: -192,
        width: 384,
        height: 384,
        floorHeight: 0,
        ceilingHeight: 128,
        lightLevel: 176,
        theme: 'techbase'
      },
      {
        id: 'room_hub',
        name: 'Central Hub',
        shape: 'octagon',
        x: 160,
        y: -256,
        width: 512,
        height: 512,
        floorHeight: 0,
        ceilingHeight: 176,
        lightLevel: 160,
        theme: 'industrial'
      },
      {
        id: 'room_courtyard',
        name: 'Open Skybox Courtyard',
        shape: 'rect',
        x: 192,
        y: 256,
        width: 448,
        height: 384,
        floorHeight: -16,
        ceilingHeight: 224,
        lightLevel: 208,
        theme: 'outdoor'
      },
      {
        id: 'room_overlook',
        name: 'Command Overlook',
        shape: 'rect',
        x: 800,
        y: -192,
        width: 384,
        height: 384,
        floorHeight: 64,
        ceilingHeight: 224,
        lightLevel: 184,
        theme: 'toxic',
        hasHalfFloor: true,
        halfFloorSide: 'N',
        halfFloorHeight: 136,
        halfFloorThickness: 8
      }
    ],
    smartObjects: [
      {
        id: 'door_main',
        name: 'Entry Security Door',
        type: 'door',
        x: 128,
        y: -64,
        width: 32,
        height: 128,
        theme: 'techbase',
        wallTexture: 'BIGDOOR2',
        lock: 0
      },
      {
        id: 'bridge_hub',
        name: '3D Catwalk Bridge',
        type: '3dfloor',
        style: 'solid',
        x: 224,
        y: -48,
        width: 384,
        height: 96,
        topZ: 64,
        thickness: 8,
        topTexture: 'STEP2',
        bottomTexture: 'FLAT20',
        edgeTexture: 'SUPPORT3',
        underLight: 136
      },
      {
        id: 'win_courtyard',
        name: 'Courtyard Observation Window',
        type: 'window',
        x: 320,
        y: 240,
        width: 192,
        height: 32,
        floorHeight: 32,
        ceilingHeight: 112,
        grate: false,
        theme: 'industrial'
      },
      {
        id: 'lift_courtyard',
        name: 'Courtyard Access Lift',
        type: 'lift',
        x: 528,
        y: 224,
        width: 80,
        height: 64,
        lowFloor: -16,
        floorHeight: 0,
        ceilingHeight: 144,
        theme: 'industrial'
      },
      {
        id: 'stairs_east',
        name: 'Command Stairs',
        type: 'stairs',
        x: 672,
        y: -64,
        width: 128,
        height: 128,
        steps: 4,
        direction: 'E',
        startFloor: 0,
        endFloor: 64,
        ceilingHeight: 192,
        theme: 'industrial'
      },
      {
        id: 'pool_nukage',
        name: 'Central Nukage Vat',
        type: 'pool',
        hazard: 'nukage',
        x: 352,
        y: -64,
        width: 128,
        height: 128,
        floorHeight: -16,
        ceilingHeight: 160,
        theme: 'industrial'
      },
      {
        id: 'pillar_entry_1',
        name: 'Support Column N',
        type: 'pillar',
        solid: true,
        x: -128,
        y: 64,
        width: 48,
        height: 48,
        wallTexture: 'SHAWN2'
      },
      {
        id: 'pillar_entry_2',
        name: 'Support Column S',
        type: 'pillar',
        solid: true,
        x: -128,
        y: -112,
        width: 48,
        height: 48,
        wallTexture: 'SHAWN2'
      },
      {
        id: 'exit_switch',
        name: 'Level Exit Console',
        type: 'exit',
        x: 1120,
        y: -32,
        width: 32,
        height: 64,
        floorHeight: 80,
        ceilingHeight: 160,
        theme: 'toxic'
      }
    ],
    links: [],
    things: [
      { id: 'th_p1', type: 1, x: -192, y: 0, angle: 0 },
      { id: 'th_sg', type: 2001, x: 0, y: 0, angle: 0 },
      { id: 'th_shells', type: 2008, x: 0, y: -48, angle: 0 },
      { id: 'th_armor', type: 2018, x: -64, y: 128, angle: 0 },
      { id: 'th_z1', type: 3004, x: 320, y: 96, angle: 180 },
      { id: 'th_z2', type: 9, x: 480, y: -128, angle: 180 },
      { id: 'th_imp1', type: 3001, x: 384, y: 448, angle: 270 },
      { id: 'th_imp2', type: 3001, x: 960, y: 64, angle: 180 },
      { id: 'th_imp3', type: 3001, x: 960, y: -64, angle: 180 },
      { id: 'th_cg', type: 2002, x: 384, y: 528, angle: 0 },
      { id: 'th_med1', type: 2012, x: 896, y: 0, angle: 0 },
      { id: 'th_bar1', type: 2035, x: 256, y: -128, angle: 0 },
      { id: 'th_lamp1', type: 85, x: 64, y: 96, angle: 0 },
      { id: 'th_lamp2', type: 85, x: 64, y: -96, angle: 0 }
    ]
  },

  hell_sanctum: {
    id: 'hell_sanctum',
    name: 'Brimstone Cathedral',
    description: 'Gothic marble arena with lava moat, teleporter pads, and demonic guardians.',
    rooms: [
      {
        id: 'room_nave',
        name: 'Cathedral Nave',
        shape: 'octagon',
        x: -384,
        y: -384,
        width: 768,
        height: 768,
        floorHeight: 0,
        ceilingHeight: 224,
        lightLevel: 144,
        theme: 'hell'
      },
      {
        id: 'room_altar',
        name: 'High Altar',
        shape: 'rect',
        x: 384,
        y: -192,
        width: 320,
        height: 384,
        floorHeight: 32,
        ceilingHeight: 192,
        lightLevel: 176,
        theme: 'hell'
      }
    ],
    smartObjects: [
      {
        id: 'pool_lava_n',
        name: 'Lava Trench N',
        type: 'pool',
        hazard: 'lava',
        x: -192,
        y: 128,
        width: 384,
        height: 128,
        floorHeight: -16,
        ceilingHeight: 224,
        theme: 'hell'
      },
      {
        id: 'pool_lava_s',
        name: 'Lava Trench S',
        type: 'pool',
        hazard: 'lava',
        x: -192,
        y: -256,
        width: 384,
        height: 128,
        floorHeight: -16,
        ceilingHeight: 224,
        theme: 'hell'
      },
      {
        id: 'exit_hell',
        name: 'Altar Exit',
        type: 'exit',
        x: 640,
        y: -32,
        width: 32,
        height: 64,
        floorHeight: 48,
        ceilingHeight: 128,
        theme: 'hell'
      }
    ],
    links: [],
    things: [
      { id: 'h_p1', type: 1, x: -288, y: 0, angle: 0 },
      { id: 'h_ssg', type: 82, x: -128, y: 0, angle: 0 },
      { id: 'h_sbox', type: 2049, x: -128, y: -48, angle: 0 },
      { id: 'h_armor', type: 2019, x: 0, y: 0, angle: 0 },
      { id: 'h_hk1', type: 69, x: 480, y: 0, angle: 180 },
      { id: 'h_imp1', type: 3001, x: 224, y: 160, angle: 225 },
      { id: 'h_imp2', type: 3001, x: 224, y: -160, angle: 135 }
    ]
  },

  blank_studio: {
    id: 'blank_studio',
    name: 'Clean Starter Room',
    description: 'Single clean 384×384 starter space with a Player 1 Start ready for sketching.',
    rooms: [
      {
        id: 'room_1',
        name: 'Main Space',
        shape: 'rect',
        x: -192,
        y: -192,
        width: 384,
        height: 384,
        floorHeight: 0,
        ceilingHeight: 128,
        lightLevel: 176,
        theme: 'techbase'
      }
    ],
    smartObjects: [],
    links: [],
    things: [
      { id: 'th_start', type: 1, x: 0, y: 0, angle: 0 }
    ]
  }
};

module.exports = {
  THING_CATALOG,
  STARTER_MAPS
};

