import type { Manifold, ManifoldToplevel, Vec3 } from 'manifold-3d';
import type { BaseplateStyle, BinFeatures, Padding } from '../model/types';
import { SPEC, plateFloor } from './spec';

export interface BinGeomParams {
  w: number;
  d: number;
  h: number;
  grid: number;
  heightUnit: number;
  features: BinFeatures;
}

export interface PlateGeomParams {
  w: number;
  d: number;
  grid: number;
  padding: Padding;
  style: BaseplateStyle;
}

/** A horizontal slice of a lofted rounded rectangle. */
interface Layer {
  z: number;
  inset: number;
}

const CORNER_SEGMENTS = 8;
const HOLE_SEGMENTS = 32;

type Deletable = { delete(): void };

/** Tracks WASM objects so intermediates can be freed in one go. */
class Scope {
  private items: Deletable[] = [];
  keep<T extends Deletable>(item: T): T {
    this.items.push(item);
    return item;
  }
  free(except?: Deletable) {
    for (const item of this.items) if (item !== except) item.delete();
    this.items = [];
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function ringPoints(cx: number, cy: number, hx: number, hy: number, r: number): [number, number][] {
  const pts: [number, number][] = [];
  const ox = hx - r;
  const oy = hy - r;
  const corners: [number, number, number][] = [
    [ox, oy, 0],
    [-ox, oy, 90],
    [-ox, -oy, 180],
    [ox, -oy, 270],
  ];
  for (const [px, py, a0] of corners) {
    for (let i = 0; i <= CORNER_SEGMENTS; i++) {
      const a = ((a0 + (90 * i) / CORNER_SEGMENTS) * Math.PI) / 180;
      pts.push([cx + px + r * Math.cos(a), cy + py + r * Math.sin(a)]);
    }
  }
  return pts;
}

/**
 * Builds a solid by stacking rounded rectangles that share corner centres, so
 * every 45 degree chamfer of the Gridfinity profiles comes out exact. Each
 * layer shrinks the outline (and its corner radius) by `inset`.
 */
function loft(M: ManifoldToplevel, cx: number, cy: number, hx: number, hy: number, radius: number, layers: Layer[]): Manifold {
  const clean: Layer[] = [];
  for (const layer of layers) {
    const prev = clean[clean.length - 1];
    if (prev && Math.abs(prev.z - layer.z) < 1e-6 && Math.abs(prev.inset - layer.inset) < 1e-6) continue;
    clean.push(layer);
  }
  const rings = clean.map((l) => ({
    z: l.z,
    pts: ringPoints(cx, cy, hx - l.inset, hy - l.inset, Math.max(radius - l.inset, 0.05)),
  }));
  const n = rings[0].pts.length;
  const count = rings.length;
  const vert = new Float32Array(n * count * 3);
  rings.forEach((ring, k) => {
    ring.pts.forEach(([x, y], i) => {
      const o = (k * n + i) * 3;
      vert[o] = x;
      vert[o + 1] = y;
      vert[o + 2] = ring.z;
    });
  });
  const tri: number[] = [];
  for (let i = 1; i < n - 1; i++) tri.push(0, i + 1, i);
  const top = (count - 1) * n;
  for (let i = 1; i < n - 1; i++) tri.push(top, top + i, top + i + 1);
  for (let k = 0; k < count - 1; k++) {
    const a = k * n;
    const b = (k + 1) * n;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      tri.push(a + i, a + j, b + j, a + i, b + j, b + i);
    }
  }
  const mesh = new M.Mesh({ numProp: 3, vertProperties: vert, triVerts: new Uint32Array(tri) });
  return new M.Manifold(mesh);
}

/** Inset of a piecewise-linear profile at height z (constant beyond its ends). */
function insetAt(profile: Layer[], z: number): number {
  if (z <= profile[0].z) return profile[0].inset;
  for (let i = 0; i < profile.length - 1; i++) {
    const a = profile[i];
    const b = profile[i + 1];
    if (z <= b.z) {
      const t = b.z - a.z < 1e-9 ? 1 : (z - a.z) / (b.z - a.z);
      return a.inset + (b.inset - a.inset) * t;
    }
  }
  return profile[profile.length - 1].inset;
}

/** The part of a profile from `fromZ` upwards. */
function sliceProfile(profile: Layer[], fromZ: number): Layer[] {
  const out: Layer[] = [{ z: fromZ, inset: insetAt(profile, fromZ) }];
  for (const p of profile) if (p.z > fromZ + 1e-6) out.push(p);
  return out;
}

function cylinderAt(M: ManifoldToplevel, x: number, y: number, z: number, height: number, diameter: number, segments: number) {
  const r = diameter / 2;
  return M.Manifold.cylinder(height, r, r, segments).translate([x, y, z]);
}

/**
 * A Gridfinity bin. Origin is the front-left corner of its grid footprint, so
 * the outer walls span [0.25, w * grid - 0.25].
 */
export function buildBin(M: ManifoldToplevel, p: BinGeomParams): Manifold {
  const { Manifold } = M;
  const s = new Scope();
  const g = p.grid;
  const f = p.features;
  const w = Math.max(1, Math.round(p.w));
  const d = Math.max(1, Math.round(p.d));
  const h = Math.max(1, Math.round(p.h));
  const R = SPEC.binRadius;
  const half = SPEC.binClearance / 2;
  const hx = (w * g - SPEC.binClearance) / 2;
  const hy = (d * g - SPEC.binClearance) / 2;
  const cx = (w * g) / 2;
  const cy = (d * g) / 2;
  const topZ = h * p.heightUnit;
  const rimZ = topZ + (f.lip ? SPEC.lipHeight : 0);
  const floorZ = Math.min(SPEC.floorZ, topZ);
  const wall = clamp(f.wall, 0.6, f.lip ? 2.4 : 3);

  // Feet: one per cell, each overlapping slightly into the body above.
  const footLayers: Layer[] = SPEC.footProfile.map(([z, inset]) => ({ z, inset }));
  footLayers.push({ z: SPEC.footHeight + 0.5, inset: 0 });
  const footHalf = (g - SPEC.binClearance) / 2;
  const parts: Manifold[] = [];
  for (let i = 0; i < w; i++) {
    for (let j = 0; j < d; j++) {
      parts.push(s.keep(loft(M, i * g + g / 2, j * g + g / 2, footHalf, footHalf, R, footLayers)));
    }
  }
  parts.push(
    s.keep(
      loft(M, cx, cy, hx, hy, R, [
        { z: SPEC.footHeight, inset: 0 },
        { z: rimZ, inset: 0 },
      ]),
    ),
  );
  const solid = s.keep(Manifold.union(parts));

  // Hollow interior. With a stacking lip the inside follows the lip profile.
  const profile: Layer[] = f.lip
    ? [
        { z: topZ - SPEC.lipSupport - (2.6 - wall), inset: wall },
        { z: topZ - SPEC.lipSupport, inset: 2.6 },
        { z: topZ, inset: 2.6 },
        { z: topZ + 0.7, inset: 1.9 },
        { z: topZ + 2.5, inset: 1.9 },
        { z: topZ + 4.0, inset: 0.4 },
        { z: rimZ + 1, inset: 0.4 },
      ]
    : [
        { z: floorZ, inset: wall },
        { z: rimZ + 1, inset: wall },
      ];
  const cavityLayers = sliceProfile(profile, floorZ);
  const cavity = s.keep(loft(M, cx, cy, hx, hy, R, cavityLayers));
  let bin = s.keep(solid.subtract(cavity));

  // Interior features (dividers, scoops, label shelves), clipped to the cavity.
  const adds: Manifold[] = [];
  const T = SPEC.dividerThickness;
  const x0 = half + wall;
  const x1 = w * g - half - wall;
  const y0 = half + wall;
  const y1 = d * g - half - wall;
  const featureTop = f.lip ? topZ - 0.8 : topZ;
  const divX = clamp(Math.round(f.divX), 1, 16);
  const divY = clamp(Math.round(f.divY), 1, 16);
  const innerH = featureTop - floorZ;

  if (innerH > 1) {
    for (let k = 1; k < divX; k++) {
      const xk = x0 + ((x1 - x0) * k) / divX;
      adds.push(s.keep(Manifold.cube([T, y1 - y0 + 2, innerH + 0.3]).translate([xk - T / 2, y0 - 1, floorZ - 0.3])));
    }
    for (let k = 1; k < divY; k++) {
      const yk = y0 + ((y1 - y0) * k) / divY;
      adds.push(s.keep(Manifold.cube([x1 - x0 + 2, T, innerH + 0.3]).translate([x0 - 1, yk - T / 2, floorZ - 0.3])));
    }

    for (let r = 0; r < divY; r++) {
      const ra = r === 0 ? y0 : y0 + ((y1 - y0) * r) / divY + T / 2;
      const rb = r === divY - 1 ? y1 : y0 + ((y1 - y0) * (r + 1)) / divY - T / 2;
      const depth = rb - ra;

      if (f.scoop) {
        const rs = Math.min(depth * 0.45, innerH * 0.75, 15);
        if (rs >= 2) {
          const block = s.keep(Manifold.cube([x1 - x0 + 2, rs + 0.3, rs + 0.3]).translate([x0 - 1, ra - 0.3, floorZ - 0.3]));
          const round = s.keep(
            Manifold.cylinder(x1 - x0 + 4, rs, rs, 48)
              .rotate([0, 90, 0])
              .translate([x0 - 2, ra + rs, floorZ + rs]),
          );
          adds.push(s.keep(block.subtract(round)));
        }
      }

      if (f.label) {
        const L = Math.min(12, depth * 0.45, innerH - 1.5);
        if (L >= 3) {
          const back = rb + 0.3;
          const zt = featureTop;
          const shape: [number, number][] = [
            [back, zt],
            [rb - L, zt],
            [rb - L, zt - 1],
            [back, zt - 1 - (L + 0.3)],
          ];
          const pts: Vec3[] = [];
          for (const xx of [x0 - 1, x1 + 1]) for (const [yy, zz] of shape) pts.push([xx, yy, zz]);
          adds.push(s.keep(Manifold.hull(pts)));
        }
      }
    }
  }

  if (adds.length) {
    const clipLayers = cavityLayers.map((l, i) => ({
      z: i === 0 ? l.z - 0.3 : l.z,
      inset: Math.max(l.inset - 0.25, 0.15),
    }));
    const clip = s.keep(loft(M, cx, cy, hx, hy, R, clipLayers));
    const inner = s.keep(s.keep(Manifold.union(adds)).intersect(clip));
    bin = s.keep(bin.add(inner));
  }

  // Magnet / screw holes under each cell.
  if (f.magnets || f.screws) {
    const holes: Manifold[] = [];
    const o = g / 2 - SPEC.holeInset;
    for (let i = 0; i < w; i++) {
      for (let j = 0; j < d; j++) {
        for (const [sx, sy] of [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ]) {
          const px = i * g + g / 2 + sx * o;
          const py = j * g + g / 2 + sy * o;
          if (f.magnets) holes.push(s.keep(cylinderAt(M, px, py, -0.1, SPEC.magnetDepth + 0.1, SPEC.magnetDiameter, HOLE_SEGMENTS)));
          if (f.screws) holes.push(s.keep(cylinderAt(M, px, py, -0.1, SPEC.screwDepth + 0.1, SPEC.screwDiameter, 20)));
        }
      }
    }
    bin = s.keep(bin.subtract(s.keep(Manifold.union(holes))));
  }

  s.free(bin);
  return bin;
}

/**
 * A Gridfinity baseplate. Origin is the front-left corner of its first cell;
 * padding extends past the cells into negative coordinates / beyond the grid.
 */
export function buildBaseplate(M: ManifoldToplevel, p: PlateGeomParams): Manifold {
  const { Manifold } = M;
  const s = new Scope();
  const g = p.grid;
  const w = Math.max(1, Math.round(p.w));
  const d = Math.max(1, Math.round(p.d));
  const pad = p.padding;
  const floor = plateFloor(p.style);
  const H = floor + SPEC.plateHeight;
  const R = SPEC.plateRadius;
  const minX = -pad.left;
  const maxX = w * g + pad.right;
  const minY = -pad.front;
  const maxY = d * g + pad.back;

  const outer = s.keep(
    loft(M, (minX + maxX) / 2, (minY + maxY) / 2, (maxX - minX) / 2, (maxY - minY) / 2, R, [
      { z: 0, inset: 0 },
      { z: H, inset: 0 },
    ]),
  );

  const socket: Layer[] = [];
  if (floor === 0) socket.push({ z: -1, inset: SPEC.plateProfile[0][1] });
  for (const [z, inset] of SPEC.plateProfile) socket.push({ z: floor + z, inset });
  socket.push({ z: H + 1, inset: 0 });

  const cutters: Manifold[] = [];
  const o = g / 2 - SPEC.holeInset;
  for (let i = 0; i < w; i++) {
    for (let j = 0; j < d; j++) {
      const ccx = i * g + g / 2;
      const ccy = j * g + g / 2;
      cutters.push(s.keep(loft(M, ccx, ccy, g / 2, g / 2, R, socket)));
      if (p.style === 'magnet') {
        for (const [sx, sy] of [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ]) {
          cutters.push(
            s.keep(cylinderAt(M, ccx + sx * o, ccy + sy * o, floor - SPEC.magnetDepth, SPEC.magnetDepth + 0.1, SPEC.magnetDiameter, HOLE_SEGMENTS)),
          );
        }
      }
    }
  }
  const plate = outer.subtract(s.keep(Manifold.union(cutters)));
  s.free();
  return plate;
}
