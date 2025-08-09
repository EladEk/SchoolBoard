import React, { useEffect, useMemo, useState } from 'react';
import {
  addDoc, arrayRemove, arrayUnion, collection, doc, getDoc, getDocs, onSnapshot, query,
  serverTimestamp, updateDoc, where
} from 'firebase/firestore';
import { db } from '../../firebase/app';
import styles from './TeacherLessons.module.css';
import { useTranslation } from 'react-i18next';

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
  id: string;
  name: string;
  isStudentTeacher?: boolean;
  teacherUserId?: string | null;
  teacherUsername?: string | null;
  teacherFirstName?: string | null;
  teacherLastName?: string | null;
  studentsUserIds?: string[];
  createdAt?: any;
};

function labelFromUser(u?: AppUser | null) {
  if (!u) return '';
  const full = [u.firstName || '', u.lastName || ''].join(' ').replace(/\s+/g, ' ').trim();
  if (full && u.username) return `${full} (${u.username})`;
  if (full) return full;
  return u.username || '';
}

export default function TeacherLessons() {
  const { t } = useTranslation(); // use prefixes like teacher:* / common:*

  const session = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('session') || '{}') || {}; }
    catch { return {}; }
  }, []);

  const [me, setMe] = useState<AppUser | null>(null);
  const [students, setStudents] = useState<AppUser[]>([]);
  const [lessons, setLessons] = useState<LessonItem[]>([]);

  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>('');
  const [savingEdit, setSavingEdit] = useState(false);

  const [pickerLessonId, setPickerLessonId] = useState<string>('');
  const [pickerStudentUsername, setPickerStudentUsername] = useState<string>('');
  const [changingRoster, setChangingRoster] = useState(false);

  // Load current teacher doc (UID first, then usernameLower) + students
  useEffect(() => {
    let unsubUsers: (() => void) | null = null;

    (async () => {
      // Preferred path: /appUsers/{uid}
      const uid = session?.uid || session?.UID || '';
      if (uid) {
        const snap = await getDoc(doc(db, 'appUsers', uid));
        if (snap.exists()) setMe({ id: snap.id, ...(snap.data() as any) });
      }

      // Fallback by usernameLower if needed
      if (!uid && !me) {
        const usernameLower = (session?.username || session?.userName || '').toLowerCase();
        if (usernameLower) {
          const s = await getDocs(query(collection(db, 'appUsers'), where('usernameLower', '==', usernameLower)));
          const meDoc = s.docs[0];
          if (meDoc) setMe({ id: meDoc.id, ...(meDoc.data() as any) });
        }
      }

      // Subscribe to all students (for roster UI)
      unsubUsers = onSnapshot(
        query(collection(db, 'appUsers'), where('role', '==', 'student')),
        (s) => {
          const arr = s.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as AppUser[];
          arr.sort((a, b) => (labelFromUser(a) || '').localeCompare(labelFromUser(b) || ''));
          setStudents(arr);
        },
        (err) => console.error('[TeacherLessons] students subscribe failed', err)
      );
    })();

    return () => { if (unsubUsers) unsubUsers(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Subscribe to *my* lessons (no orderBy in Firestore; we sort locally)
  useEffect(() => {
    if (!me?.id) { setLessons([]); return; }
    const unsub = onSnapshot(
      query(collection(db, 'lessons'), where('teacherUserId', '==', me.id)),
      (snap) => {
        const arr = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as LessonItem[];
        arr.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        setLessons(arr);
      },
      (err) => console.error('[TeacherLessons] lessons subscribe failed', err)
    );
    return () => unsub();
  }, [me?.id]);

  const canCreate = name.trim().length > 0 && !!me?.id;

  async function createLesson(e: React.FormEvent) {
    e.preventDefault();
    if (!canCreate || creating || !me) return;
    try {
      setCreating(true);
      await addDoc(collection(db, 'lessons'), {
        name: name.trim(),
        isStudentTeacher: false,
        teacherUsername: me.username || '',
        teacherUserId: me.id,
        teacherFirstName: me.firstName || '',
        teacherLastName: me.lastName || '',
        studentsUserIds: [],
        createdAt: serverTimestamp(),
      });
      setName('');
    } finally {
      setCreating(false);
    }
  }

  function beginEdit(row: LessonItem) {
    setEditingId(row.id);
    setEditingName(row.name || '');
  }
  function cancelEdit() {
    setEditingId(null);
    setEditingName('');
  }
  async function saveEdit() {
    if (!editingId) return;
    const newName = editingName.trim();
    if (!newName) return;
    try {
      setSavingEdit(true);
      await updateDoc(doc(db, 'lessons', editingId), { name: newName });
      cancelEdit();
    } finally {
      setSavingEdit(false);
    }
  }

  // Roster helpers
  const pickerLesson = useMemo(() => lessons.find(l => l.id === pickerLessonId), [lessons, pickerLessonId]);
  function findStudentByUsername(username: string) {
    const uLower = (username || '').toLowerCase();
    return students.find(s => (s.username || '').toLowerCase() === uLower);
  }

  async function addStudentToLesson() {
    if (!pickerLesson || !pickerStudentUsername) return;
    const stu = findStudentByUsername(pickerStudentUsername);
    if (!stu) return;
    try {
      setChangingRoster(true);
      await updateDoc(doc(db, 'lessons', pickerLesson.id), {
        studentsUserIds: arrayUnion(stu.id),
      });
      setPickerStudentUsername('');
    } finally {
      setChangingRoster(false);
    }
  }

  async function removeStudentFromLesson(lessonId: string, studentUserId: string) {
    try {
      setChangingRoster(true);
      await updateDoc(doc(db, 'lessons', lessonId), {
        studentsUserIds: arrayRemove(studentUserId),
      });
    } finally {
      setChangingRoster(false);
    }
  }

  // Label helpers for roster rendering
  const studentById = useMemo(() => {
    const map = new Map<string, AppUser>();
    for (const s of students) map.set(s.id, s);
    return map;
  }, [students]);

  function studentLabelById(id: string) {
    const s = studentById.get(id);
    return s ? labelFromUser(s) : id;
    }

  return (
    <div className={styles.wrapper}>
      {/* Header */}
      <div className={styles.headerRow}>
        <div className={styles.titleMarker}>
          <div className={styles.titleDot} />
          <h2 className={styles.titleText}>{t('teacher:myLessons')}</h2>
        </div>
        <p className={styles.subtitle}>{t('teacher:subtitle')}</p>
      </div>

      {/* Create */}
      <form onSubmit={createLesson} className={`${styles.panel} grid grid-cols-1 md:grid-cols-4 gap-3 p-4`}>
        <input
          className={styles.input}
          placeholder={t('teacher:placeholders.lessonName')!}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="md:col-span-1 flex items-stretch">
          <button type="submit" disabled={!canCreate || creating} className={`${styles.btn} ${styles.btnPrimary}`}>
            {creating ? t('teacher:creating') : t('teacher:create')}
          </button>
        </div>
      </form>

      {/* List */}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t('teacher:table.lesson')}</th>
              <th>{t('teacher:table.roster')}</th>
              <th className="w-56">{t('common:actions')}</th>
            </tr>
          </thead>
          <tbody>
            {lessons.map((l) => {
              const roster = l.studentsUserIds || [];
              return (
                <tr key={l.id}>
                  <td>
                    {editingId === l.id ? (
                      <input
                        className={styles.input}
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                      />
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{l.name}</span>
                        <span className={styles.muted}>
                          · {me?.firstName} {me?.lastName} {me?.username ? `(@${me.username})` : ''}
                        </span>
                      </div>
                    )}
                  </td>
                  <td>
                    {roster.length ? (
                      <ul className={styles.rosterList}>
                        {roster.map((sid) => (
                          <li key={sid} className={styles.rosterItem}>
                            <span>{studentLabelById(sid)}</span>
                            <button
                              type="button"
                              className={`${styles.btn} ${styles.btnDanger} ${styles.btnSm}`}
                              onClick={() => removeStudentFromLesson(l.id, sid)}
                              disabled={changingRoster}
                            >
                              {t('common:remove')}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className={styles.muted}>{t('common:noItems')}</span>
                    )}
                  </td>
                  <td>
                    <div className="flex gap-2">
                      {editingId === l.id ? (
                        <>
                          <button
                            className={`${styles.btn} ${styles.btnGhost}`}
                            onClick={cancelEdit}
                            type="button"
                          >
                            {t('common:cancel')}
                          </button>
                          <button
                            className={`${styles.btn} ${styles.btnPrimary}`}
                            onClick={saveEdit}
                            disabled={savingEdit || !editingName.trim()}
                            type="button"
                          >
                            {savingEdit ? t('common:saving') : t('common:saveChanges')}
                          </button>
                        </>
                      ) : (
                        <button
                          className={`${styles.btn} ${styles.btnGhost}`}
                          onClick={() => beginEdit(l)}
                          type="button"
                        >
                          {t('common:edit')}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!lessons.length && (
              <tr>
                <td colSpan={3} style={{ color: 'var(--sb-muted)', padding: '1rem' }}>{t('teacher:empty')}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Roster add panel */}
      {lessons.length > 0 && (
        <div className={`${styles.panel} p-4 grid grid-cols-1 md:grid-cols-3 gap-3`}>
          <div className={styles.field}>
            <label className={styles.label}>{t('teacher:labels.pickLesson')}</label>
            <select
              className={styles.select}
              value={pickerLessonId}
              onChange={(e) => setPickerLessonId(e.target.value)}
            >
              <option value="">{t('common:selectOption')}</option>
              {lessons.map((l) => (<option key={l.id} value={l.id}>{l.name}</option>))}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>{t('teacher:labels.selectStudent')}</label>
            <select
              className={styles.select}
              value={pickerStudentUsername}
              onChange={(e) => setPickerStudentUsername(e.target.value)}
              disabled={!pickerLessonId}
            >
              <option value="">{t('teacher:labels.selectStudent')}</option>
              {students.map((s) => (
                <option key={s.id} value={s.username || ''}>{labelFromUser(s)}</option>
              ))}
            </select>
          </div>

          <div className="flex items-end">
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={addStudentToLesson}
              disabled={!pickerLessonId || !pickerStudentUsername || changingRoster}
            >
              {t('common:add')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
