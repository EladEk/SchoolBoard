import { useEffect, useMemo, useState } from 'react'
import { arrayRemove, arrayUnion, collection, doc, getDoc, getDocs, updateDoc, where, query } from 'firebase/firestore'
import { db } from '../../firebase/app'
import { getAuth } from 'firebase/auth'

type Cls = { id:string; name:string; studentIds?: string[] }
type U = { id:string; name?:string; role?:string }

export default function TeacherClassRoster() {
  const auth = getAuth()
  const [classes, setClasses] = useState<Cls[]>([])
  const [users, setUsers] = useState<U[]>([])
  const [selected, setSelected] = useState<string>('')

  useEffect(() => {
    ;(async () => {
      const uid = auth.currentUser?.uid
      if (!uid) return

      // Classes taught by this teacher (by lessons collection)
      const lq = query(collection(db, 'lessons'), where('teacherId', '==', uid))
      const lSnap = await getDocs(lq)
      const classIds = Array.from(new Set(lSnap.docs.map(d => (d.data() as any).classId)))
      const clsSnap = await getDocs(collection(db, 'classes'))
      const cls: Cls[] = clsSnap.docs.map(d => ({ id:d.id, ...(d.data() as any) }))
      setClasses(cls.filter(c => classIds.includes(c.id)))

      const uSnap = await getDocs(collection(db, 'users'))
      setUsers(uSnap.docs.map(d => ({ id:d.id, ...(d.data() as any) })))
    })()
  }, [])

  const roster = useMemo(() => {
    const cls = classes.find(c => c.id === selected)
    if (!cls) return []
    return (cls.studentIds || []).map(id => users.find(u => u.id === id)).filter(Boolean) as U[]
  }, [classes, users, selected])

  async function addStudent(uid: string) {
    if (!selected) return
    await updateDoc(doc(db, 'classes', selected), { studentIds: arrayUnion(uid) })
    setClasses(prev => prev.map(c => c.id===selected ? ({...c, studentIds:[...(c.studentIds||[]), uid]}) : c))
  }

  async function removeStudent(uid: string) {
    if (!selected) return
    await updateDoc(doc(db, 'classes', selected), { studentIds: arrayRemove(uid) })
    setClasses(prev => prev.map(c => c.id===selected ? ({...c, studentIds:(c.studentIds||[]).filter(x=>x!==uid)}) : c))
  }

  return (
    <div style={{padding:16}}>
      <h2>My Class Rosters</h2>
      <div style={{display:'flex', gap:12, alignItems:'center'}}>
        <label>Class:</label>
        <select value={selected} onChange={e=>setSelected(e.target.value)}>
          <option value="">Select</option>
          {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {selected && (
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginTop:16}}>
          <div>
            <h3>Roster</h3>
            <ul>
              {roster.map(s => (
                <li key={s.id} style={{display:'flex', justifyContent:'space-between', padding:'4px 0'}}>
                  <span>{s.name || s.id}</span>
                  <button onClick={()=>removeStudent(s.id)}>Remove</button>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3>All Students</h3>
            <ul style={{maxHeight:320, overflowY:'auto'}}>
              {users.filter(u => u.role==='student' && !(classes.find(c => c.id===selected)?.studentIds||[]).includes(u.id)).map(s => (
                <li key={s.id} style={{display:'flex', justifyContent:'space-between', padding:'4px 0'}}>
                  <span>{s.name || s.id}</span>
                  <button onClick={()=>addStudent(s.id)}>Add</button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
