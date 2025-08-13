// src/pages/AdminDashboard.tsx
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import UsersAdmin from '../components/admin/UsersAdmin';
import ClassesAdmin from '../components/admin/ClassesAdmin';
import LessonsAdmin from '../components/admin/LessonsAdmin';
import LessonsScheduler from '../components/lessons/LessonsScheduler';
import TeacherAdvisorsAdmin from '../components/admin/TeacherAdvisorsAdmin';
import LevelsMover from '../components/admin/LevelsMover';
import NewsAdmin from '../components/admin/NewsAdmin';

import styles from './AdminDashboard.module.css';
import { withRole } from '../utils/requireRole';

function AdminDashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [active, setActive] = useState<
    'users' | 'classes' | 'lessons' | 'timetable' | 'advisories' | 'levels' | 'news'
  >('users');

  const session = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('session') || '{}') || {}; } catch { return {}; }
  }, []);

  function handleLogout() {
    localStorage.removeItem('session');
    navigate('/');
  }

  const tabs: Array<{ key: typeof active; label: string }> = useMemo(() => ([
    { key: 'users',      label: t('dashboard:tabs.users', 'Users') },
    { key: 'classes',    label: t('dashboard:tabs.classes', 'Classes') },
    { key: 'lessons',    label: t('dashboard:tabs.lessons', 'Lessons') },
    { key: 'timetable',  label: t('dashboard:tabs.timetable', 'Timetable') },
    { key: 'advisories', label: t('dashboard:tabs.advisories', 'Advisories') },
    { key: 'levels',     label: t('dashboard:tabs.levels', 'הזזת רמות') },
    { key: 'news',       label: t('dashboard:tabs.news', 'News') },
  ]), [t]);

  return (
    <div className={styles.page}>
      {/* Header / Top Nav */}
      <header className={styles.header}>
        <div className={styles.headerBar}>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>{t('dashboard:dashboard.title', 'Admin Dashboard')}</h1>
            <span className={styles.subtitle}>{t('dashboard:dashboard.subtitle', 'Manage your school')}</span>
          </div>

          <div className={styles.rightControls}>
            <div className={styles.sessionInfo}>
              <span style={{ fontWeight: 600 }}>{session?.displayName || 'Admin'}</span>
              {session?.role ? (
                <span className={styles.roleSep}>
                  {t('dashboard:dashboard.roleSeparator', ' · ')}{session.role}
                </span>
              ) : null}
            </div>

            <button onClick={handleLogout} className={styles.logoutBtn}>
              {t('dashboard:dashboard.logout', 'Logout')}
            </button>
          </div>
        </div>

        {/* Tabs bar under header */}
        <nav className={styles.tabsBar}>
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActive(tab.key)}
              className={[
                styles.tabBtn,
                active === tab.key ? styles.tabBtnActive : ''
              ].join(' ')}
            >
              {tab.label}
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
          {active === 'advisories' && <TeacherAdvisorsAdmin />}
          {active === 'levels' && <LevelsMover />}
          {active === 'news' && <NewsAdmin />}
        </section>
      </main>
    </div>
  );
}

export default withRole(AdminDashboard, ['admin']);
