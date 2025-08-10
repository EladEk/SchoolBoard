// src/pages/StudentDashboard.tsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  collection, doc, getDoc, getDocs, limit, onSnapshot, query, where
} from 'firebase/firestore';
import { db } from '../firebase/app';
import { useTranslation } from 'react-i18next';
import { SLOTS, DAY_ORDER } from '../constants/timetable';
import Header from '../components/Header';
import styles from './StudentDashboard.module.css';

type Role = 'admin' | 'teacher' | 'student' | 'kiosk';

type AppUser = {
  id: string;
  role?: Role;
  username?: string;
  usernameLower?: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  email?: string;
  advisorId?: string;
  advisorName?: string;
  classId?: string;
  className?: string;
};

type LessonDoc = { id: string; name?: string };

type TimetableEntry = {
  id: string;
  lessonId: string;
  day: number;            // 0..6
  startMinutes: number;
  endMinutes: number;
  classId?: string;       // business classId OR classes doc id
  className?: string;     // optional inline label
};

type ClassDoc = { id: string; classId?: string; name?: string; location?: string };

function fullName(u?: AppUser | null) {
  if (!u) return '';
  const n = `${u?.firstName || ''} ${u?.lastName || ''}`.replace(/\s+/g, ' ').trim();
  return n || u?.displayName || u?.username || u?.email || '';
}

function getLocalSession(): any {
  try { return JSON.parse(localStorage.getItem('session') || '{}') || {}; } catch { return {}; }
}

async function resolveCurrentStudent(): Promise<AppUser | null> {
  const sess = getLocalSession();

  // Try known ids stored in session
  const candidateIds = [
    sess?.id, sess?.uid, sess?.userId, sess?.user?.id, sess?.user?.uid, sess?.userDocId
  ].filter(Boolean);
  for (const rawId of candidateIds) {
    try {
      const r = await getDoc(doc(db, 'appUsers', String(rawId)));
      if (r.exists()) return { id: r.id, ...(r.data() as any) };
    } catch {}
  }

  // Try usernameLower / username
  const tryName = (sess?.username || sess?.user?.username || '').toString().trim();
  const lower = tryName.toLowerCase();
  if (lower) {
    let snap = await getDocs(query(collection(db,'appUsers'), where('usernameLower','==',lower), limit(1)));
    if (!snap.empty) { const d = snap.docs[0]; return { id: d.id, ...(d.data() as any) }; }
    snap = await getDocs(query(collection(db,'appUsers'), where('username','==',tryName), limit(1)));
    if (!snap.empty) { const d = snap.docs[0]; return { id: d.id, ...(d.data() as any) }; }
  }
  return null;
}

