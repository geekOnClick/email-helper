import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CssBaseline } from '@mui/material';
import { App } from './App';

const container = document.getElementById('root');
if (!container) throw new Error('элемент #root не найден');

createRoot(container).render(
  <StrictMode>
    <CssBaseline />
    <App />
  </StrictMode>,
);
