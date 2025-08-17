import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  addDoc, collection, deleteDoc, doc, getDocs, onSnapshot, orderBy, query,
  serverTimestamp, updateDoc, where
} from 'firebase/firestore';
import { db } from '../../firebase/app';
import * as XLSX from 'xlsx';
import styles from './UsersAdmin.module.css';
import { useTranslation } from 'react-i18next';

type ToastState =
  | { show: false }
  | { show: true; kind: 'success' | 'error' | 'info'; message: string };

type Role = 'admin' | 'teacher' | 'student' | 'kiosk';

type AppUser = {
  id: string;
  username?: string;
  usernameLower?: string;
  firstName?: string;
  lastName?: string;
  role: Role;
  birthday?: string;
  classId?: string;
  createdAt?: any;
};

function norm(v: string) { return (v || '').trim(); }
function normLower(v: string) { return norm(v).toLowerCase(); }
function labelUser(u: Partial<AppUser>) {
  const full = `${u.firstName || ''} ${u.lastName || ''}`.replace(/\s+/g, ' ').trim();
  return full || (u.username || '');
}
function showToast(
  setToast: React.Dispatch<React.SetStateAction<ToastState>>,
  kind: 'success' | 'error' | 'info',
  message: string,
) {
  setToast({ show: true, kind, message });
  setTimeout(() => setToast({ show: false }), 2600);
}

