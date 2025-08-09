import React, { useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '../../firebase/app';

// ---------------- Types ----------------
type ToastState =
  | { show: false }
  | { show: true; kind: 'success' | 'error'; message: string };

type ClassItem = {
  id: string;            // Firestore doc id
  classId: string;       // Business ID (unique)
  classIdLower?: string; // for duplicate checks
  location: string;
  name: string;
  createdAt?: any;
};

type EditState =
  | { open: false }
  | {
      open: true;
      id: string;        // doc id
      classId: string;
      location: string;
      name: string;
    };

// ---------------- Helpers ----------------
function normId(v: string) {
  return v.trim().toLowerCase();
}

function generateClassId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `CLS-${code}`;
}

async function generateUniqueClassId(): Promise<string> {
  // Keep trying until a unique ID is found
  // (collision chance is already tiny, but we enforce correctness)
  // NOTE: This is sequential async checks; fine for admin UI scale.
  // If you need bulk, we’d do a batched approach/transaction.
  while (true) {
    const candidate = generateClassId();
    const dup = await getDocs(
      query(collection(db, 'classes'), where('classIdLower', '==', candidate.toLowerCase()))
    );
    if (dup.empty) return candidate;
  }
}

// ---------------- Component ----------------
export default function ClassesAdmin() {
  const [items, setItems] = useState<ClassItem[]>([]);
  const [toast, setToast] = useState<ToastState>({ show: false });

  // Create form (no ClassID input — it’s auto-generated)
  const [form, setForm] = useState({
    location: '',
    name: '',
  });
  const [submitting, setSubmitting] = useState(false);

  // Edit modal
  const [edit, setEdit] = useState<EditState>({ open: false });
  const [saving, setSaving] = useState(false);

  // Live list
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'classes'), orderBy('classId')),
      (snap) => {
        const arr = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as ClassItem[];
        setItems(arr);
      },
      (err) => showToast('error', `Failed to load classes: ${err.message}`)
    );
    return () => unsub();
  }, []);

  const canCreate = useMemo(() => {
    return form.location.trim().length > 0 && form.name.trim().length > 0;
  }, [form]);

  function showToast(kind: 'success' | 'error', message: string) {
    setToast({ show: true, kind, message });
    setTimeout(() => setToast({ show: false }), 2500);
  }

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
      showToast('success', `Class "${classId}" created`);
    } catch (err: any) {
      showToast('error', `Create failed: ${err?.message || 'unknown error'}`);
    } finally {
      setSubmitting(false);
    }
  }

  // --------------- Edit / Save ---------------
  function openEdit(row: ClassItem) {
    setEdit({
      open: true,
      id: row.id,
      classId: row.classId,
      location: row.location,
      name: row.name,
    });
  }

  function closeEdit() {
    setEdit({ open: false });
  }

  async function regenerateEditId() {
    if (!('open' in edit) || !edit.open) return;
    const newId = await generateUniqueClassId();
    setEdit((prev) => (prev.open ? { ...prev, classId: newId } : prev));
  }

  async function saveEdit() {
    if (!('open' in edit) || !edit.open) return;

    const id = edit.id;
    const classId = edit.classId.trim();
    const location = edit.location.trim();
    const name = edit.name.trim();

    if (!classId || !location || !name) {
      showToast('error', 'All fields are required');
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
        showToast('error', `Another class with ClassID "${classId}" already exists`);
        return;
      }

      await updateDoc(doc(db, 'classes', id), {
        classId,
        classIdLower,
        location,
        name,
      });

      showToast('success', `Class "${classId}" updated`);
      closeEdit();
    } catch (err: any) {
      showToast('error', `Update failed: ${err?.message || 'unknown error'}`);
    } finally {
      setSaving(false);
    }
  }

  // --------------- Delete ---------------
  async function removeItem(id: string) {
    try {
      await deleteDoc(doc(db, 'classes', id));
      showToast('success', 'Class deleted');
    } catch (err: any) {
      showToast('error', `Delete failed: ${err?.message || 'unknown error'}`);
    }
  }

  // --------------- Render ---------------
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

      {/* Create form (no ClassID field) */}
      <form
        onSubmit={createItem}
        className="grid grid-cols-1 md:grid-cols-4 gap-3 bg-neutral-900/60 p-4 rounded-xl border border-neutral-800"
      >
        <input
          type="text"
          placeholder="Class Location"
          value={form.location}
          onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
          className="px-3 py-2 rounded-xl bg-neutral-800 border border-neutral-700 text-white"
          autoComplete="off"
        />
        <input
          type="text"
          placeholder="Class Name"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          className="px-3 py-2 rounded-xl bg-neutral-800 border border-neutral-700 text-white"
          autoComplete="off"
        />
        <div className="md:col-span-1 flex items-stretch">
          <button
            type="submit"
            disabled={!canCreate || submitting}
            className={[
              'w-full px-3 py-2 rounded-xl text-white transition',
              canCreate && !submitting ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-neutral-700 cursor-not-allowed',
            ].join(' ')}
          >
            {submitting ? 'Adding…' : 'Add class'}
          </button>
        </div>
      </form>

      {/* List */}
      <div className="bg-neutral-900/60 rounded-xl border border-neutral-800 overflow-hidden">
        <table className="w-full text-left text-white">
          <thead className="bg-neutral-800/80">
            <tr>
              <th className="px-3 py-2 font-medium">ClassID</th>
              <th className="px-3 py-2 font-medium">Class Location</th>
              <th className="px-3 py-2 font-medium">Class Name</th>
              <th className="px-3 py-2 font-medium w-48">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id} className="odd:bg-neutral-900 even:bg-neutral-900/40">
                <td className="px-3 py-2">{c.classId}</td>
                <td className="px-3 py-2">{c.location}</td>
                <td className="px-3 py-2">{c.name}</td>
                <td className="px-3 py-2 space-x-2">
                  <button
                    onClick={() => openEdit(c)}
                    className="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => removeItem(c.id)}
                    className="px-2 py-1 rounded bg-red-600 hover:bg-red-500"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {!items.length && (
              <tr>
                <td className="px-3 py-6 text-neutral-400" colSpan={4}>
                  No classes
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
          <div className="w-full max-w-lg bg-neutral-900 border border-neutral-800 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-white">Edit class</h3>
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
                <label className="block text-sm text-neutral-300 mb-1">ClassID</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={edit.classId}
                    onChange={(e) =>
                      setEdit((prev) => (prev.open ? { ...prev, classId: e.target.value } : prev))
                    }
                    className="w-full px-3 py-2 rounded-xl bg-neutral-800 border border-neutral-700 text-white"
                  />
                  <button
                    type="button"
                    onClick={regenerateEditId}
                    className="px-3 py-2 rounded-xl bg-neutral-800 border border-neutral-700 hover:bg-neutral-700"
                    title="Generate a new random ID"
                  >
                    Regenerate
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm text-neutral-300 mb-1">Class Location</label>
                <input
                  type="text"
                  value={edit.location}
                  onChange={(e) =>
                    setEdit((prev) => (prev.open ? { ...prev, location: e.target.value } : prev))
                  }
                  className="w-full px-3 py-2 rounded-xl bg-neutral-800 border border-neutral-700 text-white"
                />
              </div>

              <div>
                <label className="block text-sm text-neutral-300 mb-1">Class Name</label>
                <input
                  type="text"
                  value={edit.name}
                  onChange={(e) =>
                    setEdit((prev) => (prev.open ? { ...prev, name: e.target.value } : prev))
                  }
                  className="w-full px-3 py-2 rounded-xl bg-neutral-800 border border-neutral-700 text-white"
                />
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
                disabled={saving}
                className={[
                  'px-3 py-2 rounded-xl text-white transition',
                  saving ? 'bg-neutral-700' : 'bg-emerald-600 hover:bg-emerald-500',
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
