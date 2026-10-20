import { useMemo } from 'react';
import { Box, Grid3x3, Package, Plus, Printer, SquareDashedMousePointer, Trash2, TriangleAlert, WandSparkles } from 'lucide-react';
import { SPEC, maxBinUnits, plateFloor } from '../geometry/spec';
import { PRINTERS } from '../model/defaults';
import { type GridInfo, type IssueMap, computeIssues, computeStacks, gridInfo } from '../model/layout';
import { addBaseplate, addBin, deleteItem, openDialog, select, setTool, updateProject, useStore } from '../model/store';
import type { Issue, LengthUnit, Project, Selection } from '../model/types';
import { IconButton, LengthInput, NumberInput, Row, Section, Segmented } from './fields';
import { fmtLen, fmtSize } from './format';

export function IssueIcon({ issues }: { issues?: Issue[] }) {
  if (!issues?.length) return null;
  const error = issues.some((i) => i.level === 'error');
  return (
    <span className={`issue-icon ${error ? 'error' : 'warn'}`} title={issues.map((i) => i.message).join('\n')}>
      <TriangleAlert size={13} />
    </span>
  );
}

function FitCard({ project, info, units }: { project: Project; info: GridInfo; units: LengthUnit }) {
  const floor = project.baseplates.reduce((m, pl) => Math.max(m, plateFloor(pl.style)), 0);
  const maxU = maxBinUnits(project, floor, true);
  const g = project.grid;
  return (
    <div className="fit-card">
      <div className="fit-main">
        <span className="fit-big">
          {info.cols} × {info.rows}
        </span>
        <span className="fit-label">
          grid units fit
          <br />
          {info.cols * info.rows} cells
        </span>
      </div>
      <div className="fit-line">
        Grid area {fmtSize(info.cols * g, info.rows * g, units)}
      </div>
      <div className="fit-line">
        Spare {fmtLen(info.spareX, units)} × {fmtLen(info.spareY, units)} (+{fmtLen(project.clearance, units)} play)
      </div>
      <div className="fit-line">
        Tallest bin {maxU}u = {fmtLen(maxU * project.heightUnit + SPEC.lipHeight, units)} with lip
      </div>
    </div>
  );
}

function DrawerSection({ project, info, units }: { project: Project; info: GridInfo; units: LengthUnit }) {
  const dr = project.drawer;
  return (
    <Section title="Drawer" icon={<Box size={14} />} storageKey="drawer">
      <div className="dims three">
        <LengthInput prefix="X" showUnit={false} title="Inner width (left to right)" value={dr.width} min={20} max={3000} onChange={(v) => updateProject({ drawer: { ...dr, width: v } }, 'drawer')} />
        <LengthInput prefix="Y" showUnit={false} title="Inner depth (front to back)" value={dr.depth} min={20} max={3000} onChange={(v) => updateProject({ drawer: { ...dr, depth: v } }, 'drawer')} />
        <LengthInput prefix="Z" showUnit={false} title="Usable inner height" value={dr.height} min={10} max={1500} onChange={(v) => updateProject({ drawer: { ...dr, height: v } }, 'drawer')} />
      </div>
      <div className="dims-caption three">
        <span>width ({units})</span>
        <span>depth ({units})</span>
        <span>height ({units})</span>
      </div>
      <FitCard project={project} info={info} units={units} />
      <Row label="Grid unit" hint="Gridfinity standard: 42 mm">
        <NumberInput value={project.grid} min={20} max={100} step={0.5} suffix="mm" onChange={(v) => updateProject({ grid: v }, 'grid')} />
      </Row>
      <Row label="Height unit" hint="Gridfinity standard: 7 mm">
        <NumberInput value={project.heightUnit} min={5} max={20} step={0.5} suffix="mm" onChange={(v) => updateProject({ heightUnit: v }, 'hu')} />
      </Row>
      <Row label="Wall play" hint="Total gap left between the baseplates and the drawer walls, per axis, so they drop in easily">
        <LengthInput value={project.clearance} min={0} max={20} step={0.5} onChange={(v) => updateProject({ clearance: v }, 'clearance')} />
      </Row>
      <Row label="Grid sits">
        <Segmented
          value={project.align}
          onChange={(v) => updateProject({ align: v })}
          options={[
            { value: 'center', label: 'Centered', title: 'Spare space split evenly on both sides' },
            { value: 'front-left', label: 'Front-left', title: 'Grid pushed into the front-left corner' },
          ]}
        />
      </Row>
    </Section>
  );
}

function PrinterSection({ project }: { project: Project }) {
  const pr = project.printer;
  const presetIndex = PRINTERS.findIndex((p) => p.bedX === pr.bedX && p.bedY === pr.bedY && p.name === pr.name);
  return (
    <Section title="Print bed" icon={<Printer size={14} />} storageKey="printer" defaultOpen={false}>
      <select
        className="select"
        value={presetIndex >= 0 ? String(presetIndex) : 'custom'}
        onChange={(e) => {
          const p = PRINTERS[Number(e.target.value)];
          if (p) updateProject({ printer: { ...p } });
        }}
      >
        {PRINTERS.map((p, i) => (
          <option key={p.name} value={i}>
            {p.name} ({p.bedX} × {p.bedY})
          </option>
        ))}
        <option value="custom">Custom size</option>
      </select>
      <div className="dims two">
        <LengthInput prefix="X" value={pr.bedX} min={50} max={2000} onChange={(v) => updateProject({ printer: { ...pr, name: 'Custom', bedX: v } }, 'bed')} />
        <LengthInput prefix="Y" value={pr.bedY} min={50} max={2000} onChange={(v) => updateProject({ printer: { ...pr, name: 'Custom', bedY: v } }, 'bed')} />
      </div>
      <p className="hint">Auto-layout splits the baseplate into pieces that fit this bed.</p>
    </Section>
  );
}

