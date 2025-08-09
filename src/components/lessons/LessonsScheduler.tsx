import React, { useEffect, useMemo, useState } from 'react';
import {
  addDoc, collection, deleteDoc, doc, getDoc, onSnapshot, query, updateDoc, where,
} from 'firebase/firestore';
import { db } from '../../firebase/app';
import { getAuth } from 'firebase/auth';
import './LessonsScheduler.css';
import { useTranslation } from 'react-i18next';

type SchoolClass = { id: string; name: string; location?: string; classId?: string };
type Lesson = {
  id: string; name: string;
  isStudentTeacher?: boolean;
  teacherFirstName?: string | null; teacherLastName?: string | null; teacherUsername?: string | null;
  studentFirstName?: string | null; studentLastName?: string | null; studentUsername?: string | null;
};
type Entry = {
  id: string; classId: string; lessonId: string;
  day: number; startMinutes: number; endMinutes: number;
};

function toMinutes(hm: string){ const [h,m]=hm.split(':').map(Number); return h*60+m; }
function labelForLesson(l?: Lesson | null){
  if(!l) return '';
  const who = l.isStudentTeacher
    ? `${l.studentFirstName??''} ${l.studentLastName??''}`.trim() || (l.studentUsername??'')
    : `${l.teacherFirstName??''} ${l.teacherLastName??''}`.trim() || (l.teacherUsername??'');
  return who ? `${l.name} — ${who}` : l.name;
}
function cellKey(day:number, sm:number, em:number){ return `${day}:${sm}-${em}`; }

