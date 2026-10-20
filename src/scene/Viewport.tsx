import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, type RootState, useThree } from '@react-three/fiber';
import { GizmoHelper, GizmoViewcube, Grid, OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei';
import { useShallow } from 'zustand/react/shallow';
import { computeIssues, computeStacks, gridInfo } from '../model/layout';
import { requestView, select, setHoverCell, useStore } from '../model/store';
import type { ViewPreset } from '../model/types';
import { ViewportOverlay } from '../ui/ViewportOverlay';
import { bindThree, startDrawBin, trackHover } from './interaction';
import { BinObject, DrawPreview, DrawerGuide, PlateObject } from './objects';

const VIEW_DIRS: Record<ViewPreset, [number, number, number]> = {
  iso: [0.85, 1.05, 1.35],
  top: [0, 1, 0.0005],
  front: [0, 0.3, 1],
  side: [1, 0.3, 0],
};

interface OrbitLike {
  target: THREE.Vector3;
  update: () => void;
}

function fitView(get: () => RootState, preset: ViewPreset) {
  const { camera, size, controls, invalidate } = get();
  const { width: W, depth: D, height: H } = useStore.getState().project.drawer;
  const target = new THREE.Vector3(W / 2, preset === 'top' ? 0 : Math.min(H, 150) * 0.3, -D / 2);
  const dir = new THREE.Vector3(...VIEW_DIRS[preset]).normalize();
  const radius = 0.5 * Math.sqrt(W * W + D * D + H * H);
  const aspect = size.width / Math.max(1, size.height);

  if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
    const cam = camera as THREE.OrthographicCamera;
    cam.zoom =
      preset === 'top'
        ? Math.min(size.width / (W * 1.18), size.height / (D * 1.18))
        : Math.min(size.width, size.height) / (2 * radius * 1.12);
    cam.position.copy(target).addScaledVector(dir, radius * 4 + 1500);
    cam.updateProjectionMatrix();
  } else {
    const cam = camera as THREE.PerspectiveCamera;
    const vfov = THREE.MathUtils.degToRad(cam.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    let dist: number;
    if (preset === 'top') {
      dist = Math.max(W / 2 / Math.tan(hfov / 2), D / 2 / Math.tan(vfov / 2)) * 1.15 + H;
    } else {
      dist = (radius / Math.sin(Math.min(vfov, hfov) / 2)) * 1.0;
    }
    cam.position.copy(target).addScaledVector(dir, dist);
    cam.updateProjectionMatrix();
  }
  const orbit = controls as unknown as OrbitLike | null;
  if (orbit?.target) {
    orbit.target.copy(target);
    orbit.update();
  } else {
    camera.lookAt(target);
  }
  invalidate();
}

function CameraRig() {
  const ortho = useStore((s) => s.prefs.ortho);
  const view = useStore((s) => s.view);
  const drawer = useStore((s) => s.project.drawer);
  const get = useThree((s) => s.get);
  const mounted = useRef(false);

  useEffect(() => {
    // Wait two frames so a freshly swapped camera and its controls are mounted.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => fitView(get, view.preset));
    });
    return () => cancelAnimationFrame(frame);
  }, [view.n, view.preset, ortho, get]);

  // Re-frame the drawer shortly after its size is edited.
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const timer = setTimeout(() => requestView(useStore.getState().view.preset), 700);
    return () => clearTimeout(timer);
  }, [drawer.width, drawer.depth, drawer.height]);

  return (
    <>
      {ortho ? (
        <OrthographicCamera makeDefault near={0.1} far={200000} position={[900, 900, 900]} zoom={1} />
      ) : (
        <PerspectiveCamera makeDefault fov={32} near={5} far={200000} position={[900, 900, 900]} />
      )}
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.14}
        rotateSpeed={0.85}
        screenSpacePanning
        minDistance={30}
        maxDistance={30000}
        minZoom={0.02}
        maxZoom={60}
        mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN }}
      />
    </>
  );
}

function Bridge() {
  const get = useThree((s) => s.get);
  useEffect(() => bindThree(get), [get]);
  return null;
}

function Scene() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const prefs = useStore(
    useShallow((s) => ({
      units: s.prefs.units,
      showDrawer: s.prefs.showDrawer,
      showBins: s.prefs.showBins,
      showPlates: s.prefs.showPlates,
      showLabels: s.prefs.showLabels,
    })),
  );
  const info = useMemo(() => gridInfo(project), [project.drawer, project.grid, project.clearance, project.align]);
  const issues = useMemo(() => computeIssues(project), [project]);
  const stacks = useMemo(() => computeStacks(project), [project]);
  const { width: W, depth: D } = project.drawer;

  return (
    <>
      <color attach="background" args={['#0b1016']} />
      <Bridge />
      <CameraRig />
      <ambientLight intensity={0.45} />
      <hemisphereLight args={['#e8f0ff', '#1a2230', 0.75]} />
      <directionalLight position={[W * 0.6 + 300, 900, 700]} intensity={1.55} />
      <directionalLight position={[-600, 420, -D - 400]} intensity={0.5} />
      <Grid
        position={[0, -0.6, 0]}
        infiniteGrid
        cellSize={10}
        sectionSize={100}
        cellThickness={0.6}
        sectionThickness={1.1}
        cellColor="#15202c"
        sectionColor="#203247"
        fadeDistance={6000}
        fadeStrength={1.6}
      />
      <group rotation-x={-Math.PI / 2}>
        {prefs.showDrawer && <DrawerGuide project={project} info={info} units={prefs.units} />}
        {prefs.showPlates &&
          project.baseplates.map((pl) => (
            <PlateObject
              key={pl.id}
              plate={pl}
              project={project}
              info={info}
              selected={selection?.kind === 'plate' && selection.id === pl.id}
              issues={issues.plates[pl.id]}
            />
          ))}
        {prefs.showBins &&
          project.bins.map((b) => (
            <BinObject
              key={b.id}
              bin={b}
              project={project}
              info={info}
              floor={stacks[b.id]?.base ?? 0}
              level={stacks[b.id]?.level ?? 0}
              selected={selection?.kind === 'bin' && selection.id === b.id}
              issues={issues.bins[b.id]}
              showLabel={prefs.showLabels}
            />
          ))}
        <DrawPreview project={project} info={info} />
      </group>
      <GizmoHelper alignment="bottom-right" margin={[76, 76]}>
        <GizmoViewcube color="#1e2732" textColor="#dbe4ee" strokeColor="#3a4757" hoverColor="#f59e0b" opacity={0.95} />
      </GizmoHelper>
    </>
  );
}

export function Viewport() {
  const tool = useStore((s) => s.tool);
  return (
    <div
      className={`viewport tool-${tool}`}
      onPointerDownCapture={(e) => {
        if (useStore.getState().tool !== 'draw' || e.button !== 0) return;
        if ((e.target as HTMLElement).tagName !== 'CANVAS') return;
        e.stopPropagation();
        e.preventDefault();
        startDrawBin(e);
      }}
      onPointerMove={(e) => {
        if ((e.target as HTMLElement).tagName === 'CANVAS') trackHover(e);
      }}
      onPointerLeave={() => setHoverCell(null)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Canvas
        frameloop="demand"
        dpr={[1, 2]}
        gl={{ antialias: true }}
        onPointerMissed={(e) => {
          if (e.button === 0 && useStore.getState().tool === 'select') select(null);
        }}
      >
        <Scene />
      </Canvas>
      <ViewportOverlay />
    </div>
  );
}
