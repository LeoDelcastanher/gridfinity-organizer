import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Copy, FilePlus, FolderOpen, Pencil, Redo2, Trash2, TriangleAlert, Undo2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { computeIssues } from '../model/layout';
import {
  addBaseplate,
  addBin,
  deleteSelected,
  duplicateSelected,
  fillEmptyCells,
  notify,
  openDialog,
  openProject,
  redo,
  refreshLibrary,
  requestView,
  rotateSelected,
  select,
  setPrefs,
  setTool,
  stackCopyOnTop,
  undo,
  useStore,
} from '../model/store';
import {
  confirmClearBins,
  confirmClearPlates,
  confirmDeleteProject,
  copyProject,
  exportAll,
  exportBackup,
  exportProject,
  exportSelected,
  importFromFile,
  promptNewProject,
  promptRenameProject,
} from './commands';
import { IconButton, Segmented } from './fields';

interface MenuItem {
  label?: string;
  shortcut?: string;
  onClick?: () => void;
  disabled?: boolean;
  checked?: boolean;
  divider?: boolean;
  danger?: boolean;
}

function useMenus(): { label: string; items: MenuItem[] }[] {
  const s = useStore(
    useShallow((st) => ({
      hasSel: !!st.selection,
      binSel: st.selection?.kind === 'bin',
      canUndo: st.past.length > 0,
      canRedo: st.future.length > 0,
      tool: st.tool,
      prefs: st.prefs,
      bins: st.project.bins.length,
      plates: st.project.baseplates.length,
    })),
  );
  return [
    {
      label: 'File',
      items: [
        { label: 'New drawer…', onClick: promptNewProject },
        { label: 'Import drawer / backup…', onClick: () => void importFromFile() },
        { divider: true },
        { label: 'Export this drawer (.json)', onClick: exportProject },
        { label: 'Back up all drawers (.json)', onClick: exportBackup },
        { divider: true },
        { label: 'Download all STLs (.zip)', shortcut: 'Ctrl+E', onClick: () => void exportAll() },
        { label: 'Download selected STL', onClick: () => void exportSelected(), disabled: !s.hasSel },
      ],
    },
    {
      label: 'Edit',
      items: [
        { label: 'Undo', shortcut: 'Ctrl+Z', onClick: undo, disabled: !s.canUndo },
        { label: 'Redo', shortcut: 'Ctrl+Y', onClick: redo, disabled: !s.canRedo },
        { divider: true },
        { label: 'Duplicate', shortcut: 'Ctrl+D', onClick: duplicateSelected, disabled: !s.hasSel },
        { label: 'Rotate 90°', shortcut: 'R', onClick: rotateSelected, disabled: !s.hasSel },
        { label: 'Stack a copy on top', shortcut: 'S', onClick: () => stackCopyOnTop(), disabled: !s.binSel },
        { label: 'Delete', shortcut: 'Del', onClick: deleteSelected, disabled: !s.hasSel },
        { label: 'Deselect', shortcut: 'Esc', onClick: () => select(null), disabled: !s.hasSel },
        { divider: true },
        { label: 'Remove all bins…', onClick: confirmClearBins, disabled: !s.bins, danger: true },
        { label: 'Remove all baseplates…', onClick: confirmClearPlates, disabled: !s.plates, danger: true },
      ],
    },
    {
      label: 'Tools',
      items: [
        { label: 'Auto-layout baseplates…', onClick: () => openDialog({ type: 'autolayout' }) },
        { label: 'Add baseplate', onClick: () => addBaseplate() },
        { divider: true },
        { label: 'Add bin', onClick: () => addBin() },
        { label: 'Draw bin on grid', shortcut: 'B', checked: s.tool === 'draw', onClick: () => setTool(s.tool === 'draw' ? 'select' : 'draw') },
        { divider: true },
        { label: 'Fill empty cells with large bins', onClick: () => fillGaps(4) },
        { label: 'Fill empty cells with 2×2 bins', onClick: () => fillGaps(2) },
        { label: 'Fill empty cells with 1×1 bins', onClick: () => fillGaps(1) },
      ],
    },
    {
      label: 'View',
      items: [
        { label: 'Isometric', shortcut: '1', onClick: () => requestView('iso') },
        { label: 'Top', shortcut: '2', onClick: () => requestView('top') },
        { label: 'Front', shortcut: '3', onClick: () => requestView('front') },
        { label: 'Side', shortcut: '4', onClick: () => requestView('side') },
        { divider: true },
        { label: 'Orthographic camera', shortcut: 'O', checked: s.prefs.ortho, onClick: () => setPrefs({ ortho: !s.prefs.ortho }) },
        { label: 'Bin labels', shortcut: 'L', checked: s.prefs.showLabels, onClick: () => setPrefs({ showLabels: !s.prefs.showLabels }) },
        { label: 'Drawer outline', checked: s.prefs.showDrawer, onClick: () => setPrefs({ showDrawer: !s.prefs.showDrawer }) },
        { label: 'Baseplates', checked: s.prefs.showPlates, onClick: () => setPrefs({ showPlates: !s.prefs.showPlates }) },
        { label: 'Bins', checked: s.prefs.showBins, onClick: () => setPrefs({ showBins: !s.prefs.showBins }) },
        { divider: true },
        { label: 'Left panel', checked: s.prefs.leftOpen, onClick: () => setPrefs({ leftOpen: !s.prefs.leftOpen }) },
        { label: 'Right panel', checked: s.prefs.rightOpen, onClick: () => setPrefs({ rightOpen: !s.prefs.rightOpen }) },
      ],
    },
    {
      label: 'Help',
      items: [
        { label: 'Keyboard & mouse', shortcut: '?', onClick: () => openDialog({ type: 'shortcuts' }) },
        { label: 'About this planner', onClick: () => openDialog({ type: 'about' }) },
      ],
    },
  ];
}

