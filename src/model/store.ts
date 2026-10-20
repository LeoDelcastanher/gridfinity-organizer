import { create } from 'zustand';
import { maxBinUnits } from '../geometry/spec';
import { BIN_PALETTE, DEFAULT_FEATURES, DEFAULT_PREFS, NO_PADDING, PLATE_COLOR, emptyProject, uid } from './defaults';
import {
  type AutoLayoutOptions,
  autoLayout,
  emptyRects,
  findFreePlateSpot,
  findFreeSpot,
  floorUnder,
  gridInfo,
  moveStack,
  nextName,
  restingHeight,
  sampleProject,
  sanitizeProject,
  stackLayerFor,
} from './layout';
import type { Baseplate, Bin, BinFeatures, Prefs, Project, Selection, ViewPreset } from './types';

const KEY_PROJECTS = 'gridfinity-planner/projects/v1';
const KEY_CURRENT = 'gridfinity-planner/current/v1';
const KEY_PREFS = 'gridfinity-planner/prefs/v1';
const HISTORY_LIMIT = 200;

export type Dialog =
  | { type: 'autolayout' }
  | { type: 'shortcuts' }
  | { type: 'about' }
  | { type: 'projects' }
  | { type: 'prompt'; title: string; label: string; value: string; confirm: string; onSubmit: (value: string) => void }
  | { type: 'confirm'; title: string; message: string; confirm: string; danger?: boolean; onConfirm: () => void };

export type Tool = 'select' | 'draw';

export interface DrawRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface State {
  library: Record<string, Project>;
  project: Project;
  selection: Selection | null;
  past: Project[];
  future: Project[];
  lastKey: string | null;
  lastAt: number;
  dragOrigin: Project | null;
  tool: Tool;
  prefs: Prefs;
  dialog: Dialog | null;
  toast: { id: number; text: string; tone: 'info' | 'error' } | null;
  view: { preset: ViewPreset; n: number };
  drawRect: DrawRect | null;
  hoverCell: { x: number; y: number } | null;
  busy: string | null;
}

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.warn('Could not save to localStorage', err);
    return false;
  }
}

function initialState(): State {
  const stored = readJSON<Record<string, unknown>>(KEY_PROJECTS, {});
  const library: Record<string, Project> = {};
  for (const raw of Object.values(stored ?? {})) {
    try {
      const p = sanitizeProject(raw);
      library[p.id] = p;
    } catch {
      // skip unreadable entries
    }
  }
  let currentId = readJSON<string | null>(KEY_CURRENT, null);
  if (!currentId || !library[currentId]) {
    currentId = Object.values(library).sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id ?? null;
  }
  if (!currentId) {
    const p = sampleProject();
    library[p.id] = p;
    currentId = p.id;
  }
  return {
    library,
    project: library[currentId],
    selection: null,
    past: [],
    future: [],
    lastKey: null,
    lastAt: 0,
    dragOrigin: null,
    tool: 'select',
    prefs: { ...DEFAULT_PREFS, ...readJSON<Partial<Prefs>>(KEY_PREFS, {}) },
    dialog: null,
    toast: null,
    view: { preset: 'iso', n: 0 },
    drawRect: null,
    hoverCell: null,
    busy: null,
  };
}

export const useStore = create<State>()(() => initialState());

const get = useStore.getState;
const set = useStore.setState;

// ---------------------------------------------------------------------------
// Persistence

let saveTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Storage is updated one project at a time (read, change one entry, write),
 * so a second open tab never wipes drawers it doesn't know about.
 */
function storeProject(p: Project) {
  const stored = readJSON<Record<string, unknown>>(KEY_PROJECTS, {}) ?? {};
  stored[p.id] = p;
  writeJSON(KEY_PROJECTS, stored);
}

function unstoreProject(id: string) {
  const stored = readJSON<Record<string, unknown>>(KEY_PROJECTS, {}) ?? {};
  delete stored[id];
  writeJSON(KEY_PROJECTS, stored);
}

