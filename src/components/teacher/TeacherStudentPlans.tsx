// src/components/teacher/TeacherStudentPlans.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../firebase/app';
import styles from './TeacherStudentPlans.module.css';
import { useTranslation } from 'react-i18next';
import { SLOTS, DAY_ORDER } from '../../constants/timetable';

type LessonDoc = {
  id: string;
  name?: string;
  studentsUserIds?: string[];
};

type TimetableEntry = {
  id: string;
  lessonId: string;
  day: number;            // 0-6 (Sun..Sat)
  startMinutes: number;
  endMinutes: number;
  classId?: string;       // can be business classId or class doc id
  className?: string;     // optional inline label
};

type ClassDoc = {
  id: string;             // doc id
  classId?: string;       // business id
  name?: string;
  location?: string;
};

type Student = {
  id: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  username?: string;
  email?: string;
  classId?: string;
  className?: string;
};

function chunk<T>(arr: T[], size = 10) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function fullName(s: Student) {
  const n = `${s.firstName || ''} ${s.lastName || ''}`.replace(/\s+/g, ' ').trim();
  return n || s.displayName || s.username || s.email || s.id;
}
function fmt(mins: number) {
  const h = Math.floor(mins / 60);
  const m = String(mins % 60).padStart(2, '0');
  return `${h}:${m}`;
}

