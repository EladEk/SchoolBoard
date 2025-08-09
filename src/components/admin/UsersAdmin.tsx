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
import * as bcrypt from 'bcryptjs';

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

const ROLES: Role[] = ['admin', 'teacher', 'student', 'kiosk'];

type ToastState =
  | { show: false }
  | { show: true; kind: 'success' | 'error'; message: string };

type EditState =
  | { open: false }
  | {
      open: true;
      id: string;
      firstName: string;
      lastName: string;
      username: string;
      role: Role;
      newPassword: string; // optional
    };

export default function UsersAdmin() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [toast, setToast] = useState<ToastState>({ show: false });

  // Create form
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    username: '',
    password: '',
    role: 'teacher' as Role,
  });
  const [submitting, setSubmitting] = useState(false);

  // Edit modal state
  const [edit, setEdit] = useState<EditState>({ open: false });
  const [savingEdit, setSavingEdit] = useState(false);

  // live users list
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'appUsers'), orderBy('username')),
      (snap) => {
        setUsers(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
      },
      (err) => {
        showToast('error', `Failed to load users: ${err.message}`);
      },
    );
    return () => unsub();
  }, []);

  const canCreate = useMemo(() => {
    return (
      form.username.trim().length > 0 &&
      form.password.trim().length > 0 &&
      form.firstName.trim().length + form.lastName.trim().length > 0
    );
  }, [form.username, form.password, form.firstName, form.lastName]);

  function showToast(kind: 'success' | 'error', message: string) {
    setToast({ show: true, kind, message });
    setTimeout(() => setToast({ show: false }), 2500);
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

      // prevent duplicates on usernameLower
      const dupSnap = await getDocs(
        query(collection(db, 'appUsers'), where('usernameLower', '==', usernameLower))
      );
      if (!dupSnap.empty) {
        showToast('error', `Username "${username}" already exists`);
        return;
      }

      const salt = bcrypt.genSaltSync(10);
      const passwordHash = bcrypt.hashSync(form.password, salt);

      await addDoc(collection(db, 'appUsers'), {
        firstName,
        lastName,
        username,
        usernameLower,
        role: form.role,
        salt,
        passwordHash,
        createdAt: serverTimestamp(),
      });

      setForm({ firstName: '', lastName: '', username: '', password: '', role: 'teacher' });
      showToast('success', `User "${username}" created`);
    } catch (err: any) {
      showToast('error', `Create failed: ${err?.message || 'unknown error'}`);
    } finally {
      setSubmitting(false);
    }
  }

  function openEdit(u: AppUser) {
    setEdit({
      open: true,
      id: u.id,
      firstName: u.firstName || '',
      lastName: u.lastName || '',
      username: u.username || '',
      role: u.role,
      newPassword: '',
    });
  }

  function closeEdit() {
    setEdit({ open: false });
  }

  async function saveEdit() {
    if (!('open' in edit) || !edit.open) return;

    const id = edit.id;
    const firstName = edit.firstName.trim();
    const lastName = edit.lastName.trim();
    const username = edit.username.trim();
    const usernameLower = username.toLowerCase();

    if (!username) {
      showToast('error', 'Username is required');
      return;
    }
    if ((firstName + lastName).length === 0) {
      showToast('error', 'First/Last name cannot both be empty');
      return;
    }

    try {
      setSavingEdit(true);

      // Duplicate username check excluding current id
      const dup = await getDocs(
        query(collection(db, 'appUsers'), where('usernameLower', '==', usernameLower))
      );
      const dupExists = dup.docs.some((d) => d.id !== id);
      if (dupExists) {
        showToast('error', `Another user with username "${username}" already exists`);
        return;
      }

      const updatePayload: any = {
        firstName,
        lastName,
        username,
        usernameLower,
        role: edit.role,
      };

      if (edit.newPassword && edit.newPassword.trim().length > 0) {
        const salt = bcrypt.genSaltSync(10);
        const passwordHash = bcrypt.hashSync(edit.newPassword.trim(), salt);
        updatePayload.salt = salt;
        updatePayload.passwordHash = passwordHash;
      }

      await updateDoc(doc(db, 'appUsers', id), updatePayload);
      showToast('success', `User "${username}" updated`);
      closeEdit();
    } catch (err: any) {
      showToast('error', `Update failed: ${err?.message || 'unknown error'}`);
    } finally {
      setSavingEdit(false);
    }
  }

  async function removeUser(id: string) {
    try {
      await deleteDoc(doc(db, 'appUsers', id));
      showToast('success', 'User deleted');
    } catch (err: any) {
      showToast('error', `Delete failed: ${err?.message || 'unknown error'}`);
    }
  }

  return (
    <div className="p-4 space-y-6">
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

      <h2 className="text-xl font-semibold text-white">Manage Users</h2>

      {/* Create User */}
      <form
        onSubmit={createUser}
        className="grid grid-cols-1 md:grid-cols-6 gap-3 bg-neutral-900/60 p-4 rounded-xl border border-neutral-800"
      >
        <input
          type="text"
          value={form.firstName}
          onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
          placeholder="First name"
          className="px-3 py-2 rounded-xl bg-neutral-800 border border-neutral-700 text-white"
          autoComplete="off"
        />
        <input
          type="text"
          value={form.lastName}
          onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
          placeholder="Last name"
          className="px-3 py-2 rounded-xl bg-neutral-800 border border-neutral-700 text-white"
          autoComplete="off"
        />
        <input
          type="text"
          value={form.username}
          onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
          placeholder="Username"
          className="px-3 py-2 rounded-xl bg-neutral-800 border border-neutral-700 text-white"
          autoComplete="username"
        />
        <input
          type="password"
          value={form.password}
          onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
          placeholder="Password"
          className="px-3 py-2 rounded-xl bg-neutral-800 border border-neutral-700 text-white"
          autoComplete="new-password"
        />
        <select
          value={form.role}
          onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as Role }))}
          className="px-3 py-2 rounded-xl bg-neutral-800 border border-neutral-700 text-white"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>

        <button
          type="submit"
          disabled={!canCreate || submitting}
          className={[
            'px-3 py-2 rounded-xl text-white transition',
            canCreate && !submitting ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-neutral-700 cursor-not-allowed',
          ].join(' ')}
        >
          {submitting ? 'Creating…' : 'Create user'}
        </button>
      </form>

      {/* Users table */}
      <div className="bg-neutral-900/60 rounded-xl border border-neutral-800 overflow-hidden">
        <table className="w-full text-left text-white">
          <thead className="bg-neutral-800/80">
            <tr>
              <th className="px-3 py-2 font-medium">Username</th>
              <th className="px-3 py-2 font-medium">First</th>
              <th className="px-3 py-2 font-medium">Last</th>
              <th className="px-3 py-2 font-medium">Role</th>
              <th className="px-3 py-2 font-medium w-48">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="odd:bg-neutral-900 even:bg-neutral-900/40">
                <td className="px-3 py-2">{u.username}</td>
                <td className="px-3 py-2">{u.firstName || ''}</td>
                <td className="px-3 py-2">{u.lastName || ''}</td>
                <td className="px-3 py-2">{u.role}</td>
                <td className="px-3 py-2 space-x-2">
                  <button
                    onClick={() => openEdit(u)}
                    className="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => removeUser(u.id)}
                    className="px-2 py-1 rounded bg-red-600 hover:bg-red-500"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {!users.length && (
              <tr>
                <td className="px-3 py-6 text-neutral-400" colSpan={5}>
                  No users
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Edit Modal */}
      {edit.open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeEdit();
          }}
        >
          <div className="w-full max-w-lg bg-neutral-900 border border-neutral-800 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-white">Edit user</h3>
              <button
                className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700"
                onClick={closeEdit}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-neutral-300 mb-1">First name</label>
                <input
                  type="text"
                  value={edit.firstName}
                  onChange={(e) =>
                    setEdit((prev) => (prev.open ? { ...prev, firstName: e.target.value } : prev))
                  }
                  className="w-full px-3 py-2 rounded-xl bg-neutral-800 border border-neutral-700 text-white"
                />
              </div>
              <div>
                <label className="block text-sm text-neutral-300 mb-1">Last name</label>
                <input
                  type="text"
                  value={edit.lastName}
                  onChange={(e) =>
                    setEdit((prev) => (prev.open ? { ...prev, lastName: e.target.value } : prev))
                  }
                  className="w-full px-3 py-2 rounded-xl bg-neutral-800 border border-neutral-700 text-white"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm text-neutral-300 mb-1">Username</label>
                <input
                  type="text"
                  value={edit.username}
                  onChange={(e) =>
                    setEdit((prev) => (prev.open ? { ...prev, username: e.target.value } : prev))
                  }
                  className="w-full px-3 py-2 rounded-xl bg-neutral-800 border border-neutral-700 text-white"
                />
              </div>
              <div>
                <label className="block text-sm text-neutral-300 mb-1">Role</label>
                <select
                  value={edit.role}
                  onChange={(e) =>
                    setEdit((prev) => (prev.open ? { ...prev, role: e.target.value as Role } : prev))
                  }
                  className="w-full px-3 py-2 rounded-xl bg-neutral-800 border border-neutral-700 text-white"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-neutral-300 mb-1">New password (optional)</label>
                <input
                  type="password"
                  value={edit.newPassword}
                  onChange={(e) =>
                    setEdit((prev) => (prev.open ? { ...prev, newPassword: e.target.value } : prev))
                  }
                  placeholder="Leave blank to keep current"
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
                disabled={savingEdit}
                className={[
                  'px-3 py-2 rounded-xl text-white transition',
                  savingEdit ? 'bg-neutral-700' : 'bg-emerald-600 hover:bg-emerald-500',
                ].join(' ')}
              >
                {savingEdit ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
