// src/components/admin/LevelsMover.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  collection, doc, onSnapshot, query, updateDoc, where, arrayRemove, arrayUnion,
} from 'firebase/firestore';
import { db } from '../../firebase/app';
import styles from './LevelsMover.module.css';
import { useTranslation } from 'react-i18next';
import * as XLSX from 'xlsx';

/**
 * Supports names like:
 *  - "אנגלית רמה 1 קבוצה 1"
 *  - "אנגלית רמה 1 - קבוצה 2"
 *  - "English Level 3 Group A"
 *  - "Hebrew Level 2"
 *
 * Parsing extracts: base, level number (optional), group label (optional).
 * We render columns per LEVEL; inside each level, we render all "groups" (lessons).
 * Import/export:
 *  - Export: one row per (student, lesson). Columns: Base, Level, Group, Lesson, StudentUsername, StudentFullName
 *  - Import: accepts Student as username OR full name. Resolves to user id, finds the target lesson and adds the student.
 *    If (Base,Level,Group) points to multiple lessons and Group omitted, we auto-pick the smallest group in that level.
 */

type Role = 'admin' | 'teacher' | 'student' | 'kiosk';
type AppUser = {
  id: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  role: Role;
};

type Lesson = {
  id: string;
  name: string;
  studentsUserIds?: string[];
};

function labelFromUser(u?: AppUser | null) {
  if (!u) return '';
  const full = `${u.firstName || ''} ${u.lastName || ''}`.replace(/\s+/g, ' ').trim();
  if (full && u.username) return `${full} (${u.username})`;
  if (full) return full;
  return u?.username || '';
}

// ---------- Name parsing ----------
function parseName(name: string): { base: string; level?: number; group?: string } {
  const s = (name || '').trim();

  // Hebrew: "רמה X" (optional "קבוצה Y")
  let m =
    s.match(/^(.*?)(?:\s*[-–—]?\s*)?רמה\s*(\d{1,2})(?:\s*[-–—]?\s*קבוצה\s*([0-9\u05D0-\u05EA]+))?\s*$/i);
  if (m) {
    const base = m[1].trim();
    const level = Number(m[2]);
    const groupRaw = (m[3] || '').trim();
    return { base, level: Number.isFinite(level) ? level : undefined, group: groupRaw || undefined };
  }

  // English: "Level X" (optional "Group Y")
  m = s.match(/^(.*?)(?:\s*[-–—]?\s*)?level\s*(\d{1,2})(?:\s*[-–—]?\s*group\s*([0-9A-Za-z]+))?\s*$/i);
  if (m) {
    const base = m[1].trim();
    const level = Number(m[2]);
    const groupRaw = (m[3] || '').trim();
    return { base, level: Number.isFinite(level) ? level : undefined, group: groupRaw || undefined };
  }

  // Fallback
  return { base: s };
}

function sortLessonsInsideLevel(a: Lesson, b: Lesson) {
  const pa = parseName(a.name); const pb = parseName(b.name);
  const ga = (pa.group || '').toString().toLowerCase();
  const gb = (pb.group || '').toString().toLowerCase();
  if (ga !== gb) return ga.localeCompare(gb);
  return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
}

// Normalize helpers
const norm = (s?: string) => (s || '').toString().trim().toLowerCase();
const fullNameKey = (u: AppUser) => norm(`${u.firstName || ''} ${u.lastName || ''}`);

