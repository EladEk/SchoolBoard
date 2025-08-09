import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import './styles/global.css'
import DisplayPage from './pages/DisplayPage'
import AdminDashboard from './pages/AdminDashboard'
import TeacherDashboard from './pages/TeacherDashboard'
import StudentDashboard from './pages/StudentDashboard'
import { AuthGate, RoleGate } from './utils/guards'
import LoginPage from './pages/LoginPage'

const router = createBrowserRouter([
  { path: '/', element: <LoginPage /> },
  { path: '/display', element: <DisplayPage /> },
  { path: '/admin', element: <AuthGate><RoleGate roles={['admin']}><AdminDashboard/></RoleGate></AuthGate> },
  { path: '/teacher', element: <AuthGate><RoleGate roles={['teacher','admin']}><TeacherDashboard/></RoleGate></AuthGate> },
  { path: '/student', element: <AuthGate><RoleGate roles={['student','admin']}><StudentDashboard/></RoleGate></AuthGate> }
])

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
)