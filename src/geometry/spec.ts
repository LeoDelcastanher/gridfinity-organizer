import type { BaseplateStyle, Bin, Project } from '../model/types';

/**
 * Gridfinity dimensions (mm), from the open Gridfinity specification
 * (https://gridfinity.xyz/specification/). Profiles are listed bottom-up as
 * [z, inset], where inset is measured inwards from the outer edge of the shape.
 */
export const SPEC = {
  /** Bins are this much smaller than the grid in X and Y (0.25 mm per side). */
  binClearance: 0.5,
  /** Outer corner radius of a bin. */
  binRadius: 3.75,
  /** Height of a bin foot. */
  footHeight: 4.75,
  footProfile: [
    [0, 2.95],
    [0.8, 2.15],
    [2.6, 2.15],
    [4.75, 0],
  ] as [number, number][],
  /** Top of the solid floor inside a bin. */
  floorZ: 7,
  /** Stacking lip height above the bin's nominal height. */
  lipHeight: 4.4,
  /** Thickness of the solid band under the lip that keeps it printable. */
  lipSupport: 1.2,
  /** Height of the baseplate socket profile. */
  plateHeight: 4.65,
  plateRadius: 4,
  plateProfile: [
    [0, 2.85],
    [0.7, 2.15],
    [2.5, 2.15],
    [4.65, 0],
  ] as [number, number][],
  magnetDiameter: 6.5,
  magnetDepth: 2.4,
  screwDiameter: 3,
  screwDepth: 6,
  /** Distance from a cell edge to the centre of its magnet/screw holes. */
  holeInset: 8,
  dividerThickness: 1.2,
  /** Floor under the sockets of a magnet baseplate (holds the 2.4 mm magnets). */
  magnetPlateFloor: 3,
  /** Floor under the sockets of a solid-bottom baseplate. */
  solidPlateFloor: 1.4,
};

export const MAX_UNITS = 20;
export const MAX_HEIGHT_UNITS = 40;

export function plateFloor(style: BaseplateStyle): number {
  if (style === 'magnet') return SPEC.magnetPlateFloor;
  if (style === 'solid') return SPEC.solidPlateFloor;
  return 0;
}

export function plateHeight(style: BaseplateStyle): number {
  return plateFloor(style) + SPEC.plateHeight;
}

/** Height of a bin from its bottom to the top of its lip (if any). */
export function binTotalHeight(bin: Pick<Bin, 'h' | 'features'>, heightUnit: number): number {
  return bin.h * heightUnit + (bin.features.lip ? SPEC.lipHeight : 0);
}

/** Largest bin height (in units) that still fits the drawer, sitting on the given floor. */
export function maxBinUnits(project: Project, floor: number, lip = true): number {
  const room = project.drawer.height - floor - (lip ? SPEC.lipHeight : 0);
  return Math.max(0, Math.floor((room + 1e-6) / project.heightUnit));
}
