# Gridfinity Planner (local)

A personal, offline planner for [Gridfinity](https://gridfinity.xyz/) storage. Size a drawer, lay out
baseplates that fit your 3D printer, arrange bins, then download print-ready STL files.

Everything runs in your browser. Nothing is uploaded anywhere.

**Open it online:** https://leodelcastanher.github.io/gridfinity-organizer/

## Using it

Open the link above, or run `npm run build` and double-click the generated **`Gridfinity Planner.html`**
(Chrome, Edge or Firefox; no install or internet needed). Each person's drawers are saved in their own
browser; use **File → Export this drawer** and **File → Import** to hand a drawer to someone else.

1. **Drawer**: type the drawer's inner width (X), depth (Y) and usable height (Z). The card below shows
   how many grid units fit, the spare space and the tallest bin that fits.
2. **Print bed**: pick your printer (or type the bed size). Baseplates and bins larger than the bed are flagged.
3. **Baseplates → Auto**: splits the grid into the fewest evenly sized pieces that fit your bed, and can fill
   the spare space around the grid with a solid border so nothing slides around.
4. **Bins**: press **B** and drag across grid cells to draw a bin, or use **+**. Drag bins to move them,
   **R** rotates, **[ ]** change height. Use **Tools → Fill empty cells** to fill what's left.
5. **Stack bins** (optional): drag a bin onto another, or select it and press **S** to stack a copy on
   top. A stacked bin sits at the top of the one below, since its feet nest in that bin's stacking lip. The
   right panel shows each bin's level, bottom and top height and the headroom left. Moving the bottom bin
   moves the whole stack; drag the top bin off to unstack it.
6. **Check problems**: red outlines and the "problems" chip flag overlaps, parts sticking out of the
   drawer, bins or stacks that are too tall, stacked bins that won't sit flat (the bins under them end at
   different heights), bins hanging over an edge or resting on a bin without a stacking lip, cells
   without a baseplate and parts bigger than the print bed.
7. **Download**: the STL button in the right panel exports the selected part. **File → Download all STLs**
   (Ctrl+E) makes a zip with one STL per distinct part (the file name says how many to print), a parts list
   with a filament estimate, and a copy of the project.

Bin options: stacking lip, magnet holes (6.5 × 2.4 mm), M3 screw holes, compartments, label shelf,
finger scoop and wall thickness. Baseplate styles: thin (open cells), magnet (3 mm floor with magnet
pockets) and solid floor.

### Mouse and keyboard

| Input | Action |
| --- | --- |
| Left drag (empty space) | Orbit |
| Right drag / wheel | Pan / zoom |
| Drag a bin | Move it (snaps to the grid) |
| Click a baseplate, then drag it | Move a baseplate |
| B / V or Esc | Draw-bin tool / back to select |
| Arrow keys | Move the selection one cell |
| R, Ctrl+D, Delete | Rotate, duplicate, delete |
| S | Stack a copy of the selected bin on top |
| 1 2 3 4, F, O, L | Views, fit view, orthographic camera, labels |
| Ctrl+Z / Ctrl+Y | Undo / redo |

Press **?** in the app for the full list.

### Where your drawers are saved

Drawers are saved automatically in the browser's local storage, separately for each browser. Keep using
the same browser, and use **File → Back up all drawers** now and then: clearing browser data, or moving the
HTML file in some browsers, can lose them. **File → Import** restores a backup or a single exported drawer.

## Gridfinity dimensions used

42 mm grid, 7 mm height units, bins 0.5 mm smaller than the grid with 3.75 mm corners, the standard
bin foot and baseplate profiles, the 4.4 mm stacking lip, and magnet holes 8 mm in from each cell
edge. A bin of height *n* is *n* × 7 mm tall plus the lip. Grid and height unit can be changed under Drawer.

## Changing the app

The source is in `src/` (React + three.js; geometry built with Manifold). With Node.js installed:

```bash
npm install
npm run dev     # live development server at http://localhost:5180
npm run build   # rebuilds "Gridfinity Planner.html"
```

Every push to `main` rebuilds the site and publishes it to GitHub Pages (`.github/workflows/deploy.yml`).

Layout: `src/geometry` (Gridfinity solids, STL), `src/model` (data, layout maths, saved state),
`src/scene` (3D view), `src/ui` (panels, menus, dialogs).

## Credits

Gridfinity is an open modular storage system by Zack Freedman. Built with
[Manifold](https://github.com/elalish/manifold) (Apache-2.0), [three.js](https://threejs.org/),
[react-three-fiber](https://github.com/pmndrs/react-three-fiber), React, zustand, fflate and lucide icons (MIT/ISC).
