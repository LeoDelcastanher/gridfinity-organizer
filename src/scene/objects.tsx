import { type ReactNode, memo, useMemo, useState } from 'react';
import * as THREE from 'three';
import { Html } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { binTotalHeight, maxBinUnits, plateHeight } from '../geometry/spec';
import { useBinGeometry, usePlateGeometry } from '../geometry/service';
import { type GridInfo, computeStacks, floorUnder, plateSize } from '../model/layout';
import { select, useStore } from '../model/store';
import type { Baseplate, Bin, Issue, LengthUnit, Project } from '../model/types';
import { fmtLen } from '../ui/format';
import { startItemDrag } from './interaction';

function boxEdges(sx: number, sy: number, sz: number) {
  const box = new THREE.BoxGeometry(sx, sy, sz);
  const edges = new THREE.EdgesGeometry(box);
  box.dispose();
  return edges;
}

function setCursor(cursor: string) {
  document.body.style.cursor = cursor;
}

function SelectionFrame({ size, center, color = '#ffffff' }: { size: [number, number, number]; center: [number, number, number]; color?: string }) {
  const geo = useMemo(() => boxEdges(size[0] + 2, size[1] + 2, size[2] + 1), [size[0], size[1], size[2]]);
  return (
    <lineSegments geometry={geo} position={center}>
      <lineBasicMaterial color={color} transparent opacity={0.9} depthTest={false} />
    </lineSegments>
  );
}

export function Tag({ position, children, className = '' }: { position: [number, number, number]; children: ReactNode; className?: string }) {
  return (
    <Html position={position} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
      <div className={`scene-tag ${className}`}>{children}</div>
    </Html>
  );
}

// ---------------------------------------------------------------------------

export function DrawerGuide({ project, info, units }: { project: Project; info: GridInfo; units: LengthUnit }) {
  const { width: W, depth: D, height: H } = project.drawer;
  const g = project.grid;

  const outline = useMemo(() => {
    const c = [
      [0, 0, 0],
      [W, 0, 0],
      [W, D, 0],
      [0, D, 0],
      [0, 0, H],
      [W, 0, H],
      [W, D, H],
      [0, D, H],
    ];
    const edges = [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 4],
      [0, 4],
      [1, 5],
      [2, 6],
      [3, 7],
    ];
    const v: number[] = [];
    for (const [a, b] of edges) v.push(...c[a], ...c[b]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    return geo;
  }, [W, D, H]);

  const cells = useMemo(() => {
    const v: number[] = [];
    const { cols, rows, originX: ox, originY: oy } = info;
    const z = 0.05;
    for (let i = 0; i <= cols; i++) v.push(ox + i * g, oy, z, ox + i * g, oy + rows * g, z);
    for (let j = 0; j <= rows; j++) v.push(ox, oy + j * g, z, ox + cols * g, oy + j * g, z);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    return geo;
  }, [info.cols, info.rows, info.originX, info.originY, g]);

  return (
    <group>
      <mesh position={[W / 2, D / 2, -0.3]}>
        <planeGeometry args={[W, D]} />
        <meshBasicMaterial color="#121c27" />
      </mesh>
      <lineSegments geometry={cells}>
        <lineBasicMaterial color="#2c4661" />
      </lineSegments>
      <lineSegments geometry={outline} onUpdate={(self) => self.computeLineDistances()}>
        <lineDashedMaterial color="#a9bdd2" dashSize={7} gapSize={5} transparent opacity={0.75} />
      </lineSegments>
      <Tag position={[W / 2, -16, 0]} className="dim">
        {fmtLen(W, units)}
      </Tag>
      <Tag position={[-16, D / 2, 0]} className="dim">
        {fmtLen(D, units)}
      </Tag>
      <Tag position={[-10, -10, H / 2]} className="dim">
        {fmtLen(H, units)}
      </Tag>
    </group>
  );
}

// ---------------------------------------------------------------------------

