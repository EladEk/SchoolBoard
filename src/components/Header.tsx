import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './Header.module.css';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase/app';

type HeaderProps = {
  title?: string;
  userName?: string;
  role?: string;
  navMode?: 'full' | 'logoutOnly' | 'none';
};

export default function Header({
  title = 'SchoolBoard',
  userName,
  role,
  navMode = 'full',
}: HeaderProps) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const logout = async () => {
    try { await signOut(auth); } catch (e) { console.error('signOut failed:', e); }
    localStorage.clear();
    navigate('/');
  };

  // close menu when clicking outside
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
        {(role || userName) && (
          <span className={styles.meta}>
            {role || ''}{(role && userName) ? ' – ' : ''}{userName || ''}
          </span>
        )}
      </div>

      <div className={styles.right}>
        {/* Desktop inline links */}
        {navMode === 'full' && (
          <div className={styles.navLinks} aria-hidden>
            <button onClick={() => navigate('/admin')} className={styles.linkBtn}>Dashboard</button>
            <button onClick={() => navigate('/classes')} className={styles.linkBtn}>Classes</button>
            <button onClick={() => navigate('/lessons')} className={styles.linkBtn}>Lessons</button>
          </div>
        )}

        {/* Mobile hamburger */}
        {navMode === 'full' && (
          <button
            className={styles.menuToggle}
            aria-label="Open navigation"
            aria-expanded={open}
            aria-controls="header-menu"
            onClick={() => setOpen(v => !v)}
          >
            <span className={styles.menuIcon}>☰</span>
          </button>
        )}

        {/* Logout (always if not 'none') */}
        {navMode !== 'none' && (
          <button onClick={logout} className={styles.logoutBtn}>Logout</button>
        )}

        {/* Slide-down mobile panel */}
        {navMode === 'full' && (
          <div
            ref={panelRef}
            id="header-menu"
            className={[styles.menuPanel, open ? styles.open : ''].join(' ')}
            role="menu"
          >
            <button className={styles.menuLink} onClick={() => { setOpen(false); navigate('/admin'); }}>
              Dashboard
            </button>
            <button className={styles.menuLink} onClick={() => { setOpen(false); navigate('/classes'); }}>
              Classes
            </button>
            <button className={styles.menuLink} onClick={() => { setOpen(false); navigate('/lessons'); }}>
              Lessons
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
