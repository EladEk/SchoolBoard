import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import UsersAdmin from '../components/admin/UsersAdmin';
import ClassesAdmin from '../components/admin/ClassesAdmin';
import LessonsAdmin from '../components/admin/LessonsAdmin';
import LessonsScheduler from '../components/lessons/LessonsScheduler';

const tabs = [
  { key: 'users', label: 'Users' },
  { key: 'classes', label: 'Classes' },
  { key: 'lessons', label: 'Lessons' },
  { key: 'timetable', label: 'Timetable' },
] as const;

export default function AdminDashboard() {
  const [active, setActive] = useState<(typeof tabs)[number]['key']>('users');
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
      {/* Header / Top Nav */}
      <header className="sticky top-0 z-40 bg-neutral-900/90 backdrop-blur border-b border-neutral-800">
        <div className="px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-xl md:text-2xl font-semibold">Admin Dashboard</h1>
            <span className="hidden md:block text-neutral-400">
              Manage users, classes, lessons, and weekly timetable.
            </span>
          </div>

          <div className="flex items-center gap-4">
            {/* Session info */}
            <div className="text-sm text-neutral-300">
              <span className="font-medium">{session?.displayName || 'Admin'}</span>
              {session?.role ? (
                <span className="text-neutral-400"> · {session.role}</span>
              ) : null}
            </div>

            {/* Logout */}
            <button
              onClick={handleLogout}
              className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white transition"
            >
              Logout
            </button>
          </div>
        </div>

        {/* Tabs bar under header */}
        <nav className="px-6 pb-3 flex gap-2 flex-wrap">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setActive(t.key)}
              className={[
                'px-3 py-2 rounded-xl border transition',
                active === t.key
                  ? 'bg-neutral-800 border-neutral-700'
                  : 'bg-neutral-900 border-neutral-800 hover:bg-neutral-800',
              ].join(' ')}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      {/* Page body */}
      <main className="p-6">
        <section className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4">
          {active === 'users' && <UsersAdmin />}
          {active === 'classes' && <ClassesAdmin />}
          {active === 'lessons' && <LessonsAdmin />}
          {active === 'timetable' && <LessonsScheduler />}
        </section>
      </main>
    </div>
  );
}