export default function TeacherStudentPlans({ teacherId }: { teacherId?: string }) {
  const { t, i18n } = useTranslation(['studentPlans','timetable']);
  const [advisees, setAdvisees] = useState<Student[]>([]);
  const [selected, setSelected] = useState<Student | null>(null);

  // Shared day labels (from i18n 'timetable:days') and order
  const dayLabels: string[] = useMemo(() => {
    const arr = (t('timetable:days', { returnObjects: true }) as any) || [];
    if (!Array.isArray(arr) || arr.length !== 7) return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    return arr;
  }, [t, i18n?.language]);
  const dayIndexes = DAY_ORDER;

  // lessonId -> lesson name
  const [lessonNameById, setLessonNameById] = useState<Record<string, string>>({});
  // class key (business id or doc id) -> label
  const [classLabelByKey, setClassLabelByKey] = useState<Record<string, string>>({});
  // timetable rows for selected student
  const [entries, setEntries] = useState<TimetableEntry[]>([]);

  // 1) load advisees of this teacher
  useEffect(() => {
    if (!teacherId) { setAdvisees([]); return; }
    const qStud = query(collection(db, 'appUsers'), where('advisorId', '==', teacherId));
    const unsub = onSnapshot(qStud, snap => {
      const arr = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Student[];
      arr.sort((a, b) => fullName(a).localeCompare(fullName(b)));
      setAdvisees(arr);
      if (!arr.length) setSelected(null);
      else if (selected && !arr.find(s => s.id === selected.id)) setSelected(arr[0]);
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teacherId]);

  // 2) for selected student: lessons -> timetableEntries -> classes (join by classId OR doc id)
  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!selected?.id) {
        setEntries([]); setLessonNameById({}); setClassLabelByKey({});
        return;
      }

      // A) lessons containing this student
      const qLessons = query(collection(db, 'lessons'), where('studentsUserIds', 'array-contains', selected.id));
      const lessonsSnap = await getDocs(qLessons);
      if (cancelled) return;

      const lessons: LessonDoc[] = lessonsSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
      const lessonIds = lessons.map(l => l.id);

      const nameMap: Record<string, string> = {};
      lessons.forEach(l => { nameMap[l.id] = l.name || l.id; });

      if (!lessonIds.length) {
        if (!cancelled) {
          setLessonNameById(nameMap);
          setEntries([]);
          setClassLabelByKey({});
        }
        return;
      }

      // B) timetable entries for those lessonIds
      const tt: TimetableEntry[] = [];
      for (const ids of chunk(lessonIds, 10)) {
        const qTimes = query(collection(db, 'timetableEntries'), where('lessonId', 'in', ids));
        const timesSnap = await getDocs(qTimes);
        if (cancelled) return;
        tt.push(...(timesSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as TimetableEntry[]));
      }

      // C) resolve classes: try by classes.classId, then fallback by doc id
      const rawKeys = Array.from(new Set(tt.map(r => r.classId).filter(Boolean))) as string[];
      const classMap: Record<string, string> = {};
      if (rawKeys.length) {
        // (1) by business key
        for (const ids of chunk(rawKeys, 10)) {
          const qByBusiness = query(collection(db, 'classes'), where('classId', 'in', ids));
          const snapBiz = await getDocs(qByBusiness);
          if (cancelled) return;
          snapBiz.docs.forEach(d => {
            const c = d.data() as ClassDoc;
            const label = [c.name || c.classId || d.id, c.location || ''].filter(Boolean).join(' · ');
            if (c.classId) classMap[c.classId] = label;
          });
        }
        // (2) by doc id (for unresolved)
        const unresolved = rawKeys.filter(k => !classMap[k]);
        if (unresolved.length) {
          for (const ids of chunk(unresolved, 10)) {
            const qByDocId = query(collection(db, 'classes'), where('__name__', 'in', ids));
            const snapId = await getDocs(qByDocId);
            if (cancelled) return;
            snapId.docs.forEach(d => {
              const c = d.data() as ClassDoc;
              const label = [c.name || c.classId || d.id, c.location || ''].filter(Boolean).join(' · ');
              classMap[d.id] = label;
              if (c.classId) classMap[c.classId] = label;
            });
          }
        }
      }

      tt.sort((a, b) => a.day - b.day || a.startMinutes - b.startMinutes);

      if (!cancelled) {
        setLessonNameById(nameMap);
        setClassLabelByKey(classMap);
        setEntries(tt);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [selected?.id]);

  // 3) Use shared SLOTS (from constants) so rows are globally aligned.
  const rows = SLOTS; // each row: { start, end, sm, em }

  // resolve lessons occupying a cell (day + slot)
  function cellLessons(day: number, sm: number, em: number) {
    const hits = entries.filter(e => e.day === day && e.startMinutes < em && e.endMinutes > sm);

    // group by lessonId
    type HitInfo = { lessonId: string; name: string; classLabel?: string };
    const map = new Map<string, HitInfo>();

    for (const h of hits) {
      const name = lessonNameById[h.lessonId] || h.lessonId;
      const labelFromClasses = h.classId ? classLabelByKey[h.classId] : undefined;
      const finalLabel = h.className || labelFromClasses; // inline wins if present
      const prev = map.get(h.lessonId);
      if (!prev) map.set(h.lessonId, { lessonId: h.lessonId, name, classLabel: finalLabel });
      else if (!prev.classLabel && finalLabel) prev.classLabel = finalLabel;
    }

    const list = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
    const conflict = list.length >= 2;
    return { conflict, list };
  }

  return (
    <div className={styles.wrap}>
      {/* Students list */}
      <div className={styles.studentsList}>
        <h3>{t('studentsTitle')}</h3>
        {advisees.map(s => (
          <button
            key={s.id}
            className={`${styles.studentItem} ${selected?.id === s.id ? styles.selected : ''}`}
            onClick={() => setSelected(s)}
          >
            {fullName(s)} {s.className ? `(${s.className})` : ''}
          </button>
        ))}
        {!advisees.length && <div className={styles.empty}>{t('noStudents')}</div>}
      </div>

      {/* Weekly grid */}
      <div className={styles.plan}>
        {selected ? (
          <>
            <h3>{t('planFor', { student: fullName(selected) })}</h3>

            <table className={styles.gridTable}>
              <thead>
                <tr>
                  <th className={styles.timeCol}>
                    {t('time')}<br />
                    <span style={{ opacity: 0.6, fontWeight: 400 }}>
                      {fmt(rows[0]?.sm ?? 0)}–{fmt(rows[rows.length-1]?.em ?? 0)} · {rows[0] ? (rows[0].em - rows[0].sm) : 0}m
                    </span>
                  </th>
                  {dayIndexes.map((d) => <th key={d} className={styles.dayCol}>{dayLabels[d]}</th>)}
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
          </>
        ) : (
          <div className={styles.empty}>{t('selectStudent')}</div>
        )}
      </div>
    </div>
  );
}
