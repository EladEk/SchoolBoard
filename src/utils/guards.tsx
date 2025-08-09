import React, { useEffect, useState } from 'react'
import { onUser, fetchAppUser, AppUser } from '../firebase/auth'
import { Navigate } from 'react-router-dom'

export const AuthGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [ready, setReady] = useState(false)
  const [u, setU] = useState<any>(null)
  useEffect(() => onUser(user => { setU(user); setReady(true) }), [])
  if (!ready) return <div style={{padding:20}}>Loading/* TODO filled */</div>
  if (!u) return <Navigate to="/" replace />
  return <>{children}</>
}

export const RoleGate: React.FC<{ roles: Array<'admin'|'teacher'|'student'|'kiosk'>, children: React.ReactNode }> = ({ roles, children }) => {
  const [user, setUser] = useState<AppUser | null>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => onUser(async u => {
    if (u) setUser(await fetchAppUser(u.uid))
    setReady(true)
  }), [])
  if (!ready) return <div style={{padding:20}}>Loading/* TODO filled */</div>
  if (!user || !roles.includes(user.role)) return <div style={{padding:20}}>Access denied</div>
  return <>{children}</>
}