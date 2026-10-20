import { useMemo } from 'react';
import { Maximize, MousePointer2, PanelLeft, PanelRight, Rotate3d, SquareDashedMousePointer, Tag, WandSparkles } from 'lucide-react';
import { useGeometryBusy } from '../geometry/service';
import { gridInfo } from '../model/layout';
import { openDialog, requestView, setPrefs, setTool, useStore } from '../model/store';
import type { ViewPreset } from '../model/types';
import { IconButton } from './fields';

const VIEWS: { value: ViewPreset; label: string; key: string }[] = [
  { value: 'iso', label: '3D', key: '1' },
  { value: 'top', label: 'Top', key: '2' },
  { value: 'front', label: 'Front', key: '3' },
  { value: 'side', label: 'Side', key: '4' },
];

export function ViewportOverlay() {
  const tool = useStore((s) => s.tool);
  const prefs = useStore((s) => s.prefs);
  const view = useStore((s) => s.view);
  const hover = useStore((s) => s.hoverCell);
  const busy = useStore((s) => s.busy);
  const project = useStore((s) => s.project);
  const building = useGeometryBusy();
  const info = useMemo(() => gridInfo(project), [project]);
  const inGrid = hover && hover.x >= 0 && hover.y >= 0 && hover.x < info.cols && hover.y < info.rows;
  const empty = !project.baseplates.length && !project.bins.length;

  return (
    <>
      <div className="vp-toolbar">
        <div className="tool-group">
          <IconButton title={prefs.leftOpen ? 'Hide left panel' : 'Show left panel'} active={prefs.leftOpen} onClick={() => setPrefs({ leftOpen: !prefs.leftOpen })}>
            <PanelLeft size={16} />
          </IconButton>
        </div>
        <div className="tool-group">
          <IconButton title="Select and move (V)" active={tool === 'select'} onClick={() => setTool('select')}>
            <MousePointer2 size={16} />
          </IconButton>
          <IconButton title="Draw a bin on the grid (B)" active={tool === 'draw'} onClick={() => setTool('draw')}>
            <SquareDashedMousePointer size={16} />
          </IconButton>
        </div>
        <div className="tool-group views">
          {VIEWS.map((v) => (
            <button
              type="button"
              key={v.value}
              className={`tb-btn ${view.preset === v.value ? 'on' : ''}`}
              onClick={() => requestView(v.value)}
              title={`${v.label} view (${v.key})`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="tool-group">
          <IconButton title="Orthographic camera (O)" active={prefs.ortho} onClick={() => setPrefs({ ortho: !prefs.ortho })}>
            <Rotate3d size={16} />
          </IconButton>
          <IconButton title="Bin labels (L)" active={prefs.showLabels} onClick={() => setPrefs({ showLabels: !prefs.showLabels })}>
            <Tag size={16} />
          </IconButton>
          <IconButton title="Fit drawer in view (F)" onClick={() => requestView(view.preset)}>
            <Maximize size={16} />
          </IconButton>
        </div>
        <div className="spacer" />
        <div className="tool-group">
          <IconButton title={prefs.rightOpen ? 'Hide right panel' : 'Show right panel'} active={prefs.rightOpen} onClick={() => setPrefs({ rightOpen: !prefs.rightOpen })}>
            <PanelRight size={16} />
          </IconButton>
        </div>
      </div>

      {empty && (
        <div className="vp-empty">
          <h3>Empty drawer</h3>
          <p>Enter your drawer's inner size on the left, then fill it with baseplates.</p>
          <button type="button" className="btn primary" onClick={() => openDialog({ type: 'autolayout' })}>
            <WandSparkles size={15} /> Auto-layout baseplates
          </button>
        </div>
      )}

      <div className="vp-status">
        <span>
          {tool === 'draw'
            ? 'Drag across grid cells to draw a bin. Esc or V to stop.'
            : 'Drag bins to move · click a baseplate, then drag it · R rotate · Del delete · ? help'}
        </span>
        {inGrid && (
          <span className="cell">
            column {hover.x + 1}, row {hover.y + 1}
          </span>
        )}
      </div>

      {(busy || building) && (
        <div className="vp-busy">
          <span className="spinner" />
          {busy ?? 'Building geometry…'}
        </div>
      )}
    </>
  );
}
