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
  birthday?: string;      // ISO "YYYY-MM-DD"
  classGrade?: string;    // Hebrew letter(s) "א".."יב"
  passwordHash?: string;
  salt?: string;
  createdAt?: any;
};

type ToastState =
  | { show: false }
  | { show: true, kind: 'success'|'error'|'info', message: string };

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
      birthday: string;
      classGrade: string;
    };

// ----- Grades helpers -----
const CLASS_GRADE_VALUES = ["א","ב","ג","ד","ה","ו","ז","ח","ט","י","יא","יב"] as const;
type GradeHeb = typeof CLASS_GRADE_VALUES[number];
function isHebGrade(v: string): v is GradeHeb { return CLASS_GRADE_VALUES.includes(v as GradeHeb); }
function toHebGrade(input: any): string {
  const raw = String(input ?? '').trim();
  if (!raw) return '';
  if (isHebGrade(raw)) return raw;
  const noPrefix = raw.replace(/^כיתה\s*/, '');
  if (isHebGrade(noPrefix)) return noPrefix;
  const num = Number(raw);
  if (!Number.isNaN(num) && num >= 1 && num <= 12) return CLASS_GRADE_VALUES[num-1];
  const compact = noPrefix.replace(/[^\u0590-\u05FF]/g, '');
  if (isHebGrade(compact)) return compact;
  return '';
}

// ----- Sort helpers -----
type SortKey = 'username'|'firstName'|'lastName'|'role'|'birthday'|'classGrade';
type SortDir = 'asc'|'desc';
type SortState = { key: SortKey, dir: SortDir };
const DEFAULT_SORT: SortState = { key: 'username', dir: 'asc' };

function compareStrings(a?: string, b?: string) {
  const A = (a ?? '').toString().toLowerCase();
  const B = (b ?? '').toString().toLowerCase();
  if (A < B) return -1;
  if (A > B) return 1;
  return 0;
}

