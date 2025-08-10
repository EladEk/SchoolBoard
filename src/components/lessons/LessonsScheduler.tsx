import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, query, updateDoc, where,
} from 'firebase/firestore';
import { db } from '../../firebase/app';
import { getAuth } from 'firebase/auth';
import './LessonsScheduler.css';
import { useTranslation } from 'react-i18next';
import { SLOTS } from '../../constants/timetable';
import * as XLSX from 'xlsx';

type SchoolClass = { id: string; name: string; location?: string; classId?: string };
type Lesson = {
  id: string; name: string;
  isStudentTeacher?: boolean;
  teacherFirstName?: string | null; teacherLastName?: string | null; teacherUsername?: string | null;
  studentFirstName?: string | null; studentLastName?: string | null; studentUsername?: string | null;
};
type Entry = { id: string; classId: string; lessonId: string; day: number; startMinutes: number; endMinutes: number; };

// ---------- Helpers ----------
function pad2(n:number){ return n.toString().padStart(2,'0'); }
function fromMinutes(mins: number){ return `${pad2(Math.floor(mins/60))}:${pad2(mins%60)}`; }

// Accepts: "08:00", 0.3333 (Excel fraction), 45678.3333 (Excel date serial)
function parseExcelTime(v:any): number | NaN {
  if (typeof v === 'number' && isFinite(v)) {
    const frac = v % 1; // if it's a serial date, we only care about the fractional day
    const mins = Math.round(frac * 24 * 60);
    return mins;
  }
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return NaN;
    const m = s.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return NaN;
    const hh = Number(m[1]); const mm = Number(m[2]);
    if (hh<0 || hh>23 || mm<0 || mm>59) return NaN;
    return hh*60+mm;
  }
  return NaN;
}

