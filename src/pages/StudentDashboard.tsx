import React from 'react'
import { logout } from '../firebase/auth'

export default function StudentDashboard() {
  return (
    <div className="container">
      <h1>Student</h1>
      <p>Shows my lessons now/today/this week.</p>
      <button onClick={() => logout()}>Logout</button>
    </div>
  )
}