// src/pages/LoginPage.tsx
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { auth, db } from '../firebase/app';
import {
  signInWithEmailAndPassword,
  getIdTokenResult,
  signOut,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
} from 'firebase/firestore';

import * as bcrypt from 'bcryptjs'; // ensure: npm i bcryptjs
import { useTranslation } from 'react-i18next';
import styles from './LoginPage.module.css';

type Role = 'admin' | 'teacher' | 'student' | 'kiosk';

function isEmail(v: string) {
  return /\S+@\S+\.\S+/.test(v);
}
function normalizeRole(v: unknown): Role | '' {
  if (typeof v !== 'string') return '';
  const r = v.trim().toLowerCase();
  return (['admin', 'teacher', 'student', 'kiosk'] as const).includes(r as Role) ? (r as Role) : '';
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

/* ---------- Role resolution helpers ---------- */

async function resolveRoleFromCollection(
  coll: 'appUsers' | 'users',
  ident: { uid?: string; email?: string; usernameLower?: string }
): Promise<Role | ''> {
  const { uid, email, usernameLower } = ident;

  // 1) by doc id
  if (uid) {
    try {
      const s = await getDoc(doc(db, coll, uid));
      if (s.exists()) {
        const d = s.data() as any;
        const role =
          normalizeRole(d?.role) ||
          (coll === 'users' && d?.isAdmin ? 'admin' : '');
        if (role) return role;
      }
    } catch {}
  }

  // 2) by uid field
  if (uid) {
    try {
      const q1 = query(collection(db, coll), where('uid', '==', uid), limit(1));
      const s1 = await getDocs(q1);
      if (!s1.empty) {
        const d = s1.docs[0].data() as any;
        const role =
          normalizeRole(d?.role) ||
          (coll === 'users' && d?.isAdmin ? 'admin' : '');
        if (role) return role;
      }
    } catch {}
  }

  // 3) by email field
  if (email) {
    try {
      const q2 = query(collection(db, coll), where('email', '==', email), limit(1));
      const s2 = await getDocs(q2);
      if (!s2.empty) {
        const d = s2.docs[0].data() as any;
        const role =
          normalizeRole(d?.role) ||
          (coll === 'users' && d?.isAdmin ? 'admin' : '');
        if (role) return role;
      }
    } catch {}
  }

  // 4) by usernameLower (for custom usernames)
  if (usernameLower) {
    try {
      const q3 = query(collection(db, coll), where('usernameLower', '==', usernameLower), limit(1));
      const s3 = await getDocs(q3);
      if (!s3.empty) {
        const d = s3.docs[0].data() as any;
        const role =
          normalizeRole(d?.role) ||
          (coll === 'users' && d?.isAdmin ? 'admin' : '');
        if (role) return role;
      }
    } catch {}
  }

  return '';
}

async function resolveRole(ident: { uid?: string; email?: string; usernameLower?: string }): Promise<Role | ''> {
  const r1 = await resolveRoleFromCollection('appUsers', ident);
  if (r1) return r1;
  return resolveRoleFromCollection('users', ident);
}

/* ---------- Custom-auth (username) lookup ---------- */

async function findAppUserByIdentifier(identifierRaw: string) {
  const identifier = identifierRaw.trim();
  const lower = identifier.toLowerCase();

  // usernameLower
  let snap = await getDocs(query(collection(db, 'appUsers'), where('usernameLower', '==', lower), limit(1)));
  if (!snap.empty) return snap.docs[0];

  // username (exact)
  snap = await getDocs(query(collection(db, 'appUsers'), where('username', '==', identifier), limit(1)));
  if (!snap.empty) return snap.docs[0];

  // displayNameLower
  snap = await getDocs(query(collection(db, 'appUsers'), where('displayNameLower', '==', lower), limit(1)));
  if (!snap.empty) return snap.docs[0];

  // email (only if input is email)
  if (isEmail(identifier)) {
    snap = await getDocs(query(collection(db, 'appUsers'), where('email', '==', identifier), limit(1)));
    if (!snap.empty) return snap.docs[0];
  }

  return null;
}

/* ---------- Component ---------- */

export default function LoginPage() {
  const { t } = useTranslation('login');
  const navigate = useNavigate();
  const [idOrEmail, setIdOrEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = useMemo(
    () => idOrEmail.trim().length > 0 && password.length > 0 && !submitting,
    [idOrEmail, password, submitting]
  );

  async function routeByRole(role: Role) {
    switch (role) {
      case 'admin':   navigate('/admin'); break;
      case 'teacher': navigate('/teacher'); break;
      case 'student': navigate('/student'); break;
      case 'kiosk':   navigate('/display'); break;
      default:        navigate('/unauthorized'); break;
    }
  }

  /* ----- Email (Firebase Auth) flow ----- */
  async function loginWithEmail(email: string, pass: string) {
    const cred = await signInWithEmailAndPassword(auth, email, pass);

    // Prefer custom claims for role (force refresh so we don't reuse stale claims)
    let role: Role | '' = '';
    try {
      const tok = await getIdTokenResult(cred.user, true);
      role = normalizeRole(tok.claims?.role);
    } catch {}

    // Fallback: resolve role from Firestore
    if (!role) {
      role = await resolveRole({ uid: cred.user.uid, email });
      if (!role) throw new Error(t('errors.noRole', 'No role found for this user. Ask admin to set role or claims.'));
    }

    // Save minimal session (no role; guards verify from DB/claims)
    const session = {
      uid: cred.user.uid,
      email: cred.user.email || email,
      displayName: cred.user.displayName || email,
      loggedInAt: Date.now(),
      mode: 'firebase-auth' as const,
    };
    localStorage.setItem('session', JSON.stringify(session));

    await routeByRole(role);
  }

  /* ----- Username (custom Firestore) flow ----- */
  async function loginWithUsername(identifier: string, pass: string) {
    const docRef = await findAppUserByIdentifier(identifier);
    if (!docRef) throw new Error(t('errors.userNotFound', 'User not found'));

    const data = docRef.data() as any;
    const storedHash: string | undefined = data.passwordHash;
    const storedSalt: string | undefined = data.salt;

    if (!storedHash) throw new Error(t('errors.missingPassword', 'User record missing password'));

    let ok = false;
    if (isBcryptHash(storedHash)) {
      ok = bcrypt.compareSync(pass, storedHash);
    } else {
      // legacy SHA-256(salt + password)
      const candidate = await sha256Hex((storedSalt || '') + pass);
      ok = candidate === storedHash;
    }
    if (!ok) throw new Error(t('errors.wrongPassword', 'Wrong password'));

    // Build session — include appUsers doc id and usernameLower
    const session = {
      uid: docRef.id, // <-- appUsers document id
      email: data.email || undefined,
      username: data.username || undefined,
      usernameLower: (data.usernameLower || data.username || '').toString().toLowerCase() || undefined,
      displayName:
        data.displayName ||
        data.username ||
        `${data.firstName ?? ''} ${data.lastName ?? ''}`.trim() ||
        identifier,
      loggedInAt: Date.now(),
      mode: 'custom-firestore' as const,
    };
    localStorage.setItem('session', JSON.stringify(session));

    // Resolve role from DB (appUsers → users) using uid/email/usernameLower
    const role = await resolveRole({
      uid: session.uid,
      email: session.email,
      usernameLower: session.usernameLower,
    });
    if (!role) throw new Error(t('errors.noRole', 'No role found for this user. Ask admin to set role.'));

    await routeByRole(role);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Clean start for every login attempt (prevents sticky sessions)
    try { await signOut(auth); } catch {}
    localStorage.clear();

    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);

    try {
      const input = idOrEmail.trim();
      if (isEmail(input)) {
        await loginWithEmail(input, password);
      } else {
        await loginWithUsername(input, password);
      }
    } catch (err: any) {
      console.error('Login error:', err);
      setError(err?.message || t('errors.generic', 'Login failed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.page}>
      <form onSubmit={handleSubmit} className={styles.card} aria-label={t('aria.form', 'Login form')}>
        <h1 className={styles.title}>{t('title', 'Sign in')}</h1>
        <p className={styles.subtitle}>{t('subtitle', 'Use email (Firebase) or username (custom)')}</p>

        <div className={styles.form}>
          <div>
            <label className={styles.label} htmlFor="login-identifier">
              {t('fields.identifier.label', 'Email or Username')}
            </label>
            <input
              id="login-identifier"
              type="text"
              value={idOrEmail}
              onChange={(e) => setIdOrEmail(e.target.value)}
              className={styles.input}
              autoComplete="username"
              placeholder={t('fields.identifier.placeholder', 'e.g. eladek@gmail.com or davidco')}
              aria-required="true"
            />
          </div>

          <div>
            <label className={styles.label} htmlFor="login-password">
              {t('fields.password.label', 'Password')}
            </label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={styles.input}
              autoComplete="current-password"
              placeholder={t('fields.password.placeholder', 'Your password')}
              aria-required="true"
            />
          </div>

          {error && <div className={styles.error} role="alert">{error}</div>}

          <button
            type="submit"
            disabled={!canSubmit}
            className={styles.submitBtn}
            aria-label={t('actions.signIn', 'Sign in')}
          >
            {submitting ? t('states.signingIn', 'Signing in…') : t('actions.signIn', 'Sign in')}
          </button>
        </div>
      </form>
    </div>
  );
}
