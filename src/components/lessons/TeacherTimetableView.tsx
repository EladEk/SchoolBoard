// src/components/lessons/TeacherTimetableView.tsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  collection, doc, getDoc, getDocs, onSnapshot, query, where
} from 'firebase/firestore';
import { db } from '../../firebase/app';
import './LessonsScheduler.css'; // reuse existing styles
import { useTranslation } from 'react-i18next';

// ---------- Types ----------
type Role = 'admin' | 'teacher' | 'student' | 'kiosk';
type AppUser = {
  id: string;
  username?: string;
  usernameLower?: string;
  firstName?: string;
  lastName?: string;
  role: Role;
};
type SchoolClass = { id: string; name: string; location?: string; classId?: string };
type Lesson = {
  id: string;
  name: string;
  isStudentTeacher?: boolean;
  teacherUserId?: string | null;
  studentUserId?: string | null;
  teacherFirstName?: string | null; teacherLastName?: string | null; teacherUsername?: string | null;
  studentFirstName?: string | null; studentLastName?: string | null; studentUsername?: string | null;
};
type Entry = {
  id: string;
  classId: string;        // can be doc id or business ClassID
  lessonId: string;
  day: number;            // 0..6 (Sun..Sat)
  startMinutes: number;   // inclusive
  endMinutes: number;     // exclusive
};

// ---------- Time grid helpers (edit to your bell schedule) ----------
function toMinutes(hm: string){ const [h,m]=hm.split(':').map(Number); return h*60+m; }
// Edit these times if your school uses different bells:
const TIME_POINTS = ['08:00','08:45','09:30','10:15','11:00','11:45','12:30','13:15','14:00'];
const SLOTS = TIME_POINTS.slice(0,-1).map((start,i)=>({
  start, end: TIME_POINTS[i+1]!, sm: toMinutes(start), em: toMinutes(TIME_POINTS[i+1]!)
}));

function normalizeEntry(id: string, raw: any): Entry {
  const toInt = (v:any) => typeof v === 'string' ? parseInt(v, 10) : Number(v);
  return {
    id,
    classId: String(raw.classId ?? ''),
    lessonId: String(raw.lessonId ?? ''),
    day: toInt(raw.day ?? 0) || 0,
    startMinutes: toInt(raw.startMinutes ?? raw.sm ?? 0) || 0,
    endMinutes: toInt(raw.endMinutes ?? raw.em ?? 0) || 0,
  };
}

type Props = { teacherUsername?: string };

// ---------- Robust session resolver ----------
async function resolveUserFromSession(overrideTeacherUsername?: string): Promise<AppUser | null> {
  let session: any = {};
  try { session = JSON.parse(localStorage.getItem('session') || '{}') || {}; } catch {}
  const candidateIds = [
    session?.id, session?.uid, session?.userId, session?.user?.id, session?.user?.uid, session?.userDocId
  ].filter(Boolean);

  // 1) Try by explicit Firestore doc id(s)
  for (const rawId of candidateIds) {
    try {
      const ref = doc(db, 'appUsers', String(rawId));
      const snap = await getDoc(ref);
      if (snap.exists()) return { id: snap.id, ...(snap.data() as any) };
    } catch {/* ignore and continue */}
  }

  // 2) Try by username (override → session.username → session.user.username)
  const username =
    (overrideTeacherUsername ||
     session?.username ||
     session?.userName ||
     session?.user?.username ||
     session?.user?.userName ||
     ''
    ).toString().trim();

  const usernameLower =
    (session?.usernameLower ||
     session?.user?.usernameLower ||
     username.toLowerCase() ||
     ''
    ).toString().trim();

  if (usernameLower) {
    const s = await getDocs(query(collection(db, 'appUsers'), where('usernameLower', '==', usernameLower)));
    if (!s.empty) { const d = s.docs[0]; return { id: d.id, ...(d.data() as any) }; }
  }
  if (username) {
    const s = await getDocs(query(collection(db, 'appUsers'), where('username', '==', username)));
    if (!s.empty) { const d = s.docs[0]; return { id: d.id, ...(d.data() as any) }; }
  }

  return null;
}

