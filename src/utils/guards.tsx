// src/utils/guards.tsx
import React, { useEffect, useState } from 'react';
import { auth } from '../firebase/app';
import { onAuthStateChanged, getIdTokenResult, User } from 'firebase/auth';
import { useNavigate } from 'react-router-dom';

type LocalSession = {
  uid: string;
  displayName?: string;
  role?: string;
  mode?: 'custom-firestore' | 'firebase-auth';
  loggedInAt?: number;
} | null;

function getLocalSession(): LocalSession {
  try {
    const raw = localStorage.getItem('session');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function useCurrentUser(): { user: User | null; loading: boolean } {
  const [user, setUser] = useState<User | null>(() => auth.currentUser);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  return { user, loading };
}

/** AuthGate
 * Allows through if EITHER:
 *  - a Firebase user exists, OR
 *  - a local custom session exists in localStorage
 */
export const AuthGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useCurrentUser();
  const nav = useNavigate();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (loading) return;
    const sess = getLocalSession();
    if (!user && !sess) {
      nav('/');
    } else {
      setReady(true);
    }
  }, [loading, user, nav]);

  if (!ready) return <div style={{ color: '#fff', textAlign: 'center', paddingTop: '20%' }}>Loading…</div>;
  return <>{children}</>;
};

/** RoleGate
 * Accepts if role matches EITHER:
 *  - Firebase custom claim "role"
 *  - localStorage session.role
 */
export const RoleGate: React.FC<{ roles: string[]; children: React.ReactNode }> = ({ roles, children }) => {
  const { user, loading } = useCurrentUser();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const nav = useNavigate();

  useEffect(() => {
    let alive = true;

    async function check() {
      if (loading) return;

      const sess = getLocalSession();
      // First preference: local session (custom Firestore logins)
      if (sess?.role && roles.includes(sess.role)) {
        if (alive) setAllowed(true);
        return;
      }

      // Otherwise, fall back to Firebase Auth + claims
      if (!user) {
        if (alive) {
          setAllowed(false);
          nav('/unauthorized');
        }
        return;
      }

      try {
        const tokenRes = await getIdTokenResult(user, true);
        const userRole = (tokenRes.claims?.role as string | undefined) || '';
        const ok = roles.includes(userRole);
        if (alive) {
          setAllowed(ok);
          if (!ok) nav('/unauthorized');
        }
      } catch (err) {
        console.error('RoleGate error reading claims:', err);
        if (alive) {
          setAllowed(false);
          nav('/unauthorized');
        }
      }
    }

    check();
    return () => { alive = false; };
  }, [user, loading, roles, nav]);

  if (loading || allowed === null) {
    return <div style={{ color: '#fff', textAlign: 'center', paddingTop: '20%' }}>Checking permissions…</div>;
  }

  return allowed ? <>{children}</> : null;
};
