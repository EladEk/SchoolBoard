// src/utils/requireRole.tsx
import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { auth, db } from '../firebase/app';
import { onAuthStateChanged, getIdTokenResult, User } from 'firebase/auth';
import {
  doc, getDoc, collection, query, where, limit, getDocs,
} from 'firebase/firestore';

export type Role = 'admin' | 'teacher' | 'student' | 'kiosk';

type Phase = 'checking' | 'allowed' | 'denied' | 'none';

function normalizeRole(v: unknown): Role | '' {
  if (typeof v !== 'string') return '';
  const r = v.trim().toLowerCase();
  return (['admin','teacher','student','kiosk'] as const).includes(r as Role) ? (r as Role) : '';
}

type Ident = { uid?: string; email?: string; usernameLower?: string };

function getSession():
  | { uid?: string; email?: string; username?: string; usernameLower?: string; mode?: 'custom-firestore'|'firebase-auth' }
  | null {
  try { return JSON.parse(localStorage.getItem('session') || 'null'); } catch { return null; }
}

/* ---------------- Core resolvers ---------------- */

async function roleFromCollection(
  coll: 'appUsers' | 'users',
  ident: Ident
): Promise<Role | ''> {
  const { uid, email, usernameLower } = ident;

  // 1) doc id
  if (uid) {
    try {
      const s = await getDoc(doc(db, coll, uid));
      if (s.exists()) {
        const d = s.data() as any;
        const role = normalizeRole(d?.role) || (coll === 'users' && d?.isAdmin ? 'admin' : '');
        if (role) return role;
      }
    } catch {}
  }

  // 2) uid field
  if (uid) {
    try {
      const q1 = query(collection(db, coll), where('uid', '==', uid), limit(1));
      const s1 = await getDocs(q1);
      if (!s1.empty) {
        const d = s1.docs[0].data() as any;
        const role = normalizeRole(d?.role) || (coll === 'users' && d?.isAdmin ? 'admin' : '');
        if (role) return role;
      }
    } catch {}
  }

  // 3) email field
  if (email) {
    try {
      const q2 = query(collection(db, coll), where('email', '==', email), limit(1));
      const s2 = await getDocs(q2);
      if (!s2.empty) {
        const d = s2.docs[0].data() as any;
        const role = normalizeRole(d?.role) || (coll === 'users' && d?.isAdmin ? 'admin' : '');
        if (role) return role;
      }
    } catch {}
  }

  // 4) usernameLower field (for custom usernames)
  if (usernameLower) {
    try {
      const q3 = query(collection(db, coll), where('usernameLower', '==', usernameLower), limit(1));
      const s3 = await getDocs(q3);
      if (!s3.empty) {
        const d = s3.docs[0].data() as any;
        const role = normalizeRole(d?.role) || (coll === 'users' && d?.isAdmin ? 'admin' : '');
        if (role) return role;
      }
    } catch {}
  }

  return '';
}

async function resolveRoleFromDB(ident: Ident): Promise<Role | ''> {
  // Prefer appUsers (custom accounts), then users (profiles/break-glass)
  const r1 = await roleFromCollection('appUsers', ident);
  if (r1) return r1;
  return roleFromCollection('users', ident);
}

async function resolveRoleForIdentity(ident: Ident, fbUser?: User | null): Promise<Role | ''> {
  // 0) Prefer Firebase custom claims for email users
  if (fbUser) {
    try {
      const tok = await getIdTokenResult(fbUser, true);
      const claimRole = normalizeRole(tok.claims?.role);
      if (claimRole) return claimRole;
    } catch {}
  }
  // 1) DB lookup
  return resolveRoleFromDB(ident);
}

/* ---------------- Hook ---------------- */

export function useEffectiveRole() {
  const [phase, setPhase] = useState<Phase>('checking');
  const [role, setRole] = useState<Role | ''>('');

  useEffect(() => {
    let alive = true;

    const off = onAuthStateChanged(auth, async (fbUser) => {
      try {
        // Build identity from Firebase user OR custom session
        const sess = getSession();
        const ident: Ident = {
          uid: fbUser?.uid || sess?.uid || undefined,
          email: fbUser?.email || sess?.email || undefined,
          usernameLower: (sess?.usernameLower || sess?.username || '')
            ? String(sess?.usernameLower || sess?.username).toLowerCase()
            : undefined,
        };

        if (!ident.uid && !ident.email && !ident.usernameLower) {
          if (!alive) return;
          setPhase('none');
          setRole('');
          return;
        }

        const r = await resolveRoleForIdentity(ident, fbUser);
        if (!alive) return;

        if (r) {
          setRole(r);
          setPhase('allowed'); // meaning: we have a role; caller will check allowed[] below
        } else {
          setRole('');
          setPhase('denied');
        }
      } catch (e) {
        console.error('[useEffectiveRole] error:', e);
        if (!alive) return;
        setRole('');
        setPhase('denied');
      }
    });

    return () => { alive = false; off(); };
  }, []);

  return { phase, role };
}

/* ---------------- Page/Route guards ---------------- */

export const RequireRole: React.FC<{ allowed: Role[]; children: React.ReactNode }> = ({
  allowed,
  children,
}) => {
  const { phase, role } = useEffectiveRole();

  if (phase === 'checking') {
    return <div style={{ color:'#fff', textAlign:'center', paddingTop:'20%' }}>Checking permissions…</div>;
  }
  if (phase === 'none') {
    return <Navigate to="/" replace />;
  }
  if (phase === 'denied' || !role || !allowed.includes(role)) {
    return <Navigate to="/unauthorized" replace />;
  }
  return <>{children}</>;
};

export function withRole<P>(Component: React.ComponentType<P>, allowed: Role[]) {
  const Wrapped: React.FC<P> = (props) => {
    const { phase, role } = useEffectiveRole();

    if (phase === 'checking') {
      return <div style={{ color:'#fff', textAlign:'center', paddingTop:'20%' }}>Checking permissions…</div>;
    }
    if (phase === 'none') {
      return <Navigate to="/" replace />;
    }
    if (phase === 'denied' || !role || !allowed.includes(role)) {
      return <Navigate to="/unauthorized" replace />;
    }
    return <Component {...props} />;
  };
  Wrapped.displayName = `withRole(${Component.displayName || Component.name || 'Component'})`;
  return Wrapped;
}