export default function UsersAdmin() {
  const { t } = useTranslation();
  const [toast, setToast] = useState<ToastState>({ show: false });

  const [items, setItems] = useState<AppUser[]>([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<Role | 'all'>('all');

  // collapsed by default on mobile; open on desktop
  const [createOpen, setCreateOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return window.innerWidth > 768;
  });

  const [form, setForm] = useState<Partial<AppUser>>({
    username: '',
    firstName: '',
    lastName: '',
    role: 'student',
    birthday: '',
  });
  const [creating, setCreating] = useState(false);

  const [edit, setEdit] = useState<{ open: false } | { open: true; row: AppUser }>({ open: false });
  const [saving, setSaving] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [busyImport, setBusyImport] = useState(false);

  // users table scroller (so we can jump to the right edge by default)
  const tableWrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'appUsers'), orderBy('usernameLower'));
    const unsub = onSnapshot(
      q,
      snap => {
        const list = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as AppUser[];
        setItems(list);
      },
      err => showToast(setToast, 'error', t('users:toasts.loadFail', { msg: err.message }))
    );
    return () => unsub();
  }, [t]);

  // When list renders/changes, scroll the table wrapper to the rightmost side (RTL-friendly)
  useEffect(() => {
    const el = tableWrapRef.current;
    if (!el) return;
    requestAnimationFrame(() => { el.scrollLeft = el.scrollWidth; });
  }, [items.length]);

  const filtered = useMemo(() => {
    const s = normLower(search);
    return items.filter(u => {
      if (roleFilter !== 'all' && u.role !== roleFilter) return false;
      if (!s) return true;
      const hay = `${u.username} ${u.firstName} ${u.lastName} ${u.birthday || ''}`.toLowerCase();
      return hay.includes(s);
    });
  }, [items, search, roleFilter]);

  const canCreate = useMemo(
    () => !!norm(form.username || '') && !!norm(form.role || ''),
    [form]
  );

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    if (!canCreate || creating) return;

    try {
      setCreating(true);
      const username = norm(form.username || '');
      const usernameLower = username.toLowerCase();

      const dup = await getDocs(
        query(collection(db, 'appUsers'), where('usernameLower', '==', usernameLower))
      );
      if (!dup.empty) {
        showToast(setToast, 'error', t('users:toasts.dup', { username }));
        return;
      }

      await addDoc(collection(db, 'appUsers'), {
        username, usernameLower,
        firstName: norm(form.firstName || ''),
        lastName: norm(form.lastName || ''),
        role: (form.role || 'student'),
        birthday: norm(form.birthday || ''),
        classId: norm(form.classId || ''),
        createdAt: serverTimestamp(),
      });

      setForm({ username: '', firstName: '', lastName: '', role: 'student', birthday: '' });
      showToast(setToast, 'success', t('users:toasts.created', { username }));
    } catch (e: any) {
      showToast(setToast, 'error', t('users:toasts.createFail', { msg: e?.message || 'unknown' }));
    } finally {
      setCreating(false);
    }
  }

  function openEdit(row: AppUser) { setEdit({ open: true, row }); }
  function closeEdit() { setEdit({ open: false }); }

  async function saveEdit() {
    if (!edit.open || saving) return;
    const { row } = edit;
    try {
      setSaving(true);

      const username = norm(row.username || '');
      const usernameLower = username.toLowerCase();

      if (username) {
        const dup = await getDocs(
          query(collection(db, 'appUsers'), where('usernameLower', '==', usernameLower))
        );
        const existsOther = dup.docs.some(d => d.id !== row.id);
        if (existsOther) {
          showToast(setToast, 'error', t('users:toasts.dup', { username }));
          setSaving(false);
          return;
        }
      }

      await updateDoc(doc(db, 'appUsers', row.id), {
        username,
        usernameLower,
        firstName: norm(row.firstName || ''),
        lastName: norm(row.lastName || ''),
        role: (row.role || 'student'),
        birthday: norm(row.birthday || ''),
        classId: norm(row.classId || ''),
      });

      showToast(setToast, 'success', t('users:toasts.updated', { username: username || row.id }));
      closeEdit();
    } catch (e: any) {
      showToast(setToast, 'error', t('users:toasts.updateFail', { msg: e?.message || 'unknown' }));
    } finally {
      setSaving(false);
    }
  }

  async function removeUser(id: string) {
    if (!window.confirm(t('common:deleteConfirm', 'Are you sure?'))) return;
    try {
      await deleteDoc(doc(db, 'appUsers', id));
      showToast(setToast, 'success', t('users:toasts.deleted'));
    } catch (e: any) {
      showToast(setToast, 'error', t('users:toasts.deleteFail', { msg: e?.message || 'unknown' }));
    }
  }

  function exportUsers() {
    const rows = filtered.map(u => ({
      username: u.username || '',
      firstName: u.firstName || '',
      lastName: u.lastName || '',
      role: u.role || '',
      birthday: u.birthday || '',
      classId: u.classId || '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows, {
      header: ['username', 'firstName', 'lastName', 'role', 'birthday', 'classId'],
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Users');
    XLSX.writeFile(wb, 'users-export.xlsx');
    showToast(setToast, 'success', t('users:toasts.exported'));
  }

  function downloadTemplate() {
    const rows = [
      { username: 'teacher.alex', firstName: 'Alex', lastName: 'Cohen', role: 'teacher', birthday: '1987-04-11', classId: '' },
      { username: 'student.neta', firstName: 'Neta', lastName: 'Levi', role: 'student', birthday: '2013-06-25', classId: 'CLS-ABCD' },
    ];
    const ws = XLSX.utils.json_to_sheet(rows, {
      header: ['username', 'firstName', 'lastName', 'role', 'birthday', 'classId'],
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'UsersTemplate');
    XLSX.writeFile(wb, 'users-template.xlsx');
    showToast(setToast, 'info', t('users:toasts.templateDownloaded'));
  }

  function openFilePicker() { fileInputRef.current?.click(); }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      setBusyImport(true);
      showToast(setToast, 'info', t('users:toasts.importing'));

      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' });

      const existing = new Map<string, AppUser>();
      for (const u of items) {
        if (u.usernameLower) existing.set(u.usernameLower, u);
      }

      let created = 0, updated = 0, skipped = 0;
      const reasons: string[] = [];

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const username = norm(String(r['username'] ?? r['Username'] ?? ''));
        const firstName = norm(String(r['firstName'] ?? r['FirstName'] ?? ''));
        const lastName  = norm(String(r['lastName']  ?? r['LastName']  ?? ''));
        const role      = norm(String(r['role']      ?? r['Role']      ?? 'student')) as Role;
        const birthday  = norm(String(r['birthday']  ?? r['Birthday']  ?? ''));
        const classId   = norm(String(r['classId']   ?? r['ClassId']   ?? ''));

        if (!username) { skipped++; reasons.push(`Row ${i + 2}: missing username`); continue; }
        const key = username.toLowerCase();

        const payload: Partial<AppUser> = {
          username, usernameLower: key, firstName, lastName, role, birthday, classId
        };

        const rowExisting = existing.get(key);
        if (rowExisting) {
          await updateDoc(doc(db, 'appUsers', rowExisting.id), payload);
          updated++;
        } else {
          await addDoc(collection(db, 'appUsers'), { ...payload, createdAt: serverTimestamp() });
          created++;
        }
      }

      showToast(setToast, 'success', t('users:toasts.importDone', { created, updated, skipped }));
      if (reasons.length) console.warn('Users import skipped:', reasons.join('\n'));
    } catch (e: any) {
      console.error(e);
      showToast(setToast, 'error', t('users:toasts.importFail', { msg: e?.message || 'unknown' }));
    } finally {
      setBusyImport(false);
    }
  }

  return (
    <div className={styles.wrapper}>

      {/* TOP TOOLBAR — Template / Export / Import */}
      <div className={styles.actionBar}>
        <div className={styles.actionsRow}>
          <button className={styles.btn} onClick={downloadTemplate}>{t('common:template','Template')}</button>
          <button className={styles.btn} onClick={exportUsers}>{t('common:export','Export')}</button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" hidden onChange={handleImportFile} />
          <button className={styles.btn} onClick={openFilePicker} disabled={busyImport}>
            {busyImport ? t('common:importing','Importing...') : t('common:import','Import')}
          </button>
        </div>
      </div>

      {/* Create (collapsed on mobile) */}
      <section className={styles.panel} aria-labelledby="create-user-title">
        <div className={styles.collapseHeader}>
          <h3 id="create-user-title" className={styles.panelTitle}>
            {t('users:new','Create User')}
          </h3>
          <button
            type="button"
            className={styles.collapseBtn}
            aria-expanded={createOpen}
            aria-controls="create-user-content"
            onClick={() => setCreateOpen(v => !v)}
          >
            {createOpen ? t('common:hide','Hide ▲') : t('common:show','Show ▼')}
          </button>
        </div>

        <div
          id="create-user-content"
          className={`${styles.collapseContent} ${createOpen ? '' : styles.closed}`}
        >
          <div className={styles.collapseInner}>
            {/* Horizontal scroll on small screens (LTR scroller, RTL content) */}
            <div className={styles.hScroll} dir="ltr">
              <form onSubmit={createUser} style={{ display: 'grid', gap: 8 }}>
                <div className={styles.wideGrid} dir="rtl">
                  <input className={styles.input} placeholder={t('users:username','Username')!}
                         value={form.username || ''} onChange={e => setForm(v => ({ ...v, username: e.target.value }))} />
                  <input className={styles.input} placeholder={t('users:firstName','First name')!}
                         value={form.firstName || ''} onChange={e => setForm(v => ({ ...v, firstName: e.target.value }))} />
                  <input className={styles.input} placeholder={t('users:lastName','Last name')!}
                         value={form.lastName || ''} onChange={e => setForm(v => ({ ...v, lastName: e.target.value }))} />
                  <select className={styles.select}
                          value={form.role || 'student'}
                          onChange={e => setForm(v => ({ ...v, role: e.target.value as Role }))}>
                    <option value="student">{t('users:role.student','Student')}</option>
                    <option value="teacher">{t('users:role.teacher','Teacher')}</option>
                    <option value="admin">{t('users:role.admin','Admin')}</option>
                    <option value="kiosk">{t('users:role.kiosk','Kiosk')}</option>
                  </select>
                  <input className={styles.input} placeholder={t('users:birthday','Birthday (yyyy-mm-dd)')!}
                         value={form.birthday || ''} onChange={e => setForm(v => ({ ...v, birthday: e.target.value }))} />
                  <input className={styles.input} placeholder={t('users:classId','Class ID')!}
                         value={form.classId || ''} onChange={e => setForm(v => ({ ...v, classId: e.target.value }))} />
                </div>

                <button className={styles.btnPrimary} disabled={!canCreate || creating}>
                  {creating ? t('common:saving','Saving…') : t('common:create','Create')}
                </button>
              </form>
            </div>
          </div>
        </div>
      </section>

      {/* All users */}
      <section className={styles.panel}>
        <h3 className={styles.panelTitle}>{t('users:list','All Users')}</h3>

        {/* SEARCH + ROLE FILTER under the title */}
        <div className={styles.actionBar} style={{ marginBottom: 8 }}>
          <div className={styles.actionsRow} style={{ flex: 1, minWidth: 0 }}>
            <input
              className={styles.input}
              placeholder={t('common:search','Search')!}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <select
              className={styles.select}
              value={roleFilter}
              onChange={e => setRoleFilter(e.target.value as Role | 'all')}
            >
              <option value="all">{t('users:filter.all','All')}</option>
              <option value="student">{t('users:filter.student','Students')}</option>
              <option value="teacher">{t('users:filter.teacher','Teachers')}</option>
              <option value="admin">{t('users:filter.admin','Admins')}</option>
              <option value="kiosk">{t('users:filter.kiosk','Kiosk')}</option>
            </select>
          </div>
        </div>

        {/* Table (RTL-safe sideways scroll + start on right) */}
        <div
          ref={tableWrapRef}
          className={styles.tableWrap}
          role="region"
          aria-label={t('users:list','All Users')!}
          dir="ltr"
        >
          <table className={styles.table} dir="rtl">
            <thead>
              <tr>
                <th>{t('users:table.username','Username')}</th>
                <th>{t('users:table.name','Name')}</th>
                <th>{t('users:table.role','Role')}</th>
                <th>{t('users:table.birthday','Birthday')}</th>
                <th>{t('users:table.classId','Class')}</th>
                <th style={{ minWidth: 200 }}>{t('common:actions','Actions')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => (
                <tr key={u.id}>
                  <td>{u.username}</td>
                  <td>{labelUser(u)}</td>
                  <td><span className={styles.badge}>{u.role}</span></td>
                  <td>{u.birthday || '-'}</td>
                  <td>{u.classId || '-'}</td>
                  <td>
                    <div className={styles.rowActions}>
                      <button className={styles.btn} onClick={() => openEdit(u)}>{t('common:edit','Edit')}</button>
                      <button className={styles.btnDanger} onClick={() => removeUser(u.id)}>{t('common:delete','Delete')}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Edit modal */}
      {edit.open && (
        <div className={styles.modalScrim} onClick={closeEdit}>
          <div className={styles.modalCard} onClick={e => e.stopPropagation()}>
            <h3 className={styles.panelTitle}>{t('users:editTitle','Edit User')}</h3>

            <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
              <input className={styles.input} placeholder={t('users:username','Username')!}
                     value={edit.row.username || ''} onChange={e => setEdit(prev => prev.open ? ({ open: true, row: { ...prev.row, username: e.target.value } }) : prev)} />
              <input className={styles.input} placeholder={t('users:firstName','First name')!}
                     value={edit.row.firstName || ''} onChange={e => setEdit(prev => prev.open ? ({ open: true, row: { ...prev.row, firstName: e.target.value } }) : prev)} />
              <input className={styles.input} placeholder={t('users:lastName','Last name')!}
                     value={edit.row.lastName || ''} onChange={e => setEdit(prev => prev.open ? ({ open: true, row: { ...prev.row, lastName: e.target.value } }) : prev)} />
              <select className={styles.select}
                      value={edit.row.role}
                      onChange={e => setEdit(prev => prev.open ? ({ open: true, row: { ...prev.row, role: e.target.value as Role } }) : prev)}>
                <option value="student">{t('users:role.student','Student')}</option>
                <option value="teacher">{t('users:role.teacher','Teacher')}</option>
                <option value="admin">{t('users:role.admin','Admin')}</option>
                <option value="kiosk">{t('users:role.kiosk','Kiosk')}</option>
              </select>
              <input className={styles.input} placeholder={t('users:birthday','Birthday (yyyy-mm-dd)')!}
                     value={edit.row.birthday || ''} onChange={e => setEdit(prev => prev.open ? ({ open: true, row: { ...prev.row, birthday: e.target.value } }) : prev)} />
              <input className={styles.input} placeholder={t('users:classId','Class ID')!}
                     value={edit.row.classId || ''} onChange={e => setEdit(prev => prev.open ? ({ open: true, row: { ...prev.row, classId: e.target.value } }) : prev)} />
            </div>

            <div className={styles.modalActions}>
              <button className={styles.btnPrimary} onClick={saveEdit} disabled={saving}>
                {saving ? t('common:saving','Saving…') : t('common:save','Save')}
              </button>
              <button className={styles.btn} onClick={closeEdit}>{t('common:cancel','Cancel')}</button>
            </div>
          </div>
        </div>
      )}

      {toast.show && <div className={styles.toast}>{toast.message}</div>}
    </div>
  );
}
