import { SPEC, plateFloor } from '../geometry/spec';
import { BIN_PALETTE, DEFAULT_FEATURES, NO_PADDING, PLATE_COLOR, PRINTERS, emptyProject, uid } from './defaults';
import type { Baseplate, BaseplateStyle, Bin, Issue, Padding, Project } from './types';

export interface GridInfo {
  /** Whole grid units that fit in the drawer (after clearance). */
  cols: number;
  rows: number;
  /** Drawer position (mm) of the front-left corner of grid cell (0, 0). */
  originX: number;
  originY: number;
  /** Space left over around the grid (mm), excluding clearance. */
  spareX: number;
  spareY: number;
  /** How that spare space is split between the sides. */
  pad: Padding;
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function gridInfo(p: Project): GridInfo {
  const g = p.grid;
  const usableX = Math.max(0, p.drawer.width - p.clearance);
  const usableY = Math.max(0, p.drawer.depth - p.clearance);
  const cols = Math.max(0, Math.floor(usableX / g + 1e-9));
  const rows = Math.max(0, Math.floor(usableY / g + 1e-9));
  const spareX = Math.max(0, usableX - cols * g);
  const spareY = Math.max(0, usableY - rows * g);
  const pad: Padding =
    p.align === 'center'
      ? { left: spareX / 2, right: spareX / 2, front: spareY / 2, back: spareY / 2 }
      : { left: 0, right: spareX, front: 0, back: spareY };
  return {
    cols,
    rows,
    originX: p.clearance / 2 + pad.left,
    originY: p.clearance / 2 + pad.front,
    spareX,
    spareY,
    pad,
  };
}

export function binRect(p: Project, info: GridInfo, b: Pick<Bin, 'x' | 'y' | 'w' | 'd'>): Rect {
  const g = p.grid;
  const half = SPEC.binClearance / 2;
  return {
    x0: info.originX + b.x * g + half,
    y0: info.originY + b.y * g + half,
    x1: info.originX + (b.x + b.w) * g - half,
    y1: info.originY + (b.y + b.d) * g - half,
  };
}

export function plateRect(p: Project, info: GridInfo, pl: Baseplate): Rect {
  const g = p.grid;
  return {
    x0: info.originX + pl.x * g - pl.padding.left,
    y0: info.originY + pl.y * g - pl.padding.front,
    x1: info.originX + (pl.x + pl.w) * g + pl.padding.right,
    y1: info.originY + (pl.y + pl.d) * g + pl.padding.back,
  };
}

export function plateSize(p: Project, pl: Baseplate): [number, number] {
  return [pl.w * p.grid + pl.padding.left + pl.padding.right, pl.d * p.grid + pl.padding.front + pl.padding.back];
}

function sizeFitsBed(p: Project, sx: number, sy: number): boolean {
  const { bedX, bedY } = p.printer;
  const eps = 1e-6;
  return (sx <= bedX + eps && sy <= bedY + eps) || (sx <= bedY + eps && sy <= bedX + eps);
}

export function fitsBed(p: Project, pl: Baseplate): boolean {
  const [sx, sy] = plateSize(p, pl);
  return sizeFitsBed(p, sx, sy);
}

export function binFitsBed(p: Project, b: Pick<Bin, 'w' | 'd'>): boolean {
  return sizeFitsBed(p, b.w * p.grid - SPEC.binClearance, b.d * p.grid - SPEC.binClearance);
}

const cellsOverlap = (a: { x: number; y: number; w: number; d: number }, b: { x: number; y: number; w: number; d: number }) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.d && b.y < a.y + a.d;

const rectsOverlap = (a: Rect, b: Rect, eps = 0.01) => a.x0 < b.x1 - eps && b.x0 < a.x1 - eps && a.y0 < b.y1 - eps && b.y0 < a.y1 - eps;

const insideDrawer = (p: Project, r: Rect, eps = 0.01) =>
  r.x0 >= -eps && r.y0 >= -eps && r.x1 <= p.drawer.width + eps && r.y1 <= p.drawer.depth + eps;

/** Thickest baseplate floor under any cell of the bin (0 when not on a plate). */
export function floorUnder(p: Project, b: Pick<Bin, 'x' | 'y' | 'w' | 'd'>): number {
  let floor = 0;
  for (const pl of p.baseplates) if (cellsOverlap(b, pl)) floor = Math.max(floor, plateFloor(pl.style));
  return floor;
}

// ---------------------------------------------------------------------------
// Stacking

type Footprint = { x: number; y: number; w: number; d: number };

export interface StackInfo {
  /** Height (mm) of the bin's bottom above the drawer floor. */
  base: number;
  /** Nominal top (base + h × height unit). A bin stacked on this one sits here, its feet in the lip. */
  top: number;
  /** Highest point of the bin, including its stacking lip. */
  rim: number;
  /** 0 = on the baseplate, 1 = on one bin, 2 = on two bins, … */
  level: number;
  /** Bins it rests on. */
  below: string[];
  /** Bins resting on it. */
  above: string[];
  /** Cells with nothing under them at the bin's bottom height (only for stacked bins). */
  gaps: number;
  /** Tops (mm) of the bins under it when they are not all the same height. */
  uneven: number[];
}

const cellKey = (x: number, y: number) => `${x},${y}`;

/**
 * Sets bins down layer by layer: each one rests on the highest thing already
 * under any of its cells (another bin's nominal top, or the baseplate floor).
 */
export function computeStacks(p: Project): Record<string, StackInfo> {
  const hu = p.heightUnit;
  const cellFloor = (x: number, y: number) => {
    let f = 0;
    for (const pl of p.baseplates) if (x >= pl.x && x < pl.x + pl.w && y >= pl.y && y < pl.y + pl.d) f = Math.max(f, plateFloor(pl.style));
    return f;
  };
  const order = p.bins.map((b, i) => ({ b, i })).sort((a, z) => a.b.layer - z.b.layer || a.i - z.i);
  const height = new Map<string, number>();
  const owner = new Map<string, string>();
  const out: Record<string, StackInfo> = {};

  let k = 0;
  while (k < order.length) {
    const layer = order[k].b.layer;
    const group: Bin[] = [];
    while (k < order.length && order[k].b.layer === layer) group.push(order[k++].b);
    const updates: [string, number, string][] = [];
    for (const b of group) {
      const under: { h: number; owner?: string }[] = [];
      for (let i = 0; i < b.w; i++) {
        for (let j = 0; j < b.d; j++) {
          const key = cellKey(b.x + i, b.y + j);
          const own = owner.get(key);
          under.push(own ? { h: height.get(key)!, owner: own } : { h: cellFloor(b.x + i, b.y + j) });
        }
      }
      const base = Math.max(...under.map((u) => u.h));
      const below = new Set<string>();
      const tops = new Set<number>();
      let gaps = 0;
      for (const u of under) {
        if (u.owner) {
          tops.add(Math.round(u.h * 100) / 100);
          if (Math.abs(u.h - base) < 0.01) below.add(u.owner);
        }
        if (u.h < base - 0.01) gaps++;
      }
      const top = base + b.h * hu;
      out[b.id] = {
        base,
        top,
        rim: top + (b.features.lip ? SPEC.lipHeight : 0),
        level: 0,
        below: [...below],
        above: [],
        gaps: below.size ? gaps : 0,
        uneven: below.size && tops.size > 1 ? [...tops].sort((a, z) => a - z) : [],
      };
      for (let i = 0; i < b.w; i++) for (let j = 0; j < b.d; j++) updates.push([cellKey(b.x + i, b.y + j), top, b.id]);
    }
    for (const [key, h, id] of updates) {
      if (!owner.has(key) || h >= height.get(key)!) {
        height.set(key, h);
        owner.set(key, id);
      }
    }
  }

  for (const { b } of order) {
    const s = out[b.id];
    s.level = s.below.length ? 1 + Math.max(...s.below.map((id) => out[id].level)) : 0;
    for (const id of s.below) out[id].above.push(b.id);
  }
  return out;
}

/** Layer that puts a bin with this footprint on top of everything already there. */
export function stackLayerFor(p: Project, f: Footprint, ignore: ReadonlySet<string> = new Set()): number {
  let layer = -1;
  for (const b of p.bins) if (!ignore.has(b.id) && cellsOverlap(f, b)) layer = Math.max(layer, b.layer);
  return layer + 1;
}

/** Height (mm) a new bin with this footprint would rest at if dropped on top of what is there. */
export function restingHeight(p: Project, f: Footprint): number {
  const stacks = computeStacks(p);
  let h = floorUnder(p, f);
  for (const b of p.bins) if (cellsOverlap(f, b)) h = Math.max(h, stacks[b.id].top);
  return h;
}

/** Bins standing on this one (within its footprint, higher in the stack): they move with it. */
export function carriedBy(p: Project, id: string): string[] {
  const b = p.bins.find((i) => i.id === id);
  if (!b) return [];
  return p.bins
    .filter((c) => c.id !== id && c.layer > b.layer && c.x >= b.x && c.y >= b.y && c.x + c.w <= b.x + b.w && c.y + c.d <= b.y + b.d)
    .map((c) => c.id);
}

/**
 * Moves a bin together with the bins standing on it, and drops the group on
 * top of whatever is at the new spot (or onto the baseplate if it is free).
 */
export function moveStack(p: Project, id: string, dx: number, dy: number, carried = carriedBy(p, id)): Project {
  const lead = p.bins.find((b) => b.id === id);
  if (!lead || (dx === 0 && dy === 0)) return p;
  const ids = new Set([id, ...carried]);
  const layer = stackLayerFor(p, { x: lead.x + dx, y: lead.y + dy, w: lead.w, d: lead.d }, ids);
  const shift = layer - lead.layer;
  return {
    ...p,
    bins: p.bins.map((b) => (ids.has(b.id) ? { ...b, x: b.x + dx, y: b.y + dy, layer: b.layer + shift } : b)),
  };
}

function uncoveredCells(p: Project, b: Bin): number {
  let missing = 0;
  for (let i = 0; i < b.w; i++) {
    for (let j = 0; j < b.d; j++) {
      const cx = b.x + i;
      const cy = b.y + j;
      const covered = p.baseplates.some((pl) => cx >= pl.x && cx < pl.x + pl.w && cy >= pl.y && cy < pl.y + pl.d);
      if (!covered) missing++;
    }
  }
  return missing;
}

export interface IssueMap {
  bins: Record<string, Issue[]>;
  plates: Record<string, Issue[]>;
  count: number;
}

export function computeIssues(p: Project): IssueMap {
  const info = gridInfo(p);
  const stacks = computeStacks(p);
  const byId = new Map(p.bins.map((b) => [b.id, b]));
  const bins: Record<string, Issue[]> = {};
  const plates: Record<string, Issue[]> = {};
  let count = 0;
  const fmt = (v: number) => `${Math.round(v * 10) / 10} mm`;

  for (const b of p.bins) {
    const list: Issue[] = [];
    const st = stacks[b.id];
    const stacked = st.below.length > 0;
    if (!insideDrawer(p, binRect(p, info, b))) list.push({ level: 'error', message: 'Sticks out of the drawer' });
    if (st.rim > p.drawer.height + 0.01) {
      list.push({
        level: 'error',
        message: stacked
          ? `Stack too tall: reaches ${fmt(st.rim)}, drawer has ${fmt(p.drawer.height)}`
          : `Too tall: needs ${fmt(st.rim)}, drawer has ${fmt(p.drawer.height)}`,
      });
    }
    for (const o of p.bins) {
      if (o.id !== b.id && o.layer === b.layer && cellsOverlap(b, o)) list.push({ level: 'error', message: `Overlaps ${o.name}` });
    }
    if (stacked) {
      for (const id of st.below) {
        const under = byId.get(id);
        if (under && !under.features.lip) list.push({ level: 'error', message: `Can't stack on ${under.name}: it has no stacking lip` });
      }
      if (st.uneven.length > 1) {
        list.push({
          level: 'warn',
          message: `Won't sit flat: the bins under it end at different heights (${st.uneven.map(fmt).join(', ')})`,
        });
      } else if (st.gaps) {
        list.push({ level: 'warn', message: `Hangs over the edge: ${st.gaps} of ${b.w * b.d} cells have nothing under them` });
      }
    } else if (p.baseplates.length) {
      const missing = uncoveredCells(p, b);
      if (missing) {
        list.push({ level: 'warn', message: `${missing} of ${b.w * b.d} cells not on a baseplate` });
      }
    }
    if (!binFitsBed(p, b)) {
      list.push({
        level: 'warn',
        message: `${fmt(b.w * p.grid - SPEC.binClearance)} × ${fmt(b.d * p.grid - SPEC.binClearance)} is larger than the ${p.printer.bedX} × ${p.printer.bedY} mm print bed`,
      });
    }
    if (list.length) {
      bins[b.id] = list;
      count += list.length;
    }
  }

  for (const pl of p.baseplates) {
    const list: Issue[] = [];
    const r = plateRect(p, info, pl);
    if (!insideDrawer(p, r)) list.push({ level: 'error', message: 'Does not fit inside the drawer' });
    for (const o of p.baseplates) {
      if (o.id !== pl.id && rectsOverlap(r, plateRect(p, info, o))) list.push({ level: 'error', message: `Overlaps ${o.name}` });
    }
    if (!fitsBed(p, pl)) {
      const [sx, sy] = plateSize(p, pl);
      list.push({
        level: 'warn',
        message: `${fmt(sx)} × ${fmt(sy)} is larger than the ${p.printer.bedX} × ${p.printer.bedY} mm print bed`,
      });
    }
    if (list.length) {
      plates[pl.id] = list;
      count += list.length;
    }
  }
  return { bins, plates, count };
}

/** First spot (scanning front-left to back-right) where a w x d bin fits without overlapping other bins. */
export function findFreeSpot(p: Project, w: number, d: number, ignoreId?: string): { x: number; y: number } | null {
  const info = gridInfo(p);
  for (let y = 0; y + d <= info.rows; y++) {
    for (let x = 0; x + w <= info.cols; x++) {
      const probe = { x, y, w, d };
      if (!p.bins.some((b) => b.id !== ignoreId && cellsOverlap(probe, b))) return { x, y };
    }
  }
  return null;
}

/** Spot for a new baseplate: first place inside the grid not overlapping other plates. */
export function findFreePlateSpot(p: Project, w: number, d: number): { x: number; y: number } | null {
  const info = gridInfo(p);
  for (let y = 0; y + d <= info.rows; y++) {
    for (let x = 0; x + w <= info.cols; x++) {
      const probe = { x, y, w, d };
      if (!p.baseplates.some((b) => cellsOverlap(probe, b))) return { x, y };
    }
  }
  return null;
}

/**
 * Rectangles that cover every empty grid cell, scanning front-left to
 * back-right and growing each one as wide, then as deep, as it can (up to
 * `max` cells per side and never larger than the print bed).
 */
export function emptyRects(p: Project, max: number): { x: number; y: number; w: number; d: number }[] {
  const info = gridInfo(p);
  const g = p.grid;
  const free = Array.from({ length: info.rows }, () => new Array<boolean>(info.cols).fill(true));
  for (const b of p.bins) {
    for (let i = 0; i < b.w; i++) {
      for (let j = 0; j < b.d; j++) {
        const x = b.x + i;
        const y = b.y + j;
        if (y >= 0 && y < info.rows && x >= 0 && x < info.cols) free[y][x] = false;
      }
    }
  }
  const capW = Math.max(1, Math.min(max, Math.floor((p.printer.bedX + SPEC.binClearance) / g)));
  const capD = Math.max(1, Math.min(max, Math.floor((p.printer.bedY + SPEC.binClearance) / g)));
  const rects: { x: number; y: number; w: number; d: number }[] = [];
  for (let y = 0; y < info.rows; y++) {
    for (let x = 0; x < info.cols; x++) {
      if (!free[y][x]) continue;
      let w = 1;
      while (w < capW && x + w < info.cols && free[y][x + w]) w++;
      let d = 1;
      while (d < capD && y + d < info.rows && free[y + d].slice(x, x + w).every(Boolean)) d++;
      for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) free[y + j][x + i] = false;
      rects.push({ x, y, w, d });
    }
  }
  return rects;
}

