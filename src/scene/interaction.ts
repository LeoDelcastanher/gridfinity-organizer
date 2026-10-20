import * as THREE from 'three';
import type { RootState, ThreeEvent } from '@react-three/fiber';
import { carriedBy, gridInfo, moveStack } from '../model/layout';
import { addBin, beginDrag, dragUpdate, endDrag, select, setDrawRect, setHoverCell, useStore } from '../model/store';
import type { Project, Selection } from '../model/types';

/**
 * The planner works in drawer coordinates (mm, Z up, origin at the drawer's
 * front-left corner). The three.js world is Y up, so planner (x, y, z) shows
 * up at world (x, z, -y).
 */

let getThree: (() => RootState) | null = null;

export function bindThree(get: () => RootState) {
  getThree = get;
}

/** Current three.js root state (used by the dev-only debug hook). */
export function threeState(): RootState | null {
  return getThree?.() ?? null;
}

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const hit = new THREE.Vector3();
const up = new THREE.Vector3(0, 1, 0);

/** Where the pointer ray crosses the horizontal plane at planner height `z`. */
export function pointerToPlanner(clientX: number, clientY: number, z = 0): { x: number; y: number } | null {
  if (!getThree) return null;
  const { camera, gl } = getThree();
  const rect = gl.domElement.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const plane = new THREE.Plane(up, -z);
  if (!raycaster.ray.intersectPlane(plane, hit)) return null;
  return { x: hit.x, y: -hit.z };
}

function setControlsEnabled(on: boolean) {
  const controls = getThree?.().controls as unknown as { enabled: boolean } | null;
  if (controls) controls.enabled = on;
}

function cellAt(p: Project, pt: { x: number; y: number }) {
  const info = gridInfo(p);
  return { x: Math.floor((pt.x - info.originX) / p.grid), y: Math.floor((pt.y - info.originY) / p.grid) };
}

function findItem(p: Project, sel: Selection) {
  return sel.kind === 'bin' ? p.bins.find((b) => b.id === sel.id) : p.baseplates.find((b) => b.id === sel.id);
}

function moveItem(p: Project, sel: Selection, x: number, y: number): Project {
  if (sel.kind === 'bin') return { ...p, bins: p.bins.map((b) => (b.id === sel.id ? { ...b, x, y } : b)) };
  return { ...p, baseplates: p.baseplates.map((b) => (b.id === sel.id ? { ...b, x, y } : b)) };
}

function trackPointer(onMove: (ev: PointerEvent) => void, onEnd: () => void) {
  const up = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    onEnd();
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

/** Pointer-down on a bin or baseplate: select it and drag it across the grid. */
export function startItemDrag(sel: Selection, e: ThreeEvent<PointerEvent>) {
  const state = useStore.getState();
  if (state.tool !== 'select' || e.button !== 0) return;
  e.stopPropagation();
  select(sel);
  const item = findItem(state.project, sel);
  if (!item) return;

  const z = e.point.y;
  const start = pointerToPlanner(e.clientX, e.clientY, z);
  if (!start) return;
  const origin = state.project;
  const g = origin.grid;
  const sx = item.x;
  const sy = item.y;
  // A bin carries whatever is stacked on it, and lands on top of whatever is at the drop spot.
  const carried = sel.kind === 'bin' ? carriedBy(origin, sel.id) : [];

  setControlsEnabled(false);
  beginDrag();
  trackPointer(
    (ev) => {
      const cur = pointerToPlanner(ev.clientX, ev.clientY, z);
      if (!cur) return;
      const nx = sx + Math.round((cur.x - start.x) / g);
      const ny = sy + Math.round((cur.y - start.y) / g);
      const now = findItem(useStore.getState().project, sel);
      if (!now || (now.x === nx && now.y === ny)) return;
      if (sel.kind === 'bin') dragUpdate(() => moveStack(origin, sel.id, nx - sx, ny - sy, carried));
      else dragUpdate((p) => moveItem(p, sel, nx, ny));
      document.body.classList.add('grabbing');
    },
    () => {
      endDrag();
      setControlsEnabled(true);
      document.body.classList.remove('grabbing');
    },
  );
}

/** Pointer-down on the viewport while the draw tool is active: rubber-band a new bin. */
export function startDrawBin(ev: { clientX: number; clientY: number }) {
  const p = useStore.getState().project;
  const start = pointerToPlanner(ev.clientX, ev.clientY, 0);
  if (!start) return;
  const c0 = cellAt(p, start);
  setDrawRect({ x0: c0.x, y0: c0.y, x1: c0.x, y1: c0.y });
  trackPointer(
    (e) => {
      const pt = pointerToPlanner(e.clientX, e.clientY, 0);
      if (!pt) return;
      const c = cellAt(p, pt);
      const cur = useStore.getState().drawRect;
      if (cur && cur.x1 === c.x && cur.y1 === c.y) return;
      setDrawRect({ x0: c0.x, y0: c0.y, x1: c.x, y1: c.y });
    },
    () => {
      const r = useStore.getState().drawRect;
      setDrawRect(null);
      if (!r) return;
      const x = Math.min(r.x0, r.x1);
      const y = Math.min(r.y0, r.y1);
      const w = Math.abs(r.x1 - r.x0) + 1;
      const d = Math.abs(r.y1 - r.y0) + 1;
      if (w > 20 || d > 20) return;
      addBin({ x, y, w, d });
    },
  );
}

export function trackHover(ev: { clientX: number; clientY: number }) {
  const p = useStore.getState().project;
  const pt = pointerToPlanner(ev.clientX, ev.clientY, 0);
  setHoverCell(pt ? cellAt(p, pt) : null);
}
