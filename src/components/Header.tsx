import React from 'react';
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

  const logout = async () => {
    try { await signOut(auth); } catch (e) { console.error('signOut failed:', e); }
    localStorage.clear();
    navigate('/');
  };

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
        {navMode === 'full' && (
          <>
            <button onClick={() => navigate('/admin')} className={styles.linkBtn}>Dashboard</button>
            <button onClick={() => navigate('/classes')} className={styles.linkBtn}>Classes</button>
            <button onClick={() => navigate('/lessons')} className={styles.linkBtn}>Lessons</button>
          </>
        )}
        {navMode !== 'none' && (
          <button onClick={logout} className={styles.logoutBtn}>Logout</button>
        )}
      </div>
    </header>
  );
}
