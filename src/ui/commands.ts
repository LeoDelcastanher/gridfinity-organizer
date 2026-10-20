import { exportAllZip, exportBackupJSON, exportBinSTL, exportPlateSTL, exportProjectJSON, parseImport, pickFile } from '../io/files';
import {
  changeSelectedHeight,
  clearBins,
  clearPlates,
  deleteProject,
  deleteSelected,
  duplicateProject,
  duplicateSelected,
  importProject,
  newProject,
  notify,
  nudgeSelected,
  openDialog,
  redo,
  renameProject,
  requestView,
  rotateSelected,
  saveNow,
  select,
  setBusy,
  setPrefs,
  setTool,
  stackCopyOnTop,
  undo,
  useStore,
} from '../model/store';
import type { Selection } from '../model/types';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function exportItem(sel: Selection) {
  const { project } = useStore.getState();
  setBusy('Generating STL…');
  try {
    if (sel.kind === 'bin') {
      const bin = project.bins.find((b) => b.id === sel.id);
      if (bin) await exportBinSTL(project, bin);
    } else {
      const plate = project.baseplates.find((b) => b.id === sel.id);
      if (plate) await exportPlateSTL(project, plate);
    }
  } catch (err) {
    notify(`STL export failed: ${errorText(err)}`, 'error');
  } finally {
    setBusy(null);
  }
}

export async function exportSelected() {
  const sel = useStore.getState().selection;
  if (!sel) {
    notify('Select a bin or baseplate first');
    return;
  }
  await exportItem(sel);
}

export async function exportAll() {
  const { project } = useStore.getState();
  if (!project.bins.length && !project.baseplates.length) {
    notify('Nothing to export yet - add baseplates or bins first');
    return;
  }
  setBusy('Generating STL files…');
  try {
    const n = await exportAllZip(project);
    notify(`Downloaded ${n} distinct part${n === 1 ? '' : 's'} as a zip`);
  } catch (err) {
    notify(`Export failed: ${errorText(err)}`, 'error');
  } finally {
    setBusy(null);
  }
}

export function exportProject() {
  saveNow();
  exportProjectJSON(useStore.getState().project);
}

export function exportBackup() {
  saveNow();
  const projects = Object.values(useStore.getState().library);
  exportBackupJSON(projects);
  notify(`Backed up ${projects.length} drawer${projects.length === 1 ? '' : 's'}`);
}

export async function importFromFile() {
  const file = await pickFile('.json,application/json');
  if (!file) return;
  try {
    const list = parseImport(await file.text());
    if (!list.length) throw new Error('empty file');
    for (const raw of list) importProject(raw);
    notify(list.length === 1 ? `Imported "${useStore.getState().project.name}"` : `Imported ${list.length} drawers`);
  } catch {
    notify('That file is not a Gridfinity Planner project', 'error');
  }
}

export function promptNewProject() {
  openDialog({
    type: 'prompt',
    title: 'New drawer',
    label: 'Name',
    value: 'New drawer',
    confirm: 'Create',
    onSubmit: (name) => {
      newProject(name);
      notify('Set the drawer size, then use Auto-layout to add baseplates');
    },
  });
}

export function promptRenameProject(id?: string) {
  const s = useStore.getState();
  const target = id ? s.library[id] ?? s.project : s.project;
  openDialog({
    type: 'prompt',
    title: 'Rename drawer',
    label: 'Name',
    value: target.name,
    confirm: 'Rename',
    onSubmit: (name) => renameProject(target.id, name),
  });
}

export function confirmDeleteProject(id?: string) {
  const s = useStore.getState();
  const target = id ? s.library[id] ?? s.project : s.project;
  openDialog({
    type: 'confirm',
    title: 'Delete drawer?',
    message: `"${target.name}" and its layout will be removed from this computer. Export it first if you might want it back.`,
    confirm: 'Delete',
    danger: true,
    onConfirm: () => deleteProject(target.id),
  });
}

export function copyProject(id?: string) {
  duplicateProject(id ?? useStore.getState().project.id);
}

export function confirmClearBins() {
  const n = useStore.getState().project.bins.length;
  if (!n) return;
  openDialog({
    type: 'confirm',
    title: 'Remove all bins?',
    message: `This removes all ${n} bins from the drawer. You can undo it with Ctrl+Z.`,
    confirm: 'Remove bins',
    danger: true,
    onConfirm: clearBins,
  });
}

