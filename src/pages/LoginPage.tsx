import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { db } from '../firebase/app';
import * as bcrypt from 'bcryptjs';
import styles from './LoginPage.module.css';

type Role = 'admin' | 'teacher' | 'student' | 'kiosk';

function isEmail(v: string) { return v.includes('@'); }
function isBcryptHash(hash?: string) {
  if (!hash || typeof hash !== 'string') return false;
  return hash.startsWith('$2a$') || hash.startsWith('$2b$') || hash.startsWith('$2y$');
}
async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder();
  const data = enc.encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
}

export default function LoginPage() {
  const navigate = useNavigate();
  const [displayNameOrEmail, setDisplayNameOrEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = useMemo(
    () => displayNameOrEmail.trim().length > 0 && password.length > 0 && !submitting,
    [displayNameOrEmail, password, submitting]
  );

  async function loginWithFirebaseAuth(email: string, pass: string) {
    const auth = getAuth();
    const cred = await signInWithEmailAndPassword(auth, email, pass);
    const uid = cred.user.uid;

    const userDoc = await getDoc(doc(db, 'users', uid));
    if (!userDoc.exists()) {
      throw new Error('Admin profile not found under /users/{uid}');
    }
    const data = userDoc.data() as any;
    const role: Role = (data.role || 'admin') as Role;

    if (role !== 'admin') {
      throw new Error('This account is not an admin.');
    }

    const session = {
      uid,
      displayName: data.displayName || cred.user.displayName || email,
      email: cred.user.email || email,
      role,
      loggedInAt: Date.now(),
      mode: 'firebase-auth',
    };
    localStorage.setItem('session', JSON.stringify(session));
    navigate('/admin');
  }

  async function findAppUser(inputRaw: string) {
    const input = inputRaw.trim();
    const lower = input.toLowerCase();

    let snap = await getDocs(query(collection(db, 'appUsers'), where('username', '==', input), limit(1)));
    if (!snap.empty) return snap.docs[0];

    snap = await getDocs(query(collection(db, 'appUsers'), where('usernameLower', '==', lower), limit(1)));
    if (!snap.empty) return snap.docs[0];

    snap = await getDocs(query(collection(db, 'appUsers'), where('displayName', '==', input), limit(1)));
    if (!snap.empty) return snap.docs[0];

    snap = await getDocs(query(collection(db, 'appUsers'), where('displayNameLower', '==', lower), limit(1)));
    if (!snap.empty) return snap.docs[0];

    if (isEmail(input)) {
      snap = await getDocs(query(collection(db, 'appUsers'), where('email', '==', input), limit(1)));
      if (!snap.empty) return snap.docs[0];
    }
    return null;
  }

  async function loginWithCustomAuth(identifier: string, pass: string) {
    const docRef: any = await findAppUser(identifier);
    if (!docRef) throw new Error('User not found');

    const data = docRef.data() as any;
    const storedHash: string | undefined = data.passwordHash;
    const storedSalt: string | undefined = data.salt;

    if (!storedHash) throw new Error('User record missing password hash');

    let ok = false;
    if (isBcryptHash(storedHash)) {
      ok = bcrypt.compareSync(pass, storedHash);
    } else {
      const candidate = await sha256Hex((storedSalt || '') + pass);
      ok = candidate === storedHash;
    }
    if (!ok) throw new Error('Wrong password');

    const role: Role = (data.role || 'student') as Role;
    const session = {
      uid: docRef.id,
      displayName: data.displayName || data.username || `${data.firstName ?? ''} ${data.lastName ?? ''}`.trim() || identifier,
      role,
      loggedInAt: Date.now(),
      mode: 'custom-firestore',
    };
    localStorage.setItem('session', JSON.stringify(session));

    switch (role) {
      case 'admin': navigate('/admin'); break;
      case 'teacher': navigate('/teacher'); break;
      case 'student': navigate('/student'); break;
      case 'kiosk': navigate('/display'); break;
      default: navigate('/');
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);

    const input = displayNameOrEmail.trim();

    try {
      if (isEmail(input)) {
        await loginWithFirebaseAuth(input, password);
      } else {
        await loginWithCustomAuth(input, password);
      }
    } catch (err: any) {
      console.error('Login error:', err);
      setError(err?.message || 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.page}>
      <form onSubmit={handleSubmit} className={styles.card}>
        <h1 className={styles.title}>Sign in</h1>
        <p className={styles.subtitle}>Admins log in with email. Others can use username/display name.</p>

        <div className={styles.form}>
          <div>
            <label className={styles.label}>Username / Display name / Admin email</label>
            <input
              type="text"
              value={displayNameOrEmail}
              onChange={(e) => setDisplayNameOrEmail(e.target.value)}
              className={styles.input}
              autoComplete="username"
              placeholder="e.g. elad2 — or admin email"
            />
          </div>

          <div>
            <label className={styles.label}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={styles.input}
              autoComplete="current-password"
            />
          </div>

          {error && <div className={styles.error} role="alert">{error}</div>}

          <button type="submit" disabled={!canSubmit} className={styles.submitBtn}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
      </form>
    </div>
  );
}