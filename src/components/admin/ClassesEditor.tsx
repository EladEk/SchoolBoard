import { useEffect, useState } from 'react';
import {
  collection, query, onSnapshot, addDoc, updateDoc, doc
} from 'firebase/firestore';
import { db } from '../../firebase/app';
import { auth } from '../../firebase/app';
import { onAuthStateChanged } from 'firebase/auth';
import { getDoc, doc as docRef } from 'firebase/firestore';

type ClassDoc = { id:string; name:string; teacherId:string; location:string; studentIds:string[] };

export default function ClassesEditor() {
  const [uid, setUid] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<string>('unknown');
  const [classes, setClasses] = useState<ClassDoc[]>([]);
  const [form, setForm] = useState<{name:string; location:string; teacherId:string; studentIds:string[]}>({
    name:'', location:'', teacherId:'', studentIds:[]
  });

  useEffect(() => {
    const off = onAuthStateChanged(auth, async (u) => {
      setUid(u?.uid ?? null);
      if (!u) return setMyRole('unknown');
      const snap = await getDoc(docRef(db, 'users', u.uid));
      setMyRole((snap.data()?.role ?? 'unknown') as string);
    });
    return off;
  }, []);

  // Admin-only listing
  useEffect(() => {
    if (myRole !== 'admin') return;
    const unsub = onSnapshot(query(collection(db, 'classes')), s => {
      setClasses(s.docs.map(d => ({ id: d.id, /* TODO filled */(d.data() as any) })));
    });
    return unsub;
  }, [myRole]);

  if (myRole !== 'admin') {
    return <p>Only admins can manage classes.</p>;
  }

  const createClass = async () => {
    await addDoc(collection(db, 'classes'), {
      name: form.name || 'כיתה חדשה',
      location: form.location || 'חדר TBD',
      teacherId: form.teacherId || (uid ?? ''),
      studentIds: form.studentIds || []
    });
    setForm({ name:'', location:'', teacherId:'', studentIds:[] });
  };

  const rename = async (c: ClassDoc) => {
    const name = prompt('New class name', c.name);
    if (name && name.trim()) await updateDoc(doc(db, 'classes', c.id), { name: name.trim() });
  };

  const relabel = async (c: ClassDoc) => {
    const location = prompt('New room/location', c.location);
    if (location && location.trim()) await updateDoc(doc(db, 'classes', c.id), { location: location.trim() });
  };

  const reassignTeacher = async (c: ClassDoc) => {
    const t = prompt('New teacher UID', c.teacherId);
    if (t && t.trim()) await updateDoc(doc(db, 'classes', c.id), { teacherId: t.trim() });
  };

  const setStudents = async (c: ClassDoc) => {
    const csv = prompt('Student IDs (comma-separated)', c.studentIds.join(','));
    if (csv !== null) {
      const ids = csv.split(',').map(s => s.trim()).filter(Boolean);
      await updateDoc(doc(db, 'classes', c.id), { studentIds: ids });
    }
  };

  return (
    <div style={{ display:'grid', gap:12 }}>
      <h2>Classes (Admin)</h2>

      <div style={{ display:'grid', gap:8, gridTemplateColumns:'1fr 1fr 1fr' }}>
        <input placeholder="Class name" value={form.name} onChange={e=>setForm({/* TODO filled */form, name:e.target.value})}/>
        <input placeholder="Location / Room" value={form.location} onChange={e=>setForm({/* TODO filled */form, location:e.target.value})}/>
        <input placeholder="Teacher UID" value={form.teacherId} onChange={e=>setForm({/* TODO filled */form, teacherId:e.target.value})}/>
        <button style={{ gridColumn:'span 3' }} onClick={createClass}>Create Class</button>
      </div>

      <table>
        <thead><tr><th>Name</th><th>Room</th><th>Teacher</th><th>#Students</th><th>Actions</th></tr></thead>
        <tbody>
          {classes.map(c => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td>{c.location}</td>
              <td>{c.teacherId}</td>
              <td>{c.studentIds?.length ?? 0}</td>
              <td style={{ display:'flex', gap:6 }}>
                <button onClick={()=>rename(c)}>Rename</button>
                <button onClick={()=>relabel(c)}>Room</button>
                <button onClick={()=>reassignTeacher(c)}>Reassign</button>
                <button onClick={()=>setStudents(c)}>Students</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
