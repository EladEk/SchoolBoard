// src/components/teacher/TeacherStudentPlans.tsx
import React, { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../firebase/app';
import styles from './TeacherStudentPlans.module.css';
import { useTranslation } from 'react-i18next';
import { SLOTS, DAY_ORDER } from '../../constants/timetable';

type LessonDoc = { id: string; name?: string; studentsUserIds?: string[] };

type TimetableEntry = {
  id: string; lessonId: string; day: number; startMinutes: number; endMinutes: number;
  classId?: string; className?: string;
};

type ClassDoc = { id: string; classId?: string; name?: string; location?: string };

type Student = {
  id: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  username?: string;
  email?: string;
  classId?: string;
  className?: string;
  birthday?: string;     // <-- added
};

function chunk<T>(arr: T[], size = 10){ const out:T[][]=[]; for(let i=0;i<arr.length;i+=size) out.push(arr.slice(i,i+size)); return out; }
function fullName(s: Student){ const n=`${s.firstName||''} ${s.lastName||''}`.replace(/\s+/g,' ').trim(); return n||s.displayName||s.username||s.email||s.id; }
function fmt(mins:number){ const h=Math.floor(mins/60); const m=String(mins%60).padStart(2,'0'); return `${h}:${m}`; }

function metaLine(s: Student) {
  const bits: string[] = [];
  if (s.username) bits.push(`@${s.username}`);
  if (s.birthday) bits.push(s.birthday);
  if (s.className) bits.push(s.className);
  return bits.join(' · ');
}

export default function TeacherStudentPlans({ teacherId: teacherIdProp }: { teacherId?: string }) {
  const { t, i18n } = useTranslation(['studentPlans','timetable']);

  // Resolve teacherId from prop or session
  const [teacherId, setTeacherId] = useState<string | undefined>(teacherIdProp);
  useEffect(() => {
    if (teacherIdProp) { setTeacherId(teacherIdProp); return; }
    try {
      const session = JSON.parse(localStorage.getItem('session') || '{}') || {};
      const uid = session?.uid || session?.UID;
      if (uid) setTeacherId(uid);
    } catch {/* ignore */}
  }, [teacherIdProp]);

  const [advisees, setAdvisees] = useState<Student[]>([]);
  const [selected, setSelected] = useState<Student | null>(null);

  const dayLabels: string[] = useMemo(() => {
    const arr = (t('timetable:days', { returnObjects: true }) as any) || [];
    return Array.isArray(arr) && arr.length === 7 ? arr : ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  }, [t, i18n?.language]);
  const dayIndexes = DAY_ORDER;

  const [lessonNameById, setLessonNameById] = useState<Record<string,string>>({});
  const [classLabelByKey, setClassLabelByKey] = useState<Record<string,string>>({});
  const [entries, setEntries] = useState<TimetableEntry[]>([]);

  // ONLY ADVISEES of this teacher
  useEffect(() => {
    if (!teacherId) { setAdvisees([]); setSelected(null); return; }
    const qStud = query(collection(db, 'appUsers'), where('advisorId', '==', teacherId));
    const unsub = onSnapshot(qStud, snap => {
      const arr = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Student[];
      arr.sort((a,b)=>fullName(a).localeCompare(fullName(b)));
      setAdvisees(arr);
      if (!arr.length) setSelected(null);
      else if (!selected || !arr.find(s=>s.id===selected.id)) setSelected(arr[0]);
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teacherId]);

  // For selected student: lessons -> timetableEntries -> classes
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!selected?.id) { setEntries([]); setLessonNameById({}); setClassLabelByKey({}); return; }

      const qLessons = query(collection(db,'lessons'), where('studentsUserIds','array-contains', selected.id));
      const lessonsSnap = await getDocs(qLessons); if (cancelled) return;
      const lessons = lessonsSnap.docs.map(d=>({ id:d.id, ...(d.data() as any) })) as LessonDoc[];
      const lessonIds = lessons.map(l=>l.id);
      const nameMap: Record<string,string> = {}; lessons.forEach(l=>{ nameMap[l.id]=l.name||l.id; });

      if (!lessonIds.length){ if(!cancelled){ setLessonNameById(nameMap); setEntries([]); setClassLabelByKey({}); } return; }

      const tt: TimetableEntry[] = [];
      for (const ids of chunk(lessonIds,10)){
        const timesSnap = await getDocs(query(collection(db,'timetableEntries'), where('lessonId','in',ids)));
        if (cancelled) return;
        tt.push(...(timesSnap.docs.map(d=>({ id:d.id, ...(d.data() as any) })) as TimetableEntry[]));
      }

      const rawKeys = Array.from(new Set(tt.map(r=>r.classId).filter(Boolean))) as string[];
      const classMap: Record<string,string> = {};
      if (rawKeys.length){
        for (const ids of chunk(rawKeys,10)){
          const snapBiz = await getDocs(query(collection(db,'classes'), where('classId','in',ids)));
          if (cancelled) return;
          snapBiz.docs.forEach(d=>{
            const c=d.data() as ClassDoc;
            const label=[c.name||c.classId||d.id, c.location||''].filter(Boolean).join(' · ');
            if (c.classId) classMap[c.classId]=label;
          });
        }
        const unresolved = rawKeys.filter(k=>!classMap[k]);
        for (const ids of chunk(unresolved,10)){
          const snapId = await getDocs(query(collection(db,'classes'), where('__name__','in',ids)));
          if (cancelled) return;
          snapId.docs.forEach(d=>{
            const c=d.data() as ClassDoc;
            const label=[c.name||c.classId||d.id, c.location||''].filter(Boolean).join(' · ');
            classMap[d.id]=label; if (c.classId) classMap[c.classId]=label;
          });
        }
      }

      tt.sort((a,b)=> a.day-b.day || a.startMinutes-b.startMinutes);
      if (!cancelled){ setLessonNameById(nameMap); setClassLabelByKey(classMap); setEntries(tt); }
    }
    load();
    return () => { cancelled = true; };
  }, [selected?.id]);

  const rows = SLOTS;

  function cellLessons(day:number, sm:number, em:number){
    const hits = entries.filter(e=>e.day===day && e.startMinutes<em && e.endMinutes>sm);
    type Hit = { lessonId:string; name:string; classLabel?:string };
    const m = new Map<string,Hit>();
    for (const h of hits){
      const name = lessonNameById[h.lessonId] || h.lessonId;
      const labelFromClasses = h.classId ? classLabelByKey[h.classId] : undefined;
      const finalLabel = h.className || labelFromClasses;
      const prev = m.get(h.lessonId);
      if (!prev) m.set(h.lessonId, { lessonId:h.lessonId, name, classLabel: finalLabel });
      else if (!prev.classLabel && finalLabel) prev.classLabel = finalLabel;
    }
    const list = Array.from(m.values()).sort((a,b)=>a.name.localeCompare(b.name));
    return { conflict: list.length>=2, list };
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
            <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-start' }}>
              <div>{fullName(s)}</div>
              <div style={{ opacity: .75, fontSize: 12 }}>
                {metaLine(s)}
              </div>
            </div>
          </button>
        ))}
        {!advisees.length && <div className={styles.empty}>{t('noStudents')}</div>}
      </div>

      {/* Weekly grid */}
      <div className={styles.plan}>
        {selected ? (
          <>
            <h3>
              {t('planFor', { student: fullName(selected) })}
              <span style={{ marginInlineStart: 8, fontWeight: 400, opacity: .75, fontSize: 13 }}>
                {metaLine(selected)}
              </span>
            </h3>

            <table className={styles.gridTable}>
              <thead>
                <tr>
                  <th className={styles.timeCol}>
                    {t('time')}<br/>
                    <span style={{ opacity:.6, fontWeight:400 }}>
                      {fmt(rows[0]?.sm ?? 0)}–{fmt(rows[rows.length-1]?.em ?? 0)} · {rows[0] ? (rows[0].em-rows[0].sm) : 0}m
                    </span>
                  </th>
                  {dayIndexes.map(d => <th key={d} className={styles.dayCol}>{dayLabels[d]}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ start, end, sm, em })=>(
                  <tr key={`${sm}-${em}`}>
                    <td className={styles.timeCol}>{start}–{end}</td>
                    {dayIndexes.map(dayIndex=>{
                      const { conflict, list } = cellLessons(dayIndex, sm, em);
                      return (
                        <td
                          key={`${dayIndex}-${sm}-${em}`}
                          className={`${styles.cell} ${conflict?styles.cellConflict:''}`}
                          title={list.map(x=>x.name+(x.classLabel?` @ ${x.classLabel}`:'')).join(' / ')}
                        >
                          {list.map(item=>(
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