export default function TeacherTimetableView({ teacherUsername }: Props) {
  const { t, i18n } = useTranslation(['timetable','teacher','common']);

  // ---------- Resolve target user (auto from session, or override) ----------
  const [me, setMe] = useState<AppUser | null>(null);
  const [whoErr, setWhoErr] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    (async () => {
      const u = await resolveUserFromSession(teacherUsername);
      if (canceled) return;
      if (u) { setMe(u); setWhoErr(null); }
      else { setMe(null); setWhoErr(null); /* stay quiet if none found */ }
    })();
    return () => { canceled = true; };
  }, [teacherUsername]);

  // ---------- Load classes for labeling ----------
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, 'classes')), s =>
      setClasses(s.docs.map(d => ({ id: d.id, ...(d.data() as any) })))
    );
    return () => unsub();
  }, []);

  function classLabel(entry: Entry): string {
    const byDocId = classes.find(c => c.id === entry.classId);
    if (byDocId) return [byDocId.name, byDocId.location, byDocId.classId].filter(Boolean).join(' · ');
    const byBizId = classes.find(c => c.classId === entry.classId);
    if (byBizId) return [byBizId.name, byBizId.location, byBizId.classId].filter(Boolean).join(' · ');
    return entry.classId || '';
  }

  // ---------- Load my lessons (teacher or student-teacher) ----------
  const [myLessons, setMyLessons] = useState<Lesson[]>([]);
  useEffect(() => {
    if (!me?.id) { setMyLessons([]); return; }

    const qTeacher = query(collection(db, 'lessons'), where('teacherUserId','==', me.id));
    const qStudent = query(collection(db, 'lessons'), where('studentUserId','==', me.id));

    const latest: Record<string, Lesson> = {};
    const pushAll = (docs: Lesson[]) => {
      for (const l of docs) latest[l.id] = l;
      setMyLessons(Object.values(latest).sort((a,b)=> (a.name||'').localeCompare(b.name||'')));
    };

    const u1 = onSnapshot(qTeacher, s => pushAll(s.docs.map(d => ({ id:d.id, ...(d.data() as any) }))));
    const u2 = onSnapshot(qStudent, s => pushAll(s.docs.map(d => ({ id:d.id, ...(d.data() as any) }))));

    return () => { u1(); u2(); };
  }, [me?.id]);

  const myLessonIds = useMemo(() => new Set(myLessons.map(l => l.id)), [myLessons]);
  const lessonNameOf = (id?: string) => id ? (myLessons.find(l=>l.id===id)?.name || '') : '';

  // ---------- Load timetable entries for ALL my lessons (full week) ----------
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const ids = Array.from(myLessonIds);
    if (!ids.length) { setEntries([]); return; }

    setLoading(true);

    // Firestore "in" limit is 10 -> chunk
    const chunkSize = 10;
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += chunkSize) chunks.push(ids.slice(i, i + chunkSize));

    const chunkResults = new Map<number, Entry[]>();
    const unsubs = chunks.map((idsChunk, idx) => {
      const qy = query(collection(db, 'timetableEntries'), where('lessonId', 'in', idsChunk));
      return onSnapshot(
        qy,
        (s) => {
          const next = s.docs.map(d => normalizeEntry(d.id, d.data()));
          chunkResults.set(idx, next);
          const merged = Array.from(chunkResults.values()).flat();
          merged.sort((a,b)=> a.day - b.day || a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes);
          setEntries(merged);
          setLoading(false);
        },
        (err) => {
          console.error('timetableEntries onSnapshot error:', err);
          chunkResults.set(idx, []);
          const merged = Array.from(chunkResults.values()).flat();
          setEntries(merged);
          setLoading(false);
        }
      );
    });

    return () => { unsubs.forEach(u => u()); };
  }, [myLessonIds]);

  // ---------- i18n day labels ----------
  const daysLabels: string[] = useMemo(() => {
    const arr = (t('timetable:days', { returnObjects: true }) as any) || [];
    if (!Array.isArray(arr) || arr.length !== 7) return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    return arr;
  }, [t, i18n.language]);

  const dayIndexes = [0,1,2,3,4,5,6];

  // Build lookup for each cell (day + slot)
  const cellMap = useMemo(() => {
    const m = new Map<string, Entry[]>();
    for (const e of entries) {
      const key = `${e.day}-${e.startMinutes}-${e.endMinutes}`;
      const arr = m.get(key) || [];
      arr.push(e);
      m.set(key, arr);
    }
    return m;
  }, [entries]);

  return (
    <div className="ls-wrap">
      <div className="ls-header">
        <div className="ls-title">
          <span className="ls-title-dot" />
          {t('teacher:weekTitle', 'My weekly schedule')}
        </div>

        <div className="ls-legend">
          <span className="ls-badge">{t('timetable:legend.selectedExisting')}</span>
          <span className="ls-badge">{t('timetable:legend.taken')}</span>
          <span className="ls-badge">{t('timetable:legend.pending')}</span>
        </div>
      </div>

      {/* status line */}
      <div style={{margin:'6px 2px', fontSize:12, color:'#9aa0a6'}}>
        {me?.username ? `${me.firstName || ''} ${me.lastName || ''} (${me.username})`.trim() : ''}
        {loading ? ` · ${t('common:loading', 'Loading…')}` : ''}
        {!me && !loading && whoErr ? `⚠ ${whoErr}` : ''}
      </div>

      {/* Weekly grid */}
      <div className="ls-table-scroller">
        <table className="ls-table">
          <thead>
            <tr>
              <th className="ls-th ls-th-time">{t('timetable:headers.timeDay')}</th>
              {dayIndexes.map((dIdx) => (
                <th key={dIdx} className="ls-th">{daysLabels[dIdx] || ''}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SLOTS.map(({start,end,sm,em})=>(
              <tr key={start}>
                <td className="ls-td-time">{start}–{end}</td>
                {dayIndexes.map((dIdx) => {
                  const key = `${dIdx}-${sm}-${em}`;
                  const cellEntries = cellMap.get(key) || [];
                  const has = cellEntries.length > 0;
                  return (
                    <td
                      key={dIdx}
                      className="ls-td"
                      style={{
                        backgroundColor: has ? '#0c4a6e' : '#141414',
                        color: has ? '#dbeafe' : '#c7c7c7',
                        cursor: 'default'
                      }}
                      title={cellEntries.map(e => `${lessonNameOf(e.lessonId)} — ${classLabel(e)}`).join('\n')}
                    >
                      <div className="ls-cell">
                        <div className="ls-cell-text" style={{ display:'grid', gap: 4 }}>
                          {!has ? '—' : cellEntries.map(e=>(
                            <div key={e.id} style={{ whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                              {lessonNameOf(e.lessonId)} · {classLabel(e)}
                            </div>
                          ))}
                        </div>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
            {!SLOTS.length && (
              <tr>
                <td colSpan={8} className="ls-td" style={{ textAlign:'center', color:'#9aa0a6' }}>
                  {t('common:noItems', 'No items')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