interface PlateProps {
  plate: Baseplate;
  project: Project;
  info: GridInfo;
  selected: boolean;
  issues?: Issue[];
}

export const PlateObject = memo(function PlateObject({ plate, project, info, selected, issues }: PlateProps) {
  const built = usePlateGeometry(project, plate);
  const [hovered, setHovered] = useState(false);
  const g = project.grid;
  const [sx, sy] = plateSize(project, plate);
  const H = plateHeight(plate.style);
  const center: [number, number, number] = [sx / 2 - plate.padding.left, sy / 2 - plate.padding.front, H / 2];
  const error = issues?.some((i) => i.level === 'error');
  const edge = selected ? '#e0f2fe' : error ? '#ff5d5d' : hovered ? '#cbd5e1' : '#1d2631';

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    // Baseplates cover the whole floor, so only drag one that is already selected;
    // otherwise left-drag keeps orbiting the view.
    if (selected) startItemDrag({ kind: 'plate', id: plate.id }, e);
  };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    // Only when this plate is the nearest thing under the pointer (not a bin on top of it).
    if (e.intersections[0]?.eventObject !== e.eventObject) return;
    if (e.delta > 4 || useStore.getState().tool !== 'select') return;
    e.stopPropagation();
    select({ kind: 'plate', id: plate.id });
  };

  return (
    <group position={[info.originX + plate.x * g, info.originY + plate.y * g, 0]}>
      {built ? (
        <>
          <mesh geometry={built.geometry}>
            <meshStandardMaterial
              color={plate.color}
              roughness={0.8}
              metalness={0.04}
              emissive={selected ? '#38bdf8' : '#000000'}
              emissiveIntensity={selected ? 0.22 : 0}
            />
          </mesh>
          <lineSegments geometry={built.edges}>
            <lineBasicMaterial color={edge} transparent opacity={selected || error ? 0.95 : 0.7} />
          </lineSegments>
        </>
      ) : (
        <mesh position={center}>
          <boxGeometry args={[sx, sy, H]} />
          <meshStandardMaterial color={plate.color} transparent opacity={0.35} />
        </mesh>
      )}
      <mesh
        visible={false}
        position={center}
        onPointerDown={onDown}
        onClick={onClick}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          if (selected && useStore.getState().tool === 'select') setCursor('grab');
        }}
        onPointerOut={() => {
          setHovered(false);
          setCursor('');
        }}
      >
        <boxGeometry args={[sx, sy, H]} />
      </mesh>
      {selected && <SelectionFrame size={[sx, sy, H]} center={center} color="#7dd3fc" />}
    </group>
  );
});

// ---------------------------------------------------------------------------

interface BinProps {
  bin: Bin;
  project: Project;
  info: GridInfo;
  /** Height (mm) of the bin's bottom: the baseplate floor, or the top of the bin it is stacked on. */
  floor: number;
  /** Stack level: 0 = on the baseplate. */
  level: number;
  selected: boolean;
  issues?: Issue[];
  showLabel: boolean;
}