function ItemRow({
  sel,
  selected,
  name,
  meta,
  swatch,
  issues,
}: {
  sel: Selection;
  selected: boolean;
  name: string;
  meta: string;
  swatch: string;
  issues?: Issue[];
}) {
  return (
    <li className={`item ${selected ? 'sel' : ''}`}>
      <button type="button" className="item-main" onClick={() => select(sel)}>
        <span className={`swatch ${sel.kind}`} style={{ background: swatch }} />
        <span className="item-name">{name}</span>
        <span className="item-meta">{meta}</span>
        <IssueIcon issues={issues} />
      </button>
      <button type="button" className="item-del" title="Delete" onClick={() => deleteItem(sel.kind, sel.id)}>
        <Trash2 size={13} />
      </button>
    </li>
  );
}

function PlatesSection({ project, info, issues, selection }: { project: Project; info: GridInfo; issues: IssueMap; selection: Selection | null }) {
  const covered = project.baseplates.reduce((n, pl) => n + pl.w * pl.d, 0);
  return (
    <Section
      title={`Baseplates (${project.baseplates.length})`}
      icon={<Grid3x3 size={14} />}
      storageKey="plates"
      actions={
        <>
          <button type="button" className="chip-btn accent" onClick={() => openDialog({ type: 'autolayout' })} title="Fill the drawer with baseplates that fit your print bed">
            <WandSparkles size={13} /> Auto
          </button>
          <IconButton title="Add a baseplate" onClick={() => addBaseplate()}>
            <Plus size={15} />
          </IconButton>
        </>
      }
    >
      {project.baseplates.length === 0 ? (
        <p className="empty">No baseplates yet. Use Auto to fill the drawer with pieces that fit your printer.</p>
      ) : (
        <>
          <ul className="item-list">
            {project.baseplates.map((pl) => (
              <ItemRow
                key={pl.id}
                sel={{ kind: 'plate', id: pl.id }}
                selected={selection?.kind === 'plate' && selection.id === pl.id}
                name={pl.name}
                meta={`${pl.w}×${pl.d}`}
                swatch={pl.color}
                issues={issues.plates[pl.id]}
              />
            ))}
          </ul>
          <p className="list-foot">
            {covered} of {info.cols * info.rows} grid cells covered
          </p>
        </>
      )}
    </Section>
  );
}

function BinsSection({ project, info, issues, selection }: { project: Project; info: GridInfo; issues: IssueMap; selection: Selection | null }) {
  const tool = useStore((s) => s.tool);
  const stacks = useMemo(() => computeStacks(project), [project]);
  // Floor cells used: stacked bins share the cells of the bins under them.
  const used = project.bins.reduce((n, b) => n + (stacks[b.id]?.level ? 0 : b.w * b.d), 0);
  return (
    <Section
      title={`Bins (${project.bins.length})`}
      icon={<Package size={14} />}
      storageKey="bins"
      actions={
        <>
          <IconButton title="Draw a bin on the grid (B)" active={tool === 'draw'} onClick={() => setTool(tool === 'draw' ? 'select' : 'draw')}>
            <SquareDashedMousePointer size={15} />
          </IconButton>
          <IconButton title="Add a 1×1 bin" onClick={() => addBin()}>
            <Plus size={15} />
          </IconButton>
        </>
      }
    >
      {project.bins.length === 0 ? (
        <p className="empty">No bins yet. Press B and drag across the grid to draw one, or use +.</p>
      ) : (
        <>
          <ul className="item-list">
            {project.bins.map((b) => (
              <ItemRow
                key={b.id}
                sel={{ kind: 'bin', id: b.id }}
                selected={selection?.kind === 'bin' && selection.id === b.id}
                name={b.name}
                meta={`${b.w}×${b.d}×${b.h}${stacks[b.id]?.level ? ` · L${stacks[b.id].level + 1}` : ''}`}
                swatch={b.color}
                issues={issues.bins[b.id]}
              />
            ))}
          </ul>
          <p className="list-foot">
            {used} of {info.cols * info.rows} cells used
          </p>
        </>
      )}
    </Section>
  );
}

export function Sidebar() {
  const project = useStore((s) => s.project);
  const units = useStore((s) => s.prefs.units);
  const selection = useStore((s) => s.selection);
  const info = useMemo(() => gridInfo(project), [project]);
  const issues = useMemo(() => computeIssues(project), [project]);
  return (
    <aside className="panel left">
      <DrawerSection project={project} info={info} units={units} />
      <PrinterSection project={project} />
      <PlatesSection project={project} info={info} issues={issues} selection={selection} />
      <BinsSection project={project} info={info} issues={issues} selection={selection} />
    </aside>
  );
}
