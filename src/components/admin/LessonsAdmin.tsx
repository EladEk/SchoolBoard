// src/components/admin/LessonsAdmin.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../../firebase/app';
import * as XLSX from 'xlsx';
import styles from './LessonsAdmin.module.css';
import { useTranslation } from 'react-i18next';

type ToastState =
  | { show: false }
  | { show: true; kind: 'success' | 'error' | 'info'; message: string };

type Role = 'admin' | 'teacher' | 'student' | 'kiosk';

type AppUser = {
  id: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  usernameLower?: string;
  role: Role;
};

type LessonItem = {
  id: string; // Firestore doc id
  name: string;

  // main teacher
  teacherUserId?: string | null;
  teacherUsername?: string | null;
  teacherFirstName?: string | null;
  teacherLastName?: string | null;

  // When a student is the teacher for this lesson
  isStudentTeacher?: boolean;
  studentUserId?: string | null;
  studentUsername?: string | null;
  studentFirstName?: string | null;
  studentLastName?: string | null;

  // members
  studentsUserIds?: string[];

  createdAt?: any;
};

type EditState =
  | { open: false }
  | {
      open: true;
      id: string;
      name: string;
      isStudentTeacher: boolean;
      teacherUsername: string;
      studentUsername: string;
    };

// ---------------- Helpers ----------------
function labelFromUser(u?: AppUser | null) {
  if (!u) return '';
  const full = [u.firstName || '', u.lastName || ''].join(' ').replace(/\s+/g, ' ').trim();
  if (full && u.username) return `${full} (${u.username})`;
  if (full) return full;
  return u?.username || '';
}
function showToastFn(
  setToast: React.Dispatch<React.SetStateAction<ToastState>>,
  kind: 'success' | 'error' | 'info',
  message: string,
) {
  setToast({ show: true, kind, message });
  setTimeout(() => setToast({ show: false }), 2600);
}

// Subject detection for filter rule (used elsewhere in this file)
type SubjectKey = 'hebrew' | 'math' | 'english' | null;
function subjectOf(name: string): SubjectKey {
  const s = (name || '').toLowerCase().trim();
  if (!s) return null;
  if (s.includes('עברית') || s.startsWith('hebrew')) return 'hebrew';
  if (s.includes('חשבון') || s.startsWith('math')) return 'math';
  if (s.includes('אנגלית') || s.startsWith('english')) return 'english';
  return null;
}

/**
 * Rename propagation: update any denormalized lesson labels
 * in related documents (e.g., timetableEntries.lessonName).
 */
async function propagateLessonRename(lessonId: string, newName: string) {
  const qEntries = query(collection(db, 'timetableEntries'), where('lessonId', '==', lessonId));
  const snap = await getDocs(qEntries);
  if (snap.empty) return;

  let batch = writeBatch(db);
  let i = 0;
  for (const d of snap.docs) {
    batch.update(d.ref, { lessonName: newName }); // harmless if field doesn't exist
    i++;
    if (i % 450 === 0) { await batch.commit(); batch = writeBatch(db); }
  }
  await batch.commit();
}

