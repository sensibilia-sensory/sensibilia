import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Router } from './router';
import { applyTheme, storedTheme } from './researcher/theme';
import '@fontsource-variable/inter';
import '@fontsource/ibm-plex-mono/400.css';
import './styles/tokens.css';
import './styles/base.css';
import './ui/ui.css';

// Avoid a flash of the light theme on researcher screens; the assessor app is never themed.
if (location.pathname.startsWith('/researcher')) applyTheme(storedTheme());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Router />
  </StrictMode>,
);