function chunk<T>(arr: T[], size = 10) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export default function StudentDashboard() {
  const { t, i18n } = useTranslation(['timetable', 'studentPlans', 'common']);
  const [me, setMe] = useState<AppUser | null>(null);

  // Load current student (self)
  useEffect(() => {
    let alive = true;
    (async () => {
      const u = await resolveCurrentStudent();
      if (alive) setMe(u);
    })();
    return () => { alive = false; };
  }, []);

  // Advisor (responsible teacher)
  const [advisor, setAdvisor] = useState<AppUser | null>(null);
  useEffect(() => {
    if (!me?.advisorId) { setAdvisor(null); return; }
    const ref = doc(db, 'appUsers', me.advisorId);
    const un = onSnapshot(ref, s => setAdvisor(s.exists() ? ({ id: s.id, ...(s.data() as any) }) : null));
    return () => un();
  }, [me?.advisorId]);

  // Student lessons + timetable
  const [lessonNames, setLessonNames] = useState<Record<string,string>>({});
  const [entries, setEntries] = useState<TimetableEntry[]>([]);
  const [classLabelByKey, setClassLabelByKey] = useState<Record<string,string>>({});

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!me?.id) { setLessonNames({}); setEntries([]); setClassLabelByKey({}); return; }

      // Lessons that include this student
      const qLessons = query(collection(db,'lessons'), where('studentsUserIds','array-contains', me.id));
      const lessonsSnap = await getDocs(qLessons);
      if (cancelled) return;

      const lessons: LessonDoc[] = lessonsSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      const ids = lessons.map(l => l.id);
      const names: Record<string,string> = {};
      lessons.forEach(l => { names[l.id] = l.name || l.id; });

      if (!ids.length) {
        if (!cancelled) { setLessonNames(names); setEntries([]); setClassLabelByKey({}); }
        return;
      }

      // Timetable entries for those lessons (chunked)
      const tt: TimetableEntry[] = [];
      for (const chunkIds of chunk(ids, 10)) {
        const qTimes = query(collection(db,'timetableEntries'), where('lessonId','in', chunkIds));
        const timesSnap = await getDocs(qTimes);
        if (cancelled) return;
        tt.push(...(timesSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as TimetableEntry[]));
      }

      // Resolve classes: by business classId first, then by doc id
      const rawKeys = Array.from(new Set(tt.map(r => r.classId).filter(Boolean))) as string[];
      const labelMap: Record<string,string> = {};
      if (rawKeys.length) {
        // business key
        for (const ids of chunk(rawKeys, 10)) {
          const qBiz = query(collection(db,'classes'), where('classId','in', ids));
          const s = await getDocs(qBiz);
          if (cancelled) return;
          s.docs.forEach(d => {
            const c = d.data() as ClassDoc;
            const label = [c.name || c.classId || d.id, c.location || ''].filter(Boolean).join(' · ');
            if (c.classId) labelMap[c.classId] = label;
          });
        }
        // doc id fallback
        const unresolved = rawKeys.filter(k => !labelMap[k]);
        if (unresolved.length) {
          for (const ids of chunk(unresolved, 10)) {
            const qId = query(collection(db,'classes'), where('__name__','in', ids));
            const s = await getDocs(qId);
            if (cancelled) return;
            s.docs.forEach(d => {
              const c = d.data() as ClassDoc;
              const label = [c.name || c.classId || d.id, c.location || ''].filter(Boolean).join(' · ');
              labelMap[d.id] = label;
              if (c.classId) labelMap[c.classId] = label;
            });
          }
        }
      }

      tt.sort((a,b)=> a.day - b.day || a.startMinutes - b.startMinutes);

      if (!cancelled) {
        setLessonNames(names);
        setClassLabelByKey(labelMap);
        setEntries(tt);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [me?.id]);

  // Day labels & shared order/slots
  const dayLabels: string[] = useMemo(() => {
    const arr = (t('timetable:days', { returnObjects: true }) as any) || [];
    if (!Array.isArray(arr) || arr.length !== 7) return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    return arr;
  }, [t, i18n?.language]);
  const dayIndexes = DAY_ORDER;
  const rows = SLOTS;

  // For cell (day, slot) show overlapping lessons
  function cellLessons(day: number, sm: number, em: number) {
    const hits = entries.filter(e => e.day === day && e.startMinutes < em && e.endMinutes > sm);
    type Hit = { lessonId: string; name: string; classLabel?: string };
    const map = new Map<string, Hit>();
    for (const h of hits) {
      const name = lessonNames[h.lessonId] || h.lessonId;
      const labelFromClasses = h.classId ? classLabelByKey[h.classId] : undefined;
      const finalLabel = h.className || labelFromClasses;
      const prev = map.get(h.lessonId);
      if (!prev) map.set(h.lessonId, { lessonId: h.lessonId, name, classLabel: finalLabel });
      else if (!prev.classLabel && finalLabel) prev.classLabel = finalLabel;
    }
    const list = Array.from(map.values()).sort((a,b)=> a.name.localeCompare(b.name));
    const conflict = list.length >= 2;
    return { conflict, list };
  }

  return (
    <div className={styles.page}>
      <Header
        title={t('studentPlans:planFor', { student: fullName(me) || t('common:me','Me') })}
        userName={fullName(me)}
        role={me?.role}
        navMode="logoutOnly"
      />

      <main className={styles.main}>
        <section className={styles.section}>
          {/* keep the internal heading structure (Admin-style) */}
          <div className={styles.titleRow}>
            <div className={styles.title}>
              {t('studentPlans:planFor', { student: fullName(me) || t('common:me','Me') })}
            </div>
            <div className={styles.subtitle}>
              {t('timetable:headers.timeDay', 'Time / Day')}
            </div>
          </div>

          {/* Advisor (responsible teacher) */}
          <div className={styles.advisorLabel}>
            {t('studentPlans:advisor', 'Responsible teacher')}: {' '}
            <strong>
              {advisor ? fullName(advisor) : (me?.advisorName || t('common:unknown','Unknown'))}
            </strong>
          </div>

          {/* Weekly grid */}
          {rows.length ? (
            <table className={styles.gridTable}>
              <thead>
                <tr>
                  <th className={styles.timeCol}>
                    {t('timetable:headers.timeDay', 'Time / Day')}
                  </th>
                  {dayIndexes.map((d) => (
                    <th key={d} className={styles.dayCol}>{dayLabels[d]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ start, end, sm, em }) => (
                  <tr key={`${sm}-${em}`}>
                    <td className={styles.timeCol}>{start}–{end}</td>
                    {dayIndexes.map((dayIndex) => {
                      const { conflict, list } = cellLessons(dayIndex, sm, em);
                      return (
                        <td
                          key={`${dayIndex}-${sm}-${em}`}
                          className={`${styles.cell} ${conflict ? styles.cellConflict : ''}`}
                          title={list.map(x => x.name + (x.classLabel ? ` @ ${x.classLabel}` : '')).join(' / ')}
                        >
                          {list.map(item => (
                            <div key={item.lessonId} className={styles.cellLine}>
                              <span className={styles.lessonName}>{item.name}</span>
                              {item.classLabel ? <span className={styles.classTag}>@ {item.classLabel}</span> : null}
                            </div>
                          ))}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className={styles.empty}>{t('common:loading','Loading…')}</div>
          )}
        </section>
      </main>
    </div>
  );
}
