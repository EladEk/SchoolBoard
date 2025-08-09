import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  addDoc, collection, deleteDoc, doc, getDocs, onSnapshot, orderBy, query,
  serverTimestamp, updateDoc, where
} from 'firebase/firestore';
import { db } from '../../firebase/app';
import * as XLSX from 'xlsx';
import styles from './ClassesAdmin.module.css';
import { useTranslation } from 'react-i18next';

// ---------------- Types ----------------
type ToastState =
  | { show: false }
  | { show: true; kind: 'success' | 'error' | 'info'; message: string };

type ClassItem = {
  id: string;            // Firestore doc id
  classId: string;       // Business ID (unique)
  classIdLower?: string; // for duplicate checks
  location: string;
  name: string;
  createdAt?: any;
};

// ---------------- Helpers ----------------
function normId(v: string) {
  return v.trim().toLowerCase();
}

function generateClassId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
  return `CLS-${code}`;
}

async function generateUniqueClassId(): Promise<string> {
  while (true) {
    const candidate = generateClassId();
    const dup = await getDocs(
      query(collection(db, 'classes'), where('classIdLower', '==', candidate.toLowerCase()))
    );
    if (dup.empty) return candidate;
  }
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
export default function ClassesAdmin() {
  const { t } = useTranslation();
  const [items, setItems] = useState<ClassItem[]>([]);
  const [toast, setToast] = useState<ToastState>({ show: false });

  // Create form (no ClassID input — it’s auto-generated)
  const [form, setForm] = useState({ location: '', name: '' });
  const [submitting, setSubmitting] = useState(false);

  // Edit modal
  const [edit, setEdit] = useState<
    | { open: false }
    | { open: true; id: string; classId: string; location: string; name: string }
  >({ open: false });
  const [saving, setSaving] = useState(false);

  // Excel import/export
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [busyImport, setBusyImport] = useState(false);

  // Live list
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'classes'), orderBy('classId')),
      (snap) => {
        const arr = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as ClassItem[];
        setItems(arr);
      },
      (err) => showToastFn(setToast, 'error', t('classes:toasts.loadFail', { msg: err.message }))
    );
    return () => unsub();
  }, [t]);

  const canCreate = useMemo(() => {
    return form.location.trim().length > 0 && form.name.trim().length > 0;
  }, [form]);

  // --------------- Create ---------------
  async function createItem(e: React.FormEvent) {
    e.preventDefault();
    if (!canCreate || submitting) return;

    const location = form.location.trim();
    const name = form.name.trim();

    try {
      setSubmitting(true);

      // Generate guaranteed-unique ClassID
      const classId = await generateUniqueClassId();

      await addDoc(collection(db, 'classes'), {
        classId,
        classIdLower: classId.toLowerCase(),
        location,
        name,
        createdAt: serverTimestamp(),
      });

      setForm({ location: '', name: '' });
      showToastFn(setToast, 'success', t('classes:toasts.created', { classId }));
    } catch (err: any) {
      showToastFn(setToast, 'error', t('classes:toasts.createFail', { msg: err?.message || 'unknown' }));
    } finally {
      setSubmitting(false);
    }
  }

  // --------------- Edit / Save ---------------
  function openEdit(row: ClassItem) {
    setEdit({ open: true, id: row.id, classId: row.classId, location: row.location, name: row.name });
  }
  function closeEdit() { setEdit({ open: false }); }

  async function regenerateEditId() {
    if (!edit.open) return;
    const newId = await generateUniqueClassId();
    setEdit((prev) => (prev.open ? { ...prev, classId: newId } : prev));
  }

  async function saveEdit() {
    if (!edit.open) return;

    const id = edit.id;
    const classId = edit.classId.trim();
    const location = edit.location.trim();
    const name = edit.name.trim();

    if (!classId || !location || !name) {
      showToastFn(setToast, 'error', t('classes:toasts.allRequired'));
      return;
    }

    try {
      setSaving(true);

      // Duplicate classIdLower check (exclude current doc)
      const classIdLower = normId(classId);
      const dup = await getDocs(
        query(collection(db, 'classes'), where('classIdLower', '==', classIdLower))
      );
      const existsOther = dup.docs.some((d) => d.id !== id);
      if (existsOther) {
        showToastFn(setToast, 'error', t('classes:toasts.dupOther', { classId }));
        return;
      }

      await updateDoc(doc(db, 'classes', id), { classId, classIdLower, location, name });
      showToastFn(setToast, 'success', t('classes:toasts.updated', { classId }));
      closeEdit();
    } catch (err: any) {
      showToastFn(setToast, 'error', t('classes:toasts.updateFail', { msg: err?.message || 'unknown' }));
    } finally {
      setSaving(false);
    }
  }

  // --------------- Delete ---------------
  async function removeItem(id: string) {
    try {
      await deleteDoc(doc(db, 'classes', id));
      showToastFn(setToast, 'success', t('classes:toasts.deleted'));
    } catch (err: any) {
      showToastFn(setToast, 'error', t('classes:toasts.deleteFail', { msg: err?.message || 'unknown' }));
    }
  }

  // --------------- Excel: Export / Template / Import ---------------
  function downloadTemplate() {
    const rows = [
      { classId: '', name: 'Grade 5 – A', location: 'Room 201' },
      { classId: '', name: 'Grade 8 – B', location: 'Lab 2' },
    ];
    const ws = XLSX.utils.json_to_sheet(rows, { header: ['classId', 'name', 'location'] });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'ClassesTemplate');
    XLSX.writeFile(wb, 'classes-template.xlsx');
    showToastFn(setToast, 'info', t('classes:toasts.templateDownloaded'));
  }

  function exportItems() {
    const rows = items.map((c) => ({
      classId: c.classId,
      name: c.name || '',
      location: c.location || '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows, { header: ['classId', 'name', 'location'] });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Classes');
    XLSX.writeFile(wb, 'classes-export.xlsx');
    showToastFn(setToast, 'success', t('classes:toasts.exported'));
  }

  function openFilePicker() { fileInputRef.current?.click(); }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      setBusyImport(true);
      showToastFn(setToast, 'info', t('classes:toasts.importing'));

      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' });

      // existing by classIdLower
      const existingMap = new Map<string, ClassItem>();
      for (const c of items) {
        const key = (c.classIdLower || c.classId?.toLowerCase()) as string;
        if (key) existingMap.set(key, c);
      }

      let created = 0, updated = 0, skipped = 0;
      const reasons: string[] = [];

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const classIdRaw = String(r['classId'] ?? r['ClassId'] ?? '').trim(); // may be empty → create new
        const name = String(r['name'] ?? r['Name'] ?? '').trim();
        const location = String(r['location'] ?? r['Location'] ?? '').trim();

        if (!name || !location) {
          skipped++; reasons.push(`Row ${i + 2}: missing name/location`);
          continue;
        }

        // If classId provided → upsert by classId; else → create with auto-generated id
        if (classIdRaw) {
          const key = classIdRaw.toLowerCase();
          const payload: any = { classId: classIdRaw, classIdLower: key, name, location };
          const existing = existingMap.get(key);
          if (existing) {
            await updateDoc(doc(db, 'classes', existing.id), payload);
            updated++;
          } else {
            await addDoc(collection(db, 'classes'), { ...payload, createdAt: serverTimestamp() });
            created++;
          }
        } else {
          const generated = await generateUniqueClassId();
          await addDoc(collection(db, 'classes'), {
            classId: generated,
            classIdLower: generated.toLowerCase(),
            name, location, createdAt: serverTimestamp(),
          });
          created++;
        }
      }

      showToastFn(setToast, 'success', t('classes:toasts.importDone', { created, updated, skipped }));
      if (reasons.length) console.warn('Classes import skipped:', reasons.join('\n'));
    } catch (err: any) {
      console.error(err);
      showToastFn(setToast, 'error', t('classes:toasts.importFail', { msg: err?.message || 'unknown' }));
    } finally {
      setBusyImport(false);
    }
  }

  // --------------- Render ---------------
  return (
    <div className={styles.wrapper}>
      {/* Toast */}
      {toast.show && (
        <div className={[
          styles.toast,
          toast.kind === 'success' ? styles.toastSuccess : toast.kind === 'info' ? styles.toastInfo : styles.toastError
        ].join(' ')} role="status" aria-live="polite">{toast.message}</div>
      )}

      <div className={styles.actionBar}>
        <h2 className="text-xl font-semibold text-white">{t('classes:manage')}</h2>
        <div className="flex gap-2">
          <button onClick={downloadTemplate} className={styles.btn}>{t('common:downloadTemplate')}</button>
          <button onClick={exportItems} className={styles.btn}>{t('common:export')}</button>
          <button onClick={openFilePicker} disabled={busyImport} className={`${styles.btn} ${styles.btnPrimary}`}>
            {busyImport ? t('classes:adding') : t('common:import')}
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

      {/* Create form (no ClassID field) */}
      <form onSubmit={createItem} className={`${styles.panel} grid grid-cols-1 md:grid-cols-4 gap-3 p-4`}>
        <input
          type="text" placeholder={t('classes:location')!} value={form.location}
          onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
          className={styles.input} autoComplete="off"
        />
        <input
          type="text" placeholder={t('classes:name')!} value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          className={styles.input} autoComplete="off"
        />
        <div className="md:col-span-1 flex items-stretch">
          <button type="submit" disabled={!canCreate || submitting} className={`${styles.btn} ${styles.btnPrimary}`}>
            {submitting ? t('classes:adding') : t('classes:add')}
          </button>
        </div>
      </form>

      {/* List */}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t('classes:table.classId')}</th>
              <th>{t('classes:table.location')}</th>
              <th>{t('classes:table.name')}</th>
              <th className="w-48">{t('common:actions')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id}>
                <td>{c.classId}</td>
                <td>{c.location}</td>
                <td>{c.name}</td>
                <td>
                  <div className="flex gap-2">
                    <button onClick={() => openEdit(c)} className={styles.btn}>{t('common:edit')}</button>
                    <button onClick={() => removeItem(c.id)} className={`${styles.btn} ${styles.btnDanger}`}>{t('common:delete')}</button>
                  </div>
                </td>
              </tr>
            ))}
            {!items.length && (
              <tr><td colSpan={4} style={{ color: 'var(--sb-muted)', padding: '1rem' }}>{t('common:noItems')}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Edit modal */}
      {edit.open && (
        <div className={styles.modalScrim} onClick={(e) => { if (e.target === e.currentTarget) closeEdit(); }}>
          <div className={styles.modalCard}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-white">{t('classes:editTitle')}</h3>
              <button className={styles.btn} onClick={closeEdit} aria-label={t('common:close')!}>✕</button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="md:col-span-2">
                <label className="block text-sm text-neutral-300 mb-1">{t('classes:classId')}</label>
                <div className="flex gap-2">
                  <input
                    type="text" value={edit.classId}
                    onChange={(e) => setEdit((prev) => (prev.open ? { ...prev, classId: e.target.value } : prev))}
                    className={styles.input}
                  />
                  <button type="button" onClick={regenerateEditId} className={styles.btn} title={t('common:regenerate')!}>
                    {t('common:regenerate')}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm text-neutral-300 mb-1">{t('classes:location')}</label>
                <input
                  type="text" value={edit.location}
                  onChange={(e) => setEdit((prev) => (prev.open ? { ...prev, location: e.target.value } : prev))}
                  className={styles.input}
                />
              </div>

              <div>
                <label className="block text-sm text-neutral-300 mb-1">{t('classes:name')}</label>
                <input
                  type="text" value={edit.name}
                  onChange={(e) => setEdit((prev) => (prev.open ? { ...prev, name: e.target.value } : prev))}
                  className={styles.input}
                />
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button onClick={closeEdit} className={styles.btn}>{t('common:cancel')}</button>
              <button onClick={saveEdit} disabled={saving} className={`${styles.btn} ${styles.btnPrimary}`}>
                {saving ? t('common:saving') : t('common:saveChanges')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
