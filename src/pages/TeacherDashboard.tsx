// src/pages/TeacherDashboard.tsx – fixed: remove unsupported teacherId props
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Header from '../components/Header';
import TeacherTimetableView from '../components/lessons/TeacherTimetableView';
import TeacherLessons from '../components/teacher/TeacherLessons';
import TeacherStudentPlans from '../components/teacher/TeacherStudentPlans';
import './TeacherDashboard.css';

export default function TeacherDashboard() {
  const { t } = useTranslation(['teacher', 'studentPlans']);
  const [tab, setTab] = useState<'view' | 'edit' | 'students'>('view');

  const session = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem('session') || '{}') || {};
    } catch {
      return {};
    }
  }, []);

  const displayName =
    session?.displayName ||
    session?.username ||
    session?.user?.username ||
    [session?.user?.firstName, session?.user?.lastName].filter(Boolean).join(' ') ||
    '';

  return (
    <div className="tdash-page">
      <Header
        title={t('teacher:dashboardTitle', 'Teacher Schedule')}
        userName={displayName}
        role={session?.role}
        navMode="logoutOnly"
      />

      <header className="tdash-header">
        <nav className="tdash-tabs">
          <button
            className={`tdash-tab ${tab === 'view' ? 'active' : ''}`}
            onClick={() => setTab('view')}
          >
            {t('teacher:tabs.view', 'My Weekly Plan')}
          </button>
          <button
            className={`tdash-tab ${tab === 'edit' ? 'active' : ''}`}
            onClick={() => setTab('edit')}
          >
            {t('teacher:tabs.edit', 'My Lessons')}
          </button>
          <button
            className={`tdash-tab ${tab === 'students' ? 'active' : ''}`}
            onClick={() => setTab('students')}
          >
            {t('studentPlans:studentsTitle', 'Students')}
          </button>
        </nav>
      </header>

      <main className="tdash-main">
        {tab === 'edit' && <TeacherLessons />}
        {tab === 'view' && <TeacherTimetableView />}
        {tab === 'students' && <TeacherStudentPlans />}
      </main>
    </div>
  );
}