export const BinObject = memo(function BinObject({ bin, project, info, floor, level, selected, issues, showLabel }: BinProps) {
  const built = useBinGeometry(project, bin);
  const [hovered, setHovered] = useState(false);
  const g = project.grid;
  const w = bin.w * g;
  const d = bin.d * g;
  const totalH = binTotalHeight(bin, project.heightUnit);
  const center: [number, number, number] = [w / 2, d / 2, totalH / 2];
  const error = issues?.some((i) => i.level === 'error');
  const warn = !!issues?.length;
  const edge = selected ? '#ffffff' : error ? '#ff4d4d' : hovered ? '#f1f5f9' : '#0d1117';

  return (
    <group position={[info.originX + bin.x * g, info.originY + bin.y * g, floor]}>
      {built ? (
        <>
          <mesh geometry={built.geometry}>
            <meshStandardMaterial
              color={bin.color}
              roughness={0.62}
              metalness={0.02}
              emissive={bin.color}
              emissiveIntensity={selected ? 0.28 : hovered ? 0.12 : 0}
            />
          </mesh>
          <lineSegments geometry={built.edges}>
            <lineBasicMaterial color={edge} transparent opacity={selected || error ? 0.95 : 0.55} />
          </lineSegments>
        </>
      ) : (
        <mesh position={center}>
          <boxGeometry args={[w - 0.5, d - 0.5, totalH]} />
          <meshStandardMaterial color={bin.color} transparent opacity={0.35} />
        </mesh>
      )}
      <mesh
        visible={false}
        position={center}
        onPointerDown={(e) => startItemDrag({ kind: 'bin', id: bin.id }, e)}
        onClick={(e) => e.stopPropagation()}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          if (useStore.getState().tool === 'select') setCursor('grab');
        }}
        onPointerOut={() => {
          setHovered(false);
          setCursor('');
        }}
      >
        <boxGeometry args={[w - 0.5, d - 0.5, totalH]} />
      </mesh>
      {selected && <SelectionFrame size={[w - 0.5, d - 0.5, totalH]} center={center} />}
      {showLabel && (
        <Tag position={[w / 2, d / 2, totalH + 4]} className={`bin ${error ? 'bad' : warn ? 'warn' : ''} ${selected ? 'sel' : ''}`}>
          <b>{bin.name}</b>
          <span>
            {bin.w}×{bin.d}×{bin.h}
            {level > 0 ? ` · level ${level + 1}` : ''}
            {warn ? ' ⚠' : ''}
          </span>
        </Tag>
      )}
    </group>
  );
});

// ---------------------------------------------------------------------------

export function DrawPreview({ project, info }: { project: Project; info: GridInfo }) {
  const rect = useStore((s) => s.drawRect);
  const tool = useStore((s) => s.tool);
  const hover = useStore((s) => s.hoverCell);
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), []);
  const stacks = useMemo(() => (tool === 'draw' ? computeStacks(project) : null), [project, tool]);
  if (tool !== 'draw' || !stacks) return null;
  const r = rect ?? (hover ? { x0: hover.x, y0: hover.y, x1: hover.x, y1: hover.y } : null);
  if (!r) return null;
  const g = project.grid;
  const x = Math.min(r.x0, r.x1);
  const y = Math.min(r.y0, r.y1);
  const w = Math.abs(r.x1 - r.x0) + 1;
  const d = Math.abs(r.y1 - r.y0) + 1;
  const foot = { x, y, w, d };
  const outside = x < 0 || y < 0 || x + w > info.cols || y + d > info.rows;
  // A bin drawn over other bins is stacked on top of them.
  const under = project.bins.filter((b) => x < b.x + b.w && b.x < x + w && y < b.y + b.d && b.y < y + d);
  const base = Math.max(floorUnder(project, foot), ...under.map((b) => stacks[b.id].top));
  const restOn = under.filter((b) => Math.abs(stacks[b.id].top - base) < 0.01);
  const noLip = restOn.some((b) => !b.features.lip);
  const color = outside || noLip ? '#f87171' : under.length ? '#5eead4' : '#fbbf24';
  const h = rect ? Math.max(1, Math.min(6, maxBinUnits(project, base, true) || 1)) * project.heightUnit : 1.5;
  const sx = w * g - 0.5;
  const sy = d * g - 0.5;
  return (
    <group position={[info.originX + x * g + (w * g) / 2, info.originY + y * g + (d * g) / 2, base + h / 2]}>
      <mesh scale={[sx, sy, h]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial color={color} transparent opacity={0.22} depthWrite={false} />
      </mesh>
      <lineSegments geometry={edges} scale={[sx, sy, h]}>
        <lineBasicMaterial color={color} />
      </lineSegments>
      {rect && (
        <Tag position={[0, 0, h / 2 + 6]} className="draw">
          {w} × {d}
          {outside ? ' · outside grid' : noLip ? ' · bin below has no lip' : under.length ? ' · stacks on top' : ''}
        </Tag>
      )}
    </group>
  );
}
