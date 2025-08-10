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
  classGrade?: string;     // optional (e.g., "א".."יב")
  birthday?: string;
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

type SortKey = 'firstName' | 'lastName' | 'username' | 'classGrade';
type SortDir = 'asc' | 'desc';
const DEFAULT_SORT: { key: SortKey; dir: SortDir } = { key: 'firstName', dir: 'asc' };

export default function TeacherLessons() {
  const { t } = useTranslation();

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

  // NEW: roster picker state
  const [pickerLessonId, setPickerLessonId] = useState<string>('');
  const [changingRoster, setChangingRoster] = useState(false);

  // NEW: filter & sort for student tables
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>(DEFAULT_SORT);

  // Load current teacher + subscribe to all students
  useEffect(() => {
    let unsubUsers: (() => void) | null = null;

    (async () => {
      const uid = session?.uid || session?.UID || '';
      if (uid) {
        const snap = await getDoc(doc(db, 'appUsers', uid));
        if (snap.exists()) setMe({ id: snap.id, ...(snap.data() as any) });
      }

      if (!uid && !me) {
        const usernameLower = (session?.username || session?.userName || '').toLowerCase();
        if (usernameLower) {
          const s = await getDocs(query(collection(db, 'appUsers'), where('usernameLower', '==', usernameLower)));
          const meDoc = s.docs[0];
          if (meDoc) setMe({ id: meDoc.id, ...(meDoc.data() as any) });
        }
      }

      // Subscribe to students
      unsubUsers = onSnapshot(
        query(collection(db, 'appUsers'), where('role', '==', 'student')),
        (s) => {
          const arr = s.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as AppUser[];
          setStudents(arr);
        },
        (err) => console.error('[TeacherLessons] students subscribe failed', err)
      );
    })();

    return () => { if (unsubUsers) unsubUsers(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Subscribe to my lessons
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
    } finally { setCreating(false); }
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
    } finally { setSavingEdit(false); }
  }

  // Helpers
  const studentById = useMemo(() => {
    const map = new Map<string, AppUser>();
    for (const s of students) map.set(s.id, s);
    return map;
  }, [students]);

  const pickerLesson = useMemo(
    () => lessons.find(l => l.id === pickerLessonId),
    [lessons, pickerLessonId]
  );

  const rosterIds = pickerLesson?.studentsUserIds || [];

  function toggleSort(nextKey: SortKey) {
    setSort(prev => prev.key === nextKey ? { key: nextKey, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key: nextKey, dir: 'asc' });
  }

  function cmp(a?: string, b?: string) {
    const A = (a || '').toLowerCase(); const B = (b || '').toLowerCase();
    if (A < B) return -1; if (A > B) return 1; return 0;
  }

  const searchLower = search.trim().toLowerCase();

  // Left table: all students not in lesson
  const availableStudents = useMemo(() => {
    let arr = students.filter(s => !rosterIds.includes(s.id));
    if (searchLower) {
      arr = arr.filter(s => {
        const cells = [
          s.firstName, s.lastName, s.username,
          s.classGrade ? `כיתה ${s.classGrade}` : ''
        ].map(x => (x || '').toLowerCase());
        return cells.some(c => c.includes(searchLower));
      });
    }
    arr.sort((a, b) => {
      switch (sort.key) {
        case 'firstName': return sort.dir === 'asc' ? cmp(a.firstName, b.firstName) : -cmp(a.firstName, b.firstName);
        case 'lastName':  return sort.dir === 'asc' ? cmp(a.lastName, b.lastName)  : -cmp(a.lastName,  b.lastName);
        case 'username':  return sort.dir === 'asc' ? cmp(a.username, b.username)  : -cmp(a.username,  b.username);
        case 'classGrade':return sort.dir === 'asc' ? cmp(a.classGrade, b.classGrade): -cmp(a.classGrade, b.classGrade);
      }
    });
    return arr;
  }, [students, rosterIds, searchLower, sort]);

  // Right table: roster (students already added)
  const rosterStudents = useMemo(() => {
    let arr = rosterIds.map(id => studentById.get(id)).filter(Boolean) as AppUser[];
    if (searchLower) {
      arr = arr.filter(s => {
        const cells = [
          s.firstName, s.lastName, s.username,
          s.classGrade ? `כיתה ${s.classGrade}` : ''
        ].map(x => (x || '').toLowerCase());
        return cells.some(c => c.includes(searchLower));
      });
    }
    arr.sort((a, b) => {
      switch (sort.key) {
        case 'firstName': return sort.dir === 'asc' ? cmp(a.firstName, b.firstName) : -cmp(a.firstName, b.firstName);
        case 'lastName':  return sort.dir === 'asc' ? cmp(a.lastName, b.lastName)  : -cmp(a.lastName,  b.lastName);
        case 'username':  return sort.dir === 'asc' ? cmp(a.username, b.username)  : -cmp(a.username,  b.username);
        case 'classGrade':return sort.dir === 'asc' ? cmp(a.classGrade, b.classGrade): -cmp(a.classGrade, b.classGrade);
      }
    });
    return arr;
  }, [rosterIds, studentById, searchLower, sort]);

  async function addStudent(studentId: string) {
    if (!pickerLesson) return;
    try {
      setChangingRoster(true);
      await updateDoc(doc(db, 'lessons', pickerLesson.id), {
        studentsUserIds: arrayUnion(studentId),
      });
    } finally { setChangingRoster(false); }
  }

  async function removeStudent(studentId: string) {
    if (!pickerLesson) return;
    try {
      setChangingRoster(true);
      await updateDoc(doc(db, 'lessons', pickerLesson.id), {
        studentsUserIds: arrayRemove(studentId),
      });
    } finally { setChangingRoster(false); }
  }

  const SortTh: React.FC<{ col: SortKey; label: string }> = ({ col, label }) => {
    const active = sort.key === col;
    return (
      <th className={styles.sortTh} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button type="button" className={styles.sortBtn} onClick={() => toggleSort(col)}>
          <span>{label}</span>
          <span className={styles.sortIcon} aria-hidden>{active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
        </button>
      </th>
    );
  };

  return (
    <div className={styles.wrapper}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <div className={styles.titleDot} />
          <h2 className={styles.titleText}>{t('teacher:myLessons','My Lessons')}</h2>
        </div>
        <p className={styles.subtitle}>{t('teacher:subtitle','Create lessons and manage rosters')}</p>
      </div>

      {/* Create lesson */}
      <form onSubmit={createLesson} className={`${styles.panel} grid grid-cols-1 md:grid-cols-4 gap-3 p-4`}>
        <input
          className={styles.input}
          placeholder={t('teacher:placeholders.lessonName','Lesson name')!}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="md:col-span-1 flex items-stretch">
          <button type="submit" disabled={!canCreate || creating} className={`${styles.btn} ${styles.btnPrimary}`}>
            {creating ? t('teacher:creating','Creating...') : t('teacher:create','Create')}
          </button>
        </div>
      </form>

      {/* Lessons list (name + current roster preview) */}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t('teacher:table.lesson','Lesson')}</th>
              <th>{t('teacher:table.roster','Roster')}</th>
              <th className="w-56">{t('common:actions','Actions')}</th>
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
                      <div className={styles.rosterChips}>
                        {roster.slice(0, 4).map((sid) => (
                          <span key={sid} className={styles.chip}>{labelFromUser(studentById.get(sid))}</span>
                        ))}
                        {roster.length > 4 && <span className={styles.moreChip}>+{roster.length - 4}</span>}
                      </div>
                    ) : (
                      <span className={styles.muted}>{t('common:noItems','No items')}</span>
                    )}
                  </td>
                  <td>
                    <div className="flex gap-2">
                      {editingId === l.id ? (
                        <>
                          <button className={styles.btn} onClick={cancelEdit} type="button">
                            {t('common:cancel','Cancel')}
                          </button>
                          <button
                            className={`${styles.btn} ${styles.btnPrimary}`}
                            onClick={saveEdit}
                            disabled={savingEdit || !editingName.trim()}
                            type="button"
                          >
                            {savingEdit ? t('common:saving','Saving...') : t('common:saveChanges','Save changes')}
                          </button>
                        </>
                      ) : (
                        <>
                          <button className={styles.btn} onClick={() => beginEdit(l)} type="button">
                            {t('common:edit','Edit')}
                          </button>
                          <button
                            className={`${styles.btn} ${styles.btnPrimary}`}
                            type="button"
                            onClick={() => setPickerLessonId(l.id)}
                          >
                            {pickerLessonId === l.id ? t('teacher:managing','Managing') : t('teacher:manageRoster','Manage roster')}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!lessons.length && (
              <tr>
                <td colSpan={3} style={{ color: 'var(--sb-muted)', padding: '1rem' }}>{t('teacher:empty','No lessons yet')}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Dual-pane roster manager */}
      {!!pickerLesson && (
        <div className={`${styles.panel} p-4`}>
          <div className={styles.managerHeader}>
            <div className={styles.managerTitle}>
              <span className={styles.managerDot} />
              <span className={styles.managerText}>
                {t('teacher:managingRosterFor','Managing roster for')}: <b>{pickerLesson.name}</b>
              </span>
            </div>
            <div className={styles.managerControls}>
              <input
                className={styles.input}
                placeholder={t('common:search','Search')!}
                value={search}
                onChange={(e)=>setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className={styles.dualGrid}>
            {/* Left: all students */}
            <div className={styles.dualCol}>
              <div className={styles.colHeader}>
                <h3 className={styles.colTitle}>{t('teacher:allStudents','All students')}</h3>
                <span className={styles.countBadge}>{availableStudents.length}</span>
              </div>
              <div className={styles.tableScroller}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <SortTh col="firstName" label={t('users:table.first','First')} />
                      <SortTh col="lastName"  label={t('users:table.last','Last')} />
                      <SortTh col="username"  label={t('users:table.username','Username')} />
                      <SortTh col="classGrade" label={t('users:classGrade','Class Grade')} />
                      <th className="w-28" />
                    </tr>
                  </thead>
                  <tbody>
                    {availableStudents.map(s => (
                      <tr key={s.id}>
                        <td>{s.firstName || ''}</td>
                        <td>{s.lastName || ''}</td>
                        <td>{s.username || ''}</td>
                        <td>{s.classGrade ? `כיתה ${s.classGrade}` : ''}</td>
                        <td className={styles.actionsCell}>
                          <button
                            className={`${styles.btn} ${styles.btnPrimary} ${styles.btnSm}`}
                            onClick={() => addStudent(s.id)}
                            disabled={changingRoster}
                            title={t('common:add','Add')!}
                          >
                            {t('common:add','Add')}
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!availableStudents.length && (
                      <tr><td colSpan={5} className={styles.emptyCell}>{t('common:noItems','No items')}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Right: selected */}
            <div className={styles.dualCol}>
              <div className={styles.colHeader}>
                <h3 className={styles.colTitle}>{t('teacher:selectedForLesson','In this lesson')}</h3>
                <span className={`${styles.countBadge} ${styles.badgePrimary}`}>{rosterStudents.length}</span>
              </div>
              <div className={styles.tableScroller}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <SortTh col="firstName" label={t('users:table.first','First')} />
                      <SortTh col="lastName"  label={t('users:table.last','Last')} />
                      <SortTh col="username"  label={t('users:table.username','Username')} />
                      <SortTh col="classGrade" label={t('users:classGrade','Class Grade')} />
                      <th className="w-28" />
                    </tr>
                  </thead>
                  <tbody>
                    {rosterStudents.map(s => (
                      <tr key={s.id}>
                        <td>{s.firstName || ''}</td>
                        <td>{s.lastName || ''}</td>
                        <td>{s.username || ''}</td>
                        <td>{s.classGrade ? `כיתה ${s.classGrade}` : ''}</td>
                        <td className={styles.actionsCell}>
                          <button
                            className={`${styles.btn} ${styles.btnDanger} ${styles.btnSm}`}
                            onClick={() => removeStudent(s.id)}
                            disabled={changingRoster}
                            title={t('common:remove','Remove')!}
                          >
                            {t('common:remove','Remove')}
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!rosterStudents.length && (
                      <tr><td colSpan={5} className={styles.emptyCell}>{t('teacher:noStudentsYet','No students yet')}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className={styles.managerFooter}>
            <button className={styles.btn} onClick={() => setPickerLessonId('')} type="button">
              {t('common:done','Done')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
