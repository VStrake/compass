/**
 * Seeded demo tower — "Meridian Tower", a 12-story Class A office building.
 * Proprietary and confidential. © Partners Real Estate.
 *
 * Fully DETERMINISTIC: no randomness, no clock reads. Ids are sequential
 * (`wall_d0042`) so snapshots and screenshots are stable across sessions and
 * the demo doubles as a fixture for area-analysis tests.
 *
 * Plate geometry (meters, plan space — plan y maps to world z):
 *
 *   plate        x ∈ [−24, 24], y ∈ [−16, 16]           48 × 32 = 1,536 m²
 *   core         x ∈ [−8, 8],   y ∈ [−6, 6]             16 × 12 =   192 m²
 *   corridor     2.5 m ring around the core                        165 m²
 *   suites       everything outside the ring                     1,179 m²
 *
 * The suite subdivision is a pinwheel tiling, so 2, 3 or 4 suites always tile
 * the exact same 1,179 m² of rentable area — per-floor area totals stay
 * comparable no matter how the plate is demised.
 */

import { fixedId } from './ids';
import {
  DEFAULTS,
  createColumn,
  createCore,
  createFloor,
  createFurniture,
  createOpening,
  createSlab,
  createTenant,
  createWall,
  createZone,
  rect,
  recomputeElevations,
} from './factories';
import type {
  Building,
  Column,
  ColumnId,
  Core,
  CoreId,
  Floor,
  FloorId,
  FurnitureId,
  FurnitureInstance,
  Opening,
  OpeningId,
  Polygon,
  ProjectDoc,
  ProjectId,
  BuildingId,
  Slab,
  SlabId,
  Tenant,
  TenantId,
  Vec2,
  Wall,
  WallId,
  WallKind,
  Zone,
  ZoneId,
} from './types';

// —— plate constants ————————————————————————————————————————————
const FLOOR_COUNT = 12;
const PLATE = { x0: -24, x1: 24, y0: -16, y1: 16 } as const;
const CORE = { x0: -8, x1: 8, y0: -6, y1: 6 } as const;
const CORRIDOR_WIDTH = 2.5;
/** Core + corridor ring — the non-rentable center block. */
const BLOCK = {
  x0: CORE.x0 - CORRIDOR_WIDTH,
  x1: CORE.x1 + CORRIDOR_WIDTH,
  y0: CORE.y0 - CORRIDOR_WIDTH,
  y1: CORE.y1 + CORRIDOR_WIDTH,
} as const;

const DEMO_CREATED_AT = '2026-01-15T09:00:00.000Z';

// —— deterministic id minting ————————————————————————————————————
function createIdMinter() {
  let counter = 0;
  return function mint<T extends string>(prefix: string): T {
    counter += 1;
    return fixedId<T>(prefix, `d${counter.toString().padStart(4, '0')}`);
  };
}

// —— tenants ————————————————————————————————————————————————————
/**
 * Six tenants covering every `TenantStatus`. Colors are picked for legibility
 * on the dark editor canvas (mid-tone, distinct hues, similar luminance so no
 * single suite visually dominates a stacking diagram).
 */
function createTenants(): Tenant[] {
  const tenants: Tenant[] = [
    {
      ...createTenant('Northwind Analytics', '#4f9cf9', 'leased', {
        industry: 'Technology',
        leaseExpiry: '2031-06-30',
      }),
      id: fixedId<TenantId>('tenant', 'northwind'),
    },
    {
      ...createTenant('Halverson Legal Group', '#f59e0b', 'leased', {
        industry: 'Legal',
        leaseExpiry: '2029-12-31',
      }),
      id: fixedId<TenantId>('tenant', 'halverson'),
    },
    {
      ...createTenant('Meridian Capital Partners', '#34d399', 'leased', {
        industry: 'Financial Services',
        leaseExpiry: '2033-03-31',
      }),
      id: fixedId<TenantId>('tenant', 'meridian-capital'),
    },
    {
      ...createTenant('Bayline Health Systems', '#f472b6', 'expiring', {
        industry: 'Healthcare',
        leaseExpiry: '2026-11-30',
      }),
      id: fixedId<TenantId>('tenant', 'bayline'),
    },
    {
      ...createTenant('Orsted Design Collective', '#a78bfa', 'proposed', {
        industry: 'Architecture & Design',
      }),
      id: fixedId<TenantId>('tenant', 'orsted'),
    },
    {
      // Vacated tenant of record: the suite is being marketed, the record is
      // retained for the stacking diagram until the space is re-let.
      ...createTenant('Ridgeline Insurance', '#94a3b8', 'vacant', {
        industry: 'Insurance',
        leaseExpiry: '2026-04-30',
      }),
      id: fixedId<TenantId>('tenant', 'ridgeline'),
    },
  ];
  return tenants;
}

