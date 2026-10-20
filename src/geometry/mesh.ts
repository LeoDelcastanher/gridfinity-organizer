import type { Manifold } from 'manifold-3d';

/** Plain triangle data extracted from a manifold (positions in mm, Z up). */
export interface MeshData {
  positions: Float32Array;
  indices: Uint32Array;
  volume: number;
  min: [number, number, number];
  max: [number, number, number];
}

export function extractMesh(m: Manifold): MeshData {
  const mesh = m.getMesh();
  const np = mesh.numProp;
  const vp = mesh.vertProperties;
  const count = vp.length / np;
  const positions = new Float32Array(count * 3);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 3; k++) {
      const v = vp[i * np + k];
      positions[i * 3 + k] = v;
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { positions, indices: new Uint32Array(mesh.triVerts), volume: m.volume(), min, max };
}

/** Binary STL. */
export function toSTL(data: MeshData, title: string): ArrayBuffer {
  const { positions: p, indices } = data;
  const triCount = indices.length / 3;
  const buffer = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(buffer);
  const header = `Gridfinity Planner - ${title}`.slice(0, 80);
  for (let i = 0; i < header.length; i++) view.setUint8(i, header.charCodeAt(i) & 0x7f);
  view.setUint32(80, triCount, true);
  let o = 84;
  for (let t = 0; t < triCount; t++) {
    const a = indices[t * 3] * 3;
    const b = indices[t * 3 + 1] * 3;
    const c = indices[t * 3 + 2] * 3;
    const ux = p[b] - p[a];
    const uy = p[b + 1] - p[a + 1];
    const uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a];
    const vy = p[c + 1] - p[a + 1];
    const vz = p[c + 2] - p[a + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    view.setFloat32(o, nx, true);
    view.setFloat32(o + 4, ny, true);
    view.setFloat32(o + 8, nz, true);
    o += 12;
    for (const idx of [a, b, c]) {
      view.setFloat32(o, p[idx], true);
      view.setFloat32(o + 4, p[idx + 1], true);
      view.setFloat32(o + 8, p[idx + 2], true);
      o += 12;
    }
    view.setUint16(o, 0, true);
    o += 2;
  }
  return buffer;
}
