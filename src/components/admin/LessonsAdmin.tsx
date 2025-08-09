import React, { useEffect, useMemo, useState } from 'react';
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

type ToastState =
  | { show: false }
  | { show: true; kind: 'success' | 'error'; message: string };

type Role = 'admin' | 'teacher' | 'student' | 'kiosk';

type AppUser = {
  id: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  role: Role;
};

type LessonItem = {
  id: string; // Firestore doc id
  name: string;

  // main teacher (required when isStudentTeacher === false)
  teacherUserId?: string;
  teacherFirstName?: string;
  teacherLastName?: string;
  teacherUsername?: string;

  // When a student is the teacher for this lesson
  isStudentTeacher?: boolean;
  studentUserId?: string;
  studentFirstName?: string;
  studentLastName?: string;
  studentUsername?: string;

  createdAt?: any;
};

type EditState =
  | { open: false }
  | {
      open: true;
      id: string;
      name: string;
      isStudentTeacher: boolean;
      teacherUserId: string | null;
      studentUserId: string | null;
    };

// ---------------- Helpers ----------------
function userLabel(u?: AppUser | null) {
  if (!u) return '';
  const full = [u.firstName || '', u.lastName || ''].join(' ').replace(/\s+/g, ' ').trim();
  if (full && u.username) return `${full} (${u.username})`;
  if (full) return full;
  return u.username || '';
}

function compactName(first?: string, last?: string, username?: string) {
  const full = [first || '', last || ''].join(' ').replace(/\s+/g, ' ').trim();
  if (full && username) return `${full} (${username})`;
  if (full) return full;
  return username || '';
}