// —— suite subdivision (pinwheel tiling) ————————————————————————
const PINWHEEL = {
  west: rect(PLATE.x0, BLOCK.y0, BLOCK.x0 - PLATE.x0, PLATE.y1 - BLOCK.y0),
  north: rect(BLOCK.x0, BLOCK.y1, PLATE.x1 - BLOCK.x0, PLATE.y1 - BLOCK.y1),
  east: rect(BLOCK.x1, PLATE.y0, PLATE.x1 - BLOCK.x1, BLOCK.y1 - PLATE.y0),
  south: rect(PLATE.x0, PLATE.y0, BLOCK.x1 - PLATE.x0, BLOCK.y0 - PLATE.y0),
} as const;

/** West + north pinwheel quarters merged into one L-shaped half-plate. */
const HALF_NORTHWEST: Polygon = [
  { x: PLATE.x0, y: BLOCK.y0 },
  { x: BLOCK.x0, y: BLOCK.y0 },
  { x: BLOCK.x0, y: BLOCK.y1 },
  { x: PLATE.x1, y: BLOCK.y1 },
  { x: PLATE.x1, y: PLATE.y1 },
  { x: PLATE.x0, y: PLATE.y1 },
];

/** East + south pinwheel quarters merged into one L-shaped half-plate. */
const HALF_SOUTHEAST: Polygon = [
  { x: PLATE.x0, y: PLATE.y0 },
  { x: PLATE.x1, y: PLATE.y0 },
  { x: PLATE.x1, y: BLOCK.y1 },
  { x: BLOCK.x1, y: BLOCK.y1 },
  { x: BLOCK.x1, y: BLOCK.y0 },
  { x: PLATE.x0, y: BLOCK.y0 },
];

/**
 * How many suites a given level is demised into: a deterministic 2 → 3 → 4
 * cycle so the tower shows single-tenant, split and multi-tenant floors.
 */
function suiteCountForFloor(index: number): number {
  return 2 + ((index * 7) % 3);
}

/** Suite outlines for a level; every variant tiles the identical 1,179 m². */
function suiteOutlines(index: number): Polygon[] {
  switch (suiteCountForFloor(index)) {
    case 2:
      return [HALF_NORTHWEST, HALF_SOUTHEAST];
    case 3:
      return [PINWHEEL.west, PINWHEEL.north, HALF_SOUTHEAST];
    default:
      return [PINWHEEL.west, PINWHEEL.north, PINWHEEL.east, PINWHEEL.south];
  }
}

/**
 * Tenant assignment ring. Two `null` slots keep genuine vacancy in the model
 * (vacant suite area is reported under a `null` tenantId).
 */
function assignmentRing(tenants: Tenant[]): (TenantId | null)[] {
  return [
    tenants[0]!.id,
    tenants[1]!.id,
    null,
    tenants[2]!.id,
    tenants[3]!.id,
    tenants[4]!.id,
    null,
    tenants[5]!.id,
  ];
}

// —— core ————————————————————————————————————————————————————————
function buildCores(mint: <T extends string>(p: string) => T): Core[] {
  const specs: { kind: Core['kind']; outline: Polygon; label: string }[] = [
    {
      kind: 'elevator-bank',
      outline: rect(CORE.x0, -2.5, 8, 5),
      label: 'Passenger Elevators (6 cars)',
    },
    { kind: 'stair', outline: rect(CORE.x0, 2.5, 4.5, 3.5), label: 'Stair 1' },
    { kind: 'stair', outline: rect(CORE.x0, CORE.y0, 4.5, 3.5), label: 'Stair 2' },
    { kind: 'mechanical', outline: rect(-3.5, 2.5, 3.5, 3.5), label: 'Mechanical' },
    { kind: 'electrical', outline: rect(-3.5, CORE.y0, 3.5, 3.5), label: 'Electrical' },
    { kind: 'restroom', outline: rect(0.5, 0.5, 7.5, 5.5), label: "Restroom — Women's" },
    { kind: 'restroom', outline: rect(0.5, CORE.y0, 7.5, 5.5), label: "Restroom — Men's" },
    { kind: 'telecom', outline: rect(0.5, -0.4, 3, 0.8), label: 'Telecom / IDF' },
  ];

  return specs.map((spec) => {
    const core = createCore(spec.kind, spec.outline, spec.label);
    core.id = mint<CoreId>('core');
    return core;
  });
}

