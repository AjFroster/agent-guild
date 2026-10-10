import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.tsx';
import { applyTheme, readSettings } from './settings.ts';
import './fonts.ts';
import './styles.css';
import './themes.css';

// Before the first paint, so the page never flashes the wrong theme.
applyTheme(readSettings().theme);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
