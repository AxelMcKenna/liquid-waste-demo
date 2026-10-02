import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { StoreProvider } from './store/context';
import { createIdbStorage } from './store/storage';
import { DemoStore } from './store/store';
import { Shell } from './views/Shell';
import { DispatchView } from './views/Dispatch';
import { DriverView } from './views/Driver';
import { OfficeView } from './views/Office';

const router = createBrowserRouter([
  {
    path: '/',
    element: <Shell />,
    children: [
      { index: true, element: <Navigate to="/dispatch" replace /> },
      { path: 'dispatch', element: <DispatchView /> },
      { path: 'driver', element: <DriverView /> },
      { path: 'office', element: <OfficeView /> },
      { path: '*', element: <Navigate to="/dispatch" replace /> },
    ],
  },
]);

const root = createRoot(document.getElementById('root')!);
const store = new DemoStore(createIdbStorage());

store.init().then(
  () =>
    root.render(
      <StrictMode>
        <StoreProvider store={store}>
          <RouterProvider router={router} />
        </StoreProvider>
      </StrictMode>,
    ),
  () =>
    root.render(
      <div className="boot-error" role="alert">
        <h1>Liquid Waste Demo</h1>
        <p>This browser blocked on-device storage (for example in a private window), so the demo can't save. Open it in a normal window to continue.</p>
      </div>,
    ),
);
