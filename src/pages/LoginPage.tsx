import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { db } from '../firebase/app';
import * as bcrypt from 'bcryptjs';

type Role = 'admin' | 'teacher' | 'student' | 'kiosk';

function isEmail(v: string) {
  return v.includes('@');
}
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

    // Old system stored roles under /users/{uid}
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

  async function findAppUserByName(nameRaw: string) {
    const nameLower = nameRaw.toLowerCase();

    // 1) Exact displayName
    let snap = await getDocs(
      query(collection(db, 'appUsers'), where('displayName', '==', nameRaw), limit(1))
    );
    if (!snap.empty) return snap.docs[0];

    // 2) Case-insensitive if you stored displayNameLower
    snap = await getDocs(
      query(collection(db, 'appUsers'), where('displayNameLower', '==', nameLower), limit(1))
    );
    if (!snap.empty) return snap.docs[0];

    return null;
  }

  async function loginWithCustomAuth(nameRaw: string, pass: string) {
    const docRef = await findAppUserByName(nameRaw);
    if (!docRef) throw new Error('User not found');

    const data = docRef.data() as any;
    const storedHash: string | undefined = data.passwordHash;
    const storedSalt: string | undefined = data.salt;

    if (!storedHash) throw new Error('User record missing password hash');

    let ok = false;
    if (isBcryptHash(storedHash)) {
      ok = bcrypt.compareSync(pass, storedHash);
    } else {
      // legacy SHA-256(salt + password) or SHA-256(password) if no salt
      const candidate = await sha256Hex((storedSalt || '') + pass);
      ok = candidate === storedHash;
    }
    if (!ok) throw new Error('Wrong password');

    const role: Role = (data.role || 'admin') as Role;
    const session = {
      uid: docRef.id,
      displayName: data.displayName || nameRaw,
      role,
      loggedInAt: Date.now(),
      mode: 'custom-firestore',
    };
    localStorage.setItem('session', JSON.stringify(session));

    // Redirect by role
    switch (role) {
      case 'admin':
        navigate('/admin'); break;
      case 'teacher':
        navigate('/teacher'); break;
      case 'student':
        navigate('/student'); break;
      case 'kiosk':
        navigate('/display'); break;
      default:
        navigate('/');
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
        // OLD WAY (Admin via Firebase Auth)
        await loginWithFirebaseAuth(input, password);
      } else {
        // NEW WAY (Custom Firestore appUsers)
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
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center p-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-neutral-900 border border-neutral-800 rounded-2xl p-6 space-y-4"
      >
        <h1 className="text-xl font-semibold">Sign in</h1>

        <div className="space-y-1">
          <label className="text-sm text-neutral-300">Display name or Admin email</label>
          <input
            type="text"
            value={displayNameOrEmail}
            onChange={(e) => setDisplayNameOrEmail(e.target.value)}
            className="w-full px-3 py-2 rounded-xl bg-neutral-800 border border-neutral-700 text-white"
            autoComplete="username"
            placeholder="e.g. elad / or admin email"
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm text-neutral-300">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 rounded-xl bg-neutral-800 border border-neutral-700 text-white"
            autoComplete="current-password"
          />
        </div>

        {error && (
          <div className="text-sm text-red-400 bg-red-950/40 border border-red-800 rounded-lg px-3 py-2" role="alert">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className={[
            'w-full px-3 py-2 rounded-xl transition text-white',
            canSubmit ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-neutral-700 cursor-not-allowed',
          ].join(' ')}
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
