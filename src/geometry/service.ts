import { useEffect, useState, useSyncExternalStore } from 'react';
import * as THREE from 'three';
import type { Manifold, ManifoldToplevel } from 'manifold-3d';
import type { Baseplate, Bin, Project } from '../model/types';
import { type BinGeomParams, type PlateGeomParams, buildBaseplate, buildBin } from './build';
import { loadKernel } from './kernel';
import { type MeshData, extractMesh } from './mesh';

export interface Built {
  key: string;
  data: MeshData;
  /** Flat-shaded triangles for display. */
  geometry: THREE.BufferGeometry;
  /** Feature edges (chamfers, corners) for the outline look. */
  edges: THREE.BufferGeometry;
}

const MAX_CACHE = 160;
const cache = new Map<string, Built>();
const pending = new Map<string, Promise<Built>>();
let chain: Promise<unknown> = Promise.resolve();

// --- busy indicator ----------------------------------------------------------
let busyCount = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function useGeometryBusy(): boolean {
  return useSyncExternalStore(subscribe, () => busyCount > 0);
}

// --- keys --------------------------------------------------------------------
export function binParams(p: Project, b: Bin): BinGeomParams {
  return { w: b.w, d: b.d, h: b.h, grid: p.grid, heightUnit: p.heightUnit, features: b.features };
}

export function plateParams(p: Project, pl: Baseplate): PlateGeomParams {
  return { w: pl.w, d: pl.d, grid: p.grid, padding: pl.padding, style: pl.style };
}

export function binKey(q: BinGeomParams): string {
  const f = q.features;
  return `bin|${q.w}|${q.d}|${q.h}|${q.grid}|${q.heightUnit}|${+f.lip}${+f.magnets}${+f.screws}${+f.label}${+f.scoop}|${f.divX}|${f.divY}|${f.wall}`;
}

export function plateKey(q: PlateGeomParams): string {
  const pd = q.padding;
  return `plate|${q.w}|${q.d}|${q.grid}|${q.style}|${pd.left}|${pd.right}|${pd.front}|${pd.back}`;
}

// --- building ----------------------------------------------------------------
function toThree(key: string, data: MeshData): Built {
  const indexed = new THREE.BufferGeometry();
  indexed.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  indexed.setIndex(new THREE.BufferAttribute(data.indices, 1));
  const edges = new THREE.EdgesGeometry(indexed, 28);
  const geometry = indexed.toNonIndexed();
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return { key, data, geometry, edges };
}

function evict() {
  while (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value as string;
    const old = cache.get(oldest);
    cache.delete(oldest);
    old?.geometry.dispose();
    old?.edges.dispose();
  }
}

// Yield to the event loop between builds. MessageChannel is used instead of
// setTimeout because timers are throttled to ~1 s in background tabs.
const yieldQueue: (() => void)[] = [];
const channel = new MessageChannel();
channel.port1.onmessage = () => yieldQueue.shift()?.();
const nextTick = () =>
  new Promise<void>((resolve) => {
    yieldQueue.push(resolve);
    channel.port2.postMessage(0);
  });

/** Builds (or returns cached) geometry. Builds run one at a time so the UI stays responsive. */
export function requestBuilt(key: string, make: (M: ManifoldToplevel) => Manifold): Promise<Built> {
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return Promise.resolve(hit);
  }
  const inflight = pending.get(key);
  if (inflight) return inflight;

  busyCount++;
  emit();
  const job = chain.then(async () => {
    const M = await loadKernel();
    await nextTick();
    const m = make(M);
    try {
      const built = toThree(key, extractMesh(m));
      cache.set(key, built);
      evict();
      return built;
    } finally {
      m.delete();
    }
  });
  chain = job.catch(() => undefined);
  pending.set(key, job);
  const done = () => {
    pending.delete(key);
    busyCount--;
    emit();
  };
  job.then(done, done);
  return job;
}

export function useBuilt(key: string, make: (M: ManifoldToplevel) => Manifold): Built | null {
  const [built, setBuilt] = useState<Built | null>(() => cache.get(key) ?? null);
  useEffect(() => {
    let alive = true;
    const hit = cache.get(key);
    if (hit) {
      setBuilt(hit);
      return;
    }
    requestBuilt(key, make).then(
      (b) => alive && setBuilt(b),
      (err) => console.error('Geometry build failed for', key, err),
    );
    return () => {
      alive = false;
    };
    // `make` is fully described by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return built;
}

export function useBinGeometry(p: Project, b: Bin): Built | null {
  const q = binParams(p, b);
  return useBuilt(binKey(q), (M) => buildBin(M, q));
}

export function usePlateGeometry(p: Project, pl: Baseplate): Built | null {
  const q = plateParams(p, pl);
  return useBuilt(plateKey(q), (M) => buildBaseplate(M, q));
}

export async function binMesh(p: Project, b: Bin): Promise<MeshData> {
  const q = binParams(p, b);
  return (await requestBuilt(binKey(q), (M) => buildBin(M, q))).data;
}

export async function plateMesh(p: Project, pl: Baseplate): Promise<MeshData> {
  const q = plateParams(p, pl);
  return (await requestBuilt(plateKey(q), (M) => buildBaseplate(M, q))).data;
}

/** Volume (mm³) if this geometry is already built, otherwise null. */
export function cachedVolume(key: string): number | null {
  return cache.get(key)?.data.volume ?? null;
}
