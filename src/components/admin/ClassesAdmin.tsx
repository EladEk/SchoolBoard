import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  addDoc, collection, deleteDoc, doc, getDocs, onSnapshot, orderBy, query,
  serverTimestamp, updateDoc, where, writeBatch
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

/**
 * Rename propagation: update any denormalized class labels
 * in documents that *also* store the class name/label in addition to its id.
 * Safe to run even if those fields don't exist.
 */
async function propagateClassRename(
  classDocId: string,
  newName: string,
  newLocation?: string,
) {
  // Label used by some UIs
  const label = [newName || '', newLocation || ''].filter(Boolean).join(' · ');

  // 1) timetableEntries.className (most important)
  const qEntries = query(collection(db, 'timetableEntries'), where('classId', '==', classDocId));
  const snapEntries = await getDocs(qEntries);
  if (!snapEntries.empty) {
    let batch = writeBatch(db);
    let count = 0;
    for (const d of snapEntries.docs) {
      batch.update(d.ref, { className: label }); // harmless if field doesn't exist
      count++;
      if (count % 450 === 0) { await batch.commit(); batch = writeBatch(db); }
    }
    await batch.commit();
  }

  // 2) appUsers.className (homeroom cached on user – optional, if you use it)
  const qUsers = query(collection(db, 'appUsers'), where('classId', '==', classDocId));
  const snapUsers = await getDocs(qUsers);
  if (!snapUsers.empty) {
    let batch = writeBatch(db);
    let count = 0;
    for (const d of snapUsers.docs) {
      batch.update(d.ref, { className: label }); // harmless if not used
      count++;
      if (count % 450 === 0) { await batch.commit(); batch = writeBatch(db); }
    }
    await batch.commit();
  }
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

      // keep any denormalized copies fresh
      await propagateClassRename(id, name, location);

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
            // Propagate rename on import update as well
            await propagateClassRename(existing.id, name, location);
            updated++;
          } else {
            const ref = await addDoc(collection(db, 'classes'), { ...payload, createdAt: serverTimestamp() });
            await propagateClassRename(ref.id, name, location);
            created++;
          }
        } else {
          const generated = await generateUniqueClassId();
          const ref = await addDoc(collection(db, 'classes'), {
            classId: generated,
            classIdLower: generated.toLowerCase(),
            name, location, createdAt: serverTimestamp(),
          });
          await propagateClassRename(ref.id, name, location);
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

  // --------------- UI ---------------
  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <h2>{t('classes:title', 'Classes')}</h2>
      </header>

      <section className={styles.card}>
        <h3 className={styles.cardTitle}>{t('classes:new', 'Create Class')}</h3>
        <form onSubmit={createItem} className={styles.form}>
          <input
            className={styles.input}
            placeholder={t('classes:name', 'Class name')!}
            value={form.name}
            onChange={e => setForm(v => ({ ...v, name: e.target.value }))}
          />
          <input
            className={styles.input}
            placeholder={t('classes:location', 'Location')!}
            value={form.location}
            onChange={e => setForm(v => ({ ...v, location: e.target.value }))}
          />
          <button className={styles.btn} disabled={!canCreate || submitting}>
            {t('common:create', 'Create')}
          </button>
        </form>
      </section>

      <section className={styles.card}>
        <div className={styles.cardTitleRow}>
          <h3 className={styles.cardTitle}>{t('classes:list', 'All Classes')}</h3>
          <div className={styles.actions}>
            <button className={styles.btnSecondary} onClick={downloadTemplate}>{t('common:template', 'Template')}</button>
            <button className={styles.btnSecondary} onClick={exportItems}>{t('common:export', 'Export')}</button>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" hidden onChange={handleImportFile} />
            <button className={styles.btnSecondary} onClick={() => fileInputRef.current?.click()} disabled={busyImport}>
              {busyImport ? t('common:importing','Importing...') : t('common:import','Import')}
            </button>
          </div>
        </div>

        <table className={styles.table}>
          <thead>
            <tr>
              <th>{t('classes:table.classId', 'Class ID')}</th>
              <th>{t('classes:table.name', 'Name')}</th>
              <th>{t('classes:table.location', 'Location')}</th>
              <th style={{width:180}}>{t('common:actions', 'Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map(row => (
              <tr key={row.id}>
                <td>{row.classId}</td>
                <td>{row.name}</td>
                <td>{row.location}</td>
                <td style={{ display:'flex', gap:6, justifyContent:'flex-end' }}>
                  <button className={styles.btnSmall} onClick={() => openEdit(row)}>{t('common:edit','Edit')}</button>
                  <button className={styles.btnSmallDanger} onClick={() => removeItem(row.id)}>{t('common:delete','Delete')}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {edit.open && (
        <div className={styles.modalScrim} onClick={closeEdit}>
          <div
            className={styles.modalCard}
            onClick={e => e.stopPropagation()}
          >
            <h3 className={styles.cardTitle}>{t('classes:editTitle','Edit Class')}</h3>
            <label className={styles.label}>{t('classes:classId','Class ID')}</label>
            <div className={styles.row}>
              <input className={styles.input} value={edit.classId} onChange={e => setEdit(prev => prev.open ? { ...prev, classId:e.target.value } : prev)} />
              <button className={styles.btnSecondary} onClick={regenerateEditId}>{t('classes:regen','Regenerate')}</button>
            </div>

            <label className={styles.label}>{t('classes:name','Name')}</label>
            <input className={styles.input} value={edit.name} onChange={e => setEdit(prev => prev.open ? { ...prev, name:e.target.value } : prev)} />

            <label className={styles.label}>{t('classes:location','Location')}</label>
            <input className={styles.input} value={edit.location} onChange={e => setEdit(prev => prev.open ? { ...prev, location:e.target.value } : prev)} />

            <div className={styles.modalActions}>
              <button className={styles.btn} onClick={saveEdit} disabled={saving}>{t('common:save','Save')}</button>
              <button className={styles.btnSecondary} onClick={closeEdit}>{t('common:cancel','Cancel')}</button>
            </div>
          </div>
        </div>
      )}

      {toast.show && <div className={styles.toast}>{toast.message}</div>}
    </div>
  );
}
