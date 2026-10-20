import { strToU8, zipSync } from 'fflate';
import { plateFloor } from '../geometry/spec';
import { binMesh, plateMesh } from '../geometry/service';
import { toSTL } from '../geometry/mesh';
import { billOfMaterials, binDetail, gridInfo, plateDetail, plateSize } from '../model/layout';
import type { Baseplate, Bin, Project } from '../model/types';

/** PLA density, g/cm³. */
export const PLA_DENSITY = 1.24;

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function safeName(s: string): string {
  const clean = s
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
  return clean || 'model';
}

function binTag(b: Bin): string {
  const f = b.features;
  const tags: string[] = [];
  if (!f.lip) tags.push('nolip');
  if (f.magnets) tags.push('magnets');
  if (f.screws) tags.push('screws');
  if (f.divX > 1 || f.divY > 1) tags.push(`div${f.divX}x${f.divY}`);
  if (f.label) tags.push('label');
  if (f.scoop) tags.push('scoop');
  return tags.join(' ');
}

export function binFileName(b: Bin): string {
  return `${safeName(`${b.name} - bin ${b.w}x${b.d}x${b.h} ${binTag(b)}`)}.stl`;
}

export function plateFileName(pl: Baseplate): string {
  return `${safeName(`${pl.name} - baseplate ${pl.w}x${pl.d} ${pl.style}`)}.stl`;
}

export async function exportBinSTL(p: Project, b: Bin) {
  const data = await binMesh(p, b);
  downloadBlob(new Blob([toSTL(data, `bin ${b.w}x${b.d}x${b.h}`)], { type: 'model/stl' }), binFileName(b));
}

export async function exportPlateSTL(p: Project, pl: Baseplate) {
  const data = await plateMesh(p, pl);
  downloadBlob(new Blob([toSTL(data, `baseplate ${pl.w}x${pl.d}`)], { type: 'model/stl' }), plateFileName(pl));
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** One STL per distinct part (with the quantity in its name), plus a parts list and the project file. */
export async function exportAllZip(p: Project): Promise<number> {
  const bom = billOfMaterials(p);
  const files: Record<string, Uint8Array> = {};
  const used = new Set<string>();
  const unique = (path: string) => {
    let out = path;
    for (let i = 2; used.has(out.toLowerCase()); i++) out = path.replace(/\.stl$/, ` (${i}).stl`);
    used.add(out.toLowerCase());
    return out;
  };

  const info = gridInfo(p);
  const lines: string[] = [
    `Gridfinity parts list - ${p.name}`,
    `Drawer: ${p.drawer.width} x ${p.drawer.depth} x ${p.drawer.height} mm (W x D x H)`,
    `Grid: ${info.cols} x ${info.rows} units of ${p.grid} mm, height unit ${p.heightUnit} mm`,
    `Print bed: ${p.printer.bedX} x ${p.printer.bedY} mm`,
    '',
  ];
  let totalVolume = 0;

  // A part used once is named after its item, so similar pieces are easy to tell apart.
  const who = (names: string[]) => (names.length === 1 ? ` - ${names[0]}` : '');
  const ascii = (s: string) => s.replace(/×/g, 'x');

  if (bom.plates.length) lines.push('BASEPLATES');
  for (const row of bom.plates) {
    const pl = row.sample;
    const data = await plateMesh(p, pl);
    const [sx, sy] = plateSize(p, pl);
    const padded = pl.padding.left + pl.padding.right + pl.padding.front + pl.padding.back > 0;
    const name = safeName(`${row.count}x baseplate ${pl.w}x${pl.d} ${pl.style}${padded ? ' padded' : ''}${who(row.names)}`);
    files[unique(`baseplates/${name}.stl`)] = new Uint8Array(toSTL(data, name));
    totalVolume += data.volume * row.count;
    lines.push(
      `  ${row.count} x  ${pl.w}x${pl.d} ${ascii(plateDetail(p, pl))}  (${r1(sx)} x ${r1(sy)} x ${r1(plateFloor(pl.style) + 4.65)} mm)  [${row.names.join(', ')}]`,
    );
  }
  if (bom.plates.length) lines.push('');

  if (bom.bins.length) lines.push('BINS');
  for (const row of bom.bins) {
    const b = row.sample;
    const data = await binMesh(p, b);
    const name = safeName(`${row.count}x bin ${b.w}x${b.d}x${b.h} ${binTag(b)}${who(row.names)}`);
    files[unique(`bins/${name}.stl`)] = new Uint8Array(toSTL(data, name));
    totalVolume += data.volume * row.count;
    lines.push(`  ${row.count} x  ${b.w}x${b.d}x${b.h} bin - ${ascii(binDetail(b))}  [${row.names.join(', ')}]`);
  }
  lines.push('');
  lines.push(`Total plastic volume: ${r1(totalVolume / 1000)} cm3 (about ${Math.round((totalVolume / 1000) * PLA_DENSITY)} g of PLA if printed solid)`);

  files['parts-list.txt'] = strToU8(lines.join('\r\n'));
  files['project.gridfinity.json'] = strToU8(JSON.stringify(p, null, 2));
  const zip = zipSync(files, { level: 6 });
  downloadBlob(new Blob([zip], { type: 'application/zip' }), `${safeName(p.name)} - gridfinity.zip`);
  return bom.plates.length + bom.bins.length;
}

export function exportProjectJSON(p: Project) {
  const blob = new Blob([JSON.stringify({ app: 'gridfinity-planner', version: 1, project: p }, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `${safeName(p.name)}.gridfinity.json`);
}

export function exportBackupJSON(projects: Project[]) {
  const blob = new Blob([JSON.stringify({ app: 'gridfinity-planner', version: 1, projects }, null, 2)], { type: 'application/json' });
  const stamp = new Date().toISOString().slice(0, 10);
  downloadBlob(blob, `gridfinity-planner-backup-${stamp}.json`);
}

/** Accepts a single-project export, a backup with many projects, or a bare project object. */
export function parseImport(text: string): unknown[] {
  const data = JSON.parse(text);
  if (data && Array.isArray(data.projects)) return data.projects;
  if (data && data.project) return [data.project];
  if (Array.isArray(data)) return data;
  return [data];
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}