// Normalize names: trim spaces, collapse whitespace, replace en/em dashes with ASCII hyphen
function normName(s:string){
  return (s||'')
    .replace(/\u2013|\u2014/g, '-') // en/em dash -> hyphen
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeEntry(id:string, raw:any): Entry{
  const toInt=(v:any)=> typeof v==='string'?parseInt(v,10):Number(v);
  const day = toInt(raw.day ?? 0) || 0;
  const startMinutes = toInt(raw.startMinutes ?? raw.start ?? raw.startTimeMinutes ?? raw.sm ?? 0) || 0;
  const endMinutes   = toInt(raw.endMinutes   ?? raw.end   ?? raw.endTimeMinutes   ?? raw.em ?? 0) || 0;
  return { id, classId: String(raw.classId ?? ''), lessonId: String(raw.lessonId ?? ''), day, startMinutes, endMinutes };
}

function labelForLesson(l?: Lesson | null){
  if(!l) return '';
  const who = l.isStudentTeacher
    ? `${l.studentFirstName??''} ${l.studentLastName??''}`.trim() || (l.studentUsername??'')
    : `${l.teacherFirstName??''} ${l.teacherLastName??''}`.trim() || (l.teacherUsername??'');
  return who ? `${l.name} — ${who}` : l.name;
}

const SS_KEY_SKIP_DELETE_CONFIRM = 'ls.skipDeleteConfirm.session';

export default function LessonsScheduler(){
  const { t, i18n } = useTranslation();
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [selectedClass, setSelectedClass] = useState<string>('');
  const [selectedLesson, setSelectedLesson] = useState<string>('');

  // Session-only checkbox: checked = skip confirmation
  const [skipDeleteConfirm, setSkipDeleteConfirm] = useState<boolean>(() => {
    return sessionStorage.getItem(SS_KEY_SKIP_DELETE_CONFIRM) === 'true'; // default false (ask)
  });

  const [entries, setEntries] = useState<Entry[]>([]);
  const [status, setStatus] = useState<{kind:'idle'|'saving'|'success'|'error'|'info'; message?:string}>({kind:'idle'});
  const [importErrors, setImportErrors] = useState<string[]>([]);

  // Excel controls
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [busyImport, setBusyImport] = useState(false);

  // Build quick lookup of slots by (sm,em) and by labels
  const slotByMinutes = useMemo(()=>{
    const m = new Map<string, {sm:number;em:number;start:string;end:string}>();
    for(const s of SLOTS){ m.set(`${s.sm}-${s.em}`, s as any); }
    return m;
  },[]);
  const slotByLabel = useMemo(()=>{
    const m = new Map<string, {sm:number;em:number;start:string;end:string}>();
    for(const s of SLOTS){
      m.set(`${s.start}__${s.end}`, s as any);
    }
    return m;
  },[]);

  useEffect(()=>{
    const unsubC = onSnapshot(query(collection(db,'classes')), s =>
      setClasses(s.docs.map(d=>({id:d.id, ...(d.data() as any)}))));
    const unsubL = onSnapshot(query(collection(db,'lessons')), s =>
      setLessons(s.docs.map(d=>({id:d.id, ...(d.data() as any)}))));
    return ()=>{unsubC();unsubL();};
  },[]);

  useEffect(()=>{
    setEntries([]);
    setImportErrors([]);
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
  const slots = SLOTS;
  const DAYS = useMemo(() => t('timetable:days', { returnObjects: true }) as string[], [t, i18n.language]);

  function findExisting(dayIdx:number, sm:number, em:number){
    return entries.find(e=> e.day===dayIdx && e.startMinutes===sm && e.endMinutes===em );
  }

  // IMMEDIATE ACTIONS (no save/cancel) + delete confirmation (session toggle)
  async function handleCellClick(dayIdx:number, sm:number, em:number){
    if(!selectedClass) return;
    const existing = findExisting(dayIdx, sm, em);

    try{
      setStatus({kind:'saving', message: t('timetable:toasts.saving')});

      if(existing){
        if(!selectedLesson || selectedLesson===existing.lessonId){
          if (!skipDeleteConfirm) {
            const lessonLabel = lessons.find(l=>l.id===existing.lessonId)?.name || '';
            const confirmMsg = t('timetable:confirmDelete', { lesson: lessonLabel })
              || `Delete "${lessonLabel}" from this time slot?`;
            if (!window.confirm(confirmMsg)) {
              setStatus({kind:'idle'});
              return;
            }
          }
          await deleteDoc(doc(db,'timetableEntries', existing.id));
          setStatus({kind:'success', message: t('timetable:toasts.deleted')});
        } else {
          // replace
          await updateDoc(doc(db,'timetableEntries', existing.id), { lessonId: selectedLesson });
          setStatus({kind:'success', message: t('timetable:toasts.updated')});
        }
        return;
      }

      if(!selectedLesson){
        setStatus({kind:'error', message: t('timetable:toasts.selectLessonFirst')});
        return;
      }

      const uid = getAuth().currentUser?.uid ?? 'EDITOR';
      await addDoc(collection(db,'timetableEntries'), {
        classId: selectedClass, lessonId: selectedLesson, day: dayIdx, startMinutes: sm, endMinutes: em,
        createdBy: uid, createdAt: new Date(),
      });
      setStatus({kind:'success', message: t('timetable:toasts.added')});
    }catch(err:any){
      console.error(err);
      setStatus({kind:'error', message: t('timetable:toasts.saveFailed')});
    }
  }

  function lessonName(id?:string){ return id ? (lessons.find(l=>l.id===id)?.name || '') : ''; }
  const placedCount = useMemo(()=> entries.filter(e => selectedLesson && e.lessonId===selectedLesson).length,[entries, selectedLesson]);

  // ---------- Import/Export ----------
  function openFilePicker(){ fileInputRef.current?.click(); }

  // Template generated from SLOTS; includes "class" column
  function downloadTemplate(){
    const demoClass = classes[0]?.name || 'Grade 5 - A';
    const rows = SLOTS.slice(0, 6).map(s => ({
      class: demoClass,
      day: 0,
      start: s.start,
      end: s.end,
      lesson: 'Math',
    }));
    const ws = XLSX.utils.json_to_sheet(rows, { header: ['class','day','start','end','lesson'] });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'TimetableTemplate');
    XLSX.writeFile(wb, 'timetable-template.xlsx');
    setStatus({kind:'info', message: t('timetable:toasts.templateDownloaded')});
  }

  // Export stays per selected class
  function exportTimetable(){
    if(!selectedClass){
      setStatus({kind:'error', message: t('timetable:toasts.selectClassFirst')});
      return;
    }
    const currentClass = classes.find(c=>c.id===selectedClass);
    const rows = entries.map(e => ({
      class: currentClass?.name || currentClass?.classId || selectedClass,
      day: e.day,
      start: fromMinutes(e.startMinutes),
      end: fromMinutes(e.endMinutes),
      lesson: lessonName(e.lessonId),
    }));
    const ws = XLSX.utils.json_to_sheet(rows, { header: ['class','day','start','end','lesson'] });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Timetable');
    const fnBase = (currentClass?.name || currentClass?.classId || selectedClass).toString().replace(/[^\w\-]+/g,'_');
    XLSX.writeFile(wb, `timetable-${fnBase}.xlsx`);
    setStatus({kind:'success', message: t('timetable:toasts.exported')});
  }

  // Resolve class by: doc id OR business classId OR exact (normalized) name match
  function resolveClassId(inputRaw: string): { id?: string; error?: string }{
    const v = normName(inputRaw);
    if(!v) return { error: 'empty class' };

    const byDoc = classes.find(c => c.id === inputRaw); // raw doc id
    if(byDoc) return { id: byDoc.id };

    const byBiz = classes.find(c => normName(String(c.classId||'')) === v);
    if(byBiz) return { id: byBiz.id };

    const nameMatches = classes.filter(c => normName(c.name||'') === v);
    if(nameMatches.length === 1) return { id: nameMatches[0].id };
    if(nameMatches.length > 1) return { error: `class name "${inputRaw}" is ambiguous (${nameMatches.length} matches)` };
    return { error: `class "${inputRaw}" not found` };
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>){
    const file = e.target.files?.[0];
    e.target.value = '';
    if(!file) return;

    try{
      setBusyImport(true);
      setStatus({kind:'info', message: t('timetable:toasts.importing')});
      setImportErrors([]);

      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' });

      // Lookups (normalized)
      const lessonByName = new Map<string, Lesson>();
      for(const l of lessons){ lessonByName.set(normName(l.name||''), l); }

      // Cache of existing entries per class
      const existingByClass = new Map<string, Map<string, Entry>>();

      async function loadExistingForClass(classId:string){
        if(existingByClass.has(classId)) return;
        const qy = query(collection(db,'timetableEntries'), where('classId','==', classId));
        const snap = await getDocs(qy);
        const m = new Map<string, Entry>();
        snap.docs.forEach(d=>{
          const e = normalizeEntry(d.id, d.data());
          m.set(`${e.day}:${e.startMinutes}-${e.endMinutes}`, e);
        });
        existingByClass.set(classId, m);
      }

      // Slot resolver: only accept times that match one of SLOTS
      function resolveSlot(startRaw:any, endRaw:any): { sm?:number; em?:number; error?:string }{
        // Try numeric/string → minutes
        const smTry = parseExcelTime(startRaw);
        const emTry = parseExcelTime(endRaw);

        if (Number.isFinite(smTry) && Number.isFinite(emTry)) {
          const s = slotByMinutes.get(`${smTry}-${emTry}`);
          if (s) return { sm: s.sm, em: s.em };
        }

        // Try label match if strings
        const sStr = typeof startRaw === 'string' ? startRaw.trim() : '';
        const eStr = typeof endRaw === 'string' ? endRaw.trim() : '';
        if (sStr && eStr) {
          const s = slotByLabel.get(`${sStr}__${eStr}`);
          if (s) return { sm: s.sm, em: s.em };
        }

        return { error: `time "${startRaw}–${endRaw}" does not match any defined slot` };
      }

      let created=0, updated=0, skipped=0;
      const errors:string[] = [];

      for(let i=0;i<rows.length;i++){
        const r = rows[i];
        const rowNum = i+2;

        // class: from column or fallback to selectedClass
        const classFieldRaw = String(r['class'] ?? r['Class'] ?? r['classId'] ?? r['ClassId'] ?? '').trim();
        let resolvedClassId: string | undefined;

        if(classFieldRaw){
          const { id, error } = resolveClassId(classFieldRaw);
          if(error){ skipped++; errors.push(`Row ${rowNum}: ${error}`); continue; }
          resolvedClassId = id!;
        }else if(selectedClass){
          resolvedClassId = selectedClass;
        }else{
          skipped++; errors.push(`Row ${rowNum}: missing class (no 'class'/'classId' and no selected class)`); continue;
        }

        const dayNum = Number(r['day'] ?? r['Day']);
        if(!Number.isFinite(dayNum)){ skipped++; errors.push(`Row ${rowNum}: invalid day`); continue; }

        const { sm, em, error:slotErr } = resolveSlot(r['start'] ?? r['Start'], r['end'] ?? r['End']);
        if(slotErr){ skipped++; errors.push(`Row ${rowNum}: ${slotErr}`); continue; }

        const lessonTitle = normName(String(r['lesson'] ?? r['Lesson'] ?? ''));
        const lesson = lessonTitle ? lessonByName.get(lessonTitle) : undefined;
        if(!lesson){ skipped++; errors.push(`Row ${rowNum}: lesson "${r['lesson'] || '(empty)'}" not found`); continue; }

        await loadExistingForClass(resolvedClassId);
        const classMap = existingByClass.get(resolvedClassId)!;

        const key = `${dayNum}:${sm}-${em}`;
        const exist = classMap.get(key);

        if(exist){
          if(exist.lessonId !== lesson.id){
            await updateDoc(doc(db,'timetableEntries', exist.id), { lessonId: lesson.id });
            exist.lessonId = lesson.id;
            updated++;
          }
        } else {
          await addDoc(collection(db,'timetableEntries'), {
            classId: resolvedClassId,
            lessonId: lesson.id,
            day: dayNum,
            startMinutes: sm!,
            endMinutes: em!,
            createdBy: getAuth().currentUser?.uid ?? 'IMPORT',
            createdAt: new Date(),
          });
          classMap.set(key, { id: '(new)', classId: resolvedClassId, lessonId: lesson.id, day: dayNum, startMinutes: sm!, endMinutes: em! });
          created++;
        }
      }

      setStatus({kind:'success', message: t('timetable:toasts.importDone', { created, updated, skipped })});
      setImportErrors(errors);
    }catch(err:any){
      console.error(err);
      setStatus({kind:'error', message: t('timetable:toasts.importFail', { msg: err?.message || 'unknown' })});
    }finally{
      setBusyImport(false);
    }
  }

  // Persist session toggle
  function onToggleSkipDelete(next: boolean){
    setSkipDeleteConfirm(next);
    sessionStorage.setItem(SS_KEY_SKIP_DELETE_CONFIRM, String(next));
  }

  return (
    <div className="ls-wrap">
      <div className="ls-header">
        <div className="ls-title">
          <span className="ls-title-dot" />
          {t('timetable:title')}
        </div>

        <div className="ls-toolbar">
          {/* Class select is useful for VIEW/CLICK editing; not required for import */}
          <label className="ls-label">{t('timetable:labels.class')}</label>
          <select
            value={selectedClass}
            onChange={e=>{ setSelectedClass(e.target.value); setSelectedLesson(''); setStatus({kind:'idle'}); setImportErrors([]); }}
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
            onChange={e=>{ setSelectedLesson(e.target.value); setStatus({kind:'idle'}); }}
            disabled={!selectedClass}
            className="ls-select"
          >
            <option value="">{t('common:selectOption')}</option>
            {lessons.map(l=>(
              <option key={l.id} value={l.id}>{labelForLesson(l)}</option>
            ))}
          </select>

          {selectedLesson && (
            <div className="ls-placed" dangerouslySetInnerHTML={{__html: t('timetable:labels.placed', { count: entries.filter(e=>e.lessonId===selectedLesson).length })}} />
          )}

          <div className="ls-actions">
            <button onClick={downloadTemplate} className="ls-btn">{t('common:downloadTemplate')}</button>
            <button onClick={exportTimetable} disabled={!selectedClass} className={`ls-btn ${selectedClass? '' : 'ls-btn-disabled'}`}>{t('common:export')}</button>
            <button onClick={openFilePicker} disabled={busyImport} className={`ls-btn ${!busyImport ? 'ls-btn-primary' : 'ls-btn-disabled'}`}>
              {busyImport ? t('timetable:labels.importing') : t('common:import')}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleImportFile}
              style={{ display:'none' }}
              aria-hidden="true"
              tabIndex={-1}
            />
          </div>

          {/* Ask-before-delete (session) */}
          <label className="ls-toggle">
            <input
              type="checkbox"
              checked={skipDeleteConfirm}
              onChange={(e)=>onToggleSkipDelete(e.target.checked)}
            />
            <span>{t('timetable:labels.askBeforeDeleteSession', 'Don’t ask again for deletions (this session)')}</span>
          </label>
        </div>

        <div className="ls-legend">
          <span className="ls-badge ls-badge-selected">{t('timetable:legend.selectedExisting')}</span>
          <span className="ls-badge ls-badge-taken">{t('timetable:legend.taken')}</span>
          {status.kind !== 'idle' && status.message ? (
            <span className="ls-badge">{status.message}</span>
          ) : null}
        </div>

        {importErrors.length > 0 && (
          <div className="ls-import-errors">
            <div className="ls-import-errors-title">{t('timetable:labels.importErrors', 'Import errors')}:</div>
            <ul>
              {importErrors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </div>
        )}
      </div>

      {!selectedClass ? (
        <div className="ls-empty">{t('timetable:emptyPrompt')}</div>
      ) : (
        <div className="ls-table-scroller">
          <table className="ls-table">
            <thead>
              <tr>
                <th className="ls-th ls-th-time">{t('timetable:headers.timeDay')}</th>
                {DAYS.map((d, idx)=>(<th key={idx} className="ls-th">{d}</th>))}
              </tr>
            </thead>
            <tbody>
              {slots.map(({start,end,sm,em})=>(
                <tr key={start}>
                  <td className="ls-td-time">{start}–{end}</td>
                  {DAYS.map((_,dayIdx)=>{
                    const existing = findExisting(dayIdx, sm, em);
                    const isSelected = existing && selectedLesson && existing.lessonId === selectedLesson;
                    const hasOther = existing && (!selectedLesson || existing.lessonId !== selectedLesson);

                    let bg = '#141414', fg = '#c7c7c7';
                    if(isSelected){ bg='#0c4a6e'; fg='#dbeafe'; }
                    else if(hasOther){ bg='#7f1d1d'; fg='#fde2e2'; }

                    const currentName = existing ? (lessons.find(l=>l.id===existing.lessonId)?.name || '(unknown)') : '';
                    return (
                      <td
                        key={dayIdx}
                        className="ls-td"
                        onClick={()=>handleCellClick(dayIdx, sm, em)}
                        style={{ background:bg, color:fg }}
                        title={currentName}
                      >
                        <div className="ls-cell"><div className="ls-cell-text">{currentName}</div></div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
