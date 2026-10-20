import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { PRINTERS } from '../model/defaults';
import { autoLayout, gridInfo, plateRect, plateSize } from '../model/layout';
import { applyAutoLayout, closeDialog, notify, updateProject, useStore } from '../model/store';
import type { BaseplateStyle, Project } from '../model/types';
import { SHORTCUTS } from './commands';
import { IconButton, LengthInput, Row, Segmented, Toggle } from './fields';
import { fmtLen, round } from './format';

function Modal({ title, children, footer, onClose, width = 460 }: { title: string; children: ReactNode; footer?: ReactNode; onClose: () => void; width?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" style={{ width }} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <h3>{title}</h3>
          <IconButton title="Close" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

/** Top-down sketch of a baseplate layout. */
function LayoutSketch({ project, plates }: { project: Project; plates: Project['baseplates'] }) {
  const { width: W, depth: D } = project.drawer;
  const scale = Math.min(400 / W, 230 / D);
  const pw = W * scale;
  const ph = D * scale;
  const temp = { ...project, baseplates: plates };
  const info = gridInfo(temp);
  return (
    <svg className="sketch" viewBox={`-6 -6 ${pw + 12} ${ph + 12}`} width={pw + 12} height={ph + 12}>
      <rect x={0} y={0} width={pw} height={ph} className="sketch-drawer" />
      {plates.map((pl) => {
        const r = plateRect(temp, info, pl);
        const x = r.x0 * scale;
        const y = (D - r.y1) * scale;
        const w = (r.x1 - r.x0) * scale;
        const h = (r.y1 - r.y0) * scale;
        return (
          <g key={pl.id}>
            <rect x={x + 0.75} y={y + 0.75} width={w - 1.5} height={h - 1.5} rx={3} className="sketch-plate" />
            <text x={x + w / 2} y={y + h / 2} className="sketch-label">
              {pl.w}×{pl.d}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function AutoLayoutDialog() {
  const project = useStore((s) => s.project);
  const [style, setStyle] = useState<BaseplateStyle>(project.baseplates[0]?.style ?? 'thin');
  const [fill, setFill] = useState(true);
  const units = useStore((s) => s.prefs.units);
  const result = useMemo(() => autoLayout(project, { style, fill }), [project, style, fill]);
  const { info } = result;
  const pr = project.printer;
  const presetIndex = PRINTERS.findIndex((p) => p.bedX === pr.bedX && p.bedY === pr.bedY && p.name === pr.name);

  const groups = useMemo(() => {
    const m = new Map<string, { label: string; count: number }>();
    for (const pl of result.plates) {
      const [sx, sy] = plateSize(project, pl);
      const label = `${pl.w}×${pl.d} — ${fmtLen(sx, units)} × ${fmtLen(sy, units)}`;
      const g = m.get(label);
      if (g) g.count++;
      else m.set(label, { label, count: 1 });
    }
    return [...m.values()];
  }, [result, project, units]);

  const apply = () => {
    const r = applyAutoLayout({ style, fill });
    closeDialog();
    notify(`Placed ${r.plates.length} baseplate${r.plates.length === 1 ? '' : 's'}`);
  };

  return (
    <Modal
      title="Auto-layout baseplates"
      onClose={closeDialog}
      width={500}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={closeDialog}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={!result.plates.length} onClick={apply}>
            Apply layout
          </button>
        </>
      }
    >
      {info.cols * info.rows === 0 ? (
        <p className="warn-text">The drawer is smaller than one grid unit. Check the drawer size.</p>
      ) : (
        <p>
          The drawer fits <b>{info.cols} × {info.rows}</b> grid units. Split into <b>{result.splitX.length} × {result.splitY.length}</b> piece
          {result.plates.length === 1 ? '' : 's'} that fit your print bed:
        </p>
      )}
      <LayoutSketch project={project} plates={result.plates} />
      <ul className="piece-list">
        {groups.map((g) => (
          <li key={g.label}>
            <b>{g.count}×</b> {g.label}
          </li>
        ))}
      </ul>
      <Row label="Print bed">
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
              {p.name}
            </option>
          ))}
          <option value="custom">Custom</option>
        </select>
      </Row>
      <Row label="Bed size">
        <div className="dims two">
          <LengthInput prefix="X" value={pr.bedX} min={50} max={2000} onChange={(v) => updateProject({ printer: { ...pr, name: 'Custom', bedX: v } }, 'bed')} />
          <LengthInput prefix="Y" value={pr.bedY} min={50} max={2000} onChange={(v) => updateProject({ printer: { ...pr, name: 'Custom', bedY: v } }, 'bed')} />
        </div>
      </Row>
      <Row label="Style">
        <Segmented
          value={style}
          onChange={setStyle}
          options={[
            { value: 'thin', label: 'Thin' },
            { value: 'magnet', label: 'Magnet' },
            { value: 'solid', label: 'Solid' },
          ]}
        />
      </Row>
      <Toggle
        checked={fill}
        onChange={setFill}
        label={`Fill the spare ${fmtLen(round(info.spareX, 1), units)} × ${fmtLen(round(info.spareY, 1), units)} with padding`}
        hint="Adds a solid border on the outer pieces so the grid cannot slide around in the drawer"
      />
      {project.baseplates.length > 0 && (
        <p className="warn-text">
          This replaces the {project.baseplates.length} baseplate{project.baseplates.length === 1 ? '' : 's'} already in this drawer (Ctrl+Z undoes it).
        </p>
      )}
    </Modal>
  );
}

function PromptDialog({ title, label, value, confirm, onSubmit }: { title: string; label: string; value: string; confirm: string; onSubmit: (v: string) => void }) {
  const [text, setText] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const submit = () => {
    if (!text.trim()) return;
    closeDialog();
    onSubmit(text.trim());
  };
  return (
    <Modal
      title={title}
      onClose={closeDialog}
      width={400}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={closeDialog}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={submit} disabled={!text.trim()}>
            {confirm}
          </button>
        </>
      }
    >
      <label className="field">
        <span>{label}</span>
        <input
          ref={ref}
          className="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
      </label>
    </Modal>
  );
}

function ConfirmDialog({ title, message, confirm, danger, onConfirm }: { title: string; message: string; confirm: string; danger?: boolean; onConfirm: () => void }) {
  return (
    <Modal
      title={title}
      onClose={closeDialog}
      width={420}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={closeDialog}>
            Cancel
          </button>
          <button
            type="button"
            className={`btn ${danger ? 'danger' : 'primary'}`}
            autoFocus
            onClick={() => {
              closeDialog();
              onConfirm();
            }}
          >
            {confirm}
          </button>
        </>
      }
    >
      <p>{message}</p>
    </Modal>
  );
}

function ShortcutsDialog() {
  return (
    <Modal title="Keyboard & mouse" onClose={closeDialog} width={520}>
      <table className="shortcuts">
        <tbody>
          {SHORTCUTS.map((s) => (
            <tr key={s.keys}>
              <td>
                <kbd>{s.keys}</kbd>
              </td>
              <td>{s.action}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

function AboutDialog() {
  return (
    <Modal title="About Gridfinity Planner" onClose={closeDialog} width={500}>
      <div className="about">
        <p>
          A personal, offline planner for <b>Gridfinity</b> storage: size a drawer, lay out baseplates that fit your printer, arrange bins, then download
          print-ready STL files.
        </p>
        <p>
          Gridfinity is an open modular storage system created by Zack Freedman. Parts generated here follow the public spec: 42 mm grid, 7 mm height
          units, 0.5 mm clearance, stacking lip and 6.5 × 2.4 mm magnet pockets.
        </p>
        <p>
          Your drawers are saved automatically in this browser on this computer. Nothing is uploaded anywhere. Use <b>File → Back up all drawers</b> now
          and then, since clearing browser data would erase them.
        </p>
        <p className="hint">Geometry is built with the open-source Manifold library; 3D view by three.js.</p>
      </div>
    </Modal>
  );
}

export function Dialogs() {
  const dialog = useStore((s) => s.dialog);
  if (!dialog) return null;
  switch (dialog.type) {
    case 'autolayout':
      return <AutoLayoutDialog />;
    case 'shortcuts':
      return <ShortcutsDialog />;
    case 'about':
      return <AboutDialog />;
    case 'prompt':
      return <PromptDialog {...dialog} />;
    case 'confirm':
      return <ConfirmDialog {...dialog} />;
    default:
      return null;
  }
}

export function Toast() {
  const toast = useStore((s) => s.toast);
  if (!toast) return null;
  return (
    <div key={toast.id} className={`toast ${toast.tone}`} role="status">
      {toast.text}
    </div>
  );
}