// ---------------- Component ----------------
export default function LessonsAdmin() {
  const { t } = useTranslation();
  const [toast, setToast] = useState<ToastState>({ show: false });

  // Live datasets
  const [teachers, setTeachers] = useState<AppUser[]>([]);
  const [students, setStudents] = useState<AppUser[]>([]);
  const [lessons, setLessons] = useState<LessonItem[]>([]);

  // Create form
  const [form, setForm] = useState({
    name: '',
    isStudentTeacher: false,
    teacherUsername: '' as string,
    studentUsername: '' as string,
  });
  const [submitting, setSubmitting] = useState(false);

  // Edit modal
  const [edit, setEdit] = useState<EditState>({ open: false });
  const [saving, setSaving] = useState(false);

  // Excel import/export
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [busyImport, setBusyImport] = useState(false);

  // Manage students modal
  const [manageOpen, setManageOpen] = useState(false);
  const [manageLessonId, setManageLessonId] = useState<string>('');
  const [searchStudent, setSearchStudent] = useState('');
  const [allowDuplicatesInSubject, setAllowDuplicatesInSubject] = useState(false);

  // ---------- Load teachers / students / lessons ----------
  useEffect(() => {
    const unsubTeachers = onSnapshot(
      query(collection(db, 'appUsers'), where('role', '==', 'teacher')),
      (snap) => {
        const arr = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as AppUser[];
        arr.sort((a, b) => (labelFromUser(a) || '').localeCompare(labelFromUser(b) || ''));
        setTeachers(arr);
      },
      (err) => showToastFn(setToast, 'error', t('lessons:toasts.loadTeachersFail', { msg: err.message }))
    );

    const unsubStudents = onSnapshot(
      query(collection(db, 'appUsers'), where('role', '==', 'student')),
      (snap) => {
        const arr = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as AppUser[];
        arr.sort((a, b) => (labelFromUser(a) || '').localeCompare(labelFromUser(b) || ''));
        setStudents(arr);
      },
      (err) => showToastFn(setToast, 'error', t('lessons:toasts.loadStudentsFail', { msg: err.message }))
    );

    const unsubLessons = onSnapshot(
      query(collection(db, 'lessons'), orderBy('name')),
      (snap) => {
        const arr = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as LessonItem[];
        setLessons(arr);
      },
      (err) => showToastFn(setToast, 'error', t('lessons:toasts.loadLessonsFail', { msg: err.message }))
    );

    return () => {
      unsubTeachers();
      unsubStudents();
      unsubLessons();
    };
  }, [t]);

  const canCreate = useMemo(() => {
    if (!form.name.trim()) return false;
    if (form.isStudentTeacher) return !!form.studentUsername;
    return !!form.teacherUsername;
  }, [form]);

  function findByUsername(list: AppUser[], username: string | null | undefined) {
    if (!username) return undefined;
    const uLower = username.toLowerCase();
    return list.find((u) => (u.username || '').toLowerCase() === uLower);
  }

  // ---------- Create ----------
  async function createLesson(e: React.FormEvent) {
    e.preventDefault();
    if (!canCreate || submitting) return;

    const name = form.name.trim();
    const isStudentTeacher = !!form.isStudentTeacher;

    try {
      setSubmitting(true);

      let payload: any = {
        name,
        isStudentTeacher,
        createdAt: serverTimestamp(),
        studentsUserIds: [],
      };

      if (isStudentTeacher) {
        const stu = findByUsername(students, form.studentUsername);
        if (!stu) return showToastFn(setToast, 'error', t('lessons:toasts.selectValidStudent'));
        payload = {
          ...payload,
          studentUsername: stu.username || '',
          studentUserId: stu.id,
          studentFirstName: stu.firstName || '',
          studentLastName: stu.lastName || '',
          teacherUsername: null,
          teacherUserId: null,
          teacherFirstName: null,
          teacherLastName: null,
        };
      } else {
        const tch = findByUsername(teachers, form.teacherUsername);
        if (!tch) return showToastFn(setToast, 'error', t('lessons:toasts.selectValidTeacher'));
        payload = {
          ...payload,
          teacherUsername: tch.username || '',
          teacherUserId: tch.id,
          teacherFirstName: tch.firstName || '',
          teacherLastName: tch.lastName || '',
          studentUsername: null,
          studentUserId: null,
          studentFirstName: null,
          studentLastName: null,
        };
      }

      await addDoc(collection(db, 'lessons'), payload);

      setForm({ name: '', isStudentTeacher: false, teacherUsername: '', studentUsername: '' });
      showToastFn(setToast, 'success', t('lessons:toasts.created', { name }));
    } catch (err: any) {
      showToastFn(setToast, 'error', t('lessons:toasts.createFail', { msg: err?.message || 'unknown' }));
    } finally {
      setSubmitting(false);
    }
  }

  // ---------- Edit ----------
  function openEdit(row: LessonItem) {
    setEdit({
      open: true,
      id: row.id,
      name: row.name || '',
      isStudentTeacher: !!row.isStudentTeacher,
      teacherUsername: row.teacherUsername || '',
      studentUsername: row.studentUsername || '',
    });
  }
  function closeEdit() { setEdit({ open: false }); }

  const canSaveEdit = useMemo(() => {
    if (!edit.open) return false;
    if (!edit.name.trim()) return false;
    if (edit.isStudentTeacher) return !!edit.studentUsername;
    return !!edit.teacherUsername;
  }, [edit]);

  async function saveEdit() {
    if (!edit.open || !canSaveEdit || saving) return;

    const name = edit.name.trim();
    const isStudentTeacher = !!edit.isStudentTeacher;

    try {
      setSaving(true);

      let update: any = {
        name,
        isStudentTeacher,
      };

      if (isStudentTeacher) {
        const stu = findByUsername(students, edit.studentUsername);
        if (!stu) return showToastFn(setToast, 'error', t('lessons:toasts.selectValidStudent'));
        update = {
          ...update,
          studentUsername: stu.username || '',
          studentUserId: stu.id,
          studentFirstName: stu.firstName || '',
          studentLastName: stu.lastName || '',
          teacherUsername: null,
          teacherUserId: null,
          teacherFirstName: null,
          teacherLastName: null,
        };
      } else {
        const tch = findByUsername(teachers, edit.teacherUsername);
        if (!tch) return showToastFn(setToast, 'error', t('lessons:toasts.selectValidTeacher'));
        update = {
          ...update,
          teacherUsername: tch.username || '',
          teacherUserId: tch.id,
          teacherFirstName: tch.firstName || '',
          teacherLastName: tch.lastName || '',
          studentUsername: null,
          studentUserId: null,
          studentFirstName: null,
          studentLastName: null,
        };
      }

      await updateDoc(doc(db, 'lessons', edit.id), update);

      // keep any denormalized copies fresh
      await propagateLessonRename(edit.id, name);

      showToastFn(setToast, 'success', t('lessons:toasts.updated', { name }));
      closeEdit();
    } catch (err: any) {
      showToastFn(setToast, 'error', t('lessons:toasts.updateFail', { msg: err?.message || 'unknown' }));
    } finally {
      setSaving(false);
    }
  }

  // ---------- Delete (with confirmation) ----------
  async function removeLesson(id: string) {
    const lessonName = lessons.find(l => l.id === id)?.name || '';
    const confirmMsg =
      t('lessons:confirmDelete', { name: lessonName }) ||
      `Are you sure you want to delete "${lessonName}"?`;

    if (!window.confirm(confirmMsg)) return;

    try {
      await deleteDoc(doc(db, 'lessons', id));
      showToastFn(setToast, 'success', t('lessons:toasts.deleted'));
    } catch (err: any) {
      showToastFn(setToast, 'error', t('lessons:toasts.deleteFail', { msg: err?.message || 'unknown' }));
    }
  }

  // ---------- Excel: Export / Template / Import ----------
  function openFilePicker() { fileInputRef.current?.click(); }

  function downloadTemplate() {
    const rows = [
      { name: 'עברית רמה 1', isStudentTeacher: false, teacherUsername: 'teacher.alex', studentUsername: '' },
      { name: '1:1 Neta & Alex', isStudentTeacher: true, teacherUsername: '', studentUsername: 'student.neta' },
    ];
    const ws = XLSX.utils.json_to_sheet(rows, {
      header: ['name', 'isStudentTeacher', 'teacherUsername', 'studentUsername'],
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'LessonsTemplate');
    XLSX.writeFile(wb, 'lessons-template.xlsx');
    showToastFn(setToast, 'info', t('lessons:toasts.templateDownloaded'));
  }

  function exportItems() {
    const rows = lessons.map((l) => ({
      name: l.name || '',
      isStudentTeacher: !!l.isStudentTeacher,
      teacherUsername: l.teacherUsername || '',
      studentUsername: l.studentUsername || '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows, {
      header: ['name', 'isStudentTeacher', 'teacherUsername', 'studentUsername'],
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Lessons');
    XLSX.writeFile(wb, 'lessons-export.xlsx');
    showToastFn(setToast, 'success', t('lessons:toasts.exported'));
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      setBusyImport(true);
      showToastFn(setToast, 'info', t('lessons:toasts.importing'));

      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' });

      const existingMap = new Map<string, LessonItem>();
      for (const l of lessons) existingMap.set(l.name, l);

      let created = 0, updated = 0, skipped = 0;
      const reasons: string[] = [];

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];

        const name = String(r['name'] ?? r['Name'] ?? '').trim();
        if (!name) { skipped++; reasons.push(`Row ${i + 2}: missing name`); continue; }

        const isStudentTeacher =
          String(r['isStudentTeacher'] ?? r['IsStudentTeacher'] ?? '').toLowerCase() === 'true';
        const teacherUsername = String(r['teacherUsername'] ?? r['TeacherUsername'] ?? '').trim();
        const studentUsername = String(r['studentUsername'] ?? r['StudentUsername'] ?? '').trim();
        const legacyTeacherId = String(r['teacherUserId'] ?? r['TeacherUserId'] ?? '').trim();
        const legacyStudentId = String(r['studentUserId'] ?? r['StudentUserId'] ?? '').trim();

        let payload: any = { name, isStudentTeacher };

        if (isStudentTeacher) {
          let stu: AppUser | undefined =
            studentUsername
              ? students.find((s) => (s.username || '').toLowerCase() === studentUsername.toLowerCase())
              : students.find((s) => s.id === legacyStudentId);

          if (!stu) { skipped++; reasons.push(`Row ${i + 2}: student not found (username/id)`); continue; }

          payload = {
            ...payload,
            studentUsername: stu.username || '',
            studentUserId: stu.id,
            studentFirstName: stu.firstName || '',
            studentLastName: stu.lastName || '',
            teacherUsername: null,
            teacherUserId: null,
            teacherFirstName: null,
            teacherLastName: null,
          };
        } else {
          let tch: AppUser | undefined =
            teacherUsername
              ? teachers.find((t) => (t.username || '').toLowerCase() === teacherUsername.toLowerCase())
              : teachers.find((t) => t.id === legacyTeacherId);

          if (!tch) { skipped++; reasons.push(`Row ${i + 2}: teacher not found (username/id)`); continue; }

          payload = {
            ...payload,
            teacherUsername: tch.username || '',
            teacherUserId: tch.id,
            teacherFirstName: tch.firstName || '',
            teacherLastName: tch.lastName || '',
            studentUsername: null,
            studentUserId: null,
            studentFirstName: null,
            studentLastName: null,
          };
        }

        const existing = existingMap.get(name);
        if (existing) {
          if (existing.studentsUserIds) (payload as any).studentsUserIds = existing.studentsUserIds;
          await updateDoc(doc(db, 'lessons', existing.id), payload);
          await propagateLessonRename(existing.id, name); // keep caches fresh on import update as well
          updated++;
        } else {
          const ref = await addDoc(collection(db, 'lessons'), { ...payload, createdAt: serverTimestamp(), studentsUserIds: [] });
          await propagateLessonRename(ref.id, name);
          created++;
        }
      }

      showToastFn(setToast, 'success', t('lessons:toasts.importDone', { created, updated, skipped }));
      if (reasons.length) console.warn('Lessons import skipped:', reasons.join('\n'));
    } catch (err: any) {
      console.error(err);
      showToastFn(setToast, 'error', t('lessons:toasts.importFail', { msg: err?.message || 'unknown' }));
    } finally {
      setBusyImport(false);
    }
  }

  // ---------- Manage students ----------
  const manageLesson = useMemo(() => lessons.find(l => l.id === manageLessonId) || null, [lessons, manageLessonId]);
  const manageLessonSubject = useMemo<SubjectKey>(() => subjectOf(manageLesson?.name || ''), [manageLesson]);

  const subjectTakenSet = useMemo<Set<string>>(() => {
    if (!manageLessonSubject) return new Set();
    const taken = new Set<string>();
    for (const l of lessons) {
      if (subjectOf(l.name) === manageLessonSubject) {
        for (const sid of (l.studentsUserIds || [])) taken.add(sid);
      }
    }
    return taken;
  }, [lessons, manageLessonSubject]);

  const candidateStudents = useMemo(() => {
    const all = students.slice();
    if (!allowDuplicatesInSubject && manageLessonSubject) {
      return all.filter(s => !subjectTakenSet.has(s.id));
    }
    return all;
  }, [students, allowDuplicatesInSubject, subjectTakenSet, manageLessonSubject]);

  async function addStudentToLesson(lessonId: string, studentId: string) {
    await updateDoc(doc(db, 'lessons', lessonId), { studentsUserIds: arrayUnion(studentId) });
  }
  async function removeStudentFromLesson(lessonId: string, studentId: string) {
    await updateDoc(doc(db, 'lessons', lessonId), { studentsUserIds: arrayRemove(studentId) });
  }

  // ---------- UI ----------
  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <h2>{t('lessons:title', 'Lessons')}</h2>
      </header>

      <section className={styles.card}>
        <h3 className={styles.cardTitle}>{t('lessons:new', 'Create Lesson')}</h3>
        <form onSubmit={createLesson} className={styles.form}>
          <input
            className={styles.input}
            placeholder={t('lessons:name','Lesson name')!}
            value={form.name}
            onChange={e => setForm(v => ({ ...v, name: e.target.value }))}
          />

          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={form.isStudentTeacher}
              onChange={e => setForm(v => ({ ...v, isStudentTeacher: e.target.checked }))}
            />
            {t('lessons:isStudentTeacher','Student is the teacher')}
          </label>

          {!form.isStudentTeacher ? (
            <input
              className={styles.input}
              placeholder={t('lessons:teacherUsername','Teacher username')!}
              value={form.teacherUsername}
              onChange={e => setForm(v => ({ ...v, teacherUsername: e.target.value }))}
            />
          ) : (
            <input
              className={styles.input}
              placeholder={t('lessons:studentUsername','Student username')!}
              value={form.studentUsername}
              onChange={e => setForm(v => ({ ...v, studentUsername: e.target.value }))}
            />
          )}

          <button className={styles.btn} disabled={!canCreate || submitting}>
            {t('common:create','Create')}
          </button>
        </form>
      </section>

      <section className={styles.card}>
        <div className={styles.cardTitleRow}>
          <h3 className={styles.cardTitle}>{t('lessons:list','All Lessons')}</h3>
          <div className={styles.actions}>
            <button className={styles.btnSecondary} onClick={downloadTemplate}>{t('common:template','Template')}</button>
            <button className={styles.btnSecondary} onClick={exportItems}>{t('common:export','Export')}</button>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" hidden onChange={handleImportFile} />
            <button className={styles.btnSecondary} onClick={() => fileInputRef.current?.click()} disabled={busyImport}>
              {busyImport ? t('common:importing','Importing...') : t('common:import','Import')}
            </button>
          </div>
        </div>

        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t('lessons:table.name','Name')}</th>
              <th>{t('lessons:table.teacher','Teacher / Student-Teacher')}</th>
              <th style={{width:240}}>{t('common:actions','Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {lessons.map(l => (
              <tr key={l.id}>
                <td>{l.name}</td>
                <td>
                  {!l.isStudentTeacher
                    ? (l.teacherUsername || '-')
                    : (l.studentUsername ? `${l.studentUsername} (${t('lessons:studentTeacher','student-teacher')})` : '-')}
                </td>
                <td style={{ display:'flex', gap:6, justifyContent:'flex-end' }}>
                  <button className={styles.btnSmall} onClick={() => openEdit(l)}>{t('common:edit','Edit')}</button>
                  <button className={styles.btnSmall} onClick={() => { setManageLessonId(l.id); setManageOpen(true); }}>
                    {t('lessons:manageStudents','Manage Students')}
                  </button>
                  <button className={styles.btnSmallDanger} onClick={() => removeLesson(l.id)}>{t('common:delete','Delete')}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* EDIT POPUP */}
      {edit.open && (
        <div className={styles.modalScrim} onClick={closeEdit}>
          <div
            className={styles.modalCard}
            onClick={e => e.stopPropagation()}
          >
            <h3 className={styles.cardTitle}>{t('lessons:editTitle','Edit Lesson')}</h3>

            <label className={styles.label}>{t('lessons:name','Name')}</label>
            <input className={styles.input} value={edit.name} onChange={e => setEdit(prev => prev.open ? { ...prev, name:e.target.value } : prev)} />

            <label className={styles.checkbox}>
              <input type="checkbox" checked={edit.isStudentTeacher} onChange={e => setEdit(prev => prev.open ? { ...prev, isStudentTeacher:e.target.checked } : prev)} />
              {t('lessons:isStudentTeacher','Student is the teacher')}
            </label>

            {!edit.isStudentTeacher ? (
              <>
                <label className={styles.label}>{t('lessons:teacherUsername','Teacher username')}</label>
                <input className={styles.input} value={edit.teacherUsername} onChange={e => setEdit(prev => prev.open ? { ...prev, teacherUsername:e.target.value } : prev)} />
              </>
            ) : (
              <>
                <label className={styles.label}>{t('lessons:studentUsername','Student username')}</label>
                <input className={styles.input} value={edit.studentUsername} onChange={e => setEdit(prev => prev.open ? { ...prev, studentUsername:e.target.value } : prev)} />
              </>
            )}

            <div className={styles.modalActions}>
              <button className={styles.btn} onClick={saveEdit} disabled={!canSaveEdit || saving}>{t('common:save','Save')}</button>
              <button className={styles.btnSecondary} onClick={closeEdit}>{t('common:cancel','Cancel')}</button>
            </div>
          </div>
        </div>
      )}

      {/* MANAGE STUDENTS POPUP */}
      {manageOpen && manageLesson && (
        <div className={styles.modalScrim} onClick={() => setManageOpen(false)}>
          <div
            className={styles.modalCard}
            style={{ maxWidth: 900, width: '100%' }}
            onClick={e => e.stopPropagation()}
          >
            <h3 className={styles.cardTitle}>
              {t('lessons:manageStudentsOf','Students in')} “{manageLesson.name}”
            </h3>

            <div className={styles.row}>
              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={allowDuplicatesInSubject}
                  onChange={e => setAllowDuplicatesInSubject(e.target.checked)}
                />
                {t('lessons:allowDupSubject','Allow duplicates in same subject')}
              </label>
              <input
                className={styles.input}
                placeholder={t('common:search','Search')!}
                value={searchStudent}
                onChange={e => setSearchStudent(e.target.value)}
              />
            </div>

            <div className={styles.manageGrid}>
              <div className={styles.manageCol}>
                <h4>{t('lessons:current','Current')}</h4>
                <ul className={styles.list}>
                  {(manageLesson.studentsUserIds || []).map(sid => {
                    const s = students.find(u => u.id === sid);
                    const label = s ? (labelFromUser(s) || s.username || s.id) : sid;
                    if (searchStudent.trim() && !label.toLowerCase().includes(searchStudent.trim().toLowerCase())) {
                      return null;
                    }
                    return (
                      <li key={sid} className={styles.listItem}>
                        <span>{label}</span>
                        <button className={styles.btnSmall} onClick={() => removeStudentFromLesson(manageLesson.id, sid)}>
                          {t('common:remove','Remove')}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div className={styles.manageCol}>
                <h4>{t('lessons:add','Add')}</h4>
                <ul className={styles.list}>
                  {candidateStudents.map(s => {
                    const label = labelFromUser(s) || s.username || s.id;
                    if (searchStudent.trim() && !label.toLowerCase().includes(searchStudent.trim().toLowerCase())) {
                      return null;
                    }
                    const already = (manageLesson.studentsUserIds || []).includes(s.id);
                    if (already) return null;
                    return (
                      <li key={s.id} className={styles.listItem}>
                        <span>{label}</span>
                        <button className={styles.btnSmall} onClick={() => addStudentToLesson(manageLesson.id, s.id)}>
                          {t('common:add','Add')}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>

            <div className={styles.modalActions}>
              <button className={styles.btn} onClick={() => setManageOpen(false)}>{t('common:done','Done')}</button>
            </div>
          </div>
        </div>
      )}

      {toast.show && <div className={styles.toast}>{toast.message}</div>}
    </div>
  );
}
