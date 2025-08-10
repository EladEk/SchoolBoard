import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { doc, getDoc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { auth, db } from '../firebase/app';
import styles from './SignupPage.module.css';

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
      const data = snap.data()! as any;
      setEmail(data.email || '');
      setDisplayName(data.displayName || '');
      setRole((data.role as any) || 'teacher');
      if (data.tempPassword) setAdminPassword(data.tempPassword);
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

      await deleteDoc(doc(db, 'invites', token));

      // Route by role if you like; keeping /admin for now as before
      nav('/admin');
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.page}>
      <form onSubmit={doSignup} className={styles.card}>
        <h1 className={styles.title}>Create your account</h1>
        <p className={styles.subtitle}>Confirm your details and set a password.</p>

        <div className={`${styles.infoBox} ${styles.stackSm}`}>
          <div className={styles.infoRow}><span className={styles.infoKey}>Email:</span><span className={styles.infoVal}>{email || '—'}</span></div>
          <div className={styles.infoRow}><span className={styles.infoKey}>Name:</span><span className={styles.infoVal}>{displayName || '—'}</span></div>
          <div className={styles.infoRow}><span className={styles.infoKey}>Role:</span><span className={styles.infoVal}>{role}</span></div>
        </div>

        <div className={styles.form}>
          {!adminPassword && (
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Choose a password (min 6)"
              className={styles.input}
              autoComplete="new-password"
            />
          )}

          {adminPassword && (
            <div className={styles.hint}>
              Admin set an initial password for you. You’ll be able to change it later.
            </div>
          )}

          {err && <div className={styles.error}>{err}</div>}

          <button type="submit" disabled={busy || !email} className={styles.submitBtn}>
            {busy ? 'Creating…' : 'Create account'}
          </button>
        </div>
      </form>
    </div>
  );
}