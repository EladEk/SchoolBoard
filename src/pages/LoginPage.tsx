import { useState } from 'react'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { auth } from '../firebase/app'
import { useNavigate } from 'react-router-dom'

export default function LoginPage() {
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string|undefined>()

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr(undefined)
    try {
      await signInWithEmailAndPassword(auth, email, password)
      nav('/')
    } catch (e:any) {
      setErr(e?.message || 'Login failed')
    }
  }

  return (
    <div style={{minHeight:'100vh', display:'grid', placeItems:'center', background:'#0b0b0b', color:'#fff'}}>
      <form onSubmit={onSubmit} style={{background:'#121212', padding:24, borderRadius:12, width:360}}>
        <h2 style={{marginTop:0}}>SchoolBoard Login</h2>
        <div style={{display:'grid', gap:8}}>
          <label>Email</label>
          <input type="email" value={email} onChange={e=>setEmail(e.target.value)} required style={{padding:8, borderRadius:6}}/>
          <label>Password</label>
          <input type="password" value={password} onChange={e=>setPassword(e.target.value)} required style={{padding:8, borderRadius:6}}/>
          {err && <div style={{color:'salmon'}}>{err}</div>}
          <button type="submit" style={{marginTop:12}}>Sign In</button>
        </div>
      </form>
    </div>
  )
}
