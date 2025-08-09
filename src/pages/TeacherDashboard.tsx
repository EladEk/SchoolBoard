// src/pages/TeacherDashboard.tsx
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Header from '../components/Header';
import TeacherTimetableView from '../components/lessons/TeacherTimetableView';
import TeacherLessons from '../components/teacher/TeacherLessons';
import './TeacherDashboard.css';

type TabKey = 'view' | 'edit';

export default function TeacherDashboard() {
  const { t } = useTranslation(['teacher']);

  // Persist the active tab in localStorage so it survives refresh
  const [tab, setTab] = useState<TabKey>(() => {
    const saved = (localStorage.getItem('teacherTab') as TabKey) || 'view';
    return saved === 'edit' ? 'edit' : 'view';
  });
  const setTabAndSave = (next: TabKey) => {
    setTab(next);
    localStorage.setItem('teacherTab', next);
  };

  const session = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('session') || '{}') || {}; }
    catch { return {}; }
  }, []);
  const displayName = session?.displayName || session?.username || session?.user?.username || '';

  return (
    <div className="tdash-page">
      <Header
        title={t('teacher:dashboardTitle', 'Teacher Schedule')}
        userName={displayName}
        role={session?.role}
        navMode="logoutOnly"
      />

      <header className="tdash-header">
        <nav className="tdash-tabs" aria-label={t('teacher:dashboardTitle', 'Teacher Schedule')}>
          <button
            type="button"
            className={`tdash-tab ${tab === 'view' ? 'active' : ''}`}
            onClick={() => setTabAndSave('view')}
            aria-current={tab === 'view' ? 'page' : undefined}
          >
            {t('teacher:tabs.view', 'View')}
          </button>
          <button
            type="button"
            className={`tdash-tab ${tab === 'edit' ? 'active' : ''}`}
            onClick={() => setTabAndSave('edit')}
            aria-current={tab === 'edit' ? 'page' : undefined}
          >
            {t('teacher:tabs.edit', 'Edit')}
          </button>
        </nav>
      </header>

      <main className="tdash-main">
        {tab === 'view' && (
          <section className="tdash-section" aria-label={t('teacher:tabs.view', 'View')}>
            {/* VIEW: weekly plan (lessons). Clicking a class cell shows students below the grid. */}
            <TeacherTimetableView />
          </section>
        )}
        {tab === 'edit' && (
          <section className="tdash-section" aria-label={t('teacher:tabs.edit', 'Edit')}>
            {/* EDIT: manage lessons for this teacher */}
            <TeacherLessons />
          </section>
        )}
      </main>
    </div>
  );
}
