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
  // possible class assignment fields (we'll check several):
  classId?: string;        // business ClassID
  classDocId?: string;     // Firestore class doc id
  className?: string;      // class name
  classes?: string[];      // array of ids/names
  classIds?: string[];     // array of business IDs
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
  // IMPORTANT: roster coming from TeacherLessons
  studentsUserIds?: string[];
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

// ---------- Resolve current user from session or override ----------
async function resolveUserFromSession(overrideTeacherUsername?: string): Promise<AppUser | null> {
  let session: any = {};
  try { session = JSON.parse(localStorage.getItem('session') || '{}') || {}; } catch {}

  const candidateIds = [
    session?.id, session?.uid, session?.userId, session?.user?.id, session?.user?.uid, session?.userDocId
  ].filter(Boolean);

  for (const rawId of candidateIds) {
    try {
      const ref = doc(db, 'appUsers', String(rawId));
      const snap = await getDoc(ref);
      if (snap.exists()) return { id: snap.id, ...(snap.data() as any) };
    } catch { /* continue */ }
  }

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

// ---------- Small helpers ----------
function userLabel(u?: AppUser | null) {
  if (!u) return '';
  const full = [u.firstName||'', u.lastName||''].join(' ').replace(/\s+/g,' ').trim();
  if (full && u.username) return `${full} (${u.username})`;
  if (full) return full;
  return u.username || '';
}

export default function TeacherTimetableView({ teacherUsername }: Props) {
  const { t, i18n } = useTranslation(['timetable','teacher','common']);

  // ---------- Resolve target user ----------
  const [me, setMe] = useState<AppUser | null>(null);

  useEffect(() => {
    let canceled = false;
    (async () => {
      const u = await resolveUserFromSession(teacherUsername);
      if (!canceled) setMe(u);
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

  function findClassByAnyId(classId: string): SchoolClass | undefined {
    return classes.find(c => c.id === classId || (c.classId && c.classId === classId));
  }
  function classLabelByEntry(e: Entry): string {
    const cls = findClassByAnyId(e.classId);
    if (cls) return [cls.name, cls.location, cls.classId].filter(Boolean).join(' · ');
    return e.classId || '';
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

  // ---------- Load timetable entries (all lessons; chunked "in") ----------
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const ids = Array.from(myLessonIds);
    if (!ids.length) { setEntries([]); return; }

    setLoading(true);
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

  // ---------- Build lookup for each cell (day + slot) ----------
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

  // ---------- Load all students (once) and filter client-side ----------
  const [allStudents, setAllStudents] = useState<AppUser[]>([]);
  useEffect(() => {
    const qStu = query(collection(db, 'appUsers'), where('role','==','student'));
    const unsub = onSnapshot(qStu, s => {
      const list = s.docs.map(d => ({ id: d.id, ...(d.data() as any)} as AppUser));
      list.sort((a,b) => userLabel(a).localeCompare(userLabel(b)));
      setAllStudents(list);
    });
    return () => unsub();
  }, []);

  const studentById = useMemo(() => {
    const map = new Map<string, AppUser>();
    for (const s of allStudents) map.set(s.id, s);
    return map;
  }, [allStudents]);

  function studentMatchesClass(stu: AppUser, cls: SchoolClass): boolean {
    const classDocId = cls.id;
    const classBizId = cls.classId || '';
    const className = cls.name || '';

    const fields = [
      stu.classDocId,
      stu.classId,
      stu.className,
      ...(stu.classes || []),
      ...(stu.classIds || []),
    ]
    .filter(Boolean)
    .map(String);

    return fields.includes(classDocId)
        || (classBizId && fields.includes(classBizId))
        || (className && fields.includes(className));
  }

  // ---------- Cell selection and students panel ----------
  type SelectedCell = {
    day: number;
    sm: number;
    em: number;
    groups: Array<{
      classId: string;
      cls?: SchoolClass;
      entries: Entry[];
      students: AppUser[];
      source: 'lessonRoster' | 'classMembership';
    }>;
  } | null;

  const [selected, setSelected] = useState<SelectedCell>(null);

  function handleCellClick(day: number, sm: number, em: number) {
    const key = `${day}-${sm}-${em}`;
    const cellEntries = (cellMap.get(key) || []).slice();
    if (!cellEntries.length) { setSelected(null); return; }

    // group by classId
    const byClass = new Map<string, Entry[]>();
    for (const e of cellEntries) {
      const arr = byClass.get(e.classId) || [];
      arr.push(e);
      byClass.set(e.classId, arr);
    }

    const groups = Array.from(byClass.entries()).map(([classId, ents]) => {
      const cls = findClassByAnyId(classId);

      // 1) Try LESSON ROSTER: union of studentsUserIds across the lessons in this slot
      const rosterSet = new Set<string>();
      for (const e of ents) {
        const l = myLessons.find(x => x.id === e.lessonId);
        (l?.studentsUserIds || []).forEach(id => rosterSet.add(id));
      }
      const rosterStudents = Array.from(rosterSet)
        .map(id => studentById.get(id))
        .filter(Boolean) as AppUser[];

      if (rosterStudents.length) {
        return { classId, cls, entries: ents, students: rosterStudents, source: 'lessonRoster' as const };
      }

      // 2) Fallback: CLASS MEMBERSHIP
      const classStudents = cls ? allStudents.filter(stu => studentMatchesClass(stu, cls)) : [];
      return { classId, cls, entries: ents, students: classStudents, source: 'classMembership' as const };
    });

    setSelected({ day, sm, em, groups });
  }

  return (
    <div className="ls-wrap">
      <div className="ls-header">
        <div className="ls-title">
          <span className="ls-title-dot" />
          {t('teacher:weekTitle', 'My weekly schedule')}
        </div>
      </div>

      {/* status line */}
      <div style={{margin:'6px 2px', fontSize:12, color:'#9aa0a6'}}>
        {me ? userLabel(me) : ''}
        {loading ? ` · ${t('common:loading', 'Loading…')}` : ''}
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
                  const isSelected = selected && selected.day===dIdx && selected.sm===sm && selected.em===em;
                  return (
                    <td
                      key={dIdx}
                      className="ls-td"
                      onClick={() => handleCellClick(dIdx, sm, em)}
                      style={{
                        backgroundColor: has ? (isSelected ? '#145ea0' : '#0c4a6e') : '#141414',
                        color: has ? '#dbeafe' : '#c7c7c7',
                        cursor: has ? 'pointer' : 'default',
                        outline: isSelected ? '2px solid #60a5fa' : 'none',
                        outlineOffset: isSelected ? '1px' : 0
                      }}
                      title={cellEntries.map(e => `${lessonNameOf(e.lessonId)} — ${classLabelByEntry(e)}`).join('\n')}
                    >
                      <div className="ls-cell">
                        <div className="ls-cell-text" style={{ display:'grid', gap: 4 }}>
                          {!has ? '—' : cellEntries.map(e=>(
                            <div key={e.id} style={{ whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                              {lessonNameOf(e.lessonId)} · {classLabelByEntry(e)}
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

      {/* Students panel under table */}
      {selected && (
        <div style={{ marginTop: 16, padding: 12, border:'1px solid #2b3542', borderRadius: 12, background:'#0f172a' }}>
          <div style={{ fontWeight: 600, color:'#e5e7eb', marginBottom: 8 }}>
            {t('teacher:selectedSlot', 'Selected slot:')} {daysLabels[selected.day]} {(() => {
              const s = SLOTS.find(x=>x.sm===selected.sm && x.em===selected.em);
              return s ? ` · ${s.start}–${s.end}` : '';
            })()}
          </div>

          {selected.groups.map(g => (
            <div key={g.classId} style={{ marginTop: 10 }}>
              <div style={{ color:'#93c5fd', fontWeight:600, marginBottom:6 }}>
                {g.cls ? [g.cls.name, g.cls.location, g.cls.classId].filter(Boolean).join(' · ') : g.classId}
                <span style={{ marginLeft: 8, fontSize: 12, color:'#9aa0a6' }}>
                </span>
              </div>

              {g.students.length ? (
                <ul style={{ display:'grid', gap:4, gridTemplateColumns:'repeat(auto-fill, minmax(220px, 1fr))', margin:0, paddingLeft:16 }}>
                  {g.students.map(s => (
                    <li key={s.id} style={{ color:'#e5e7eb' }}>{userLabel(s)}</li>
                  ))}
                </ul>
              ) : (
                <div style={{ color:'#9aa0a6' }}>
                  {t('teacher:noStudentsForClass', 'No students found for this class (check student class assignments).')}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