export function saveNow() {
  clearTimeout(saveTimer);
  const s = get();
  storeProject(s.project);
  writeJSON(KEY_CURRENT, s.project.id);
  if (s.library[s.project.id] !== s.project) set({ library: { ...s.library, [s.project.id]: s.project } });
}

/** Re-reads the saved drawers (e.g. ones created in another tab), keeping the open one as is. */
export function refreshLibrary() {
  const s = get();
  const stored = readJSON<Record<string, unknown>>(KEY_PROJECTS, {}) ?? {};
  const library: Record<string, Project> = {};
  for (const raw of Object.values(stored)) {
    try {
      const p = sanitizeProject(raw);
      library[p.id] = p;
    } catch {
      // skip unreadable entries
    }
  }
  library[s.project.id] = s.project;
  set({ library });
}

useStore.subscribe((s, prev) => {
  if (s.project !== prev.project) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 400);
  }
  if (s.prefs !== prev.prefs) writeJSON(KEY_PREFS, s.prefs);
});

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', saveNow);
  window.addEventListener('storage', (e) => {
    if (e.key === KEY_PROJECTS) refreshLibrary();
  });
}

// ---------------------------------------------------------------------------
// History

function validSelection(p: Project, sel: Selection | null): Selection | null {
  if (!sel) return null;
  const list = sel.kind === 'bin' ? p.bins : p.baseplates;
  return list.some((i) => i.id === sel.id) ? sel : null;
}

/**
 * Applies a change to the current project and records it for undo. Changes
 * that share a `key` within a short time (typing, nudging) become one step.
 */
export function commit(fn: (p: Project) => Project, key?: string) {
  const s = get();
  const next = { ...fn(s.project), updatedAt: Date.now() };
  const now = Date.now();
  const coalesce = key != null && key === s.lastKey && now - s.lastAt < 1500;
  set({
    project: next,
    past: coalesce ? s.past : [...s.past, s.project].slice(-HISTORY_LIMIT),
    future: [],
    lastKey: key ?? null,
    lastAt: now,
    selection: validSelection(next, s.selection),
  });
}

export function undo() {
  const s = get();
  if (!s.past.length) return;
  const prev = s.past[s.past.length - 1];
  set({
    project: prev,
    past: s.past.slice(0, -1),
    future: [s.project, ...s.future].slice(0, HISTORY_LIMIT),
    lastKey: null,
    selection: validSelection(prev, s.selection),
  });
}

export function redo() {
  const s = get();
  if (!s.future.length) return;
  const next = s.future[0];
  set({
    project: next,
    past: [...s.past, s.project].slice(-HISTORY_LIMIT),
    future: s.future.slice(1),
    lastKey: null,
    selection: validSelection(next, s.selection),
  });
}

export function beginDrag() {
  set({ dragOrigin: get().project });
}

export function dragUpdate(fn: (p: Project) => Project) {
  set({ project: fn(get().project) });
}

export function endDrag() {
  const s = get();
  if (!s.dragOrigin) return;
  if (s.dragOrigin === s.project) {
    set({ dragOrigin: null });
    return;
  }
  set({
    past: [...s.past, s.dragOrigin].slice(-HISTORY_LIMIT),
    future: [],
    dragOrigin: null,
    lastKey: null,
    project: { ...s.project, updatedAt: Date.now() },
  });
}

// ---------------------------------------------------------------------------
// UI state

export function select(selection: Selection | null) {
  set({ selection });
}

export function setTool(tool: State['tool']) {
  set({ tool, drawRect: null });
}

export function setPrefs(patch: Partial<Prefs>) {
  set({ prefs: { ...get().prefs, ...patch } });
}

export function openDialog(dialog: Dialog) {
  set({ dialog });
}