// —— walls ——————————————————————————————————————————————————————
function wall(
  mint: <T extends string>(p: string) => T,
  kind: WallKind,
  start: Vec2,
  end: Vec2,
  openings: { kind: Opening['kind']; offset: number }[] = [],
): Wall {
  const w = createWall(kind, start, end);
  w.id = mint<WallId>('wall');
  w.openings = openings.map((spec) => {
    const opening = createOpening(spec.kind, spec.offset);
    opening.id = mint<OpeningId>('open');
    return opening;
  });
  return w;
}

/** Exterior glass curtain wall running the full perimeter of the plate. */
function buildPerimeterWalls(mint: <T extends string>(p: string) => T): Wall[] {
  const sw = { x: PLATE.x0, y: PLATE.y0 };
  const se = { x: PLATE.x1, y: PLATE.y0 };
  const ne = { x: PLATE.x1, y: PLATE.y1 };
  const nw = { x: PLATE.x0, y: PLATE.y1 };
  return [
    wall(mint, 'exterior', sw, se),
    wall(mint, 'exterior', se, ne),
    wall(mint, 'exterior', ne, nw),
    wall(mint, 'exterior', nw, sw),
  ];
}

/** Core enclosure: interior walls with the elevator-lobby doors. */
function buildCoreWalls(mint: <T extends string>(p: string) => T): Wall[] {
  const sw = { x: CORE.x0, y: CORE.y0 };
  const se = { x: CORE.x1, y: CORE.y0 };
  const ne = { x: CORE.x1, y: CORE.y1 };
  const nw = { x: CORE.x0, y: CORE.y1 };
  return [
    wall(mint, 'interior', sw, se, [{ kind: 'door', offset: 4 }]),
    wall(mint, 'interior', se, ne),
    wall(mint, 'interior', ne, nw, [{ kind: 'double-door', offset: 8 }]),
    wall(mint, 'interior', nw, sw),
  ];
}

/**
 * Fit-out partitions for a furnished suite: a glass-fronted conference room, a
 * partition with a pass-through at the tea point, and the demising wall that
 * separates the suite from the elevator lobby.
 */
function buildFitOutWalls(mint: <T extends string>(p: string) => T): Wall[] {
  return [
    // conference room, glass front with a glass door
    wall(mint, 'glass', { x: -22.5, y: 9 }, { x: -12, y: 9 }, [
      { kind: 'glass-door', offset: 5.25 },
    ]),
    wall(mint, 'glass', { x: -12, y: 9 }, { x: -12, y: 15 }),
    // tea point partition with a pass-through
    wall(mint, 'partition', { x: -22.5, y: 7.5 }, { x: -18, y: 7.5 }, [
      { kind: 'pass-through', offset: 2.25 },
    ]),
    // suite demising wall along the block edge, with the suite entry door
    wall(mint, 'demising', { x: BLOCK.x0, y: BLOCK.y0 }, { x: BLOCK.x0, y: PLATE.y1 }, [
      { kind: 'door', offset: 12 },
    ]),
  ];
}

// —— columns ————————————————————————————————————————————————————
function buildColumns(mint: <T extends string>(p: string) => T): Column[] {
  const columns: Column[] = [];
  for (const x of [-18, -12, 12, 18]) {
    for (const y of [-12, 0, 12]) {
      const column = createColumn({ x, y }, 0.6, 0.6, 'rect');
      column.id = mint<ColumnId>('col');
      columns.push(column);
    }
  }
  return columns;
}

// —— zones ——————————————————————————————————————————————————————
function buildCirculationZones(mint: <T extends string>(p: string) => T): Zone[] {
  const ring: { name: string; outline: Polygon }[] = [
    {
      name: 'Corridor — North',
      outline: rect(BLOCK.x0, CORE.y1, BLOCK.x1 - BLOCK.x0, CORRIDOR_WIDTH),
    },
    {
      name: 'Corridor — South',
      outline: rect(BLOCK.x0, BLOCK.y0, BLOCK.x1 - BLOCK.x0, CORRIDOR_WIDTH),
    },
    {
      name: 'Corridor — West',
      outline: rect(BLOCK.x0, CORE.y0, CORRIDOR_WIDTH, CORE.y1 - CORE.y0),
    },
    {
      name: 'Corridor — East',
      outline: rect(CORE.x1, CORE.y0, CORRIDOR_WIDTH, CORE.y1 - CORE.y0),
    },
  ];
  return ring.map((spec) => {
    const zone = createZone(spec.name, 'circulation', spec.outline, null);
    zone.id = mint<ZoneId>('zone');
    return zone;
  });
}

