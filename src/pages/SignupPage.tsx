import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { doc, getDoc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { auth, db } from '../firebase/app';

export default function SignupPage() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const token = params.get('token') ?? '';

  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<'admin'|'teacher'|'student'|'kiosk'>('teacher');
  const [password, setPassword] = useState('');            // user-entered fallback
  const [adminPassword, setAdminPassword] = useState('');  // from invite (optional)
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string|null>(null);

  useEffect(() => {
    (async () => {
      if (!token) { setErr('Missing token'); return; }
      const snap = await getDoc(doc(db, 'invites', token));
      if (!snap.exists()) { setErr('Invalid or used token'); return; }
      const data = snap.data()!;
      setEmail(data.email);
      setDisplayName(data.displayName);
      setRole(data.role);
      if (data.tempPassword) setAdminPassword(data.tempPassword); // admin-specified password
    })();
  }, [token]);

  const doSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      setBusy(true);
      const pass = adminPassword || password;
      if (!pass || pass.length < 6) { setErr('Password must be at least 6 characters'); setBusy(false); return; }

      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      if (displayName) await updateProfile(cred.user, { displayName });

      await setDoc(doc(db, 'users', cred.user.uid), {
        id: cred.user.uid,
        uid: cred.user.uid,
        email,
        displayName,
        role,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }, { merge: true });

      await deleteDoc(doc(db, 'invites', token)); // one-time use

      nav('/admin'); // or wherever
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center p-6">
      <form onSubmit={doSignup} className="w-full max-w-md space-y-4 bg-neutral-900 border border-neutral-800 rounded-2xl p-6">
        <h1 className="text-xl font-semibold">Create your account</h1>

        <div className="text-sm text-neutral-400">
          <div><b>Email:</b> {email || '—'}</div>
          <div><b>Name:</b> {displayName || '—'}</div>
          <div><b>Role:</b> {role}</div>
        </div>

        {!adminPassword && (
          <input
            type="password" value={password} onChange={e => setPassword(e.target.value)}
            placeholder="Choose a password (min 6)"
            className="w-full px-3 py-2 rounded-xl bg-neutral-800 border border-neutral-700"
          />
        )}
        {adminPassword && (
          <div className="text-sm text-neutral-400">
            Admin set an initial password for you. You’ll be able to change it later.
          </div>
        )}

        {err && <div className="text-sm text-red-400">{err}</div>}
        <button type="submit" disabled={busy || !email} className="w-full px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60">
          {busy ? 'Creating…' : 'Create account'}
        </button>
      </form>
    </div>
  );
}
