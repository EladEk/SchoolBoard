import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import './styles/global.css';

import DisplayPage from './pages/DisplayPage';
import AdminDashboard from './pages/AdminDashboard';
import TeacherDashboard from './pages/TeacherDashboard';
import StudentDashboard from './pages/StudentDashboard';
import { AuthGate, RoleGate } from './utils/guards';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';

// Simple Unauthorized page
function UnauthorizedPage() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0b0b0b', color: '#fff' }}>
      <div style={{ textAlign: 'center' }}>
        <h1>🚫 Unauthorized</h1>
        <p>You do not have permission to view this page.</p>
        <a href="/" style={{ color: '#4da3ff', textDecoration: 'underline' }}>Go to Login</a>
      </div>
    </div>
  );
}

// Simple 404 page
function NotFoundPage() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0b0b0b', color: '#fff' }}>
      <h1>404 - Page Not Found</h1>
    </div>
  );
}

const router = createBrowserRouter([
  { path: '/', element: <LoginPage /> },
  { path: '/signup', element: <SignupPage /> }, // <— add this
  { path: '/display', element: <DisplayPage /> },
  {
    path: '/admin',
    element: (
      <AuthGate>
        <RoleGate roles={['admin']}>
          <AdminDashboard />
        </RoleGate>
      </AuthGate>
    ),
  },
  {
    path: '/teacher',
    element: (
      <AuthGate>
        <RoleGate roles={['teacher', 'admin']}>
          <TeacherDashboard />
        </RoleGate>
      </AuthGate>
    ),
  },
  {
    path: '/student',
    element: (
      <AuthGate>
        <RoleGate roles={['student', 'admin']}>
          <StudentDashboard />
        </RoleGate>
      </AuthGate>
    ),
  },
  { path: '/unauthorized', element: <UnauthorizedPage /> },
  { path: '*', element: <NotFoundPage /> }, // catch-all
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