// —— furniture ——————————————————————————————————————————————————
function place(
  mint: <T extends string>(p: string) => T,
  catalogId: string,
  x: number,
  y: number,
  rotation = 0,
): FurnitureInstance {
  const instance = createFurniture(catalogId, { x, y }, rotation);
  instance.id = mint<FurnitureId>('furn');
  return instance;
}

/** Ground-floor lobby fit-out: reception, lounge cluster, planters. */
function buildLobbyFurniture(mint: <T extends string>(p: string) => T): FurnitureInstance[] {
  const items: FurnitureInstance[] = [];

  // Reception desk faces the main entry (south), backed against the west wall zone.
  items.push(place(mint, 'reception-desk', -16, 2, 0));
  items.push(place(mint, 'chair-task', -16, 3.2, Math.PI));
  items.push(place(mint, 'chair-task', -14.6, 3.2, Math.PI));

  // Lounge cluster south of reception.
  items.push(place(mint, 'sofa-lounge', -18, -4, 0));
  items.push(place(mint, 'sofa-lounge', -13, -4, Math.PI));
  for (let i = 0; i < 4; i++) {
    items.push(place(mint, 'chair-guest', -19.5 + i * 1.2, -6.6, 0));
  }

  // Planters marking the lobby edges.
  for (const [x, y] of [
    [-21.5, 6],
    [-21.5, 12],
    [-11.5, 12],
    [-11.5, 6],
  ] as const) {
    items.push(place(mint, 'planter-large', x, y, 0));
  }

  return items;
}

/**
 * Open-plan fit-out for the west suite (x ∈ [−24, −10.5], y ∈ [−8.5, 16]):
 * a workstation field, a 10-person conference room, a tea point and support.
 * Generated with simple deterministic loops.
 */
function buildOpenPlanFurniture(mint: <T extends string>(p: string) => T): FurnitureInstance[] {
  const items: FurnitureInstance[] = [];

  // —— workstation field: 4 columns × 5 rows, 2.6 m on center ——
  const wsX0 = -22.2;
  const wsY0 = -6;
  const spacing = 2.6;
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 5; row++) {
      const x = wsX0 + col * spacing;
      const y = wsY0 + row * spacing;
      // Alternate facing so back panels pair up down each aisle.
      const rotation = col % 2 === 0 ? 0 : Math.PI;
      items.push(place(mint, 'workstation-cubicle', x, y, rotation));
      items.push(place(mint, 'chair-task', x, y + (rotation === 0 ? 0.45 : -0.45), rotation));
    }
  }

  // —— conference room: table + 10 chairs ——
  const tableX = -17.25;
  const tableY = 12;
  items.push(place(mint, 'conference-table-10', tableX, tableY, 0));
  for (let i = 0; i < 4; i++) {
    const x = tableX - 1.575 + i * 1.05;
    items.push(place(mint, 'chair-task', x, tableY - 1.15, 0));
    items.push(place(mint, 'chair-task', x, tableY + 1.15, Math.PI));
  }
  items.push(place(mint, 'chair-task', tableX - 2.55, tableY, Math.PI / 2));
  items.push(place(mint, 'chair-task', tableX + 2.55, tableY, -Math.PI / 2));
  items.push(place(mint, 'whiteboard-mobile', tableX, tableY + 2.6, Math.PI));

  // —— tea point / break area, south end of the suite ——
  items.push(place(mint, 'breakroom-counter', -21, -7.6, 0));
  items.push(place(mint, 'breakroom-table', -17.5, -7.2, 0));
  items.push(place(mint, 'breakroom-table', -14.5, -7.2, 0));
  for (let i = 0; i < 4; i++) {
    items.push(place(mint, 'chair-guest', -18.4 + i * 1.4, -7.2, 0));
  }

  // —— support: filing, print, greenery ——
  items.push(place(mint, 'file-cabinet', -11.6, 2, -Math.PI / 2));
  items.push(place(mint, 'file-cabinet', -11.6, 3.2, -Math.PI / 2));
  items.push(place(mint, 'printer-station', -11.6, 5.4, -Math.PI / 2));
  items.push(place(mint, 'planter-large', -11.6, 8.4, 0));
  items.push(place(mint, 'planter-large', -22.8, 8.4, 0));

  return items;
}

