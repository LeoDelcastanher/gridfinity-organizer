import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';

let kernel: Promise<ManifoldToplevel> | null = null;

/**
 * Loads the manifold WASM once. manifold locates its binary with
 * `new URL('manifold.wasm', import.meta.url)`, which Vite serves in dev and
 * inlines as a data: URL in the single-file build, so it also works offline
 * from a file:// page.
 */
export function loadKernel(): Promise<ManifoldToplevel> {
  if (!kernel) {
    kernel = Module().then((mod) => {
      mod.setup();
      return mod;
    });
    kernel.catch((err) => {
      console.error('Could not load the geometry kernel', err);
      kernel = null;
    });
  }
  return kernel;
}
