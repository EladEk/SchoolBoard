// src/pages/AdminDashboard.tsx
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import UsersAdmin from '../components/admin/UsersAdmin';
import ClassesAdmin from '../components/admin/ClassesAdmin';
import LessonsAdmin from '../components/admin/LessonsAdmin';
import LessonsScheduler from '../components/lessons/LessonsScheduler';
import TeacherAdvisorsAdmin from '../components/admin/TeacherAdvisorsAdmin'; // <— NEW
import { useTranslation } from 'react-i18next';
import styles from './AdminDashboard.module.css';

export default function AdminDashboard() {
  const { t } = useTranslation();
  const [active, setActive] = useState<
    'users' | 'classes' | 'lessons' | 'timetable' | 'advisories'
  >('users');
  const navigate = useNavigate();

  const session = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('session') || '{}') || {}; } catch { return {}; }
  }, []);

  function handleLogout() {
    localStorage.removeItem('session');
    navigate('/');
  }

  return (
    <div className={styles.page}>
      {/* Header / Top Nav */}
      <header className={styles.header}>
        <div className={styles.headerBar}>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>{t('dashboard:dashboard.title')}</h1>
            <span className={styles.subtitle}>{t('dashboard:dashboard.subtitle')}</span>
          </div>

          <div className={styles.rightControls}>
            {/* Session info */}
            <div className={styles.sessionInfo}>
              <span style={{ fontWeight: 600 }}>{session?.displayName || 'Admin'}</span>
              {session?.role ? (
                <span className={styles.roleSep}>
                  {t('dashboard:dashboard.roleSeparator')}{session.role}
                </span>
              ) : null}
            </div>

            {/* Logout */}
            <button onClick={handleLogout} className={styles.logoutBtn}>
              {t('dashboard:dashboard.logout')}
            </button>
          </div>
        </div>

        {/* Tabs bar under header */}
        <nav className={styles.tabsBar}>
          {(['users','classes','lessons','timetable','advisories'] as const).map((key) => (
            <button
              key={key}
              onClick={() => setActive(key)}
              className={[
                styles.tabBtn,
                active === key ? styles.tabBtnActive : ''
              ].join(' ')}
            >
              {t(`dashboard:tabs.${key}`)}
            </button>
          ))}
        </nav>
      </header>

      {/* Page body */}
      <main className={styles.main}>
        <section className={styles.section}>
          {active === 'users' && <UsersAdmin />}
          {active === 'classes' && <ClassesAdmin />}
          {active === 'lessons' && <LessonsAdmin />}
          {active === 'timetable' && <LessonsScheduler />}
          {active === 'advisories' && <TeacherAdvisorsAdmin />}{/* NEW */}
        </section>
      </main>
    </div>
  );
}