// —— floor assembly ——————————————————————————————————————————————
function buildFloor(
  index: number,
  mint: <T extends string>(p: string) => T,
  tenants: Tenant[],
): Floor {
  const isGround = index === 0;
  const height = isGround ? DEFAULTS.groundFloorHeight : DEFAULTS.floorHeight;
  const floor = createFloor(index, 0, height); // elevation fixed up below
  floor.id = mint<FloorId>('floor');

  // —— slab ——
  const slab: Slab = createSlab(
    rect(PLATE.x0, PLATE.y0, PLATE.x1 - PLATE.x0, PLATE.y1 - PLATE.y0),
    [],
    DEFAULTS.slabThickness,
  );
  slab.id = mint<SlabId>('slab');
  floor.slabs = [slab];

  // —— structure ——
  floor.walls = [...buildPerimeterWalls(mint), ...buildCoreWalls(mint)];
  floor.cores = buildCores(mint);
  floor.columns = buildColumns(mint);

  // —— zoning ——
  const coreZone = createZone(
    'Building Core',
    'core',
    rect(CORE.x0, CORE.y0, CORE.x1 - CORE.x0, CORE.y1 - CORE.y0),
    null,
  );
  coreZone.id = mint<ZoneId>('zone');
  floor.zones = [coreZone, ...buildCirculationZones(mint)];

  if (isGround) {
    // Ground floor is amenity space: lobby + retail, no demised suites.
    const lobby = createZone('Main Lobby', 'amenity', HALF_NORTHWEST, null);
    lobby.id = mint<ZoneId>('zone');
    const retail = createZone('Retail & Café', 'amenity', HALF_SOUTHEAST, null);
    retail.id = mint<ZoneId>('zone');
    floor.zones.push(lobby, retail);
    floor.furniture = buildLobbyFurniture(mint);
    return floor;
  }

  // —— tenant suites ——
  const outlines = suiteOutlines(index);
  const ring = assignmentRing(tenants);
  outlines.forEach((outline, suiteIndex) => {
    const tenantId = ring[(index * 3 + suiteIndex) % ring.length]!;
    const suiteNumber = `${index + 1}${String(suiteIndex + 1).padStart(2, '0')}`;
    const zone = createZone(`Suite ${suiteNumber}`, 'tenant-suite', outline, tenantId);
    zone.id = mint<ZoneId>('zone');
    floor.zones.push(zone);
  });

  // —— furnished levels (2 and 3) get a full open-plan fit-out ——
  if (index === 1 || index === 2) {
    floor.walls.push(...buildFitOutWalls(mint));
    floor.furniture = buildOpenPlanFurniture(mint);
  }

  return floor;
}

/**
 * Build the demo project: "Meridian Tower", 12 stories, Class A.
 * Deterministic — repeated calls return structurally identical documents.
 */
export function createDemoProject(): ProjectDoc {
  const mint = createIdMinter();
  const tenants = createTenants();

  const floors: Floor[] = [];
  for (let index = 0; index < FLOOR_COUNT; index++) {
    floors.push(buildFloor(index, mint, tenants));
  }
  recomputeElevations(floors);

  const building: Building = {
    id: fixedId<BuildingId>('bldg', 'meridian'),
    name: 'Meridian Tower',
    address: '1200 Commerce Street, Houston, TX',
    buildingClass: 'A',
    floors,
  };

  const tenantMap: Record<TenantId, Tenant> = {};
  for (const tenant of tenants) tenantMap[tenant.id] = tenant;

  return {
    schemaVersion: 1,
    id: fixedId<ProjectId>('proj', 'demo-meridian'),
    name: 'Meridian Tower — Demo',
    createdAt: DEMO_CREATED_AT,
    updatedAt: DEMO_CREATED_AT,
    settings: {
      units: 'imperial',
      grid: { size: DEFAULTS.gridSize, snap: true, angleSnap: true },
    },
    meta: {
      ownerId: null,
      collaborators: [],
      export: {
        watermark: { enabled: true, text: 'Compass Studio — Demo' },
        allowGltf: true,
        allowJson: true,
      },
    },
    building,
    tenants: tenantMap,
  };
}