export function nextName(prefix: string, existing: { name: string }[]): string {
  const used = new Set(existing.map((e) => e.name));
  for (let i = 1; ; i++) {
    const name = `${prefix} ${i}`;
    if (!used.has(name)) return name;
  }
}

// ---------------------------------------------------------------------------
// Baseplate auto layout

export interface AutoLayoutOptions {
  style: BaseplateStyle;
  /** Fill the spare space around the grid with solid padding. */
  fill: boolean;
}

export interface AutoLayoutResult {
  plates: Baseplate[];
  splitX: number[];
  splitY: number[];
  info: GridInfo;
}

function balancedParts(n: number, k: number): number[] {
  const base = Math.floor(n / k);
  const extra = n % k;
  const parts = new Array(k).fill(base);
  const order = [...parts.keys()].sort((a, b) => Math.abs(a - (k - 1) / 2) - Math.abs(b - (k - 1) / 2) || a - b);
  for (let i = 0; i < extra; i++) parts[order[i]]++;
  return parts;
}

/** Fewest, evenly sized pieces so that every piece (with its padding) fits within `limit` mm. */
function splitAxis(n: number, g: number, padStart: number, padEnd: number, limit: number): number[] {
  if (n <= 0) return [];
  for (let k = 1; k <= n; k++) {
    const parts = balancedParts(n, k);
    const ok = parts.every((c, i) => c * g + (i === 0 ? padStart : 0) + (i === parts.length - 1 ? padEnd : 0) <= limit + 1e-6);
    if (ok) return parts;
  }
  return new Array(n).fill(1);
}

