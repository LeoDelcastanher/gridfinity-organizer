export type BaseplateStyle = 'thin' | 'magnet' | 'solid';

export interface BinFeatures {
  /** Stacking lip on top so other bins can stack on this one. */
  lip: boolean;
  /** 6.5 x 2.4 mm magnet pockets under each cell. */
  magnets: boolean;
  /** M3 screw holes under each cell. */
  screws: boolean;
  /** Compartments along X (1 = no dividers). */
  divX: number;
  /** Compartments along Y (1 = no dividers). */
  divY: number;
  /** Label shelf along the back of each compartment row. */
  label: boolean;
  /** Rounded scoop at the front of each compartment row. */
  scoop: boolean;
  /** Wall thickness in mm. */
  wall: number;
}

export interface Bin {
  id: string;
  name: string;
  /** Position in grid cells, relative to the drawer grid origin (front-left cell = 0,0). */
  x: number;
  y: number;
  /** Footprint in grid units. */
  w: number;
  d: number;
  /** Height in height units (7 mm by default). */
  h: number;
  /**
   * Stacking order. Bins are set down from the lowest layer up, and each one
   * rests on whatever is already under its cells, so a higher layer over
   * another bin sits on top of it. 0 = on the baseplate.
   */
  layer: number;
  color: string;
  features: BinFeatures;
}

export interface Padding {
  left: number;
  right: number;
  front: number;
  back: number;
}

export interface Baseplate {
  id: string;
  name: string;
  x: number;
  y: number;
  /** Size in grid cells. */
  w: number;
  d: number;
  /** Solid fill (mm) added around the cells, used to fill the drawer's spare space. */
  padding: Padding;
  style: BaseplateStyle;
  color: string;
}

export interface Drawer {
  /** Inner width (X) in mm. */
  width: number;
  /** Inner depth (Y) in mm. */
  depth: number;
  /** Usable inner height (Z) in mm. */
  height: number;
}

export interface Printer {
  name: string;
  bedX: number;
  bedY: number;
}

export type GridAlign = 'center' | 'front-left';

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  drawer: Drawer;
  /** Grid unit in mm (Gridfinity standard: 42). */
  grid: number;
  /** Height unit in mm (Gridfinity standard: 7). */
  heightUnit: number;
  /** Where the grid sits inside the drawer when there is spare space. */
  align: GridAlign;
  /** Total play (mm) left between the baseplates and the drawer walls, per axis. */
  clearance: number;
  printer: Printer;
  baseplates: Baseplate[];
  bins: Bin[];
}

export type ItemKind = 'bin' | 'plate';

export interface Selection {
  kind: ItemKind;
  id: string;
}

export type LengthUnit = 'mm' | 'in';

export type ViewPreset = 'iso' | 'top' | 'front' | 'side';

export interface Prefs {
  units: LengthUnit;
  ortho: boolean;
  showLabels: boolean;
  showDrawer: boolean;
  showBins: boolean;
  showPlates: boolean;
  leftOpen: boolean;
  rightOpen: boolean;
}

export interface Issue {
  level: 'warn' | 'error';
  message: string;
}
