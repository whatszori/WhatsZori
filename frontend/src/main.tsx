import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './theme/tokens.css';
import './theme/base.css';
import { App } from './app/App';
import { ToastApp } from './toast/ToastApp';

// the desktop app opens a second window for its own notifications, same bundle
const toastWindow = new URLSearchParams(location.search).get('window') === 'toast';
if (toastWindow) document.documentElement.dataset.window = 'toast';

createRoot(document.getElementById('root')!).render(
  <StrictMode>{toastWindow ? <ToastApp /> : <App />}</StrictMode>,
);