// ---------- Component ----------
export default function LevelsMover() {
  const { t } = useTranslation('levelsMover');

  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [students, setStudents] = useState<AppUser[]>([]);
  const [selectedBase, setSelectedBase] = useState<string>('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [busyImport, setBusyImport] = useState(false);

  // Live: lessons + students
  useEffect(() => {
    const unsubL = onSnapshot(query(collection(db, 'lessons')), (snap) => {
      const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Lesson[];
      setLessons(rows);
    });
    const unsubS = onSnapshot(query(collection(db, 'appUsers'), where('role', '==', 'student')), (snap) => {
      const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as AppUser[];
      setStudents(rows);
    });
    return () => { unsubL(); unsubS(); };
  }, []);

  // Group lessons by base -> level -> list of lessons (groups)
  const bases = useMemo(() => {
    const map = new Map<string, Map<number | 'unleveled', Lesson[]>>();

    for (const l of lessons) {
      const { base, level } = parseName(l.name || '');
      if (!base) continue;
      const lvlKey = Number.isFinite(level!) ? (level as number) : ('unleveled' as const);

      if (!map.has(base)) map.set(base, new Map());
      const byLevel = map.get(base)!;
      if (!byLevel.has(lvlKey)) byLevel.set(lvlKey, []);
      byLevel.get(lvlKey)!.push(l);
    }

    const out: Array<{ base: string; levels: Array<{ key: number | 'unleveled'; items: Lesson[] }> }> = [];
    for (const [base, byLevel] of map) {
      const all = Array.from(byLevel.values()).flat();
      const hasAnyLevel = Array.from(byLevel.keys()).some(k => k !== 'unleveled');
      if (all.length >= 2 && hasAnyLevel) {
        const levelEntries = Array.from(byLevel.entries())
          .map(([key, items]) => ({ key, items: items.slice().sort(sortLessonsInsideLevel) }))
          .sort((a, b) => {
            if (a.key === 'unleveled' && b.key === 'unleveled') return 0;
            if (a.key === 'unleveled') return 1;
            if (b.key === 'unleveled') return -1;
            return (a.key as number) - (b.key as number);
          });
        out.push({ base, levels: levelEntries });
      }
    }
    out.sort((a, b) => a.base.toLowerCase().localeCompare(b.base.toLowerCase()));
    return out;
  }, [lessons]);

  // Current selection
  const current = useMemo(
    () => bases.find(g => g.base === selectedBase) || null,
    [bases, selectedBase]
  );

  // Student quick lookups
  const stuByUsername = useMemo(() => {
    const m = new Map<string, AppUser>();
    for (const s of students) {
      if (s.username) m.set(norm(s.username), s);
    }
    return m;
  }, [students]);

  const stusByFullName = useMemo(() => {
    const m = new Map<string, AppUser[]>();
    for (const s of students) {
      const key = fullNameKey(s);
      if (!key) continue;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(s);
    }
    return m;
  }, [students]);

  function studentsForLesson(lesson: Lesson): AppUser[] {
    const ids = lesson.studentsUserIds || [];
    let arr = ids.map(id => students.find(s => s.id === id)).filter(Boolean) as AppUser[];
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      arr = arr.filter(s =>
        [labelFromUser(s), s.username]
          .filter(Boolean)
          .some(v => (v as string).toLowerCase().includes(q))
      );
    }
    arr.sort((a, b) => (labelFromUser(a) || '').localeCompare(labelFromUser(b) || ''));
    return arr;
  }

  async function moveOne(studentId: string, fromLessonId: string, toLessonId: string) {
    if (fromLessonId === toLessonId) return;
    try {
      await updateDoc(doc(db, 'lessons', fromLessonId), { studentsUserIds: arrayRemove(studentId) });
      await updateDoc(doc(db, 'lessons', toLessonId), { studentsUserIds: arrayUnion(studentId) });
    } catch (e: any) {
      console.error(e);
      alert(e?.message || 'Failed to move student');
    }
  }

  function pickSmallestGroupInLevel(levelIdx: number): string | undefined {
    if (!current) return undefined;
    const level = current.levels[levelIdx];
    if (!level) return undefined;
    let bestId: string | undefined;
    let bestSize = Number.POSITIVE_INFINITY;
    for (const l of level.items) {
      const size = (l.studentsUserIds || []).length;
      if (size < bestSize) { bestSize = size; bestId = l.id; }
    }
    return bestId;
  }

  async function moveAll(fromLessonId: string, toLessonId: string) {
    const from = lessons.find(l => l.id === fromLessonId);
    if (!from) return;
    const ids = (from.studentsUserIds || []).slice();
    if (!ids.length) return;
    if (!window.confirm(t('moveAllConfirm', 'Move ALL students from this group?'))) return;

    try {
      await updateDoc(doc(db, 'lessons', fromLessonId), { studentsUserIds: arrayRemove(...ids) });
      await updateDoc(doc(db, 'lessons', toLessonId), { studentsUserIds: arrayUnion(...ids) });
    } catch (e: any) {
      console.error(e);
      alert(e?.message || 'Failed to move all students');
    }
  }

  // Resolve: given base, level?, group? choose a single lesson id (group)
  function resolveLessonId(base: string, level?: number, group?: string): string | undefined {
    const matchBase = bases.find(b => norm(b.base) === norm(base));
    if (!matchBase) return undefined;

    // Build list of lessons at level (or all if no level)
    let candidates: Lesson[] = [];
    for (const lev of matchBase.levels) {
      if (typeof level === 'number') {
        if (lev.key === level) candidates.push(...lev.items);
      } else {
        candidates.push(...lev.items);
      }
    }

    if (group) {
      const gNorm = norm(group);
      const exact = candidates.find(l => norm(parseName(l.name).group) === gNorm);
      if (exact) return exact.id;
      // fallback: contains
      const contains = candidates.find(l => norm(parseName(l.name).group || '').includes(gNorm));
      if (contains) return contains.id;
    }

    // No group specified ←pick smallest in that level set
    let bestId: string | undefined;
    let bestSize = Number.POSITIVE_INFINITY;
    for (const l of candidates) {
      const size = (l.studentsUserIds || []).length;
      if (size < bestSize) { bestSize = size; bestId = l.id; }
    }
    return bestId;
  }

  // ---------- Export / Import ----------
  function openFilePicker(){ fileInputRef.current?.click(); }

  // Export: either current base or ALL bases (flattened)
  function exportData(){
    const rows: any[] = [];
    const collectFrom = (grouping: { base: string; levels: { key: number | 'unleveled'; items: Lesson[] }[] }) => {
      for (const lev of grouping.levels) {
        for (const l of lev.items) {
          const stuIds = l.studentsUserIds || [];
          for (const sid of stuIds) {
            const s = students.find(x => x.id === sid);
            rows.push({
              Base: grouping.base,
              Level: lev.key === 'unleveled' ? '' : lev.key,
              Group: parseName(l.name).group || '',
              Lesson: l.name,
              StudentUsername: s?.username || '',
              StudentFullName: `${s?.firstName || ''} ${s?.lastName || ''}`.replace(/\s+/g, ' ').trim(),
            });
          }
          if (!stuIds.length) {
            // Keep an empty row to represent an empty group
            rows.push({
              Base: grouping.base,
              Level: lev.key === 'unleveled' ? '' : lev.key,
              Group: parseName(l.name).group || '',
              Lesson: l.name,
              StudentUsername: '',
              StudentFullName: '',
            });
          }
        }
      }
    };

    if (current) collectFrom(current);
    else bases.forEach(collectFrom);

    const ws = XLSX.utils.json_to_sheet(rows, { header:['Base','Level','Group','Lesson','StudentUsername','StudentFullName'] });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Levels');
    const fn = current ? `levels-${current.base}.xlsx` : 'levels-all.xlsx';
    XLSX.writeFile(wb, fn);
    setStatus(t('common:exported', 'Exported'));
  }

  function downloadTemplate(){
    const sample = [
      { Base: 'English', Level: 1, Group: '1', Lesson: 'English Level 1 Group 1', StudentUsername: 'student.neta', StudentFullName: 'Neta Cohen' },
      { Base: 'עברית',   Level: 3, Group: '2', Lesson: 'עברית רמה 3 קבוצה 2',     StudentUsername: '',             StudentFullName: 'דנה לוי' },
    ];
    const ws = XLSX.utils.json_to_sheet(sample, { header:['Base','Level','Group','Lesson','StudentUsername','StudentFullName'] });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, 'levels-template.xlsx');
    setStatus(t('templateDownloaded', 'Template downloaded'));
  }

  // Import notes:
  //  - For each row, determine target lesson:
  //      * Prefer Lesson column if matches exactly one lesson by name.
  //      * Else use (Base, Level, Group) to resolve; if Group missing, auto-pick smallest group in that level.
  //  - Student resolution:
  //      * If StudentUsername present -> use it.
  //      * Else if StudentFullName present -> match by "first last" (case-insensitive). If multiple matches, skip with reason.
  //  - Dedup: arrayUnion ensures no duplicate ids. We also avoid needless writes if already present.
  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>){
    const file = e.target.files?.[0];
    e.target.value = '';
    if(!file) return;

    try{
      setBusyImport(true);
      setStatus(t('common:importing','Importing...'));

      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' });

      let added=0, skipped=0, updated=0;
      const reasons: string[] = [];

      // Quick lesson name map
      const lessonByName = new Map<string, Lesson>();
      for (const l of lessons) lessonByName.set((l.name || '').trim(), l);

      for (let i=0;i<rows.length;i++){
        const r = rows[i];
        const rowNum = i+2;

        const baseRaw = String(r['Base'] ?? r['base'] ?? '').trim();
        const levelRaw = String(r['Level'] ?? r['level'] ?? '').trim();
        const groupRaw = String(r['Group'] ?? r['group'] ?? '').trim();
        const lessonTitle = String(r['Lesson'] ?? r['lesson'] ?? '').trim();
        const userRaw = String(r['StudentUsername'] ?? r['studentUsername'] ?? '').trim();
        const fullRaw = String(r['StudentFullName'] ?? r['studentFullName'] ?? '').trim();

        // Resolve student
        let student: AppUser | undefined;
        if (userRaw) {
          student = stuByUsername.get(norm(userRaw));
          if (!student) { skipped++; reasons.push(`Row ${rowNum}: username "${userRaw}" not found`); continue; }
        } else if (fullRaw) {
          const matches = stusByFullName.get(norm(fullRaw)) || [];
          if (matches.length === 0) { skipped++; reasons.push(`Row ${rowNum}: full name "${fullRaw}" not found`); continue; }
          if (matches.length > 1) { skipped++; reasons.push(`Row ${rowNum}: full name "${fullRaw}" is ambiguous (${matches.length})`); continue; }
          student = matches[0];
        } else {
          skipped++; reasons.push(`Row ${rowNum}: no StudentUsername or StudentFullName`); continue;
        }

        // Resolve lesson
        let targetLesson: Lesson | undefined;
        if (lessonTitle) {
          const direct = lessonByName.get(lessonTitle);
          if (direct) targetLesson = direct;
        }
        if (!targetLesson) {
          if (!baseRaw) { skipped++; reasons.push(`Row ${rowNum}: missing Base or Lesson`); continue; }
          const lvl = levelRaw ? Number(levelRaw) : undefined;
          const lid = resolveLessonId(baseRaw, Number.isFinite(lvl!) ? Number(lvl) : undefined, groupRaw || undefined);
          if (!lid) { skipped++; reasons.push(`Row ${rowNum}: cannot resolve lesson for Base="${baseRaw}" Level="${levelRaw}" Group="${groupRaw}"`); continue; }
          targetLesson = lessons.find(l => l.id === lid);
        }
        if (!targetLesson) { skipped++; reasons.push(`Row ${rowNum}: lesson not found`); continue; }

        // Skip if already present
        const already = (targetLesson.studentsUserIds || []).includes(student.id);
        if (already) { updated++; continue; }

        // Add
        await updateDoc(doc(db, 'lessons', targetLesson.id), { studentsUserIds: arrayUnion(student.id) });
        // Reflect locally for better subsequent decisions (like smallest group)
        targetLesson.studentsUserIds = [...(targetLesson.studentsUserIds || []), student.id];
        added++;
      }

      setStatus(t('common:importDone', { created: added, updated, skipped }) as string);
      if (reasons.length) console.warn('Levels import skipped:', reasons.join('\n'));
    }catch(err:any){
      console.error(err);
      setStatus(t('common:importFail', { msg: err?.message || 'unknown' }) as string);
    }finally{
      setBusyImport(false);
    }
  }

  const allLessonsInBase = useMemo(() => {
    if (!current) return [];
    return current.levels.flatMap(l => l.items);
  }, [current]);

  return (
    <div className={styles.wrapper}>
      {/* Status */}
      {status ? (
        <div className={styles.status || ''} style={{ marginBottom: 8, opacity: .9 }}>
          {status}
        </div>
      ) : null}

      {/* Controls */}
      <div className={styles.header}>
        <select
          className={styles.select}
          value={selectedBase}
          onChange={(e) => setSelectedBase(e.target.value)}
        >
          <option value="">{t('selectBase', 'Choose a subject with levels')}</option>
          {bases.map(g => (
            <option key={g.base} value={g.base}>{g.base}</option>
          ))}
        </select>

        <input
          className={styles.input}
          placeholder={t('searchStudents', 'Search students')}
          value={search}
          onChange={(e)=>setSearch(e.target.value)}
        />

        {/* Actions: template / export / import */}
        <div className={styles.toolbar}>
          <button className={styles.btn} onClick={downloadTemplate}>
            {t('common:downloadTemplate','Download template')}
          </button>
          <button className={styles.btn} onClick={exportData}>
            {t('common:export','Export')}
          </button>
          <button
            className={styles.btn}
            onClick={openFilePicker}
            disabled={busyImport}
            title={busyImport ? t('common:importing','Importing...') : t('common:import','Import')}
          >
            {busyImport ? t('common:importing','Importing...') : t('common:import','Import')}
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
      </div>

      {!current ? (
        <div className={styles.empty}>
          {bases.length
            ? t('pickBasePrompt', 'Pick a subject with levels from the list')
            : t('noGroupsYet', 'No level-based lessons yet')}
        </div>
      ) : (
        // Grid of columns: one per LEVEL
        <div className={styles.grid}>
          {current.levels.map((levelEntry, levelIdx) => {
            const levelKey = levelEntry.key;
            const levelTitle =
              levelKey === 'unleveled' ? t('noLevel', 'No level') : t('levelPrefix', { n: levelKey });

            const prevLevelTargetId = levelIdx > 0 ? pickSmallestGroupInLevel(levelIdx - 1) : undefined;
            const nextLevelTargetId = levelIdx < current.levels.length - 1 ? pickSmallestGroupInLevel(levelIdx + 1) : undefined;

            return (
              <div key={String(levelKey)} className={styles.card}>
                <div className={styles.cardHeader}>
                  <span>{`${current.base} - ${levelTitle}`}</span>
                  <span className={styles.badge}>
                    {levelEntry.items.length > 1
                      ? t('groupsCount', { n: levelEntry.items.length })
                      : t('oneGroup', 'One group')}
                  </span>
                </div>

                <div className={styles.list}>
                  {levelEntry.items.map((lesson) => {
                    const people = studentsForLesson(lesson);
                    return (
                      <div key={lesson.id} className={styles.card} style={{ margin: 0 }}>
                        <div className={styles.cardHeader}>
                          <span>{lesson.name}</span>

                          <div className={styles.toolbar}>
                            {prevLevelTargetId && (
                              <button
                                className={styles.btn}
                                title={t('moveAllPrevTitle', 'Move the whole group to previous level (smallest group)')}
                                onClick={()=>moveAll(lesson.id, prevLevelTargetId)}
                              >
                                {t('moveAllPrev', '→  Move all')}
                              </button>
                            )}
                            {nextLevelTargetId && (
                              <button
                                className={styles.btn}
                                title={t('moveAllNextTitle', 'Move the whole group to next level (smallest group)')}
                                onClick={()=>moveAll(lesson.id, nextLevelTargetId)}
                              >
                                {t('moveAllNext', 'Move all →')}
                              </button>
                            )}
                          </div>
                        </div>

                        <div className={styles.list}>
                          {people.map(stu => (
                            <div key={stu.id} className={styles.row}>
                              <div style={{ marginInlineEnd: 8 }}>{labelFromUser(stu)}</div>

                              <div className={styles.toolbar}>
                                <select
                                  className={styles.select}
                                  onChange={(e) => {
                                    const toId = e.target.value;
                                    if (toId) moveOne(stu.id, lesson.id, toId);
                                  }}
                                  defaultValue=""
                                >
                                  <option value="">{t('moveTo', 'Move to...')}</option>
                                  {current.levels.map((lev) => (
                                    <optgroup
                                      key={String(lev.key)}
                                      label={lev.key === 'unleveled' ? t('noLevel', 'No level') : t('levelPrefix', { n: lev.key as number })}
                                    >
                                      {lev.items
                                        .filter(l => l.id !== lesson.id)
                                        .map(l => (
                                          <option key={l.id} value={l.id}>
                                            {l.name}
                                          </option>
                                        ))}
                                    </optgroup>
                                  ))}
                                </select>

                                {prevLevelTargetId && (
                                  <button
                                    className={styles.btnGhost}
                                    title={t('prevLevel', '→  To previous level (smallest group)')}
                                    onClick={()=>moveOne(stu.id, lesson.id, prevLevelTargetId)}
                                  >
                                    {'\u2192'}
                                  </button>
                                )}
                                {nextLevelTargetId && (
                                  <button
                                    className={styles.btnGhost}
                                    title={t('nextLevel', 'To next level ←(smallest group)')}
                                    onClick={()=>moveOne(stu.id, lesson.id, nextLevelTargetId)}
                                  >
                                    {'\u2190'}
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                          {!people.length && (
                            <div className={styles.empty}>{t('noStudentsInGroup', 'No students in this group')}</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