export function confirmClearPlates() {
  const n = useStore.getState().project.baseplates.length;
  if (!n) return;
  openDialog({
    type: 'confirm',
    title: 'Remove all baseplates?',
    message: `This removes all ${n} baseplates. You can undo it with Ctrl+Z.`,
    confirm: 'Remove baseplates',
    danger: true,
    onConfirm: clearPlates,
  });
}

export const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: 'Ctrl+Z / Ctrl+Y', action: 'Undo / redo' },
  { keys: 'B', action: 'Draw a bin by dragging on the grid' },
  { keys: 'V or Esc', action: 'Back to the select tool / clear selection' },
  { keys: 'Arrow keys', action: 'Move the selected item one cell' },
  { keys: 'R', action: 'Rotate the selected item 90°' },
  { keys: 'S', action: 'Stack a copy of the selected bin on top of it' },
  { keys: '[  ]', action: 'Lower / raise the selected bin' },
  { keys: 'Ctrl+D', action: 'Duplicate the selection' },
  { keys: 'Delete', action: 'Delete the selection' },
  { keys: '1  2  3  4', action: 'Isometric / top / front / side view' },
  { keys: 'F', action: 'Fit the drawer in view' },
  { keys: 'O', action: 'Toggle orthographic camera' },
  { keys: 'L', action: 'Toggle labels' },
  { keys: 'Ctrl+E', action: 'Download all STLs (zip)' },
  { keys: 'Ctrl+S', action: 'Save now (it also autosaves)' },
  { keys: '?', action: 'Show this list' },
  { keys: 'Mouse', action: 'Left drag: orbit · Right drag: pan · Wheel: zoom' },
  { keys: 'Mouse on items', action: 'Drag bins to move them · click a baseplate, then drag it' },
  { keys: 'Stacking', action: 'Drop a bin onto another to stack it; drag it off to unstack. A stack moves as one.' },
];

const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'range', 'file']);

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.tagName === 'INPUT') return !NON_TEXT_INPUTS.has((el as HTMLInputElement).type);
  return el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
}

export function handleKeyDown(e: KeyboardEvent) {
  const s = useStore.getState();
  if (s.dialog || isTyping(e.target)) return;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key;
  const k = key.toLowerCase();

  if (mod) {
    if (k === 'z' && !e.shiftKey) undo();
    else if (k === 'y' || (k === 'z' && e.shiftKey)) redo();
    else if (k === 'd') duplicateSelected();
    else if (k === 's') {
      saveNow();
      notify('Saved');
    } else if (k === 'e') void exportAll();
    else return;
    e.preventDefault();
    return;
  }
  if (e.altKey) return;

  switch (key) {
    case 'Delete':
    case 'Backspace':
      deleteSelected();
      break;
    case 'Escape':
      if (s.tool !== 'select') setTool('select');
      else select(null);
      break;
    case 'ArrowLeft':
      nudgeSelected(-1, 0);
      break;
    case 'ArrowRight':
      nudgeSelected(1, 0);
      break;
    case 'ArrowUp':
      nudgeSelected(0, 1);
      break;
    case 'ArrowDown':
      nudgeSelected(0, -1);
      break;
    case '[':
      changeSelectedHeight(-1);
      break;
    case ']':
      changeSelectedHeight(1);
      break;
    case '1':
      requestView('iso');
      break;
    case '2':
      requestView('top');
      break;
    case '3':
      requestView('front');
      break;
    case '4':
      requestView('side');
      break;
    case '?':
      openDialog({ type: 'shortcuts' });
      break;
    default:
      if (k === 'r') rotateSelected();
      else if (k === 's') {
        if (s.selection?.kind === 'bin') stackCopyOnTop();
        else return;
      }
      else if (k === 'b') setTool(s.tool === 'draw' ? 'select' : 'draw');
      else if (k === 'v') setTool('select');
      else if (k === 'f') requestView(s.view.preset);
      else if (k === 'o') setPrefs({ ortho: !s.prefs.ortho });
      else if (k === 'l') setPrefs({ showLabels: !s.prefs.showLabels });
      else return;
  }
  e.preventDefault();
}
