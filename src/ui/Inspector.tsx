import { type ReactNode, useMemo } from 'react';
import { Copy, Download, FileArchive, Layers, RotateCw, Trash2, TriangleAlert } from 'lucide-react';
import { MAX_HEIGHT_UNITS, MAX_UNITS, SPEC, binTotalHeight, maxBinUnits, plateHeight } from '../geometry/spec';
import { binKey, binParams, cachedVolume, plateKey, plateParams, useBinGeometry, useGeometryBusy, usePlateGeometry } from '../geometry/service';
import { PLA_DENSITY } from '../io/files';
import { BIN_PALETTE, NO_PADDING } from '../model/defaults';
import { STYLE_LABEL, type StackInfo, billOfMaterials, computeIssues, computeStacks, fitsBed, gridInfo, plateSize } from '../model/layout';
import {
  applyFeaturesToAll,
  deleteSelected,
  duplicateSelected,
  moveBinTo,
  rotateSelected,
  select,
  stackCopyOnTop,
  updateBin,
  updateBinFeatures,
  updatePlate,
  useStore,
} from '../model/store';
import type { Baseplate, Bin, Issue, LengthUnit, Project } from '../model/types';
import { exportAll, exportItem } from './commands';
import { IconButton, LengthInput, NumberInput, Row, Section, Segmented, Stepper, TextInput, Toggle } from './fields';
import { fmtLen, fmtSize, round } from './format';

function IssueList({ issues }: { issues?: Issue[] }) {
  if (!issues?.length) return null;
  return (
    <ul className="issue-list">
      {issues.map((i, n) => (
        <li key={n} className={i.level}>
          <TriangleAlert size={13} />
          <span>{i.message}</span>
        </li>
      ))}
    </ul>
  );
}

