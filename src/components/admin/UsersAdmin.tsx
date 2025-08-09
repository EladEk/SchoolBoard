import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  addDoc, collection, deleteDoc, doc, getDocs, onSnapshot, orderBy, query,
  serverTimestamp, updateDoc, where
} from 'firebase/firestore';
import { db } from '../../firebase/app';
import * as bcrypt from 'bcryptjs';
import * as XLSX from 'xlsx';
import styles from './UsersAdmin.module.css';
import { useTranslation } from 'react-i18next';

type Role = 'admin' | 'teacher' | 'student' | 'kiosk';
type AppUser = {
  id: string;
  firstName?: string;
  lastName?: string;
  username: string;
  usernameLower?: string;
  role: Role;
  passwordHash?: string;
  salt?: string;
  createdAt?: any;
};

type ToastState =
  | { show: false }
  | { show: true; kind: 'success' | 'error' | 'info'; message: string };

type EditState =
  | { open: false }
  | {
      open: true;
      id: string;
      firstName: string;
      lastName: string;
      username: string;
      role: Role;
      newPassword: string;
    };

export default function UsersAdmin() {
  const { t } = useTranslation();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [toast, setToast] = useState<ToastState>({ show: false });

  const [form, setForm] = useState({
    firstName: '', lastName: '', username: '', password: '', role: 'teacher' as Role,
  });
  const [submitting, setSubmitting] = useState(false);

  const [edit, setEdit] = useState<EditState>({ open: false });
  const [savingEdit, setSavingEdit] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [busyImport, setBusyImport] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'appUsers'), orderBy('username')),
      (snap) => setUsers(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))),
      (err) => showToast('error', t('users:toasts.loadFail', { msg: err.message })),
    );
    return () => unsub();
  }, [t]);

  const canCreate = useMemo(() =>
    form.username.trim() && form.password.trim() && (form.firstName.trim() || form.lastName.trim())
      ? true : false
  , [form]);

  function showToast(kind: 'success' | 'error' | 'info', message: string) {
    setToast({ show: true, kind, message });
    setTimeout(() => setToast({ show: false }), 2600);
  }

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    if (!canCreate || submitting) return;

    const firstName = form.firstName.trim();
    const lastName = form.lastName.trim();
    const username = form.username.trim();
    const usernameLower = username.toLowerCase();

    try {
      setSubmitting(true);
      const dupSnap = await getDocs(
        query(collection(db, 'appUsers'), where('usernameLower', '==', usernameLower))
      );
      if (!dupSnap.empty) {
        showToast('error', t('users:toasts.dupUser', { username }));
        return;
      }

      const salt = bcrypt.genSaltSync(10);
      const passwordHash = bcrypt.hashSync(form.password, salt);

      await addDoc(collection(db, 'appUsers'), {
        firstName, lastName, username, usernameLower, role: form.role,
        salt, passwordHash, createdAt: serverTimestamp(),
      });

      setForm({ firstName: '', lastName: '', username: '', password: '', role: 'teacher' });
      showToast('success', t('users:toasts.created', { username }));
    } catch (err: any) {
      showToast('error', t('users:toasts.createFail', { msg: err?.message || 'unknown' }));
    } finally {
      setSubmitting(false);
    }
  }

  function openEdit(u: AppUser) {
    setEdit({
      open: true, id: u.id,
      firstName: u.firstName || '', lastName: u.lastName || '',
      username: u.username || '', role: u.role, newPassword: '',
    });
  }
  function closeEdit() { setEdit({ open: false }); }

  async function saveEdit() {
    if (!edit.open) return;

    const id = edit.id;
    const firstName = edit.firstName.trim();
    const lastName = edit.lastName.trim();
    const username = edit.username.trim();
    const usernameLower = username.toLowerCase();

    if (!username) return showToast('error', t('users:toasts.createFail', { msg: t('users:username') }));
    if (!firstName && !lastName) return showToast('error', t('users:toasts.createFail', { msg: t('users:firstName') + '/' + t('users:lastName') }));

    try {
      setSavingEdit(true);
      const dup = await getDocs(
        query(collection(db, 'appUsers'), where('usernameLower', '==', usernameLower))
      );
      const dupExists = dup.docs.some((d) => d.id !== id);
      if (dupExists) {
        showToast('error', t('users:toasts.dupOther', { username }));
        return;
      }

      const payload: any = {
        firstName, lastName, username, usernameLower, role: edit.role,
      };
      if (edit.newPassword?.trim()) {
        const salt = bcrypt.genSaltSync(10);
        const passwordHash = bcrypt.hashSync(edit.newPassword.trim(), salt);
        payload.salt = salt;
        payload.passwordHash = passwordHash;
      }
      await updateDoc(doc(db, 'appUsers', id), payload);
      showToast('success', t('users:toasts.updated', { username }));
      closeEdit();
    } catch (err: any) {
      showToast('error', t('users:toasts.updateFail', { msg: err?.message || 'unknown' }));
    } finally {
      setSavingEdit(false);
    }
  }

  async function removeUser(id: string) {
    try { await deleteDoc(doc(db, 'appUsers', id)); showToast('success', t('users:toasts.deleted')); }
    catch (err: any) { showToast('error', t('users:toasts.deleteFail', { msg: err?.message || 'unknown' })); }
  }

  function downloadTemplate() {
    const rows = [
      { username: 'teacher.alex', firstName: 'Alex', lastName: 'Levi', role: 'teacher', password: 'Secret123' },
      { username: 'student.neta', firstName: 'Neta', lastName: 'Cohen', role: 'student', password: 'Temp4567' },
    ];
    const ws = XLSX.utils.json_to_sheet(rows, { header: ['username','firstName','lastName','role','password'] });
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'UsersTemplate');
    XLSX.writeFile(wb, 'users-template.xlsx'); showToast('info', t('users:toasts.templateDownloaded'));
  }
  function exportUsers() {
    const rows = users.map(u => ({
      username: u.username || '', firstName: u.firstName || '', lastName: u.lastName || '', role: u.role || 'student', password: ''
    }));
    const ws = XLSX.utils.json_to_sheet(rows, { header: ['username','firstName','lastName','role','password'] });
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Users');
    XLSX.writeFile(wb, 'users-export.xlsx'); showToast('success', t('users:toasts.exported'));
  }
  function openFilePicker() { fileInputRef.current?.click(); }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value=''; if (!file) return;
    try {
      setBusyImport(true); showToast('info', t('users:toasts.importing'));
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rowsRaw: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' });

      const existingMap = new Map<string, AppUser>();
      for (const u of users) {
        const key = (u.usernameLower || u.username?.toLowerCase()) as string;
        if (key) existingMap.set(key, u);
      }

      let created = 0, updated = 0, skipped = 0;
      const reasons: string[] = [];

      for (let i=0;i<rowsRaw.length;i++){
        const r = rowsRaw[i];
        const username = String(r['username'] ?? r['Username'] ?? '').trim();
        const firstName = String(r['firstName'] ?? r['FirstName'] ?? '').trim();
        const lastName = String(r['lastName'] ?? r['LastName'] ?? '').trim();
        const role = String(r['role'] ?? r['Role'] ?? 'student').trim() as Role;
        const password = String(r['password'] ?? r['Password'] ?? '').trim();

        if (!username){ skipped++; reasons.push(`Row ${i+2}: missing username`); continue; }
        const key = username.toLowerCase();
        const existing = existingMap.get(key);

        if (existing){
          const payload: any = { firstName, lastName, username, usernameLower:key, role };
          if (password){
            const salt = bcrypt.genSaltSync(10);
            const passwordHash = bcrypt.hashSync(password, salt);
            payload.salt = salt; payload.passwordHash = passwordHash;
          }
          await updateDoc(doc(db, 'appUsers', existing.id), payload);
          updated++;
        } else {
          if (!password){ skipped++; reasons.push(`Row ${i+2}: new user "${username}" missing password`); continue; }
          const salt = bcrypt.genSaltSync(10);
          const passwordHash = bcrypt.hashSync(password, salt);
          await addDoc(collection(db, 'appUsers'), {
            firstName, lastName, username, usernameLower:key, role, salt, passwordHash, createdAt: serverTimestamp(),
          });
          created++;
        }
      }
      showToast('success', t('users:toasts.importDone', { created, updated, skipped }));
      if (reasons.length) console.warn('Import skipped reasons:', reasons.join('\n'));
    } catch (err:any) {
      console.error(err); showToast('error', t('users:toasts.importFail', { msg: err?.message || 'unknown' }));
    } finally { setBusyImport(false); }
  }

  return (
    <div className={styles.wrapper}>
      {/* Toast */}
      {toast.show && (
        <div className={[
          styles.toast,
          toast.kind==='success'?styles.toastSuccess: toast.kind==='info'?styles.toastInfo:styles.toastError
        ].join(' ')} role="status" aria-live="polite">
          {toast.message}
        </div>
      )}

      <div className={styles.actionBar}>
        <h2 className="text-xl font-semibold text-white">{t('users:manage')}</h2>
        <div className="flex gap-2">
          <button onClick={downloadTemplate} className={`${styles.btn}`}>{t('common:downloadTemplate')}</button>
          <button onClick={exportUsers} className={`${styles.btn}`}>{t('common:export')}</button>
          <button onClick={openFilePicker} disabled={busyImport}
            className={`${styles.btn} ${styles.btnPrimary}`} >
            {busyImport ? t('users:creating') : t('common:import')}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleImportFile}
            className={styles.fileInputHidden}
          />
        </div>
      </div>

      {/* Create User */}
      <form onSubmit={createUser} className={`${styles.panel} grid grid-cols-1 md:grid-cols-6 gap-3 p-4`}>
        <input className={styles.input} placeholder={t('users:firstName')!}
          value={form.firstName} onChange={(e)=>setForm(f=>({...f,firstName:e.target.value}))}/>
        <input className={styles.input} placeholder={t('users:lastName')!}
          value={form.lastName} onChange={(e)=>setForm(f=>({...f,lastName:e.target.value}))}/>
        <input className={styles.input} placeholder={t('users:username')!} autoComplete="username"
          value={form.username} onChange={(e)=>setForm(f=>({...f,username:e.target.value}))}/>
        <input className={styles.input} type="password" placeholder={t('users:password')!} autoComplete="new-password"
          value={form.password} onChange={(e)=>setForm(f=>({...f,password:e.target.value}))}/>
        <select className={styles.select} value={form.role}
          onChange={(e)=>setForm(f=>({...f,role:e.target.value as Role}))}>
          {['admin','teacher','student','kiosk'].map(r=><option key={r} value={r}>{r}</option>)}
        </select>
        <button type="submit" disabled={!canCreate||submitting}
          className={`${styles.btn} ${styles.btnPrimary}`}>{submitting?t('users:creating'):t('users:create')}</button>
      </form>

      {/* Table */}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t('users:table.username')}</th>
              <th>{t('users:table.first')}</th>
              <th>{t('users:table.last')}</th>
              <th>{t('users:table.role')}</th>
              <th className="w-48">{t('common:actions')}</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u=>(
              <tr key={u.id}>
                <td>{u.username}</td>
                <td>{u.firstName||''}</td>
                <td>{u.lastName||''}</td>
                <td>{u.role}</td>
                <td>
                  <div className="flex gap-2">
                    <button onClick={()=>openEdit(u)} className={styles.btn}>{t('common:edit')}</button>
                    <button onClick={()=>removeUser(u.id)} className={`${styles.btn} ${styles.btnDanger}`}>{t('common:delete')}</button>
                  </div>
                </td>
              </tr>
            ))}
            {!users.length && (
              <tr><td colSpan={5} style={{color:'var(--sb-muted)', padding:'1rem'}}>{t('common:noItems')}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Edit Modal */}
      {edit.open && (
        <div className={styles.modalScrim} onClick={(e)=>{ if(e.target===e.currentTarget) closeEdit(); }}>
          <div className={styles.modalCard}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-white">{t('users:editTitle')}</h3>
              <button className={styles.btn} onClick={closeEdit} aria-label={t('common:close')!}>✕</button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-neutral-300 mb-1">{t('users:firstName')}</label>
                <input className={styles.input} value={edit.firstName}
                  onChange={(e)=>setEdit(prev=>prev.open?{...prev,firstName:e.target.value}:prev)} />
              </div>
              <div>
                <label className="block text-sm text-neutral-300 mb-1">{t('users:lastName')}</label>
                <input className={styles.input} value={edit.lastName}
                  onChange={(e)=>setEdit(prev=>prev.open?{...prev,lastName:e.target.value}:prev)} />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm text-neutral-300 mb-1">{t('users:username')}</label>
                <input className={styles.input} value={edit.username}
                  onChange={(e)=>setEdit(prev=>prev.open?{...prev,username:e.target.value}:prev)} />
              </div>
              <div>
                <label className="block text-sm text-neutral-300 mb-1">{t('users:role')}</label>
                <select className={styles.select} value={edit.role}
                  onChange={(e)=>setEdit(prev=>prev.open?{...prev,role:e.target.value as Role}:prev)}>
                  {['admin','teacher','student','kiosk'].map(r=><option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm text-neutral-300 mb-1">{t('users:newPasswordOptional')}</label>
                <input className={styles.input} type="password" placeholder={t('users:keepCurrentPassword')!}
                  value={(edit as any).newPassword}
                  onChange={(e)=>setEdit(prev=>prev.open?{...prev,newPassword:e.target.value}:prev)} />
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button onClick={closeEdit} className={styles.btn}>{t('common:cancel')}</button>
              <button onClick={saveEdit} disabled={savingEdit}
                className={`${styles.btn} ${styles.btnPrimary}`}>{savingEdit?t('common:saving'):t('common:saveChanges')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
