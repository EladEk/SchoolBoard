// src/utils/guards.tsx
import React, { useEffect, useState } from 'react';
import { auth } from '../firebase/app';
import { onAuthStateChanged, getIdTokenResult, User } from 'firebase/auth';
import { useNavigate } from 'react-router-dom';

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
 * Renders children only when a user is signed in.
 * Redirects to / if unauthenticated.
 */
export const AuthGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useCurrentUser();
  const nav = useNavigate();

  useEffect(() => {
    if (!loading && !user) nav('/');
  }, [loading, user, nav]);

  if (loading) return <div style={{ color: '#fff', textAlign: 'center', paddingTop: '20%' }}>Loading…</div>;
  if (!user) return null;
  return <>{children}</>;
};

/** RoleGate
 * Checks custom claim "role" from the ID token.
 * Accepts any of the provided roles (e.g., ['admin'], ['teacher','admin']).
 * Forces a token refresh so newly set claims are honored immediately.
 */
export const RoleGate: React.FC<{ roles: string[]; children: React.ReactNode }> = ({ roles, children }) => {
  const { user, loading } = useCurrentUser();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const nav = useNavigate();

  useEffect(() => {
    let alive = true;

    async function check() {
      if (loading) return; // wait for auth to settle
      if (!user) {
        setAllowed(false);
        nav('/');
        return;
      }

      try {
        // Force refresh to include latest custom claims (e.g., after running setAdmin)
        const tokenRes = await getIdTokenResult(user, true);
        const userRole = (tokenRes.claims?.role as string | undefined) || '';

        // Debug (optional): console.log('RoleGate claims:', tokenRes.claims);

        const ok = roles.includes(userRole);
        if (!alive) return;
        setAllowed(ok);
        if (!ok) nav('/unauthorized');
      } catch (err) {
        console.error('RoleGate error reading claims:', err);
        if (!alive) return;
        setAllowed(false);
        nav('/unauthorized');
      }
    }

    check();
    return () => {
      alive = false;
    };
  }, [user, loading, roles, nav]);

  if (loading || allowed === null) {
    return <div style={{ color: '#fff', textAlign: 'center', paddingTop: '20%' }}>Checking permissions…</div>;
  }

  return allowed ? <>{children}</> : null;
};