function Stats({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="stats">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

const grams = (mm3: number) => Math.round((mm3 / 1000) * PLA_DENSITY);

function ItemActions({ onExport, children }: { onExport: () => void; children?: ReactNode }) {
  return (
    <div className="insp-actions">
      <IconButton title="Rotate 90° (R)" onClick={rotateSelected}>
        <RotateCw size={15} />
      </IconButton>
      <IconButton title="Duplicate (Ctrl+D)" onClick={duplicateSelected}>
        <Copy size={15} />
      </IconButton>
      {children}
      <IconButton title="Delete (Del)" onClick={deleteSelected} className="danger">
        <Trash2 size={15} />
      </IconButton>
      <div className="spacer" />
      <button type="button" className="btn primary" onClick={onExport}>
        <Download size={14} /> Download STL
      </button>
    </div>
  );
}

function StackSection({ bin, project, stacks, units }: { bin: Bin; project: Project; stacks: Record<string, StackInfo>; units: LengthUnit }) {
  const st = stacks[bin.id];
  const byId = new Map(project.bins.map((b) => [b.id, b]));
  const names = (ids: string[]) => ids.map((id) => byId.get(id)?.name ?? '?').join(', ');
  const H = project.drawer.height;
  const headroom = H - st.rim;

  // A copy goes on top of everything standing on this bin's cells.
  const column = project.bins.filter((b) => b.x < bin.x + bin.w && bin.x < b.x + b.w && b.y < bin.y + bin.d && bin.y < b.y + b.d);
  const topBin = column.reduce((a, b) => (stacks[b.id].top > stacks[a.id].top ? b : a), bin);
  const room = Math.floor((H - stacks[topBin.id].top - SPEC.lipHeight + 1e-6) / project.heightUnit);
  const canStack = topBin.features.lip;

  let hint: string;
  if (!canStack) hint = `${topBin.id === bin.id ? 'This bin' : topBin.name} has no stacking lip, so nothing can sit on it.`;
  else if (room >= bin.h) hint = `A ${bin.h}u copy fits on top (room for ${room}u more).`;
  else if (room > 0) hint = `Only ${room}u of room left above, so a ${bin.h}u copy would be too tall.`;
  else hint = 'No room left above this stack.';

  return (
    <Section title="Stacking" storageKey="bin-stack">
      <Stats
        rows={[
          ['Level', st.level === 0 ? '1 · on the baseplate' : `${st.level + 1} · on ${names(st.below)}`],
          ['Bottom at', fmtLen(st.base, units)],
          ['Top at', bin.features.lip ? `${fmtLen(st.top, units)} · lip ${fmtLen(st.rim, units)}` : fmtLen(st.top, units)],
          [
            'Headroom',
            headroom >= -0.01 ? (
              `${fmtLen(Math.max(0, headroom), units)} to the drawer top`
            ) : (
              <span className="bad">{fmtLen(-headroom, units)} too tall</span>
            ),
          ],
        ]}
      />
      {st.above.length > 0 && (
        <p className="hint">
          Carrying {names(st.above)}, which {st.above.length === 1 ? 'moves' : 'move'} with it.
        </p>
      )}
      <div className="row-buttons">
        <button type="button" className="btn small" disabled={!canStack} onClick={() => stackCopyOnTop(bin.id)}>
          <Layers size={13} /> Stack a copy on top
        </button>
      </div>
      <p className="hint">{hint}</p>
      <p className="hint">Drag a bin onto another to stack it, or off to unstack it. Bins stacked on a bin sit at its top, with their feet in its lip.</p>
    </Section>
  );
}

function BinInspector({ bin, project, issues, units }: { bin: Bin; project: Project; issues?: Issue[]; units: LengthUnit }) {
  const built = useBinGeometry(project, bin);
  const stacks = useMemo(() => computeStacks(project), [project]);
  const f = bin.features;
  const g = project.grid;
  const fit = maxBinUnits(project, stacks[bin.id]?.base ?? 0, f.lip);
  const totalH = binTotalHeight(bin, project.heightUnit);
  const set = (patch: Partial<Bin>, key?: string) => updateBin(bin.id, patch, key);
  const setF = (patch: Partial<Bin['features']>, key?: string) => updateBinFeatures(bin.id, patch, key);

  return (
    <div className="inspector">
      <div className="insp-kind">Bin</div>
      <div className="insp-head">
        <span className="swatch big" style={{ background: bin.color }} />
        <TextInput value={bin.name} onChange={(v) => set({ name: v })} className="title-input" />
      </div>
      <ItemActions onExport={() => void exportItem({ kind: 'bin', id: bin.id })}>
        <IconButton title="Stack a copy on top (S)" onClick={() => stackCopyOnTop(bin.id)}>
          <Layers size={15} />
        </IconButton>
      </ItemActions>
      <IssueList issues={issues} />

      <Section title="Size" storageKey="bin-size">
        <Row label="Width (X)">
          <Stepper value={bin.w} min={1} max={MAX_UNITS} suffix="u" onChange={(v) => set({ w: v }, `w:${bin.id}`)} />
        </Row>
        <Row label="Depth (Y)">
          <Stepper value={bin.d} min={1} max={MAX_UNITS} suffix="u" onChange={(v) => set({ d: v }, `d:${bin.id}`)} />
        </Row>
        <Row label="Height">
          <Stepper value={bin.h} min={1} max={MAX_HEIGHT_UNITS} suffix="u" onChange={(v) => set({ h: v }, `h:${bin.id}`)} />
        </Row>
        <div className="readout">
          {fmtSize(bin.w * g - SPEC.binClearance, bin.d * g - SPEC.binClearance, units, totalH)}
          {f.lip ? ' incl. lip' : ''}
        </div>
        <div className="row-buttons">
          <button
            type="button"
            className="btn small"
            disabled={fit < 1 || fit === bin.h}
            onClick={() => set({ h: fit })}
            title="Tallest height that still fits under the drawer's height, counting what it is stacked on"
          >
            Fit drawer height ({fit}u)
          </button>
        </div>
      </Section>

      <StackSection bin={bin} project={project} stacks={stacks} units={units} />

      <Section title="Position" storageKey="bin-pos">
        <Row label="Column">
          <Stepper value={bin.x + 1} min={-50} max={200} onChange={(v) => moveBinTo(bin.id, v - 1, bin.y, `x:${bin.id}`)} />
        </Row>
        <Row label="Row">
          <Stepper value={bin.y + 1} min={-50} max={200} onChange={(v) => moveBinTo(bin.id, bin.x, v - 1, `y:${bin.id}`)} />
        </Row>
        <p className="hint">Drag the bin in the view, or use the arrow keys. Bins stacked on it move along.</p>
      </Section>

      <Section title="Color" storageKey="bin-color">
        <div className="palette">
          {BIN_PALETTE.map((c) => (
            <button type="button" key={c} className={`swatch-btn ${c === bin.color ? 'on' : ''}`} style={{ background: c }} onClick={() => set({ color: c })} title={c} />
          ))}
          <label className="swatch-btn custom" title="Custom color">
            <input type="color" value={bin.color} onChange={(e) => set({ color: e.target.value }, `color:${bin.id}`)} />
          </label>
        </div>
      </Section>

      <Section title="Features" storageKey="bin-features">
        <div className="toggles">
          <Toggle checked={f.lip} onChange={(v) => setF({ lip: v })} label="Stacking lip" hint="Lets other bins stack on top. Adds 4.4 mm of height." />
          <Toggle checked={f.magnets} onChange={(v) => setF({ magnets: v })} label="Magnet holes" hint="6.5 × 2.4 mm pockets for 6 × 2 mm magnets under every cell" />
          <Toggle checked={f.screws} onChange={(v) => setF({ screws: v })} label="Screw holes" hint="M3 screw holes under every cell" />
          <Toggle checked={f.label} onChange={(v) => setF({ label: v })} label="Label shelf" hint="Angled shelf along the back of each compartment row" />
          <Toggle checked={f.scoop} onChange={(v) => setF({ scoop: v })} label="Finger scoop" hint="Rounded front edge inside each compartment row" />
        </div>
        <Row label="Compartments">
          <div className="pair">
            <Stepper value={f.divX} min={1} max={16} onChange={(v) => setF({ divX: v }, `divx:${bin.id}`)} title="Compartments across (X)" />
            <span className="times">×</span>
            <Stepper value={f.divY} min={1} max={16} onChange={(v) => setF({ divY: v }, `divy:${bin.id}`)} title="Compartments front to back (Y)" />
          </div>
        </Row>
        <Row label="Wall thickness">
          <NumberInput value={f.wall} min={0.6} max={f.lip ? 2.4 : 3} step={0.1} digits={2} suffix="mm" onChange={(v) => setF({ wall: v }, `wall:${bin.id}`)} />
        </Row>
        <button type="button" className="btn small ghost" onClick={() => applyFeaturesToAll(bin)} title="Copy lip, holes, label, scoop and wall settings to every bin">
          Use these features on all bins
        </button>
      </Section>

      <Section title="Print info" storageKey="bin-info">
        {built ? (
          <Stats
            rows={[
              ['Outer size', fmtSize(built.data.max[0] - built.data.min[0], built.data.max[1] - built.data.min[1], units, built.data.max[2] - built.data.min[2])],
              ['Plastic volume', `${round(built.data.volume / 1000, 1)} cm³`],
              ['Weight if solid', `≈ ${grams(built.data.volume)} g PLA`],
              ['Triangles', (built.data.indices.length / 3).toLocaleString()],
            ]}
          />
        ) : (
          <p className="hint">Building…</p>
        )}
      </Section>
    </div>
  );
}

function PlateInspector({ plate, project, issues, units }: { plate: Baseplate; project: Project; issues?: Issue[]; units: LengthUnit }) {
  const built = usePlateGeometry(project, plate);
  const info = gridInfo(project);
  const [sx, sy] = plateSize(project, plate);
  const H = plateHeight(plate.style);
  const set = (patch: Partial<Baseplate>, key?: string) => updatePlate(plate.id, patch, key);
  const pad = plate.padding;
  const setPad = (patch: Partial<Baseplate['padding']>) => set({ padding: { ...pad, ...patch } }, `pad:${plate.id}`);
  const r2 = (v: number) => Math.round(v * 100) / 100;
  // Pad only the sides that sit on the edge of the drawer grid.
  const fillPadding = () =>
    set({
      padding: {
        left: plate.x === 0 ? r2(info.pad.left) : 0,
        right: plate.x + plate.w === info.cols ? r2(info.pad.right) : 0,
        front: plate.y === 0 ? r2(info.pad.front) : 0,
        back: plate.y + plate.d === info.rows ? r2(info.pad.back) : 0,
      },
    });

  return (
    <div className="inspector">
      <div className="insp-kind">Baseplate</div>
      <div className="insp-head">
        <span className="swatch big plate" style={{ background: plate.color }} />
        <TextInput value={plate.name} onChange={(v) => set({ name: v })} className="title-input" />
      </div>
      <ItemActions onExport={() => void exportItem({ kind: 'plate', id: plate.id })} />
      <IssueList issues={issues} />

      <Section title="Size & position" storageKey="plate-size">
        <Row label="Columns (X)">
          <Stepper value={plate.w} min={1} max={40} onChange={(v) => set({ w: v }, `w:${plate.id}`)} />
        </Row>
        <Row label="Rows (Y)">
          <Stepper value={plate.d} min={1} max={40} onChange={(v) => set({ d: v }, `d:${plate.id}`)} />
        </Row>
        <Row label="Starts at column">
          <Stepper value={plate.x + 1} min={-50} max={200} onChange={(v) => set({ x: v - 1 }, `x:${plate.id}`)} />
        </Row>
        <Row label="Starts at row">
          <Stepper value={plate.y + 1} min={-50} max={200} onChange={(v) => set({ y: v - 1 }, `y:${plate.id}`)} />
        </Row>
        <p className="hint">Drag a selected baseplate in the view to move it.</p>
      </Section>

      <Section title="Style" storageKey="plate-style">
        <Segmented
          value={plate.style}
          onChange={(v) => set({ style: v })}
          options={[
            { value: 'thin', label: 'Thin', title: STYLE_LABEL.thin },
            { value: 'magnet', label: 'Magnet', title: STYLE_LABEL.magnet },
            { value: 'solid', label: 'Solid', title: STYLE_LABEL.solid },
          ]}
        />
        <p className="hint">
          {plate.style === 'thin' && 'Classic 4.65 mm frame with open cells. Lightest and fastest to print.'}
          {plate.style === 'magnet' && '3 mm floor with 6.5 × 2.4 mm magnet pockets in every cell corner.'}
          {plate.style === 'solid' && '1.4 mm closed floor: stiffer and easier to slide in and out.'}
        </p>
      </Section>

      <Section title="Padding" storageKey="plate-pad">
        <p className="hint">Solid border that fills the gap between the grid and the drawer walls.</p>
        <div className="pad-grid">
          <div className="pad-back">
            <LengthInput prefix="Back" value={pad.back} min={0} max={100} step={0.5} onChange={(v) => setPad({ back: v })} />
          </div>
          <div className="pad-left">
            <LengthInput prefix="Left" value={pad.left} min={0} max={100} step={0.5} onChange={(v) => setPad({ left: v })} />
          </div>
          <div className="pad-right">
            <LengthInput prefix="Right" value={pad.right} min={0} max={100} step={0.5} onChange={(v) => setPad({ right: v })} />
          </div>
          <div className="pad-front">
            <LengthInput prefix="Front" value={pad.front} min={0} max={100} step={0.5} onChange={(v) => setPad({ front: v })} />
          </div>
        </div>
        <div className="row-buttons">
          <button type="button" className="btn small" onClick={fillPadding}>
            Fill to drawer walls
          </button>
          <button type="button" className="btn small ghost" onClick={() => set({ padding: { ...NO_PADDING } })}>
            None
          </button>
        </div>
      </Section>

      <Section title="Print info" storageKey="plate-info">
        <Stats
          rows={[
            ['Outer size', fmtSize(sx, sy, units, H)],
            [
              'Print bed',
              fitsBed(project, plate) ? (
                <span className="ok">Fits {project.printer.bedX} × {project.printer.bedY}</span>
              ) : (
                <span className="bad">Too big for {project.printer.bedX} × {project.printer.bedY}</span>
              ),
            ],
            ['Plastic volume', built ? `${round(built.data.volume / 1000, 1)} cm³` : '…'],
            ['Weight if solid', built ? `≈ ${grams(built.data.volume)} g PLA` : '…'],
          ]}
        />
      </Section>
    </div>
  );
}

function Overview({ project, units }: { project: Project; units: LengthUnit }) {
  const info = useMemo(() => gridInfo(project), [project]);
  const issues = useMemo(() => computeIssues(project), [project]);
  const bom = useMemo(() => billOfMaterials(project), [project]);
  const stacks = useMemo(() => computeStacks(project), [project]);
  useGeometryBusy(); // re-render as geometry finishes so the totals fill in
  const total = info.cols * info.rows;
  const used = project.bins.reduce((n, b) => n + (stacks[b.id]?.level ? 0 : b.w * b.d), 0);
  const stacked = project.bins.filter((b) => stacks[b.id]?.level).length;
  const pct = total ? Math.min(100, Math.round((used / total) * 100)) : 0;

  let volume = 0;
  let complete = true;
  for (const row of bom.plates) {
    const v = cachedVolume(plateKey(plateParams(project, row.sample)));
    if (v == null) complete = false;
    else volume += v * row.count;
  }
  for (const row of bom.bins) {
    const v = cachedVolume(binKey(binParams(project, row.sample)));
    if (v == null) complete = false;
    else volume += v * row.count;
  }

  const problemItems = [
    ...project.baseplates.filter((pl) => issues.plates[pl.id]).map((pl) => ({ kind: 'plate' as const, id: pl.id, name: pl.name, list: issues.plates[pl.id] })),
    ...project.bins.filter((b) => issues.bins[b.id]).map((b) => ({ kind: 'bin' as const, id: b.id, name: b.name, list: issues.bins[b.id] })),
  ];

  return (
    <div className="inspector overview">
      <div className="insp-kind">Overview</div>
      <h2 className="insp-title">{project.name}</h2>
      <p className="hint">
        {fmtSize(project.drawer.width, project.drawer.depth, units, project.drawer.height)} drawer. Click a bin or baseplate to edit it.
      </p>
      <div className="stat-tiles">
        <div>
          <b>
            {info.cols}×{info.rows}
          </b>
          <span>grid</span>
        </div>
        <div>
          <b>{project.baseplates.length}</b>
          <span>baseplates</span>
        </div>
        <div>
          <b>{project.bins.length}</b>
          <span>bins</span>
        </div>
      </div>
      <div className="usage">
        <div className="usage-bar">
          <span style={{ width: `${pct}%` }} />
        </div>
        <div className="usage-text">
          {used} of {total} cells filled ({pct}%)
          {stacked > 0 && ` · ${stacked} bin${stacked === 1 ? '' : 's'} stacked on top`}
        </div>
      </div>

      {problemItems.length > 0 && (
        <Section title={`Problems (${issues.count})`} storageKey="ov-problems">
          <ul className="problem-list">
            {problemItems.map((it) => (
              <li key={it.id}>
                <button type="button" onClick={() => select({ kind: it.kind, id: it.id })}>
                  <b>{it.name}</b>
                  {it.list.map((i, n) => (
                    <span key={n} className={i.level}>
                      {i.message}
                    </span>
                  ))}
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Parts to print" storageKey="ov-parts">
        {bom.plates.length + bom.bins.length === 0 ? (
          <p className="empty">Nothing yet. Start with Auto-layout in the Baseplates section.</p>
        ) : (
          <ul className="bom">
            {bom.plates.map((row) => (
              <li key={row.key}>
                <span className="qty">{row.count}×</span>
                <span className="bom-text">
                  <b>{row.label}</b>
                  <small>{row.detail}</small>
                </span>
                <IconButton title="Download STL" onClick={() => void exportItem({ kind: 'plate', id: row.sample.id })}>
                  <Download size={14} />
                </IconButton>
              </li>
            ))}
            {bom.bins.map((row) => (
              <li key={row.key}>
                <span className="qty">{row.count}×</span>
                <span className="bom-text">
                  <b>{row.label}</b>
                  <small>{row.detail}</small>
                </span>
                <IconButton title="Download STL" onClick={() => void exportItem({ kind: 'bin', id: row.sample.id })}>
                  <Download size={14} />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
        {volume > 0 && (
          <p className="hint">
            {complete ? '' : 'At least '}
            {round(volume / 1000, 0)} cm³ of plastic, about {grams(volume)} g of PLA if printed solid (infill makes it less).
          </p>
        )}
        <button type="button" className="btn primary wide" onClick={() => void exportAll()}>
          <FileArchive size={15} /> Download all STLs (.zip)
        </button>
      </Section>

      <Section title="Tips" storageKey="ov-tips" defaultOpen={false}>
        <ul className="tips">
          <li>Press B and drag across the grid to draw a bin of any size.</li>
          <li>Drag bins to move them. Click a baseplate first, then drag it.</li>
          <li>Red outlines mean a problem: overlap, outside the drawer or too tall.</li>
          <li>The zip has one STL per distinct part, named with how many to print.</li>
          <li>Everything is saved in this browser. Use File → Back up all drawers to keep a copy.</li>
          <li>Grid unit {fmtLen(project.grid, units)}, height unit {fmtLen(project.heightUnit, units)}.</li>
        </ul>
      </Section>
    </div>
  );
}

export function Inspector() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);
  const units = useStore((s) => s.prefs.units);
  const issues = useMemo(() => computeIssues(project), [project]);

  let body: ReactNode;
  if (selection?.kind === 'bin') {
    const bin = project.bins.find((b) => b.id === selection.id);
    body = bin ? <BinInspector key={bin.id} bin={bin} project={project} issues={issues.bins[bin.id]} units={units} /> : null;
  } else if (selection?.kind === 'plate') {
    const plate = project.baseplates.find((b) => b.id === selection.id);
    body = plate ? <PlateInspector key={plate.id} plate={plate} project={project} issues={issues.plates[plate.id]} units={units} /> : null;
  }
  return <aside className="panel right">{body ?? <Overview project={project} units={units} />}</aside>;
}
