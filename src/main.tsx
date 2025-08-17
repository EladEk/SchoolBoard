// src/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import './styles/global.css';
import './i18n';

import DisplayPage from './pages/DisplayPage';
import AdminDashboard from './pages/AdminDashboard';
import TeacherDashboard from './pages/TeacherDashboard';
import StudentDashboard from './pages/StudentDashboard';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';

import { RequireRole } from './utils/requireRole';

function UnauthorizedPage() {
  return (
    <div style={{ minHeight: '100vh', display:'grid', placeItems:'center', background:'#0b0b0b', color:'#fff' }}>
      <div style={{ textAlign:'center' }}>
        <h1>🚫 Unauthorized</h1>
        <p>You do not have permission to view this page.</p>
        <a href="/" style={{ color:'#4da3ff', textDecoration:'underline' }}>Go to Login</a>
      </div>
    </div>
  );
}
function NotFoundPage() {
  return (
    <div style={{ minHeight:'100vh', display:'grid', placeItems:'center', background:'#0b0b0b', color:'#fff' }}>
      <h1>404 - Page Not Found</h1>
    </div>
  );
}

const router = createBrowserRouter(
  [
    { path: '/', element: <LoginPage /> },
    { path: '/signup', element: <SignupPage /> },

    {
      path: '/display',
      element: (
        <RequireRole allowed={['kiosk','admin']}>
          <DisplayPage />
        </RequireRole>
      ),
    },
    {
      path: '/admin',
      element: (
        <RequireRole allowed={['admin']}>
          <AdminDashboard />
        </RequireRole>
      ),
    },
    {
      path: '/teacher',
      element: (
        <RequireRole allowed={['teacher','admin']}>
          <TeacherDashboard />
        </RequireRole>
      ),
    },
    {
      path: '/student',
      element: (
        <RequireRole allowed={['student','admin']}>
          <StudentDashboard />
        </RequireRole>
      ),
    },

    { path: '/unauthorized', element: <UnauthorizedPage /> },
    { path: '*', element: <NotFoundPage /> },
  ],
  {
    future: {
      v7_startTransition: true,
      v7_relativeSplatPath: true,
      v7_fetcherPersist: true,
      v7_normalizeFormMethod: true,
    },
  }
);

const providerFuture = {
  v7_startTransition: true,
  v7_relativeSplatPath: true,
  v7_fetcherPersist: true,
  v7_normalizeFormMethod: true,
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} future={providerFuture} />
  </React.StrictMode>
);