// ---------------- Component ----------------
export default function LessonsAdmin() {
  const [toast, setToast] = useState<ToastState>({ show: false });

  // Live datasets
  const [teachers, setTeachers] = useState<AppUser[]>([]);
  const [students, setStudents] = useState<AppUser[]>([]);
  const [lessons, setLessons] = useState<LessonItem[]>([]);

  // Create form
  const [form, setForm] = useState({
    name: '',
    isStudentTeacher: false,
    teacherUserId: '' as string,
    studentUserId: '' as string,
  });
  const [submitting, setSubmitting] = useState(false);

  // Edit modal
  const [edit, setEdit] = useState<EditState>({ open: false });
  const [saving, setSaving] = useState(false);

  // ---------- Load teachers / students / lessons ----------
  useEffect(() => {
    const unsubTeachers = onSnapshot(
      query(collection(db, 'appUsers'), where('role', '==', 'teacher')),
      (snap) => {
        const arr = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as AppUser[];
        arr.sort((a, b) => (userLabel(a) || '').localeCompare(userLabel(b) || ''));
        setTeachers(arr);
      },
      (err) => showToast('error', `Failed to load teachers: ${err.message}`)
    );

    const unsubStudents = onSnapshot(
      query(collection(db, 'appUsers'), where('role', '==', 'student')),
      (snap) => {
        const arr = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as AppUser[];
        arr.sort((a, b) => (userLabel(a) || '').localeCompare(userLabel(b) || ''));
        setStudents(arr);
      },
      (err) => showToast('error', `Failed to load students: ${err.message}`)
    );

    const unsubLessons = onSnapshot(
      query(collection(db, 'lessons'), orderBy('name')),
      (snap) => {
        const arr = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as LessonItem[];
        setLessons(arr);
      },
      (err) => showToast('error', `Failed to load lessons: ${err.message}`)
    );

    return () => {
      unsubTeachers();
      unsubStudents();
      unsubLessons();
    };
  }, []);

  const canCreate = useMemo(() => {
    if (!form.name.trim()) return false;
    if (form.isStudentTeacher) {
      return !!form.studentUserId;
    }
    return !!form.teacherUserId;
  }, [form]);

  function showToast(kind: 'success' | 'error', message: string) {
    setToast({ show: true, kind, message });
    setTimeout(() => setToast({ show: false }), 2500);
  }

  // ---------- Create ----------
  async function createLesson(e: React.FormEvent) {
    e.preventDefault();
    if (!canCreate || submitting) return;

    const name = form.name.trim();
    const isStudentTeacher = !!form.isStudentTeacher;

    // Build payload
    let payload: any = {
      name,
      isStudentTeacher,
      createdAt: serverTimestamp(),
    };

    try {
      setSubmitting(true);

      if (isStudentTeacher) {
        const stu = students.find((s) => s.id === form.studentUserId);
        if (!stu) {
          showToast('error', 'Please select a student');
          return;
        }
        payload = {
          ...payload,
          studentUserId: stu.id,
          studentFirstName: stu.firstName || '',
          studentLastName: stu.lastName || '',
          studentUsername: stu.username || '',
          // teacher fields intentionally omitted
          teacherUserId: null,
          teacherFirstName: null,
          teacherLastName: null,
          teacherUsername: null,
        };
      } else {
        const tch = teachers.find((t) => t.id === form.teacherUserId);
        if (!tch) {
          showToast('error', 'Please select a teacher');
          return;
        }
        payload = {
          ...payload,
          teacherUserId: tch.id,
          teacherFirstName: tch.firstName || '',
          teacherLastName: tch.lastName || '',
          teacherUsername: tch.username || '',
          // student fields intentionally omitted
          studentUserId: null,
          studentFirstName: null,
          studentLastName: null,
          studentUsername: null,
        };
      }

      await addDoc(collection(db, 'lessons'), payload);

      setForm({
        name: '',
        isStudentTeacher: false,
        teacherUserId: '',
        studentUserId: '',
      });
      showToast('success', `Lesson "${name}" created`);
    } catch (err: any) {
      showToast('error', `Create failed: ${err?.message || 'unknown error'}`);
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
      teacherUserId: row.teacherUserId || null,
      studentUserId: row.studentUserId || null,
    });
  }

  function closeEdit() {
    setEdit({ open: false });
  }

  const canSaveEdit = useMemo(() => {
    if (!('open' in edit) || !edit.open) return false;
    if (!edit.name.trim()) return false;
    if (edit.isStudentTeacher) {
      return !!edit.studentUserId;
    }
    return !!edit.teacherUserId;
  }, [edit]);

  async function saveEdit() {
    if (!('open' in edit) || !edit.open) return;
    if (!canSaveEdit || saving) return;

    const id = edit.id;
    const name = edit.name.trim();
    const isStudentTeacher = !!edit.isStudentTeacher;

    let update: any = {
      name,
      isStudentTeacher,
    };

    try {
      setSaving(true);

      if (isStudentTeacher) {
        const stu = students.find((s) => s.id === edit.studentUserId);
        if (!stu) {
          showToast('error', 'Please select a student');
          return;
        }
        update = {
          ...update,
          studentUserId: stu.id,
          studentFirstName: stu.firstName || '',
          studentLastName: stu.lastName || '',
          studentUsername: stu.username || '',
          teacherUserId: null,
          teacherFirstName: null,
          teacherLastName: null,
          teacherUsername: null,
        };
      } else {
        const tch = teachers.find((t) => t.id === edit.teacherUserId);
        if (!tch) {
          showToast('error', 'Please select a teacher');
          return;
        }
        update = {
          ...update,
          teacherUserId: tch.id,
          teacherFirstName: tch.firstName || '',
          teacherLastName: tch.lastName || '',
          teacherUsername: tch.username || '',
          studentUserId: null,
          studentFirstName: null,
          studentLastName: null,
          studentUsername: null,
        };
      }

      await updateDoc(doc(db, 'lessons', id), update);
      showToast('success', `Lesson "${name}" updated`);
      closeEdit();
    } catch (err: any) {
      showToast('error', `Update failed: ${err?.message || 'unknown error'}`);
    } finally {
      setSaving(false);
    }
  }

  // ---------- Delete ----------
  async function removeLesson(id: string) {
    try {
      await deleteDoc(doc(db, 'lessons', id));
      showToast('success', 'Lesson deleted');
    } catch (err: any) {
      showToast('error', `Delete failed: ${err?.message || 'unknown error'}`);
    }
  }

  // ---------- UI ----------
  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast.show && (
        <div
          className={[
            'fixed z-50 left-1/2 -translate-x-1/2 top-6 px-4 py-2 rounded-xl shadow-lg',
            toast.kind === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white',
          ].join(' ')}
          role="status"
          aria-live="polite"
        >
          {toast.message}
        </div>
      )}

      {/* Create */}
      <form
        onSubmit={createLesson}
        className="grid grid-cols-1 md:grid-cols-5 gap-3 bg-neutral-900/60 p-4 rounded-xl border border-neutral-800"
      >
        <input
          type="text"
          placeholder="Lesson name"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          className="px-3 py-2 rounded-xl bg-neutral-800 border border-neutral-700 text-white md:col-span-2"
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
                // clear selection when switching modes
                teacherUserId: e.target.checked ? '' : f.teacherUserId,
                studentUserId: e.target.checked ? f.studentUserId : '',
              }))
            }
          />
          Student is the teacher
        </label>

        {/* Teacher select (enabled when NOT student-teacher) */}
        <select
          disabled={form.isStudentTeacher}
          value={form.teacherUserId}
          onChange={(e) => setForm((f) => ({ ...f, teacherUserId: e.target.value }))}
          className={[
            'px-3 py-2 rounded-xl bg-neutral-800 border border-neutral-700 text-white',
            form.isStudentTeacher ? 'opacity-50 cursor-not-allowed' : '',
            'md:col-span-1',
          ].join(' ')}
        >
          <option value="">Select teacher…</option>
          {teachers.map((t) => (
            <option key={t.id} value={t.id}>
              {userLabel(t)}
            </option>
          ))}
        </select>

        {/* Student select (enabled when student-teacher) */}
        <select
          disabled={!form.isStudentTeacher}
          value={form.studentUserId}
          onChange={(e) => setForm((f) => ({ ...f, studentUserId: e.target.value }))}
          className={[
            'px-3 py-2 rounded-xl bg-neutral-800 border border-neutral-700 text-white',
            !form.isStudentTeacher ? 'opacity-50 cursor-not-allowed' : '',
            'md:col-span-1',
          ].join(' ')}
        >
          <option value="">Select student…</option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {userLabel(s)}
            </option>
          ))}
        </select>

        <div className="md:col-span-5 flex items-stretch">
          <button
            type="submit"
            disabled={!canCreate || submitting}
            className={[
              'px-3 py-2 rounded-xl text-white transition',
              canCreate && !submitting ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-neutral-700 cursor-not-allowed',
            ].join(' ')}
          >
            {submitting ? 'Adding…' : 'Add lesson'}
          </button>
        </div>
      </form>

      {/* List */}
      <div className="bg-neutral-900/60 rounded-xl border border-neutral-800 overflow-hidden">
        <table className="w-full text-left text-white">
          <thead className="bg-neutral-800/80">
            <tr>
              <th className="px-3 py-2 font-medium">Lesson name</th>
              <th className="px-3 py-2 font-medium">Teacher</th>
              <th className="px-3 py-2 font-medium w-44">Actions</th>
            </tr>
          </thead>
          <tbody>
            {lessons.map((l) => {
              const teacherStr = l.isStudentTeacher
                ? compactName(l.studentFirstName, l.studentLastName, l.studentUsername) + ' (student)'
                : compactName(l.teacherFirstName, l.teacherLastName, l.teacherUsername);
              return (
                <tr key={l.id} className="odd:bg-neutral-900 even:bg-neutral-900/40">
                  <td className="px-3 py-2">{l.name}</td>
                  <td className="px-3 py-2">
                    {teacherStr || <span className="text-neutral-400">—</span>}
                  </td>
                  <td className="px-3 py-2 space-x-2">
                    <button
                      onClick={() => openEdit(l)}
                      className="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => removeLesson(l.id)}
                      className="px-2 py-1 rounded bg-red-600 hover:bg-red-500"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
            {!lessons.length && (
              <tr>
                <td className="px-3 py-6 text-neutral-400" colSpan={3}>
                  No lessons
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Edit modal */}
      {edit.open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeEdit();
          }}
        >
          <div className="w-full max-w-xl bg-neutral-900 border border-neutral-800 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-white">Edit lesson</h3>
              <button
                className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700"
                onClick={closeEdit}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="md:col-span-2">
                <label className="block text-sm text-neutral-300 mb-1">Lesson name</label>
                <input
                  type="text"
                  value={edit.name}
                  onChange={(e) =>
                    setEdit((prev) => (prev.open ? { ...prev, name: e.target.value } : prev))
                  }
                  className="w-full px-3 py-2 rounded-xl bg-neutral-800 border border-neutral-700 text-white"
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
                            teacherUserId: e.target.checked ? null : prev.teacherUserId,
                            studentUserId: e.target.checked ? prev.studentUserId : null,
                          }
                        : prev
                    )
                  }
                />
                Student is the teacher
              </label>

              {/* Teacher select */}
              <div className="md:col-span-1">
                <label className="block text-sm text-neutral-300 mb-1">Teacher</label>
                <select
                  disabled={edit.isStudentTeacher}
                  value={edit.teacherUserId || ''}
                  onChange={(e) =>
                    setEdit((prev) => (prev.open ? { ...prev, teacherUserId: e.target.value } : prev))
                  }
                  className={[
                    'w-full px-3 py-2 rounded-xl bg-neutral-800 border border-neutral-700 text-white',
                    edit.isStudentTeacher ? 'opacity-50 cursor-not-allowed' : '',
                  ].join(' ')}
                >
                  <option value="">Select teacher…</option>
                  {teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {userLabel(t)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Student select */}
              <div className="md:col-span-1">
                <label className="block text-sm text-neutral-300 mb-1">Student</label>
                <select
                  disabled={!edit.isStudentTeacher}
                  value={edit.studentUserId || ''}
                  onChange={(e) =>
                    setEdit((prev) => (prev.open ? { ...prev, studentUserId: e.target.value } : prev))
                  }
                  className={[
                    'w-full px-3 py-2 rounded-xl bg-neutral-800 border border-neutral-700 text-white',
                    !edit.isStudentTeacher ? 'opacity-50 cursor-not-allowed' : '',
                  ].join(' ')}
                >
                  <option value="">Select student…</option>
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {userLabel(s)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={closeEdit}
                className="px-3 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white"
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                disabled={!canSaveEdit || saving}
                className={[
                  'px-3 py-2 rounded-xl text-white transition',
                  !canSaveEdit || saving ? 'bg-neutral-700 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-500',
                ].join(' ')}
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