export function autoLayout(p: Project, opts: AutoLayoutOptions): AutoLayoutResult {
  const info = gridInfo(p);
  const g = p.grid;
  const pad = opts.fill ? info.pad : NO_PADDING;
  const { bedX, bedY } = p.printer;

  const tryLayout = (limitX: number, limitY: number) => ({
    x: splitAxis(info.cols, g, pad.left, pad.right, limitX),
    y: splitAxis(info.rows, g, pad.front, pad.back, limitY),
  });
  const a = tryLayout(bedX, bedY);
  const b = tryLayout(bedY, bedX);
  const pick = b.x.length * b.y.length < a.x.length * a.y.length ? b : a;

  const plates: Baseplate[] = [];
  let y = 0;
  pick.y.forEach((rows, j) => {
    let x = 0;
    pick.x.forEach((cols, i) => {
      plates.push({
        id: uid(),
        name: pick.x.length * pick.y.length === 1 ? 'Baseplate' : `Plate ${String.fromCharCode(65 + j)}${i + 1}`,
        x,
        y,
        w: cols,
        d: rows,
        padding: {
          left: i === 0 ? round2(pad.left) : 0,
          right: i === pick.x.length - 1 ? round2(pad.right) : 0,
          front: j === 0 ? round2(pad.front) : 0,
          back: j === pick.y.length - 1 ? round2(pad.back) : 0,
        },
        style: opts.style,
        color: PLATE_COLOR,
      });
      x += cols;
    });
    y += rows;
  });
  return { plates, splitX: pick.x, splitY: pick.y, info };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------------------
// Bill of materials

export interface BomRow<T> {
  key: string;
  label: string;
  detail: string;
  count: number;
  sample: T;
  /** Names of every item in this group. */
  names: string[];
}

export function binSignature(b: Bin): string {
  const f = b.features;
  return [b.w, b.d, b.h, +f.lip, +f.magnets, +f.screws, f.divX, f.divY, +f.label, +f.scoop, f.wall].join('|');
}

export function binDetail(b: Bin): string {
  const f = b.features;
  const parts: string[] = [];
  parts.push(f.lip ? 'stacking lip' : 'no lip');
  if (f.magnets) parts.push('magnets');
  if (f.screws) parts.push('screws');
  if (f.divX > 1 || f.divY > 1) parts.push(`${f.divX}×${f.divY} compartments`);
  if (f.label) parts.push('label');
  if (f.scoop) parts.push('scoop');
  if (f.wall !== DEFAULT_FEATURES.wall) parts.push(`${f.wall} mm walls`);
  return parts.join(', ');
}

export function plateSignature(pl: Baseplate): string {
  const p = pl.padding;
  return [pl.w, pl.d, pl.style, p.left, p.right, p.front, p.back].join('|');
}

export const STYLE_LABEL: Record<BaseplateStyle, string> = {
  thin: 'Thin (open bottom)',
  magnet: 'Magnet holes',
  solid: 'Solid bottom',
};

export function plateDetail(p: Project, pl: Baseplate): string {
  const [sx, sy] = plateSize(p, pl);
  const pads = pl.padding.left + pl.padding.right + pl.padding.front + pl.padding.back > 0;
  return `${STYLE_LABEL[pl.style]}, ${Math.round(sx * 10) / 10} × ${Math.round(sy * 10) / 10} mm${pads ? ' incl. padding' : ''}`;
}

export function billOfMaterials(p: Project): { bins: BomRow<Bin>[]; plates: BomRow<Baseplate>[] } {
  const bins = new Map<string, BomRow<Bin>>();
  for (const b of p.bins) {
    const key = binSignature(b);
    const row = bins.get(key);
    if (row) {
      row.count++;
      row.names.push(b.name);
    } else bins.set(key, { key, label: `${b.w}×${b.d}×${b.h} bin`, detail: binDetail(b), count: 1, sample: b, names: [b.name] });
  }
  const plates = new Map<string, BomRow<Baseplate>>();
  for (const pl of p.baseplates) {
    const key = plateSignature(pl);
    const row = plates.get(key);
    if (row) {
      row.count++;
      row.names.push(pl.name);
    } else plates.set(key, { key, label: `${pl.w}×${pl.d} baseplate`, detail: plateDetail(p, pl), count: 1, sample: pl, names: [pl.name] });
  }
  return { bins: [...bins.values()], plates: [...plates.values()] };
}

// ---------------------------------------------------------------------------
// Loading / sanitising projects (from storage or imported files)

const num = (v: unknown, fallback: number, lo = -Infinity, hi = Infinity) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
const int = (v: unknown, fallback: number, lo: number, hi: number) => Math.round(num(v, fallback, lo, hi));
const str = (v: unknown, fallback: string) => (typeof v === 'string' && v.trim() ? v : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

export function sanitizeProject(raw: unknown): Project {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const base = emptyProject(str(r.name, 'Imported drawer'));
  const drawer = r.drawer ?? {};
  const printer = r.printer ?? {};
  const project: Project = {
    ...base,
    id: str(r.id, base.id),
    createdAt: num(r.createdAt, base.createdAt),
    updatedAt: num(r.updatedAt, base.updatedAt),
    drawer: {
      width: num(drawer.width, base.drawer.width, 10, 5000),
      depth: num(drawer.depth, base.drawer.depth, 10, 5000),
      height: num(drawer.height, base.drawer.height, 5, 2000),
    },
    grid: num(r.grid, 42, 20, 100),
    heightUnit: num(r.heightUnit, 7, 5, 20),
    align: r.align === 'front-left' ? 'front-left' : 'center',
    clearance: num(r.clearance, 1, 0, 20),
    printer: {
      name: str(printer.name, PRINTERS[0].name),
      bedX: num(printer.bedX, PRINTERS[0].bedX, 50, 2000),
      bedY: num(printer.bedY, PRINTERS[0].bedY, 50, 2000),
    },
    baseplates: [],
    bins: [],
  };
  const plates = Array.isArray(r.baseplates) ? r.baseplates : [];
  project.baseplates = plates.map((pl: any, i: number) => ({
    id: str(pl?.id, uid()),
    name: str(pl?.name, `Plate ${i + 1}`),
    x: int(pl?.x, 0, -200, 200),
    y: int(pl?.y, 0, -200, 200),
    w: int(pl?.w, 1, 1, 40),
    d: int(pl?.d, 1, 1, 40),
    padding: {
      left: num(pl?.padding?.left, 0, 0, 100),
      right: num(pl?.padding?.right, 0, 0, 100),
      front: num(pl?.padding?.front, 0, 0, 100),
      back: num(pl?.padding?.back, 0, 0, 100),
    },
    style: (['thin', 'magnet', 'solid'] as const).includes(pl?.style) ? pl.style : 'thin',
    color: str(pl?.color, PLATE_COLOR),
  }));
  const bins = Array.isArray(r.bins) ? r.bins : [];
  project.bins = bins.map((b: any, i: number) => {
    const f = b?.features ?? {};
    return {
      id: str(b?.id, uid()),
      name: str(b?.name, `Bin ${i + 1}`),
      x: int(b?.x, 0, -200, 200),
      y: int(b?.y, 0, -200, 200),
      w: int(b?.w, 1, 1, 20),
      d: int(b?.d, 1, 1, 20),
      h: int(b?.h, 3, 1, 40),
      layer: int(b?.layer, 0, 0, 60),
      color: str(b?.color, BIN_PALETTE[i % BIN_PALETTE.length]),
      features: {
        lip: bool(f.lip, DEFAULT_FEATURES.lip),
        magnets: bool(f.magnets, DEFAULT_FEATURES.magnets),
        screws: bool(f.screws, DEFAULT_FEATURES.screws),
        divX: int(f.divX, 1, 1, 16),
        divY: int(f.divY, 1, 1, 16),
        label: bool(f.label, DEFAULT_FEATURES.label),
        scoop: bool(f.scoop, DEFAULT_FEATURES.scoop),
        wall: num(f.wall, DEFAULT_FEATURES.wall, 0.6, 3),
      },
    };
  });
  return project;
}

/** Starter project shown on first launch. */
export function sampleProject(): Project {
  const p = emptyProject('Kitchen drawer');
  p.baseplates = autoLayout(p, { style: 'thin', fill: true }).plates;
  const mk = (name: string, x: number, y: number, w: number, d: number, h: number, color: string, extra: Partial<Bin['features']> = {}): Bin => ({
    id: uid(),
    name,
    x,
    y,
    w,
    d,
    h,
    layer: 0,
    color,
    features: { ...DEFAULT_FEATURES, ...extra },
  });
  p.bins = [
    mk('Utensils', 0, 0, 2, 5, 6, BIN_PALETTE[0]),
    mk('Spices', 2, 0, 3, 2, 6, BIN_PALETTE[1], { divX: 3 }),
    mk('Small parts', 2, 2, 2, 2, 4, BIN_PALETTE[2], { divX: 2, divY: 2, label: true, scoop: true }),
    mk('Openers', 5, 0, 2, 3, 6, BIN_PALETTE[3], { label: true }),
  ];
  return p;
}