export default function UsersAdmin() {
  const { t } = useTranslation();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [toast, setToast] = useState<ToastState>({ show: false });

  // NEW: search + sort
  const [queryText, setQueryText] = useState('');
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);

  const [form, setForm] = useState({
    firstName: '', lastName: '', username: '', password: '', role: 'teacher' as Role,
    birthday: '', classGrade: 'א',
  });
  const [submitting, setSubmitting] = useState(false);

  const [edit, setEdit] = useState<EditState>({ open: false });
  const [savingEdit, setSavingEdit] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [busyImport, setBusyImport] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'appUsers'), orderBy('username')),
      (snap) => setUsers(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))),
      (err) => showToast('error', t('users:toasts.loadFail', { msg: err.message })),
    );
    return () => unsub();
  }, [t]);

  const canCreate = useMemo(() =>
    form.username.trim() && form.password.trim() && (form.firstName.trim() || form.lastName.trim())
  , [form]);

  function showToast(kind: 'success'|'error'|'info', message: string) {
    setToast({ show: true, kind, message });
    setTimeout(()=>setToast({ show: false }), 2600);
  }

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    if (!canCreate || submitting) return;

    const firstName = form.firstName.trim();
    const lastName = form.lastName.trim();
    const username = form.username.trim();
    const usernameLower = username.toLowerCase();
    const birthday = form.birthday.trim();
    const classGradeHeb = form.role === 'student' ? toHebGrade(form.classGrade) : '';

    try {
      setSubmitting(true);
      const dupSnap = await getDocs(query(collection(db, 'appUsers'), where('usernameLower', '==', usernameLower)));
      if (!dupSnap.empty) { showToast('error', t('users:toasts.dupUser', { username })); return; }

      const salt = bcrypt.genSaltSync(10);
      const passwordHash = bcrypt.hashSync(form.password, salt);

      const payload: any = {
        firstName, lastName, username, usernameLower, role: form.role,
        salt, passwordHash, createdAt: serverTimestamp(),
      };
      if (birthday) payload.birthday = birthday;
      if (form.role === 'student' && classGradeHeb) payload.classGrade = classGradeHeb;

      await addDoc(collection(db, 'appUsers'), payload);

      setForm({ firstName:'', lastName:'', username:'', password:'', role:'teacher', birthday:'', classGrade:'א' });
      showToast('success', t('users:toasts.created', { username }));
    } catch (err:any) {
      showToast('error', t('users:toasts.createFail', { msg: err?.message || 'unknown' }));
    } finally { setSubmitting(false); }
  }

  function openEdit(u: AppUser) {
    setEdit({
      open: true, id: u.id,
      firstName: u.firstName || '', lastName: u.lastName || '',
      username: u.username || '', role: u.role, newPassword: '',
      birthday: u.birthday || '',
      classGrade: toHebGrade(u.classGrade) || 'א',
    });
  }
  function closeEdit(){ setEdit({ open: false }); }

  async function saveEdit() {
    if (!edit.open) return;

    const id = edit.id;
    const firstName = edit.firstName.trim();
    const lastName = edit.lastName.trim();
    const username = edit.username.trim();
    const usernameLower = username.toLowerCase();
    const birthday = (edit.birthday || '').trim();
    const classGradeHeb = edit.role === 'student' ? toHebGrade(edit.classGrade) : '';

    if (!username) return showToast('error', t('users:toasts.createFail', { msg: t('users:username','Username') }));
    if (!firstName && !lastName) return showToast('error', t('users:toasts.createFail', { msg: t('users:firstName','First name') + '/' + t('users:lastName','Last name') }));

    try {
      setSavingEdit(true);
      const dup = await getDocs(query(collection(db, 'appUsers'), where('usernameLower','==',usernameLower)));
      const dupExists = dup.docs.some(d => d.id !== id);
      if (dupExists) { showToast('error', t('users:toasts.dupOther', { username })); return; }

      const payload: any = {
        firstName, lastName, username, usernameLower, role: edit.role,
        birthday: birthday || '',
        classGrade: edit.role==='student' ? (classGradeHeb || '') : '',
      };
      if (edit.newPassword?.trim()) {
        const salt = bcrypt.genSaltSync(10);
        const passwordHash = bcrypt.hashSync(edit.newPassword.trim(), salt);
        payload.salt = salt; payload.passwordHash = passwordHash;
      }

      await updateDoc(doc(db, 'appUsers', id), payload);
      showToast('success', t('users:toasts.updated', { username }));
      closeEdit();
    } catch (err:any) {
      showToast('error', t('users:toasts.updateFail', { msg: err?.message || 'unknown' }));
    } finally { setSavingEdit(false); }
  }

  async function removeUser(id: string) {
    try { await deleteDoc(doc(db, 'appUsers', id)); showToast('success', t('users:toasts.deleted')); }
    catch (err:any) { showToast('error', t('users:toasts.deleteFail', { msg: err?.message || 'unknown' })); }
  }

  // ----- Import/Export -----
  function downloadTemplate() {
    const rows = [
      { username:'teacher.alex', firstName:'Alex', lastName:'Levi', role:'teacher', password:'Secret123', birthday:'1985-03-12', classGrade:'' },
      { username:'student.neta', firstName:'Neta',  lastName:'Cohen', role:'student', password:'Temp4567',  birthday:'2011-06-05', classGrade:'ו' },
    ];
    const header = ['username','firstName','lastName','role','password','birthday','classGrade'];
    const ws = XLSX.utils.json_to_sheet(rows, { header });
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'UsersTemplate');
    XLSX.writeFile(wb, 'users-template.xlsx');
    showToast('info', t('users:toasts.templateDownloaded','Template downloaded'));
  }

  function exportUsers() {
    const rows = users.map(u => ({
      username: u.username || '',
      firstName: u.firstName || '',
      lastName: u.lastName || '',
      role: u.role || 'student',
      password: '',
      birthday: u.birthday || '',
      classGrade: toHebGrade(u.classGrade) || '',
    }));
    const header = ['username','firstName','lastName','role','password','birthday','classGrade'];
    const ws = XLSX.utils.json_to_sheet(rows, { header });
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Users');
    XLSX.writeFile(wb, 'users-export.xlsx');
    showToast('success', t('users:toasts.exported','Exported'));
  }

  function openFilePicker(){ fileInputRef.current?.click(); }
  function coerceDateString(v:any){ return String(v || '').trim(); }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value=''; if (!file) return;
    try {
      setBusyImport(true); showToast('info', t('users:toasts.importing','Importing...'));
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type:'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rowsRaw: any[] = XLSX.utils.sheet_to_json(ws, { defval:'' });

      const existingMap = new Map<string, AppUser>();
      for (const u of users) {
        const key = (u.usernameLower || u.username?.toLowerCase()) as string;
        if (key) existingMap.set(key, u);
      }

      let created=0, updated=0, skipped=0; const reasons:string[] = [];
      for (let i=0;i<rowsRaw.length;i++){
        const r = rowsRaw[i];
        const username = String(r['username'] ?? r['Username'] ?? '').trim();
        const firstName = String(r['firstName'] ?? r['FirstName'] ?? '').trim();
        const lastName = String(r['lastName'] ?? r['LastName'] ?? '').trim();
        const role = String(r['role'] ?? r['Role'] ?? 'student').trim() as Role;
        const password = String(r['password'] ?? r['Password'] ?? '').trim();
        const birthday = coerceDateString(r['birthday'] ?? r['Birthday'] ?? '');
        const classGradeHeb = role === 'student' ? toHebGrade(r['classGrade'] ?? r['ClassGrade'] ?? '') : '';

        if (!username){ skipped++; reasons.push(`Row ${i+2}: missing username`); continue; }
        const key = username.toLowerCase();
        const existing = existingMap.get(key);

        if (existing){
          const payload:any = {
            firstName, lastName, username, usernameLower:key, role,
            birthday: birthday || '',
            classGrade: role==='student' ? (classGradeHeb || '') : '',
          };
          if (password){
            const salt = bcrypt.genSaltSync(10);
            const passwordHash = bcrypt.hashSync(password, salt);
            payload.salt = salt; payload.passwordHash = passwordHash;
          }
          await updateDoc(doc(db,'appUsers', existing.id), payload);
          updated++;
        } else {
          if (!password){ skipped++; reasons.push(`Row ${i+2}: new user "${username}" missing password`); continue; }
          const salt = bcrypt.genSaltSync(10);
          const passwordHash = bcrypt.hashSync(password, salt);
          const payload:any = {
            firstName, lastName, username, usernameLower:key, role, salt, passwordHash, createdAt: serverTimestamp(),
            birthday: birthday || '',
            classGrade: role==='student' ? (classGradeHeb || '') : '',
          };
          await addDoc(collection(db,'appUsers'), payload);
          created++;
        }
      }
      showToast('success', t('users:toasts.importDone', { created, updated, skipped }));
      if (reasons.length) console.warn('Import skipped reasons:', reasons.join('\n'));
    } catch (err:any) {
      console.error(err); showToast('error', t('users:toasts.importFail', { msg: err?.message || 'unknown' }));
    } finally { setBusyImport(false); }
  }

  // ----- Derived: filtered + sorted users -----
  const filteredSorted = useMemo(() => {
    const q = queryText.trim().toLowerCase();

    const filtered = !q ? users : users.filter(u => {
      const parts = [
        u.username,
        u.firstName,
        u.lastName,
        u.role,
        u.birthday,
        u.role==='student' ? `כיתה ${toHebGrade(u.classGrade)}` : '',
        u.classGrade, // raw too
      ].map(x => (x ?? '').toString().toLowerCase());
      return parts.some(p => p.includes(q));
    });

    const sorted = [...filtered].sort((a, b) => {
      const key = sort.key;
      let cmp = 0;
      if (key === 'classGrade') {
        cmp = compareStrings(toHebGrade(a.classGrade), toHebGrade(b.classGrade));
      } else {
        cmp = compareStrings((a as any)[key], (b as any)[key]);
      }
      return sort.dir === 'asc' ? cmp : -cmp;
    });

    return sorted;
  }, [users, queryText, sort]);

  function toggleSort(nextKey: SortKey) {
    setSort(prev => {
      if (prev.key !== nextKey) return { key: nextKey, dir: 'asc' };
      return { key: nextKey, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
    });
  }

  function SortHeader({ column, label }: { column: SortKey, label: string }) {
    const active = sort.key === column;
    const dir = active ? sort.dir : undefined;
    return (
      <th
        aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
        className={`${styles.sortable}`}
      >
        <button
          type="button"
          onClick={()=>toggleSort(column)}
          className={styles.sortButton}
          title={t('common:sort','Sort')!}
        >
          <span>{label}</span>
          <span className={styles.sortIcon} aria-hidden>
            {active ? (dir === 'asc' ? '▲' : '▼') : '↕'}
          </span>
        </button>
      </th>
    );
  }

  return (
    <div className={styles.wrapper}>
      {/* Toast */}
      {toast.show && (
        <div
          className={[
            styles.toast,
            toast.kind==='success'?styles.toastSuccess: toast.kind==='info'?styles.toastInfo:styles.toastError
          ].join(' ')}
          role="status" aria-live="polite"
        >
          {toast.message}
        </div>
      )}

      <div className={styles.actionBar}>
        <h2 className="text-xl font-semibold text-white">{t('users:manage', 'Manage Users')}</h2>
        <div className="flex items-center gap-2">
          {/* NEW: Search */}
          <input
            className={styles.input}
            style={{ minWidth: 220 }}
            placeholder={t('common:search','Search')!}
            value={queryText}
            onChange={(e)=>setQueryText(e.target.value)}
          />
          <button onClick={()=>setQueryText('')} className={styles.btn}>{t('common:clear','Clear')}</button>

          <button onClick={downloadTemplate} className={`${styles.btn}`}>{t('common:downloadTemplate','Download template')}</button>
          <button onClick={exportUsers} className={`${styles.btn}`}>{t('common:export','Export')}</button>
          <button onClick={openFilePicker} disabled={busyImport}
            className={`${styles.btn} ${styles.btnPrimary}`} >
            {busyImport ? t('users:creating','Working...') : t('common:import','Import')}
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
      <form onSubmit={createUser} className={`${styles.panel} grid grid-cols-1 md:grid-cols-8 gap-3 p-4`}>
        <input className={styles.input} placeholder={t('users:firstName','First name')!}
          value={form.firstName} onChange={(e)=>setForm(f=>({...f,firstName:e.target.value}))}/>
        <input className={styles.input} placeholder={t('users:lastName','Last name')!}
          value={form.lastName} onChange={(e)=>setForm(f=>({...f,lastName:e.target.value}))}/>
        <input className={styles.input} placeholder={t('users:username','Username')!} autoComplete="username"
          value={form.username} onChange={(e)=>setForm(f=>({...f,username:e.target.value}))}/>
        <input className={styles.input} type="password" placeholder={t('users:password','Password')!} autoComplete="new-password"
          value={form.password} onChange={(e)=>setForm(f=>({...f,password:e.target.value}))}/>
        <input className={styles.input} type="date" placeholder={t('users:birthday','Birthday')!}
          value={form.birthday} onChange={(e)=>setForm(f=>({...f,birthday:e.target.value}))}/>
        <select className={styles.select} value={form.role}
          onChange={(e)=>setForm(f=>({...f,role:e.target.value as Role}))}>
          {['admin','teacher','student','kiosk'].map(r=><option key={r} value={r}>{r}</option>)}
        </select>
        <select className={styles.select} value={form.classGrade}
          onChange={(e)=>setForm(f=>({...f,classGrade:e.target.value}))} disabled={form.role!=='student'}>
          {CLASS_GRADE_VALUES.map(val => <option key={val} value={val}>{`כיתה ${val}`}</option>)}
        </select>
        <button type="submit" disabled={!canCreate||submitting}
          className={`${styles.btn} ${styles.btnPrimary}`}>{submitting?t('users:creating','Creating...'):t('users:create','Create')}</button>
      </form>

      {/* Table */}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <SortHeader column="username"  label={t('users:table.username','Username')} />
              <SortHeader column="firstName" label={t('users:table.first','First')} />
              <SortHeader column="lastName"  label={t('users:table.last','Last')} />
              <SortHeader column="role"      label={t('users:table.role','Role')} />
              <SortHeader column="birthday"  label={t('users:birthday','Birthday')} />
              <SortHeader column="classGrade" label={t('users:classGrade','Class Grade')} />
              <th className="w-56">{t('common:actions','Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {filteredSorted.map(u=>(
              <tr key={u.id}>
                <td>{u.username}</td>
                <td>{u.firstName||''}</td>
                <td>{u.lastName||''}</td>
                <td>{u.role}</td>
                <td>{u.birthday||''}</td>
                <td>{u.role==='student' ? (u.classGrade ? `כיתה ${toHebGrade(u.classGrade)}` : '') : ''}</td>
                <td>
                  <div className="flex gap-2">
                    <button onClick={()=>openEdit(u)} className={styles.btn}>{t('common:edit','Edit')}</button>
                    <button onClick={()=>removeUser(u.id)} className={`${styles.btn} ${styles.btnDanger}`}>{t('common:delete','Delete')}</button>
                  </div>
                </td>
              </tr>
            ))}
            {!filteredSorted.length && (
              <tr><td colSpan={7} style={{color:'var(--sb-muted)', padding:'1rem'}}>{t('common:noItems','No items')}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Edit Modal */}
      {edit.open && (
        <div className={styles.modalScrim} onClick={(e)=>{ if(e.target===e.currentTarget) closeEdit(); }}>
          <div className={styles.modalCard}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-white">{t('users:editTitle','Edit User')}</h3>
              <button className={styles.btn} onClick={closeEdit} aria-label={t('common:close','Close')!}>✕</button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-neutral-300 mb-1">{t('users:firstName','First name')}</label>
                <input className={styles.input} value={edit.firstName}
                  onChange={(e)=>setEdit(prev=>prev.open?{...prev,firstName:e.target.value}:prev)} />
              </div>
              <div>
                <label className="block text-sm text-neutral-300 mb-1">{t('users:lastName','Last name')}</label>
                <input className={styles.input} value={edit.lastName}
                  onChange={(e)=>setEdit(prev=>prev.open?{...prev,lastName:e.target.value}:prev)} />
              </div>

              <div className="md:col-span-2">
                <label className="block text-sm text-neutral-300 mb-1">{t('users:username','Username')}</label>
                <input className={styles.input} value={edit.username}
                  onChange={(e)=>setEdit(prev=>prev.open?{...prev,username:e.target.value}:prev)} />
              </div>

              <div>
                <label className="block text-sm text-neutral-300 mb-1">{t('users:birthday','Birthday')}</label>
                <input className={styles.input} type="date" value={edit.birthday}
                  onChange={(e)=>setEdit(prev=>prev.open?{...prev,birthday:e.target.value}:prev)} />
              </div>

              <div>
                <label className="block text-sm text-neutral-300 mb-1">{t('users:role','Role')}</label>
                <select className={styles.select} value={edit.role}
                  onChange={(e)=>setEdit(prev=>prev.open?{...prev,role:e.target.value as Role}:prev)}>
                  {['admin','teacher','student','kiosk'].map(r=><option key={r} value={r}>{r}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm text-neutral-300 mb-1">{t('users:classGrade','Class Grade')}</label>
                <select className={styles.select} value={edit.classGrade}
                  disabled={edit.role!=='student'}
                  onChange={(e)=>setEdit(prev=>prev.open?{...prev,classGrade:e.target.value}:prev)}>
                  {CLASS_GRADE_VALUES.map(val => <option key={val} value={val}>{`כיתה ${val}`}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm text-neutral-300 mb-1">{t('users:newPasswordOptional','New password (optional)')}</label>
                <input className={styles.input} type="password" placeholder={t('users:keepCurrentPassword','Leave empty to keep current')!}
                  value={(edit as any).newPassword}
                  onChange={(e)=>setEdit(prev=>prev.open?{...prev,newPassword:e.target.value}:prev)} />
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button onClick={closeEdit} className={styles.btn}>{t('common:cancel','Cancel')}</button>
              <button onClick={saveEdit} disabled={savingEdit}
                className={`${styles.btn} ${styles.btnPrimary}`}>{savingEdit?t('common:saving','Saving...'):t('common:saveChanges','Save changes')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
