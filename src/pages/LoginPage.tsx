import React, { useState } from 'react'
import { login } from '../firebase/auth'
import { useNavigate } from 'react-router-dom'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const nav = useNavigate()

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null)
    try {
      const { user } = await login(email, password)
      // naive redirect choice; real app should read role
      nav('/student')
    } catch (e: any) {
      setErr(e.message)
    }
  }

  return (
    <div className="container">
      <h1>כניסה</h1>
      <form onSubmit={onSubmit} style={{display:'grid', gap:8, maxWidth:320}}>
        <input placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} />
        <input placeholder="Password" type="password" value={password} onChange={e=>setPassword(e.target.value)} />
        <button type="submit">Login</button>
        {err && <div style={{color:'crimson'}}>{err}</div>}
      </form>
      <p>תצוגת מסדרון: <a href="/display">/display</a></p>
    </div>
  )
}