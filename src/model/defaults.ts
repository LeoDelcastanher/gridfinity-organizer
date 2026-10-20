import type { BinFeatures, Padding, Prefs, Printer, Project } from './types';

export const BIN_PALETTE = [
  '#f59e0b',
  '#38bdf8',
  '#34d399',
  '#f472b6',
  '#a78bfa',
  '#fb7185',
  '#facc15',
  '#2dd4bf',
  '#fb923c',
  '#60a5fa',
  '#a3e635',
  '#cbd5e1',
  '#e2e8f0',
  '#475569',
];

export const PLATE_COLOR = '#7c8a9a';

export const PRINTERS: Printer[] = [
  { name: 'Bambu Lab X1 / P1 / A1', bedX: 256, bedY: 256 },
  { name: 'Bambu Lab A1 mini', bedX: 180, bedY: 180 },
  { name: 'Prusa MK4 / MK3', bedX: 250, bedY: 210 },
  { name: 'Prusa Core One', bedX: 250, bedY: 220 },
  { name: 'Prusa MINI', bedX: 180, bedY: 180 },
  { name: 'Creality Ender 3 / K1', bedX: 220, bedY: 220 },
  { name: 'Voron 2.4 (350)', bedX: 350, bedY: 350 },
];

export const DEFAULT_FEATURES: BinFeatures = {
  lip: true,
  magnets: false,
  screws: false,
  divX: 1,
  divY: 1,
  label: false,
  scoop: false,
  wall: 1.2,
};

export const NO_PADDING: Padding = { left: 0, right: 0, front: 0, back: 0 };

export const DEFAULT_PREFS: Prefs = {
  units: 'mm',
  ortho: true,
  showLabels: true,
  showDrawer: true,
  showBins: true,
  showPlates: true,
  leftOpen: true,
  rightOpen: true,
};

export function uid(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  } catch {
    // fall through
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function emptyProject(name: string): Project {
  const now = Date.now();
  return {
    id: uid(),
    name,
    createdAt: now,
    updatedAt: now,
    drawer: { width: 300, depth: 300, height: 100 },
    grid: 42,
    heightUnit: 7,
    align: 'center',
    clearance: 1,
    printer: { ...PRINTERS[0] },
    baseplates: [],
    bins: [],
  };
}
