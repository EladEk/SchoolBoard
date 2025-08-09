import { useEffect, useState } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../../firebase/app'

type U = { id:string; name?:string; role?:string; email?:string }

export default function AdminUsers() {
  const [users, setUsers] = useState<U[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      try {
        const s = await getDocs(collection(db, 'users'))
        setUsers(s.docs.map(d => ({ id:d.id, /* TODO filled */(d.data() as any) })))
      } catch (e:any) {
        setErr(e?.message || 'Failed to load users')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  if (loading) return <div>Loading users…</div>
  if (err) return <div style={{color:'red'}}>Error: {err}</div>

  return (
    <div style={{padding:16}}>
      <h2 style={{marginTop:0}}>Users</h2>
      <table style={{borderCollapse:'collapse', width:'100%'}}>
        <thead>
          <tr>
            <th style={{textAlign:'left', borderBottom:'1px solid #ddd', padding:'8px'}}>Name</th>
            <th style={{textAlign:'left', borderBottom:'1px solid #ddd', padding:'8px'}}>Role</th>
            <th style={{textAlign:'left', borderBottom:'1px solid #ddd', padding:'8px'}}>Email</th>
            <th style={{textAlign:'left', borderBottom:'1px solid #ddd', padding:'8px'}}>UID</th>
          </tr>
        </thead>
        <tbody>
          {users.map(u => (
            <tr key={u.id}>
              <td style={{padding:'8px'}}>{u.name||'—'}</td>
              <td style={{padding:'8px'}}>{u.role||'—'}</td>
              <td style={{padding:'8px'}}>{(u as any).email||'—'}</td>
              <td style={{padding:'8px', fontFamily:'monospace', fontSize:12}}>{u.id}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