function fillGaps(max: number) {
  const n = fillEmptyCells(max);
  notify(n ? `Added ${n} bin${n === 1 ? '' : 's'} in the empty cells` : 'There are no empty grid cells left');
}

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  return ref;
}

function MenuBar() {
  const [open, setOpen] = useState<string | null>(null);
  const close = useMemo(() => () => setOpen(null), []);
  const ref = useDismiss(!!open, close);
  const menus = useMenus();
  return (
    <nav className="menubar" ref={ref}>
      {menus.map((m) => (
        <div className="menu" key={m.label}>
          <button
            type="button"
            className={`menu-title ${open === m.label ? 'open' : ''}`}
            onClick={() => setOpen(open === m.label ? null : m.label)}
            onPointerEnter={() => open && setOpen(m.label)}
          >
            {m.label}
          </button>
          {open === m.label && (
            <div className="menu-pop" role="menu">
              {m.items.map((it, i) =>
                it.divider ? (
                  <div key={i} className="menu-sep" />
                ) : (
                  <button
                    type="button"
                    key={i}
                    role="menuitem"
                    className={`menu-item ${it.danger ? 'danger' : ''}`}
                    disabled={it.disabled}
                    onClick={() => {
                      setOpen(null);
                      it.onClick?.();
                    }}
                  >
                    <span className="menu-check">{it.checked ? <Check size={13} /> : null}</span>
                    <span className="menu-label">{it.label}</span>
                    {it.shortcut && <kbd className="menu-key">{it.shortcut}</kbd>}
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      ))}
    </nav>
  );
}

function ProjectSwitcher() {
  const [open, setOpen] = useState(false);
  const close = useMemo(() => () => setOpen(false), []);
  const ref = useDismiss(open, close);
  const project = useStore((s) => s.project);
  const library = useStore((s) => s.library);
  const list = Object.values({ ...library, [project.id]: project }).sort((a, b) => b.updatedAt - a.updatedAt);
  const act = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <div className="switcher" ref={ref}>
      <button
        type="button"
        className={`switcher-btn ${open ? 'open' : ''}`}
        onClick={() => {
          if (!open) refreshLibrary();
          setOpen(!open);
        }}
        title="Switch drawer"
      >
        <FolderOpen size={15} />
        <span className="switcher-name">{project.name}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="switcher-pop">
          <div className="pop-head">Your drawers</div>
          <div className="switcher-list">
            {list.map((p) => (
              <button
                type="button"
                key={p.id}
                className={`switcher-item ${p.id === project.id ? 'current' : ''}`}
                onClick={act(() => openProject(p.id))}
              >
                <span className="name">{p.name}</span>
                <span className="meta">
                  {p.drawer.width} × {p.drawer.depth} × {p.drawer.height} mm · {p.baseplates.length} plates · {p.bins.length} bins
                </span>
              </button>
            ))}
          </div>
          <div className="switcher-actions">
            <button type="button" onClick={act(promptNewProject)}>
              <FilePlus size={14} /> New
            </button>
            <button type="button" onClick={act(() => promptRenameProject())}>
              <Pencil size={14} /> Rename
            </button>
            <button type="button" onClick={act(() => copyProject())}>
              <Copy size={14} /> Duplicate
            </button>
            <button type="button" className="danger" onClick={act(() => confirmDeleteProject())}>
              <Trash2 size={14} /> Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function IssuesChip() {
  const project = useStore((s) => s.project);
  const count = useMemo(() => computeIssues(project).count, [project]);
  if (!count) return null;
  return (
    <button type="button" className="issues-chip" onClick={() => select(null)} title="Show problems in the overview panel">
      <TriangleAlert size={14} />
      {count} {count === 1 ? 'problem' : 'problems'}
    </button>
  );
}

function Logo(): ReactNode {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1.5" y="1.5" width="29" height="29" rx="7" fill="#f59e0b" />
      <path d="M8 8h7v7H8zM17 8h7v7h-7zM8 17h7v7H8zM17 17h7v7h-7z" fill="#1c1917" opacity="0.92" />
    </svg>
  );
}

export function TopBar() {
  const units = useStore((s) => s.prefs.units);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  return (
    <header className="topbar">
      <div className="brand">
        <Logo />
        <span>Gridfinity Planner</span>
      </div>
      <ProjectSwitcher />
      <MenuBar />
      <div className="spacer" />
      <IssuesChip />
      <IconButton title="Undo (Ctrl+Z)" onClick={undo} disabled={!canUndo}>
        <Undo2 size={16} />
      </IconButton>
      <IconButton title="Redo (Ctrl+Y)" onClick={redo} disabled={!canRedo}>
        <Redo2 size={16} />
      </IconButton>
      <Segmented
        value={units}
        onChange={(u) => setPrefs({ units: u })}
        options={[
          { value: 'mm', label: 'mm' },
          { value: 'in', label: 'in' },
        ]}
      />
    </header>
  );
}
