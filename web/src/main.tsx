import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from '@/App';
import { RootErrorBoundary } from '@/components/shell/RootErrorBoundary';
import { installErrorCapture } from '@/diagnostics/capture';

import '@/styles/theme.css';

// Hardening & Pilot §I: window errors, unhandled rejections and unexpected 5xx are queued from the start.
installErrorCapture();

const root = document.getElementById('root');
if (!root) throw new Error('The #root element is missing from index.html.');

createRoot(root).render(
  <StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </StrictMode>,
);