export default function LessonsScheduler(){
  const { t, i18n } = useTranslation();
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [selectedClass, setSelectedClass] = useState<string>('');
  const [selectedLesson, setSelectedLesson] = useState<string>('');

  const [entries, setEntries] = useState<Entry[]>([]);
  const [pendingAdds, setPendingAdds] = useState<Map<string,{day:number;sm:number;em:number;lessonId:string}>>(new Map());
  const [pendingDeletes, setPendingDeletes] = useState<Map<string,{entryId:string;day:number;sm:number;em:number;fromLessonId:string}>>(new Map());
  const [pendingReplaces, setPendingReplaces] = useState<Map<string,{entryId:string;day:number;sm:number;em:number;fromLessonId:string;toLessonId:string}>>(new Map());
  const [status, setStatus] = useState<{kind:'idle'|'saving'|'success'|'error'; message?:string}>({kind:'idle'});

  useEffect(()=>{
    const unsubC = onSnapshot(query(collection(db,'classes')), s =>
      setClasses(s.docs.map(d=>({id:d.id, ...(d.data() as any)}))));
    const unsubL = onSnapshot(query(collection(db,'lessons')), s =>
      setLessons(s.docs.map(d=>({id:d.id, ...(d.data() as any)}))));
    return ()=>{unsubC();unsubL();};
  },[]);

  function normalizeEntry(id:string, raw:any): Entry{
    const toInt=(v:any)=> typeof v==='string'?parseInt(v,10):Number(v);
    const day = toInt(raw.day ?? 0) || 0;
    const startMinutes = toInt(raw.startMinutes ?? raw.start ?? raw.startTimeMinutes ?? raw.sm ?? 0) || 0;
    const endMinutes   = toInt(raw.endMinutes   ?? raw.end   ?? raw.endTimeMinutes   ?? raw.em ?? 0) || 0;
    return { id, classId: String(raw.classId ?? ''), lessonId: String(raw.lessonId ?? ''), day, startMinutes, endMinutes };
  }

  // Load timetable entries for selected class
  useEffect(()=>{
    clearStaged();
    setEntries([]);
    if(!selectedClass) return;

    let unsub: (()=>void)|null = null;
    (async ()=>{
      try{
        const classSnap = await getDoc(doc(db,'classes',selectedClass));
        const bizId = classSnap.exists() ? (classSnap.data() as any)?.classId : undefined;
        const classIds = bizId ? [selectedClass, String(bizId)] : [selectedClass];
        const qy = query(collection(db,'timetableEntries'), where('classId','in', classIds));
        unsub = onSnapshot(qy, s=>{
          const arr = s.docs.map(d=>normalizeEntry(d.id, d.data()));
          const clean = arr.filter(e => Number.isFinite(e.day) && Number.isFinite(e.startMinutes) && Number.isFinite(e.endMinutes));
          clean.sort((a,b)=> a.day-b.day || a.startMinutes-b.startMinutes);
          setEntries(clean);
        }, err=>{
          console.error('[timetableEntries] snapshot error:', err);
          setStatus({kind:'error', message: t('timetable:toasts.loadFailed', { msg: err?.message || 'unknown' })});
        });
      }catch(e:any){
        console.error('Failed to prepare timetable query:', e);
        setStatus({kind:'error', message: t('timetable:toasts.prepareFailed', { msg: e?.message || 'unknown' })});
      }
    })();

    return ()=>{ if(unsub) unsub(); };
  },[selectedClass, t]);

  // Time grid
  const TIME_POINTS = useMemo(() => ['08:00','08:45','09:30','10:15','11:00','11:45','12:30','13:15','14:00'], []);
  const slots = useMemo(()=> TIME_POINTS.slice(0,-1).map((start,i)=>{
    const end = TIME_POINTS[i+1]!;
    const toMin=(hm:string)=>{const [h,m]=hm.split(':').map(Number);return h*60+m;};
    return {start,end, sm:toMin(start), em:toMin(end)};
  }),[]);
  const DAYS = useMemo(() => t('timetable:days', { returnObjects: true }) as string[], [t, i18n.language]);

  function clearStaged(){
    setPendingAdds(new Map()); setPendingDeletes(new Map()); setPendingReplaces(new Map());
    setStatus({kind:'idle'});
  }

  function findExisting(dayIdx:number, sm:number, em:number){
    return entries.find(e=> e.day===dayIdx && e.startMinutes===sm && e.endMinutes===em );
  }

  function handleCellClick(dayIdx:number, sm:number, em:number){
    if(!selectedClass) return;
    const key = cellKey(dayIdx, sm, em);
    const existing = findExisting(dayIdx, sm, em);

    if(pendingAdds.has(key)){ const m=new Map(pendingAdds); m.delete(key); setPendingAdds(m); return; }
    if(pendingDeletes.has(key)){ const m=new Map(pendingDeletes); m.delete(key); setPendingDeletes(m); return; }
    if(pendingReplaces.has(key)){ const m=new Map(pendingReplaces); m.delete(key); setPendingReplaces(m); return; }

    if(existing){
      if(!selectedLesson || selectedLesson===existing.lessonId){
        const m=new Map(pendingDeletes);
        m.set(key,{entryId:existing.id, day:dayIdx, sm, em, fromLessonId:existing.lessonId});
        setPendingDeletes(m);
      }else{
        const m=new Map(pendingReplaces);
        m.set(key,{entryId:existing.id, day:dayIdx, sm, em, fromLessonId:existing.lessonId, toLessonId:selectedLesson});
        setPendingReplaces(m);
      }
      return;
    }

    if(!selectedLesson){ alert(t('timetable:toasts.selectLessonFirst')); return; }
    const m=new Map(pendingAdds);
    m.set(key,{day:dayIdx, sm, em, lessonId:selectedLesson});
    setPendingAdds(m);
  }

  const hasPending = pendingAdds.size + pendingDeletes.size + pendingReplaces.size > 0;

  async function saveChanges(){
    if(!selectedClass || !hasPending) return;
    setStatus({kind:'saving', message: t('timetable:toasts.saving')});
    try{
      const uid = getAuth().currentUser?.uid ?? 'EDITOR';

      const adds = Array.from(pendingAdds.values()).map(({day,sm,em,lessonId}) =>
        addDoc(collection(db,'timetableEntries'), {
          classId: selectedClass, lessonId, day, startMinutes: sm, endMinutes: em,
          createdBy: uid, createdAt: new Date(),
        })
      );
      const dels = Array.from(pendingDeletes.values()).map(({entryId}) =>
        deleteDoc(doc(db,'timetableEntries',entryId))
      );
      const reps = Array.from(pendingReplaces.values()).map(({entryId,toLessonId}) =>
        updateDoc(doc(db,'timetableEntries',entryId), { lessonId: toLessonId })
      );

      await Promise.all([...adds, ...dels, ...reps]);
      setStatus({kind:'success', message:t('timetable:toasts.saved')});
      clearStaged();
    }catch(err:any){
      console.error(err);
      setStatus({kind:'error', message: t('timetable:toasts.saveFailed')});
    }
  }

  function getCellVisual(dayIdx:number, sm:number, em:number){
    const key = cellKey(dayIdx, sm, em);
    const existing = findExisting(dayIdx, sm, em);
    const del = pendingDeletes.get(key);
    const add = pendingAdds.get(key);
    const rep = pendingReplaces.get(key);

    if(del) return { state:'willDelete' as const, lessonId: del.fromLessonId };
    if(add) return { state:'willAdd' as const, lessonId: add.lessonId };
    if(rep) return { state:'willReplace' as const, lessonId: rep.toLessonId, fromLessonId: rep.fromLessonId };

    if(existing){
      return {
        state: existing.lessonId === selectedLesson ? ('committedSelected' as const) : ('committedOther' as const),
        lessonId: existing.lessonId,
      };
    }
    return { state:'empty' as const, lessonId: undefined };
  }

  function lessonName(id?:string){ return id ? (lessons.find(l=>l.id===id)?.name || '') : ''; }

  const placedCount = useMemo(
    ()=> entries.filter(e => selectedLesson && e.lessonId===selectedLesson).length,
    [entries, selectedLesson]
  );

  return (
    <div className="ls-wrap">
      <div className="ls-header">
        <div className="ls-title">
          <span className="ls-title-dot" />
          {t('timetable:title')}
        </div>

        <div className="ls-toolbar">
          <label className="ls-label">{t('timetable:labels.class')}</label>
          <select
            value={selectedClass}
            onChange={e=>{ setSelectedClass(e.target.value); clearStaged(); setSelectedLesson(''); }}
            className="ls-select"
          >
            <option value="">{t('common:selectOption')}</option>
            {classes.map(c=>(
              <option key={c.id} value={c.id}>
                {c.name} {c.location?`· ${c.location}`:''} {c.classId?`· ${c.classId}`:''}
              </option>
            ))}
          </select>

          <label className="ls-label">{t('timetable:labels.lesson')}</label>
          <select
            value={selectedLesson}
            onChange={e=>{ setSelectedLesson(e.target.value); clearStaged(); }}
            disabled={!selectedClass}
            className="ls-select"
          >
            <option value="">{t('common:selectOption')}</option>
            {lessons.map(l=>(
              <option key={l.id} value={l.id}>{labelForLesson(l)}</option>
            ))}
          </select>

          {selectedLesson && (
            <div className="ls-placed" dangerouslySetInnerHTML={{__html: t('timetable:labels.placed', { count: placedCount })}} />
          )}

          <div className="ls-actions">
            <button
              onClick={saveChanges}
              disabled={!hasPending || !selectedClass}
              className={`ls-btn ${hasPending ? 'ls-btn-primary' : 'ls-btn-disabled'}`}
            >{t('timetable:labels.save')}</button>
            <button
              onClick={clearStaged}
              disabled={!hasPending}
              className={`ls-btn ${hasPending ? 'ls-btn-neutral' : 'ls-btn-disabled'}`}
            >{t('timetable:labels.cancel')}</button>
          </div>
        </div>

        <div className="ls-legend">
          <span className="ls-badge ls-badge-selected">{t('timetable:legend.selectedExisting')}</span>
          <span className="ls-badge ls-badge-taken">{t('timetable:legend.taken')}</span>
          <span className="ls-badge ls-badge-pending">{t('timetable:legend.pending')}</span>
        </div>
      </div>

      {!selectedClass ? (
        <div className="ls-empty">{t('timetable:emptyPrompt')}</div>
      ) : (
        <div className="ls-table-scroller">
          <table className="ls-table">
            <thead>
              <tr>
                <th className="ls-th ls-th-time">{t('timetable:headers.timeDay')}</th>
                {DAYS.map((d, idx)=>(
                  <th key={idx} className="ls-th">{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {slots.map(({start,end,sm,em})=>(
                <tr key={start}>
                  <td className="ls-td-time">{start}–{end}</td>
                  {DAYS.map((_,dayIdx)=>{
                    const viz = getCellVisual(dayIdx, sm, em);

                    let bg = '#141414', fg = '#c7c7c7', strike = false;
                    if(viz.state==='committedSelected'){ bg='#0c4a6e'; fg='#dbeafe'; }
                    else if(viz.state==='committedOther'){ bg='#7f1d1d'; fg='#fde2e2'; }
                    const isPending = viz.state==='willDelete' || viz.state==='willAdd' || viz.state==='willReplace';
                    if(viz.state==='willDelete'){ bg='#7f1d1d'; fg='#fde2e2'; strike=true; }
                    if(viz.state==='willAdd' || viz.state==='willReplace'){ bg='#7f1d1d'; fg='#fde2e2'; }

                    const currentName = viz.state==='empty' ? '' : (lessons.find(l=>l.id===viz.lessonId)?.name || '(unknown)');
                    const text =
                      viz.state==='willReplace' ? `${currentName} (→)` :
                      viz.state==='willDelete'  ? currentName :
                      viz.state==='willAdd'     ? (lessons.find(l=>l.id===viz.lessonId)?.name || '(new)') :
                      (viz.state==='committedSelected' || viz.state==='committedOther') ? currentName : '＋';

                    return (
                      <td
                        key={`${dayIdx}-${sm}`}
                        onClick={()=>handleCellClick(dayIdx, sm, em)}
                        className={`ls-td ${isPending ? 'ls-td-pending' : ''}`}
                        style={{ backgroundColor:bg, color:fg, textDecoration: strike ? 'line-through' : 'none' }}
                        title={text}
                      >
                        <div className="ls-cell">
                          <span className="ls-cell-text">{text}</span>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {status.kind!=='idle' && (
        <div className={`ls-status ls-status-${status.kind}`}>
          {status.message}
        </div>
      )}

      {selectedClass && (
        <div className="ls-footnote">{t('timetable:labels.loadedEntries', { count: entries.length })}</div>
      )}
    </div>
  );
}
