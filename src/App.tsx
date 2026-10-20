import { useEffect } from 'react';
import { useStore } from './model/store';
import { Viewport } from './scene/Viewport';
import { handleKeyDown } from './ui/commands';
import { Dialogs, Toast } from './ui/Dialogs';
import { Inspector } from './ui/Inspector';
import { Sidebar } from './ui/Sidebar';
import { TopBar } from './ui/TopBar';

export function App() {
  const leftOpen = useStore((s) => s.prefs.leftOpen);
  const rightOpen = useStore((s) => s.prefs.rightOpen);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className={`app ${leftOpen ? '' : 'no-left'} ${rightOpen ? '' : 'no-right'}`}>
      <TopBar />
      {leftOpen && <Sidebar />}
      <main className="stage">
        <Viewport />
      </main>
      {rightOpen && <Inspector />}
      <Dialogs />
      <Toast />
    </div>
  );
}
