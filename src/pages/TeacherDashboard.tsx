import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import TeacherLessons from '../components/teacher/TeacherLessons';
import TeacherTimetableView from '../components/lessons/TeacherTimetableView';
import { useTranslation } from 'react-i18next';

export default function TeacherDashboard() {
  const { t } = useTranslation(['teacher', 'common']);
  const navigate = useNavigate();

  const session = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem('session') || '{}') || {};
    } catch {
      return {};
    }
  }, []);

  function handleLogout() {
    localStorage.removeItem('session');
    navigate('/');
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-neutral-900/90 backdrop-blur border-b border-neutral-800">
        <div className="px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-xl md:text-2xl font-semibold">
              {t('teacher:dashboardTitle')}
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-sm text-neutral-300">
              <span className="font-medium">
                {session?.displayName || t('teacher:labels.teacher')}
              </span>
              {session?.role ? (
                <span className="text-neutral-400"> · {session.role}</span>
              ) : null}
            </div>
            <button
              onClick={handleLogout}
              className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white transition"
            >
              {t('common:logout')}
            </button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="p-6" style={{ display: 'grid', gap: 24 }}>
        <p>{t('teacher:subtitle')}</p>
        <TeacherLessons />
        {/* Read-only timetable for this teacher */}
        <TeacherTimetableView />
      </main>
    </div>
  );
}
