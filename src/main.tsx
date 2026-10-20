import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { loadKernel } from './geometry/kernel';
import './styles.css';

// Start loading the geometry kernel right away.
void loadKernel();

if (import.meta.env.DEV) {
  // Debug hook for poking at the app from the devtools console.
  void Promise.all([import('./model/store'), import('./scene/interaction')]).then(([store, interaction]) => {
    (window as unknown as Record<string, unknown>).__gfp = {
      store: store.useStore,
      actions: store,
      three: interaction.threeState,
      render: () => {
        const s = interaction.threeState();
        if (s) s.gl.render(s.scene, s.camera);
      },
    };
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
