import React from 'react';
import { useNavigate } from 'react-router-dom';

type HeaderProps = {
  title?: string;
  userName?: string;
  role?: string;
};

export default function Header({ title = 'SchoolBoard', userName, role }: HeaderProps) {
  const navigate = useNavigate();

  function handleLogout() {
    localStorage.removeItem('session');
    navigate('/');
  }

  return (
    <header className="bg-neutral-900 text-white shadow-md px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <span className="text-xl font-semibold">{title}</span>
        {role && (
          <span className="text-sm text-neutral-400">
            {role} {userName ? `– ${userName}` : ''}
          </span>
        )}
      </div>
      <div className="flex items-center gap-4">
        {/* Example nav links */}
        <button
          onClick={() => navigate('/admin')}
          className="hover:text-emerald-400 transition"
        >
          Dashboard
        </button>
        <button
          onClick={() => navigate('/classes')}
          className="hover:text-emerald-400 transition"
        >
          Classes
        </button>
        <button
          onClick={() => navigate('/lessons')}
          className="hover:text-emerald-400 transition"
        >
          Lessons
        </button>
        <button
          onClick={handleLogout}
          className="bg-red-600 hover:bg-red-500 px-3 py-1 rounded"
        >
          Logout
        </button>
      </div>
    </header>
  );
}
