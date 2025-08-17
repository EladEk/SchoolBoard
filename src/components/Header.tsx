import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import styles from './Header.module.css';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase/app';
import { useEffectiveRole } from '../utils/requireRole';
import { useTranslation } from 'react-i18next';

type HeaderProps = {
  title?: string;
  userName?: string;
  /** Optional: parent-supplied role; hook will take precedence if available */
  role?: string;
  navMode?: 'full' | 'logoutOnly' | 'none';
};

function normalizeRole(r?: string) {
  return (r || '').toString().trim().toLowerCase();
}
function dashboardPathForRole(role?: string) {
  const r = normalizeRole(role);
  if (r === 'admin') return '/admin';
  if (r === 'teacher') return '/teacher';
  if (r === 'student') return '/student';
  if (r === 'kiosk') return '/display';
  return '/';
}
function isParliamentPath(pathname: string) {
  const p = (pathname || '').toLowerCase();
  return p === '/parliament' || p.startsWith('/parliament/');
}

export default function Header({
  title = 'SchoolBoard',
  userName,
  role: roleProp,
  navMode = 'full',
}: HeaderProps) {
  const { t } = useTranslation(['nav', 'parliament']);
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Prefer centralized role
  const { role: hookRole } = useEffectiveRole();
  const effectiveRole = normalizeRole(roleProp || hookRole);
  const dashPath = dashboardPathForRole(effectiveRole);

  const onParliament = isParliamentPath(location.pathname || '');
  const showGoDashboard = navMode !== 'none' && onParliament;
  // Show Parliament button on ANY non-parliament page (covers all dashboards & other pages)
  const showGoParliament = navMode !== 'none' && !onParliament;

  const logout = async () => {
    try { await signOut(auth); } catch (e) { console.error('signOut failed:', e); }
    localStorage.clear();
    navigate('/');
  };

  // close mobile menu on outside click
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (open && panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [open]);

  return (
    <header className={styles.wrapper}>
      <div className={styles.left}>
        <span className={styles.title}>{title}</span>
        {(effectiveRole || userName) && (
          <span className={styles.meta}>
            {effectiveRole || ''}{(effectiveRole && userName) ? ' – ' : ''}{userName || ''}
          </span>
        )}
      </div>

      <div className={styles.right}>
        {/* Contextual quick links */}
        {showGoDashboard && (
          <button
            onClick={() => navigate(dashPath)}
            className={styles.linkBtn}
            title={t('nav:goToDashboard', 'Go to Dashboard')}
          >
            {t('nav:goToDashboard', 'Go to Dashboard')}
          </button>
        )}
        {showGoParliament && (
          <button
            onClick={() => navigate('/parliament')}
            className={styles.linkBtn}
            title={t('parliament:link', 'Parliament')}
          >
            {t('parliament:link', 'Parliament')}
          </button>
        )}

        {/* Desktop inline links (optional full nav) */}
        {navMode === 'full' && (
          <div className={styles.navLinks} aria-hidden>
            <button onClick={() => navigate(dashPath)} className={styles.linkBtn}>
              {t('nav:dashboard', 'Dashboard')}
            </button>
            <button onClick={() => navigate('/classes')} className={styles.linkBtn}>
              {t('nav:classes', 'Classes')}
            </button>
            <button onClick={() => navigate('/lessons')} className={styles.linkBtn}>
              {t('nav:lessons', 'Lessons')}
            </button>
            <button onClick={() => navigate('/parliament')} className={styles.linkBtn}>
              {t('parliament:link', 'Parliament')}
            </button>
          </div>
        )}

        {/* Mobile hamburger */}
        {navMode === 'full' && (
          <button
            className={styles.menuToggle}
            aria-label={t('nav:openNavigation', 'Open navigation')}
            aria-expanded={open}
            aria-controls="header-menu"
            onClick={() => setOpen(v => !v)}
          >
            <span className={styles.menuIcon}>☰</span>
          </button>
        )}

        {/* Logout */}
        {navMode !== 'none' && (
          <button onClick={logout} className={styles.logoutBtn}>
            {t('nav:logout', 'Logout')}
          </button>
        )}

        {/* Slide-down mobile panel */}
        {navMode === 'full' && (
          <div
            ref={panelRef}
            id="header-menu"
            className={[styles.menuPanel, open ? styles.open : ''].join(' ')}
            role="menu"
          >
            <button className={styles.menuLink} onClick={() => { setOpen(false); navigate(dashPath); }}>
              {t('nav:dashboard', 'Dashboard')}
            </button>
            <button className={styles.menuLink} onClick={() => { setOpen(false); navigate('/classes'); }}>
              {t('nav:classes', 'Classes')}
            </button>
            <button className={styles.menuLink} onClick={() => { setOpen(false); navigate('/lessons'); }}>
              {t('nav:lessons', 'Lessons')}
            </button>
            <button className={styles.menuLink} onClick={() => { setOpen(false); navigate('/parliament'); }}>
              {t('parliament:link', 'Parliament')}
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
