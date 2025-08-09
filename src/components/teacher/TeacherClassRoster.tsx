import { useEffect, useState } from 'react';
import { auth, db } from '../../firebase/app';
import {
  collection, onSnapshot, query, where, updateDoc, doc, getDoc
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';

type ClassDoc = { id:string; name:string; teacherId:string; location:string; studentIds:string[] };
type Student = { id:string; name:string; username?:string };

export default function TeacherClassRoster() {
  const [uid, setUid] = useState<string | null>(null);
  const [classes, setClasses] = useState<ClassDoc[]>([]);
  const [students, setStudents] = useState<Student[]>([]);

  useEffect(() => {
    const off = onAuthStateChanged(auth, u => setUid(u?.uid ?? null));
    return off;
  }, []);

  // Load my classes (teacherId == uid)
  useEffect(() => {
    if (!uid) return;
    const q = query(collection(db, 'classes'), where('teacherId', '==', uid));
    return onSnapshot(q, s => {
      setClasses(s.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    });
  }, [uid]);

  // Load all students for quick pick (could be filtered/paginated in real app)
  useEffect(() => {
    const q = query(collection(db, 'users'), where('role', '==', 'student'));
    return onSnapshot(q, s => {
      setStudents(s.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    });
  }, []);

  if (!uid) return null;

  const toggleStudent = async (c: ClassDoc, studentId: string) => {
    const set = new Set(c.studentIds || []);
    if (set.has(studentId)) set.delete(studentId); else set.add(studentId);
    await updateDoc(doc(db, 'classes', c.id), { studentIds: Array.from(set) });
  };

  const setFromCSV = async (c: ClassDoc) => {
    const csv = prompt('Student IDs (comma-separated)', c.studentIds.join(','));
    if (csv === null) return;
    const ids = csv.split(',').map(s => s.trim()).filter(Boolean);
    await updateDoc(doc(db, 'classes', c.id), { studentIds: ids });
  };

  return (
    <div style={{ display:'grid', gap: 12 }}>
      <h2>My Classes — Student Roster</h2>
      {classes.length === 0 && <p>You don't own any classes yet.</p>}
      {classes.map(c => (
        <div key={c.id} style={{ border:'1px solid #444', borderRadius:8, padding:12, display:'grid', gap:8 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <b>{c.name}</b>
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={() => setFromCSV(c)}>Set via CSV</button>
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(180px, 1fr))', gap:8 }}>
            {students.map(s => {
              const checked = (c.studentIds || []).includes(s.id);
              return (
                <label key={s.id} style={{ border:'1px solid #666', padding:8, borderRadius:6, cursor:'pointer' }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleStudent(c, s.id)}
                    style={{ marginRight:8 }}
                  />
                  {s.name || s.id}
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
