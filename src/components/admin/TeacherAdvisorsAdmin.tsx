// src/components/admin/TeacherAdvisorsAdmin.tsx
import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  updateDoc,
  where,
  deleteField,
} from 'firebase/firestore';
import { db } from '../../firebase/app';
import styles from './TeacherAdvisorsAdmin.module.css';
import { useTranslation } from 'react-i18next';

type AppUser = {
  id: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  displayName?: string;
  email?: string;
  role?: 'admin' | 'teacher' | 'student' | 'kiosk';
  classId?: string;
  className?: string;
  advisorId?: string;
  advisorName?: string;
  createdAt?: any;
};

type ToastKind = 'success' | 'error' | 'info';
type Toast =
  | { show: false }
  | { show: true; kind: ToastKind; message: string };

const byName = (a?: AppUser, b?: AppUser) =>
  fullName(a).toLowerCase().localeCompare(fullName(b).toLowerCase());

function fullName(u?: AppUser) {
  if (!u) return '';
  if (u.firstName || u.lastName) {
    return `${u.firstName || ''} ${u.lastName || ''}`.trim();
  }
  return u.displayName || u.username || u.email || u.id || '';
}

export default function TeacherAdvisorsAdmin() {
  // Primary: advisories; Secondary (fallback): dashboard
  const { t } = useTranslation(['advisories', 'dashboard']);

  const [teachers, setTeachers] = useState<AppUser[]>([]);
  const [students, setStudents] = useState<AppUser[]>([]);
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>('');
  const [searchTeacher, setSearchTeacher] = useState('');
  const [searchStudent, setSearchStudent] = useState('');
  const [onlyUnassigned, setOnlyUnassigned] = useState(true);
  const [toast, setToast] = useState<Toast>({ show: false });
  const [busy, setBusy] = useState(false);

  const toastMsg = (kind: ToastKind, message: string) => {
    setToast({ show: true, kind, message });
    setTimeout(() => setToast({ show: false }), 3000);
  };

  // Teachers (no orderBy to avoid composite index requirement)
  useEffect(() => {
    const qTeach = query(collection(db, 'appUsers'), where('role', '==', 'teacher'));
    const unsub = onSnapshot(qTeach, snap => {
      const rows: AppUser[] = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })).sort(byName);
      setTeachers(rows);
      if (!selectedTeacherId && rows.length) setSelectedTeacherId(rows[0].id);
      else if (selectedTeacherId && !rows.some(t => t.id === selectedTeacherId)) {
        setSelectedTeacherId(rows[0]?.id || '');
      }
    });
    return () => unsub();
  }, [selectedTeacherId]);

  // Students (no orderBy for same reason)
  useEffect(() => {
    const qStud = query(collection(db, 'appUsers'), where('role', '==', 'student'));
    const unsub = onSnapshot(qStud, snap => {
      const rows: AppUser[] = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })).sort(byName);
      setStudents(rows);
    });
    return () => unsub();
  }, []);

  const selectedTeacher = useMemo(
    () => teachers.find(t => t.id === selectedTeacherId),
    [teachers, selectedTeacherId]
  );

  const filteredTeachers = useMemo(() => {
    const s = searchTeacher.trim().toLowerCase();
    if (!s) return teachers;
    return teachers.filter(t => fullName(t).toLowerCase().includes(s));
  }, [teachers, searchTeacher]);

  const { assigned, pool } = useMemo(() => {
    const assignedList = students.filter(s => s.advisorId === selectedTeacherId).sort(byName);
    let poolList = students.filter(s => s.id !== selectedTeacherId);
    if (onlyUnassigned) poolList = poolList.filter(s => !s.advisorId);
    const s = searchStudent.trim().toLowerCase();
    if (s) {
      poolList = poolList.filter(u =>
        [fullName(u), u.username, u.email, u.className]
          .filter(Boolean)
          .some(field => field!.toLowerCase().includes(s))
      );
    }
    poolList.sort(byName);
    return { assigned: assignedList, pool: poolList };
  }, [students, selectedTeacherId, onlyUnassigned, searchStudent]);

  async function assignStudent(student: AppUser) {
    if (!selectedTeacher) return;
    try {
      setBusy(true);
      const ref = doc(db, 'appUsers', student.id);
      await updateDoc(ref, {
        advisorId: selectedTeacher.id,
        advisorName: fullName(selectedTeacher),
      });
      toastMsg('success', t('toast.assigned', { student: fullName(student), teacher: fullName(selectedTeacher) }));
    } catch (e: any) {
      toastMsg('error', e?.message || t('toast.assignFail'));
    } finally {
      setBusy(false);
    }
  }

  async function unassignStudent(student: AppUser) {
    try {
      setBusy(true);
      const ref = doc(db, 'appUsers', student.id);
      await updateDoc(ref, { advisorId: deleteField(), advisorName: deleteField() });
      toastMsg('success', t('toast.unassigned', { student: fullName(student) }));
    } catch (e: any) {
      toastMsg('error', e?.message || t('toast.unassignFail'));
    } finally {
      setBusy(false);
    }
  }

  async function bulkAssign() {
    if (!selectedTeacher) return;
    if (!window.confirm(t('confirm.bulkAssign', { count: pool.length, teacher: fullName(selectedTeacher) }))) return;
    try {
      setBusy(true);
      const chunk = 15;
      for (let i = 0; i < pool.length; i += chunk) {
        const slice = pool.slice(i, i + chunk);
        await Promise.all(
          slice.map(s =>
            updateDoc(doc(db, 'appUsers', s.id), {
              advisorId: selectedTeacher.id,
              advisorName: fullName(selectedTeacher),
            })
          )
        );
      }
      toastMsg('success', t('toast.bulkAssigned', { count: pool.length }));
    } catch (e: any) {
      toastMsg('error', e?.message || t('toast.bulkAssignFail'));
    } finally {
      setBusy(false);
    }
  }

  async function bulkUnassign() {
    if (!window.confirm(t('confirm.bulkUnassign', { count: assigned.length }))) return;
    try {
      setBusy(true);
      const chunk = 15;
      for (let i = 0; i < assigned.length; i += chunk) {
        const slice = assigned.slice(i, i + chunk);
        await Promise.all(
          slice.map(s =>
            updateDoc(doc(db, 'appUsers', s.id), { advisorId: deleteField(), advisorName: deleteField() })
          )
        );
      }
      toastMsg('success', t('toast.bulkUnassigned', { count: assigned.length }));
    } catch (e: any) {
      toastMsg('error', e?.message || t('toast.bulkUnassignFail'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <h2>{t('title')}</h2>
          <p className={styles.sub}>{t('subtitle')}</p>
        </div>
        <div className={styles.headerRight}>
          <label className={styles.checkbox}>
            <input type="checkbox" checked={onlyUnassigned} onChange={e => setOnlyUnassigned(e.target.checked)} />
            {t('onlyUnassigned')}
          </label>
        </div>
      </header>

      <div className={styles.grid}>
        {/* Teachers */}
        <section className={styles.col}>
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <strong>{t('teachers')}</strong>
              <input
                className={styles.input}
                placeholder={t('searchTeachers')}
                value={searchTeacher}
                onChange={e => setSearchTeacher(e.target.value)}
              />
            </div>
            <div className={styles.list}>
              {filteredTeachers.map(tch => {
                const sel = tch.id === selectedTeacherId;
                return (
                  <button
                    key={tch.id}
                    className={sel ? styles.teacherItemSelected : styles.teacherItem}
                    onClick={() => setSelectedTeacherId(tch.id)}
                  >
                    <div className={styles.titleRow}>
                      <span className={styles.primary}>{fullName(tch)}</span>
                    </div>
                    <div className={styles.meta}>
                      <span>@{tch.username || t('teacherDefault')}</span>
                      {tch.email ? <span> • {tch.email}</span> : null}
                    </div>
                  </button>
                );
              })}
              {!filteredTeachers.length && <div className={styles.empty}>{t('noTeachers')}</div>}
            </div>
          </div>
        </section>

        {/* Pool & Assigned */}
        <section className={styles.colWide}>
          <div className={styles.split}>
            {/* Pool */}
            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <strong>{t('studentsPool')}</strong>
                <div className={styles.row}>
                  <input
                    className={styles.input}
                    placeholder={t('searchStudents')}
                    value={searchStudent}
                    onChange={e => setSearchStudent(e.target.value)}
                  />
                  <button
                    className={styles.btn}
                    disabled={busy || !selectedTeacher || !pool.length}
                    onClick={bulkAssign}
                  >
                    {t('assignAllTo', { teacher: fullName(selectedTeacher) })}
                  </button>
                </div>
              </div>
              <div className={styles.list}>
                {pool.map(s => (
                  <div key={s.id} className={styles.studentRow}>
                    <div className={styles.studentInfo}>
                      <div className={styles.primary}>{fullName(s)}</div>
                      <div className={styles.meta}>
                        <span>@{s.username || t('studentDefault')}</span>
                        {s.className ? <span> • {s.className}</span> : null}
                        {s.advisorName ? <span> • {t('advisor')}: {s.advisorName}</span> : null}
                      </div>
                    </div>
                    <div className={styles.actions}>
                      <button
                        className={styles.btnPrimary}
                        disabled={busy || !selectedTeacher}
                        onClick={() => assignStudent(s)}
                      >
                        {t('assign')}
                      </button>
                    </div>
                  </div>
                ))}
                {!pool.length && <div className={styles.empty}>{t('noStudentsInPool')}</div>}
              </div>
            </div>

            {/* Assigned */}
            <div className={styles.card}>
              <div className={styles.cardHeader}>
                <strong>{t('assignedTo', { teacher: fullName(selectedTeacher) || '—' })}</strong>
                <button className={styles.btn} disabled={busy || !assigned.length} onClick={bulkUnassign}>
                  {t('unassignAll')}
                </button>
              </div>
              <div className={styles.list}>
                {assigned.map(s => (
                  <div key={s.id} className={styles.studentRow}>
                    <div className={styles.studentInfo}>
                      <div className={styles.primary}>{fullName(s)}</div>
                      <div className={styles.meta}>
                        <span>@{s.username || t('studentDefault')}</span>
                        {s.className ? <span> • {s.className}</span> : null}
                      </div>
                    </div>
                    <div className={styles.actions}>
                      <button className={styles.btn} disabled={busy} onClick={() => unassignStudent(s)}>
                        {t('unassign')}
                      </button>
                    </div>
                  </div>
                ))}
                {!assigned.length && <div className={styles.empty}>{t('noStudentsAssigned')}</div>}
              </div>
            </div>
          </div>
        </section>
      </div>

      {toast.show && (
        <div
          className={
            toast.kind === 'success'
              ? styles.toastSuccess
              : toast.kind === 'error'
              ? styles.toastError
              : styles.toastInfo
          }
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
