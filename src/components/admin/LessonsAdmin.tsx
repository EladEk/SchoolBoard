import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
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
  return u.username || '';
}
function compactName(first?: string | null, last?: string | null, username?: string | null) {
  const full = [first || '', last || ''].join(' ').replace(/\s+/g, ' ').trim();
  if (full && username) return `${full} (${username})`;
  if (full) return full;
  return username || '';
}
function showToastFn(
  setToast: React.Dispatch<React.SetStateAction<ToastState>>,
  kind: 'success' | 'error' | 'info',
  message: string,
) {
  setToast({ show: true, kind, message });
  setTimeout(() => setToast({ show: false }), 2600);
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
      showToastFn(setToast, 'success', t('lessons:toasts.updated', { name }));
      closeEdit();
    } catch (err: any) {
      showToastFn(setToast, 'error', t('lessons:toasts.updateFail', { msg: err?.message || 'unknown' }));
    } finally {
      setSaving(false);
    }
  }

  // ---------- Delete ----------
  async function removeLesson(id: string) {
    try { await deleteDoc(doc(db, 'lessons', id)); showToastFn(setToast, 'success', t('lessons:toasts.deleted')); }
    catch (err: any) { showToastFn(setToast, 'error', t('lessons:toasts.deleteFail', { msg: err?.message || 'unknown' })); }
  }

  // ---------- Excel: Export / Template / Import ----------
  function openFilePicker() { fileInputRef.current?.click(); }

  function downloadTemplate() {
    const rows = [
      { name: 'Math', isStudentTeacher: false, teacherUsername: 'teacher.alex', studentUsername: '' },
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
          await updateDoc(doc(db, 'lessons', existing.id), payload);
          updated++;
        } else {
          await addDoc(collection(db, 'lessons'), { ...payload, createdAt: serverTimestamp() });
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

  // ---------- UI ----------
  return (
    <div className={styles.wrapper}>
      {/* Toast */}
      {toast.show && (
        <div
          className={[
            styles.toast,
            toast.kind === 'success'
              ? styles.toastSuccess
              : toast.kind === 'info'
              ? styles.toastInfo
              : styles.toastError,
          ].join(' ')}
          role="status"
          aria-live="polite"
        >
          {toast.message}
        </div>
      )}

      <div className={styles.actionBar}>
        <h2 className="text-xl font-semibold text-white">{t('lessons:manage')}</h2>
        <div className="flex gap-2">
          <button onClick={downloadTemplate} className={styles.btn}>{t('common:downloadTemplate')}</button>
          <button onClick={exportItems} className={styles.btn}>{t('common:export')}</button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={busyImport}
            className={`${styles.btn} ${styles.btnPrimary}`}
          >
            {busyImport ? t('lessons:adding') : t('common:import')}
          </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={handleImportFile}
          className={styles.fileInputHidden}
          aria-hidden="true"
          tabIndex={-1}
        />
        </div>
      </div>

      {/* Create */}
      <form
        onSubmit={createLesson}
        className={`${styles.panel} grid grid-cols-1 md:grid-cols-5 gap-3 p-4`}
      >
        <input
          type="text"
          placeholder={t('lessons:name')!}
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          className={`${styles.input} md:col-span-2`}
          autoComplete="off"
        />

        <label className="flex items-center gap-2 text-sm md:col-span-1">
          <input
            type="checkbox"
            checked={form.isStudentTeacher}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                isStudentTeacher: e.target.checked,
                teacherUsername: e.target.checked ? '' : f.teacherUsername,
                studentUsername: e.target.checked ? f.studentUsername : '',
              }))
            }
          />
          {t('lessons:teacherIsStudent')}
        </label>

        {/* Teacher select (username-based) */}
        <select
          disabled={form.isStudentTeacher}
          value={form.teacherUsername}
          onChange={(e) => setForm((f) => ({ ...f, teacherUsername: e.target.value }))}
          className={[
            styles.select,
            form.isStudentTeacher ? 'opacity-50 cursor-not-allowed' : '',
            'md:col-span-1',
          ].join(' ')}
        >
          <option value="">{t('lessons:selectTeacher')}</option>
          {teachers.map((tch) => (
            <option key={tch.id} value={tch.username || ''}>
              {labelFromUser(tch)}
            </option>
          ))}
        </select>

        {/* Student select (username-based) */}
        <select
          disabled={!form.isStudentTeacher}
          value={form.studentUsername}
          onChange={(e) => setForm((f) => ({ ...f, studentUsername: e.target.value }))}
          className={[
            styles.select,
            !form.isStudentTeacher ? 'opacity-50 cursor-not-allowed' : '',
            'md:col-span-1',
          ].join(' ')}
        >
          <option value="">{t('lessons:selectStudent')}</option>
          {students.map((s) => (
            <option key={s.id} value={s.username || ''}>
              {labelFromUser(s)}
            </option>
          ))}
        </select>

        <div className="md:col-span-5 flex items-stretch">
          <button
            type="submit"
            disabled={!canCreate || submitting}
            className={`${styles.btn} ${styles.btnPrimary}`}
          >
            {submitting ? t('lessons:adding') : t('lessons:add')}
          </button>
        </div>
      </form>

      {/* List */}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t('lessons:table.name')}</th>
              <th>{t('lessons:table.teacher')}</th>
              <th className="w-44">{t('common:actions')}</th>
            </tr>
          </thead>
          <tbody>
            {lessons.map((l) => {
              const teacherStr = l.isStudentTeacher
                ? `${compactName(l.studentFirstName, l.studentLastName, l.studentUsername)} ${t('lessons:labels.studentSuffix')}`
                : compactName(l.teacherFirstName, l.teacherLastName, l.teacherUsername);
              return (
                <tr key={l.id}>
                  <td>{l.name}</td>
                  <td>{teacherStr || <span className="text-neutral-400">—</span>}</td>
                  <td>
                    <div className="flex gap-2">
                      <button onClick={() => openEdit(l)} className={styles.btn}>{t('common:edit')}</button>
                      <button onClick={() => removeLesson(l.id)} className={`${styles.btn} ${styles.btnDanger}`}>{t('common:delete')}</button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!lessons.length && (
              <tr>
                <td colSpan={3} style={{ color: 'var(--sb-muted)', padding: '1rem' }}>
                  {t('common:noItems')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Edit modal */}
      {edit.open && (
        <div
          className={styles.modalScrim}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeEdit();
          }}
        >
          <div className={styles.modalCard}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-white">{t('lessons:editTitle')}</h3>
              <button className={styles.btn} onClick={closeEdit} aria-label={t('common:close')!}>✕</button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="md:col-span-2">
                <label className="block text-sm text-neutral-300 mb-1">{t('lessons:name')}</label>
                <input
                  type="text"
                  value={edit.name}
                  onChange={(e) =>
                    setEdit((prev) => (prev.open ? { ...prev, name: e.target.value } : prev))
                  }
                  className={styles.input}
                />
              </div>

              <label className="flex items-center gap-2 text-sm md:col-span-2">
                <input
                  type="checkbox"
                  checked={edit.isStudentTeacher}
                  onChange={(e) =>
                    setEdit((prev) =>
                      prev.open
                        ? {
                            ...prev,
                            isStudentTeacher: e.target.checked,
                            teacherUsername: e.target.checked ? '' : prev.teacherUsername,
                            studentUsername: e.target.checked ? prev.studentUsername : '',
                          }
                        : prev
                    )
                  }
                />
                {t('lessons:teacherIsStudent')}
              </label>

              {/* Teacher select */}
              <div>
                <label className="block text-sm text-neutral-300 mb-1">{t('lessons:teacherByUsername')}</label>
                <select
                  disabled={edit.isStudentTeacher}
                  value={edit.teacherUsername}
                  onChange={(e) =>
                    setEdit((prev) => (prev.open ? { ...prev, teacherUsername: e.target.value } : prev))
                  }
                  className={[
                    styles.select,
                    edit.isStudentTeacher ? 'opacity-50 cursor-not-allowed' : '',
                  ].join(' ')}
                >
                  <option value="">{t('lessons:selectTeacher')}</option>
                  {teachers.map((t) => (
                    <option key={t.id} value={t.username || ''}>
                      {labelFromUser(t)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Student select */}
              <div>
                <label className="block text-sm text-neutral-300 mb-1">{t('lessons:studentByUsername')}</label>
                <select
                  disabled={!edit.isStudentTeacher}
                  value={edit.studentUsername}
                  onChange={(e) =>
                    setEdit((prev) => (prev.open ? { ...prev, studentUsername: e.target.value } : prev))
                  }
                  className={[
                    styles.select,
                    !edit.isStudentTeacher ? 'opacity-50 cursor-not-allowed' : '',
                  ].join(' ')}
                >
                  <option value="">{t('lessons:selectStudent')}</option>
                  {students.map((s) => (
                    <option key={s.id} value={s.username || ''}>
                      {labelFromUser(s)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button onClick={closeEdit} className={styles.btn}>{t('common:cancel')}</button>
              <button
                onClick={saveEdit}
                disabled={!canSaveEdit || saving}
                className={`${styles.btn} ${styles.btnPrimary}`}
              >
                {saving ? t('common:saving') : t('common:saveChanges')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
