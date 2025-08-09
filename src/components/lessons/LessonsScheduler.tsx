import React, { useEffect, useMemo, useState } from 'react';
import {
  addDoc, collection, deleteDoc, doc, getDoc, onSnapshot, query, updateDoc, where,
} from 'firebase/firestore';
import { db } from '../../firebase/app';
import { getAuth } from 'firebase/auth';

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

const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
// MUST include the final boundary so the last row (e.g. 13:15→14:00) exists.
const TIME_POINTS = ['08:00','08:45','09:30','10:15','11:00','11:45','12:30','13:15','14:00'];

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

  // Load timetable entries for selected class (supports doc id AND business ClassID) — no orderBy, sort client-side
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

        // Use 'in' filter to get both in one listener (max 10 values)
        const qy = query(collection(db,'timetableEntries'), where('classId','in', classIds));
        unsub = onSnapshot(qy, s=>{
          const arr = s.docs.map(d=>normalizeEntry(d.id, d.data()));
          // keep only rows with a valid day + minutes
          const clean = arr.filter(e => Number.isFinite(e.day) && Number.isFinite(e.startMinutes) && Number.isFinite(e.endMinutes));
          // sort client-side by day then startMinutes
          clean.sort((a,b)=> a.day-b.day || a.startMinutes-b.startMinutes);
          setEntries(clean);
        }, err=>{
          console.error('[timetableEntries] snapshot error:', err);
          setStatus({kind:'error', message: 'Failed to load timetable: '+ (err?.message||'unknown')});
        });
      }catch(e:any){
        console.error('Failed to prepare timetable query:', e);
        setStatus({kind:'error', message: 'Failed to prepare timetable: '+ (e?.message||'unknown')});
      }
    })();

    return ()=>{ if(unsub) unsub(); };
  },[selectedClass]);

  const slots = useMemo(()=> TIME_POINTS.slice(0,-1).map((start,i)=>{
    const end = TIME_POINTS[i+1]!;
    return {start,end, sm:toMinutes(start), em:toMinutes(end)};
  }),[]);

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

    if(!selectedLesson){ alert('Select a lesson first to add.'); return; }
    const m=new Map(pendingAdds);
    m.set(key,{day:dayIdx, sm, em, lessonId:selectedLesson});
    setPendingAdds(m);
  }

  const hasPending = pendingAdds.size + pendingDeletes.size + pendingReplaces.size > 0;

  async function saveChanges(){
    if(!selectedClass || !hasPending) return;
    setStatus({kind:'saving', message:'Saving…'});
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
      setStatus({kind:'success', message:'Saved!'});
      clearStaged();
    }catch(err:any){
      console.error(err);
      setStatus({kind:'error', message: err?.message || 'Save failed'});
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
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Lessons Scheduler</h2>

      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-neutral-400">Class:</label>
        <select
          value={selectedClass}
          onChange={e=>{ setSelectedClass(e.target.value); clearStaged(); setSelectedLesson(''); }}
          className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-700 min-w-[240px]"
        >
          <option value="">— Select class —</option>
          {classes.map(c=>(
            <option key={c.id} value={c.id}>
              {c.name} {c.location?`· ${c.location}`:''} {c.classId?`· ${c.classId}`:''}
            </option>
          ))}
        </select>

        <label className="text-sm text-neutral-400">Lesson:</label>
        <select
          value={selectedLesson}
          onChange={e=>{ setSelectedLesson(e.target.value); clearStaged(); }}
          disabled={!selectedClass}
          className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-700 min-w-[320px] disabled:opacity-50"
        >
          <option value="">— Select lesson —</option>
          {lessons.map(l=>(
            <option key={l.id} value={l.id}>{labelForLesson(l)}</option>
          ))}
        </select>

        {selectedLesson && (
          <div className="text-xs text-neutral-400">
            Placed: <span className="text-neutral-200">{placedCount}</span> cell{placedCount===1?'':'s'}
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={saveChanges}
            disabled={!hasPending || !selectedClass}
            className={['px-3 py-2 rounded-xl text-white transition',
              hasPending ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-neutral-700 cursor-not-allowed'].join(' ')}
          >Save</button>
          <button
            onClick={clearStaged}
            disabled={!hasPending}
            className={['px-3 py-2 rounded-xl text-white transition',
              hasPending ? 'bg-neutral-700 hover:bg-neutral-600' : 'bg-neutral-800 cursor-not-allowed'].join(' ')}
          >Cancel</button>
      </div>
      </div>

      {/* Legend */}
      <div className="text-xs text-neutral-500 flex flex-wrap gap-4">
        <span><span style={{display:'inline-block',width:12,height:12,background:'#0c4a6e',marginRight:6}}/>Selected lesson (existing)</span>
        <span><span style={{display:'inline-block',width:12,height:12,background:'#7f1d1d',marginRight:6}}/>Class taken by other lesson</span>
        <span><span style={{display:'inline-block',width:12,height:12,background:'#7f1d1d',border:'2px dashed #fff',boxSizing:'border-box',marginRight:6}}/>Pending change</span>
      </div>

      {!selectedClass ? (
        <div className="text-neutral-500 text-sm">Pick a class to start scheduling.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="border-collapse min-w-[900px]">
            <thead>
              <tr>
                <th className="border-b border-neutral-700 p-2 text-left text-neutral-400">Time \ Day</th>
                {DAYS.map(d=>(
                  <th key={d} className="border-b border-neutral-700 p-2 text-left text-neutral-400">{d}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {slots.map(({start,end,sm,em})=>(
                <tr key={start}>
                  <td className="border-r border-neutral-700 p-2 font-semibold whitespace-nowrap">{start}–{end}</td>
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
                        className="border border-neutral-700 p-0 cursor-pointer select-none"
                        style={{ backgroundColor:bg, outline:isPending?'2px dashed #ffffff':'none', outlineOffset:'-2px' }}
                        title={text}
                      >
                        <div className="h-12 flex items-center justify-center px-2" style={{ color:fg }}>
                          <span className="truncate" style={{ textDecoration: strike ? 'line-through' : 'none' }}>
                            {text}
                          </span>
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

      {/* inline status */}
      {status.kind!=='idle' && (
        <div
          className="text-sm rounded-lg px-3 py-2 border inline-block"
          style={
            status.kind==='saving'
              ? { color:'#fcd34d', background:'#78350f33', borderColor:'#b45309' }
              : status.kind==='success'
              ? { color:'#6ee7b7', background:'#064e3b33', borderColor:'#10b981' }
              : { color:'#fca5a5', background:'#7f1d1d33', borderColor:'#ef4444' }
          }
        >
          {status.message}
        </div>
      )}

      {/* tiny debug */}
      {selectedClass && (
        <div className="text-xs text-neutral-500">
          Loaded entries: {entries.length}
        </div>
      )}
    </div>
  );
}
