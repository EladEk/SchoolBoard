import { useEffect, useMemo, useState } from 'react';
import { auth, db } from '../../firebase/app';
import {
  addDoc, collection, deleteDoc, doc, onSnapshot, query, where, getDocs
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';

// ==== CONFIG ====
const DAYS = [
  { dow: 0, label: 'Sun' },
  { dow: 1, label: 'Mon' },
  { dow: 2, label: 'Tue' },
  { dow: 3, label: 'Wed' },
  { dow: 4, label: 'Thu' },
  { dow: 5, label: 'Fri' }
  // { dow: 6, label: 'Sat' }, // add if needed
];

const SLOTS: [string, string][] = [
  ['08:30', '09:15'],
  ['09:15', '10:00'],
  ['10:30', '11:15'],
  ['11:15', '12:00'],
  ['12:15', '13:00'],
];

type Role = 'admin'|'teacher'|'student'|'kiosk';
type ClassDoc = { id:string; name:string; teacherId:string; location:string; studentIds:string[] };
type LessonDoc = {
  id: string;
  classId: string;
  subjectId?: string | null;
  name?: string | null;
  teacherId: string;
  dayOfWeek: number; // 0..6
  start: string;     // "HH:MM"
  end: string;       // "HH:MM"
  overrideLocation?: string | null;
};

export default function LessonsScheduler() {
  const [uid, setUid] = useState<string|null>(null);
  const [role, setRole] = useState<Role>('student');
  const [classes, setClasses] = useState<ClassDoc[]>([]);
  const [lessons, setLessons] = useState<LessonDoc[]>([]);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [lessonName, setLessonName] = useState('');
  const [subjectId, setSubjectId] = useState('');

  // who am I + role
  useEffect(() => {
    const off = onAuthStateChanged(auth, async (u) => {
      setUid(u?.uid ?? null);
      if (!u) return;
      const { getDoc, doc: d } = await import('firebase/firestore');
      const snap = await getDoc(d(db, 'users', u.uid));
      setRole((snap.data()?.role ?? 'student') as Role);
    });
    return off;
  }, []);

  // load classes (read-only for teachers)
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'classes'), (s) => {
      const list = s.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as ClassDoc[];
      setClasses(list);
      if (!selectedClassId && list.length) setSelectedClassId(list[0].id);
    });
    return unsub;
  }, []);

  // load lessons for selected class
  useEffect(() => {
    if (!selectedClassId) return;
    const q = query(collection(db, 'lessons'), where('classId', '==', selectedClassId));
    return onSnapshot(q, (s) => {
      setLessons(s.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as LessonDoc[]);
    });
  }, [selectedClassId]);

  const occupied = useMemo(() => {
    const map = new Map<string, LessonDoc>();
    for (const l of lessons) {
      map.set(`${l.dayOfWeek}|${l.start}|${l.end}`, l);
    }
    return map;
  }, [lessons]);

  const canCreate = useMemo(() => {
    if (!uid) return false;
    return role === 'admin' || role === 'teacher';
  }, [role, uid]);

  async function toggleCell(dayOfWeek: number, start: string, end: string) {
    if (!uid || !selectedClassId) return;

    const key = `${dayOfWeek}|${start}|${end}`;
    const existing = occupied.get(key);

    if (existing) {
      const ok = confirm(`Remove lesson "${existing.name ?? '-'}" at ${start}-${end}?`);
      if (!ok) return;
      await deleteDoc(doc(db, 'lessons', existing.id));
      return;
    }

    if (!canCreate) { alert('Not allowed.'); return; }
    if (!lessonName.trim() && !subjectId.trim()) {
      const ok = confirm('No Lesson name or subject selected. Create anyway?');
      if (!ok) return;
    }

    // collision check
    const q = query(
      collection(db, 'lessons'),
      where('classId', '==', selectedClassId),
      where('dayOfWeek', '==', dayOfWeek),
      where('start', '==', start),
      where('end', '==', end)
    );
    const snap = await getDocs(q);
    if (!snap.empty) { alert('There is already a lesson at this time.'); return; }

    const teacherId = role === 'admin' ? await pickTeacherIdForAdmin(uid, selectedClassId) : uid;
    if (!teacherId) return;

    await addDoc(collection(db, 'lessons'), {
      classId: selectedClassId,
      subjectId: subjectId || null,
      name: lessonName || null,
      teacherId,
      dayOfWeek,
      start,
      end,
      overrideLocation: null
    });
  }

  async function pickTeacherIdForAdmin(fallbackUid: string, classId: string) {
    if (role !== 'admin') return fallbackUid;
    const c = classes.find(x => x.id === classId);
    if (!c) return fallbackUid;
    const choice = prompt(`Teacher UID for this lesson? (Enter for class owner)\nClass owner: ${c.teacherId}\nSelf: ${fallbackUid}`, c.teacherId || '');
    return (choice && choice.trim()) || c.teacherId || fallbackUid;
  }

  return (
    <div style={{ display:'grid', gap:16 }}>
      <h2>Lessons Scheduler</h2>

      <div style={{ display:'grid', gap:8, gridTemplateColumns:'1fr 1fr 1fr' }}>
        <div>
          <label>Lesson name</label>
          <input
            value={lessonName}
            onChange={e=>setLessonName(e.target.value)}
            placeholder="e.g. Math Group A"
          />
        </div>

        <div>
          <label>Class (where it takes part)</label>
          <select value={selectedClassId} onChange={e=>setSelectedClassId(e.target.value)}>
            {classes.map(c => <option key={c.id} value={c.id}>{c.name} — {c.location}</option>)}
          </select>
        </div>

        <div>
          <label>Subject ID (optional)</label>
          <input
            value={subjectId}
            onChange={e=>setSubjectId(e.target.value)}
            placeholder="subjects/{id}"
          />
        </div>
      </div>

      <div style={{ overflowX:'auto' }}>
        <table style={{ borderCollapse:'collapse', minWidth: 900 }}>
          <thead>
            <tr>
              <th style={th}>Time</th>
              {DAYS.map(d => (
                <th key={d.dow} style={th}>{d.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SLOTS.map(([start, end]) => (
              <tr key={`${start}-${end}`}>
                <td style={timeCell}>{start}–{end}</td>
                {DAYS.map(d => {
                  const key = `${d.dow}|${start}|${end}`;
                  const existing = occupied.get(key);
                  const filled = Boolean(existing);
                  const label = existing?.name || '—';
                  return (
                    <td
                      key={key}
                      onClick={() => toggleCell(d.dow, start, end)}
                      style={{
                        ...cell,
                        background: filled ? 'rgba(0,150,255,0.15)' : 'transparent',
                        cursor: (role === 'admin' || role === 'teacher') ? 'pointer' : 'default'
                      }}
                      title={filled ? `Lesson: ${label}` : 'Empty'}
                    >
                      {filled ? (label || 'Lesson') : ''}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <small>
        Tip: Click a filled cell to <b>remove</b> that lesson. Admins can choose any teacher; teachers schedule for themselves.
      </small>
    </div>
  );
}

// --- styles ---
const th: React.CSSProperties = { borderBottom:'1px solid #333', padding:'8px 10px', textAlign:'center' };
const cell: React.CSSProperties = { border:'1px solid #333', minWidth:120, height:44, textAlign:'center' };
const timeCell: React.CSSProperties = { ...cell, fontWeight:600, background:'rgba(255,255,255,0.04)' };