export function closeDialog() {
  set({ dialog: null });
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function notify(text: string, tone: 'info' | 'error' = 'info') {
  clearTimeout(toastTimer);
  const id = Date.now();
  set({ toast: { id, text, tone } });
  toastTimer = setTimeout(() => {
    if (get().toast?.id === id) set({ toast: null });
  }, tone === 'error' ? 6000 : 3200);
}

export function requestView(preset: ViewPreset) {
  set({ view: { preset, n: get().view.n + 1 } });
}

export function setHoverCell(cell: { x: number; y: number } | null) {
  const cur = get().hoverCell;
  if (cur === cell || (cur && cell && cur.x === cell.x && cur.y === cell.y)) return;
  set({ hoverCell: cell });
}

export function setDrawRect(rect: DrawRect | null) {
  set({ drawRect: rect });
}

export function setBusy(busy: string | null) {
  set({ busy });
}

// ---------------------------------------------------------------------------
// Project-level edits

export function updateProject(patch: Partial<Project>, key?: string) {
  commit((p) => ({ ...p, ...patch }), key);
}

export function applyAutoLayout(opts: AutoLayoutOptions) {
  const result = autoLayout(get().project, opts);
  commit((p) => ({ ...p, baseplates: result.plates }));
  set({ selection: null });
  return result;
}

// ---------------------------------------------------------------------------
// Bins

/**
 * Adds a bin. With an explicit position (the draw tool) it is set down on top
 * of whatever is already there; otherwise it goes to the first free spot.
 */
export function addBin(partial: Partial<Omit<Bin, 'features'>> & { features?: Partial<BinFeatures> } = {}) {
  const p = get().project;
  const w = partial.w ?? 1;
  const d = partial.d ?? 1;
  let pos = partial.x != null && partial.y != null ? { x: partial.x, y: partial.y } : findFreeSpot(p, w, d);
  if (!pos) pos = { x: gridInfo(p).cols + 1, y: 0 };
  const foot = { ...pos, w, d };
  const fit = maxBinUnits(p, restingHeight(p, foot), true);
  const bin: Bin = {
    id: uid(),
    name: partial.name ?? nextName('Bin', p.bins),
    x: pos.x,
    y: pos.y,
    w,
    d,
    h: partial.h ?? Math.max(1, Math.min(6, fit || 1)),
    layer: stackLayerFor(p, foot),
    color: partial.color ?? BIN_PALETTE[p.bins.length % BIN_PALETTE.length],
    features: { ...DEFAULT_FEATURES, ...partial.features },
  };
  commit((pr) => ({ ...pr, bins: [...pr.bins, bin] }));
  set({ selection: { kind: 'bin', id: bin.id } });
  return bin;
}

export function updateBin(id: string, patch: Partial<Bin>, key?: string) {
  commit((p) => ({ ...p, bins: p.bins.map((b) => (b.id === id ? { ...b, ...patch } : b)) }), key);
}

/** Moves a bin (and whatever is stacked on it) to a cell, stacking it on top of anything there. */
export function moveBinTo(id: string, x: number, y: number, key?: string) {
  const bin = get().project.bins.find((b) => b.id === id);
  if (!bin) return;
  commit((p) => moveStack(p, id, x - bin.x, y - bin.y), key);
}

/** Puts a copy of the bin on top of its stack. */
export function stackCopyOnTop(id?: string) {
  const s = get();
  const binId = id ?? (s.selection?.kind === 'bin' ? s.selection.id : null);
  const src = s.project.bins.find((b) => b.id === binId);
  if (!src) return null;
  const copy: Bin = {
    ...src,
    id: uid(),
    name: `${src.name} copy`,
    layer: stackLayerFor(s.project, src),
    features: { ...src.features },
  };
  commit((p) => ({ ...p, bins: [...p.bins, copy] }));
  set({ selection: { kind: 'bin', id: copy.id } });
  return copy;
}

export function updateBinFeatures(id: string, patch: Partial<BinFeatures>, key?: string) {
  commit((p) => ({ ...p, bins: p.bins.map((b) => (b.id === id ? { ...b, features: { ...b.features, ...patch } } : b)) }), key);
}

/** Adds bins over every empty grid cell. Returns how many were added. */
export function fillEmptyCells(maxSize: number): number {
  const p = get().project;
  const rects = emptyRects(p, maxSize);
  if (!rects.length) return 0;
  const fit = Math.max(1, Math.min(6, maxBinUnits(p, 0, true) || 1));
  const added: Bin[] = [];
  let names = [...p.bins];
  rects.forEach((r, i) => {
    const bin: Bin = {
      id: uid(),
      name: nextName('Bin', names),
      ...r,
      h: Math.max(1, Math.min(fit, maxBinUnits(p, floorUnder(p, r), true) || 1)),
      layer: 0,
      color: BIN_PALETTE[(p.bins.length + i) % BIN_PALETTE.length],
      features: { ...DEFAULT_FEATURES },
    };
    names = [...names, bin];
    added.push(bin);
  });
  commit((pr) => ({ ...pr, bins: [...pr.bins, ...added] }));
  set({ selection: null });
  return added.length;
}

export function applyFeaturesToAll(source: Bin) {
  commit((p) => ({ ...p, bins: p.bins.map((b) => ({ ...b, features: { ...source.features, divX: b.features.divX, divY: b.features.divY } })) }));
}

// ---------------------------------------------------------------------------
// Baseplates

export function addBaseplate(partial: Partial<Baseplate> = {}) {
  const p = get().project;
  const info = gridInfo(p);
  const w = partial.w ?? Math.max(1, Math.min(3, info.cols || 1));
  const d = partial.d ?? Math.max(1, Math.min(3, info.rows || 1));
  // No room left: put it beside the drawer, where it is visible (and flagged).
  const pos = findFreePlateSpot(p, w, d) ?? { x: info.cols + 1, y: 0 };
  const plate: Baseplate = {
    id: uid(),
    name: partial.name ?? nextName('Plate', p.baseplates),
    x: partial.x ?? pos.x,
    y: partial.y ?? pos.y,
    w,
    d,
    padding: partial.padding ?? { ...NO_PADDING },
    style: partial.style ?? p.baseplates[0]?.style ?? 'thin',
    color: partial.color ?? PLATE_COLOR,
  };
  commit((pr) => ({ ...pr, baseplates: [...pr.baseplates, plate] }));
  set({ selection: { kind: 'plate', id: plate.id } });
  return plate;
}

export function updatePlate(id: string, patch: Partial<Baseplate>, key?: string) {
  commit((p) => ({ ...p, baseplates: p.baseplates.map((b) => (b.id === id ? { ...b, ...patch } : b)) }), key);
}

// ---------------------------------------------------------------------------
// Selection actions

export function deleteSelected() {
  const sel = get().selection;
  if (!sel) return;
  if (sel.kind === 'bin') commit((p) => ({ ...p, bins: p.bins.filter((b) => b.id !== sel.id) }));
  else commit((p) => ({ ...p, baseplates: p.baseplates.filter((b) => b.id !== sel.id) }));
  set({ selection: null });
}

export function deleteItem(kind: Selection['kind'], id: string) {
  if (kind === 'bin') commit((p) => ({ ...p, bins: p.bins.filter((b) => b.id !== id) }));
  else commit((p) => ({ ...p, baseplates: p.baseplates.filter((b) => b.id !== id) }));
}

export function duplicateSelected() {
  const { selection: sel, project: p } = get();
  if (!sel) return;
  if (sel.kind === 'bin') {
    const src = p.bins.find((b) => b.id === sel.id);
    if (!src) return;
    const spot = findFreeSpot(p, src.w, src.d) ?? { x: gridInfo(p).cols + 1, y: 0 };
    const copy: Bin = { ...src, id: uid(), name: `${src.name} copy`, ...spot, layer: 0, features: { ...src.features } };
    commit((pr) => ({ ...pr, bins: [...pr.bins, copy] }));
    set({ selection: { kind: 'bin', id: copy.id } });
  } else {
    const src = p.baseplates.find((b) => b.id === sel.id);
    if (!src) return;
    const spot = findFreePlateSpot(p, src.w, src.d) ?? { x: src.x + 1, y: src.y + 1 };
    const copy: Baseplate = { ...src, id: uid(), name: `${src.name} copy`, ...spot, padding: { ...src.padding } };
    commit((pr) => ({ ...pr, baseplates: [...pr.baseplates, copy] }));
    set({ selection: { kind: 'plate', id: copy.id } });
  }
}

export function rotateSelected() {
  const sel = get().selection;
  if (!sel) return;
  if (sel.kind === 'bin') {
    commit((p) => ({
      ...p,
      bins: p.bins.map((b) =>
        b.id === sel.id ? { ...b, w: b.d, d: b.w, features: { ...b.features, divX: b.features.divY, divY: b.features.divX } } : b,
      ),
    }));
  } else {
    commit((p) => ({
      ...p,
      baseplates: p.baseplates.map((b) =>
        b.id === sel.id
          ? { ...b, w: b.d, d: b.w, padding: { left: b.padding.front, right: b.padding.back, front: b.padding.left, back: b.padding.right } }
          : b,
      ),
    }));
  }
}

export function nudgeSelected(dx: number, dy: number) {
  const sel = get().selection;
  if (!sel) return;
  if (sel.kind === 'bin') {
    commit((p) => moveStack(p, sel.id, dx, dy), `nudge:${sel.id}`);
    return;
  }
  commit(
    (p) => ({ ...p, baseplates: p.baseplates.map((i) => (i.id === sel.id ? { ...i, x: i.x + dx, y: i.y + dy } : i)) }),
    `nudge:${sel.id}`,
  );
}

export function changeSelectedHeight(delta: number) {
  const sel = get().selection;
  if (!sel || sel.kind !== 'bin') return;
  commit(
    (p) => ({ ...p, bins: p.bins.map((b) => (b.id === sel.id ? { ...b, h: Math.max(1, Math.min(40, b.h + delta)) } : b)) }),
    `height:${sel.id}`,
  );
}

export function clearBins() {
  commit((p) => ({ ...p, bins: [] }));
  set({ selection: null });
}

export function clearPlates() {
  commit((p) => ({ ...p, baseplates: [] }));
  set({ selection: null });
}

// ---------------------------------------------------------------------------
// Projects

function openLoaded(project: Project) {
  set({
    project,
    library: { ...get().library, [project.id]: project },
    selection: null,
    past: [],
    future: [],
    lastKey: null,
    dragOrigin: null,
    drawRect: null,
    tool: 'select',
  });
  saveNow();
  requestView('iso');
}

export function newProject(name: string) {
  saveNow();
  openLoaded(emptyProject(name.trim() || 'New drawer'));
}

export function openProject(id: string) {
  const s = get();
  if (id === s.project.id) return;
  saveNow();
  const p = get().library[id];
  if (p) openLoaded(p);
}

export function renameProject(id: string, name: string) {
  const clean = name.trim();
  if (!clean) return;
  const s = get();
  if (id === s.project.id) {
    commit((p) => ({ ...p, name: clean }));
    saveNow();
  } else if (s.library[id]) {
    const renamed = { ...s.library[id], name: clean, updatedAt: Date.now() };
    set({ library: { ...s.library, [id]: renamed } });
    storeProject(renamed);
  }
}

export function duplicateProject(id: string) {
  saveNow();
  const src = get().library[id];
  if (!src) return;
  const copy: Project = {
    ...structuredClone(src),
    id: uid(),
    name: `${src.name} copy`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  openLoaded(copy);
}

export function deleteProject(id: string) {
  clearTimeout(saveTimer);
  const s = get();
  const library = { ...s.library };
  delete library[id];
  unstoreProject(id);
  if (id === s.project.id) {
    const next = Object.values(library).sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? emptyProject('New drawer');
    library[next.id] = next;
    set({ library, project: next, selection: null, past: [], future: [], lastKey: null, dragOrigin: null });
    saveNow();
    requestView('iso');
  } else {
    set({ library });
  }
}

export function importProject(raw: unknown) {
  const p = sanitizeProject(raw);
  if (get().library[p.id]) {
    p.id = uid();
    p.name = `${p.name} (imported)`;
  }
  saveNow();
  openLoaded(p);
  return p;
}
