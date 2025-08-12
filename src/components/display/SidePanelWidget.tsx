// src/components/display/SidePanelWidget.tsx
import React from 'react';
import { useTranslation } from 'react-i18next';
import './SidePanelWidget.css'; 

type AppUser = { id: string; firstName?: string; lastName?: string };
type Lesson = { id: string; name: string };
type SchoolClass = { id: string; name?: string; classId?: string; location?: string };

type NowItem = {
  entryId: string;
  lesson: Lesson | null;
  classData: SchoolClass | null;
  students: AppUser[];
  isSpotlight: boolean;
  onClick: () => void;
};

export default function SidePanelWidget({ items, spotlight }: { items: NowItem[], spotlight: NowItem | null }) {
  const { t } = useTranslation('display');

  return (
    <aside className="now-panel">
      <div className="now-title">{t('happeningNow')}</div>

      <div className="now-list">
        {items.length === 0 ? (
          <div className="muted">{t('noClassesNow')}</div>
        ) : items.map((it) => (
          <div
            key={it.entryId}
            className={`now-item${it.isSpotlight ? ' spot' : ''}`}
            onClick={it.onClick}
          >
            <div className="now-lesson--title">{it.lesson?.name || '—'}</div>
            <div className="now-class--subtitle">
              {it.classData?.name || it.classData?.classId || ''}
            </div>
          </div>
        ))}
      </div>

      {spotlight && (
        <div className="now-details">
          <div className="now-lesson--details">
            {spotlight.lesson?.name || '—'}
          </div>
          <div className="now-class--details">
            {spotlight.classData?.name || spotlight.classData?.classId || ''}
          </div>
          <div className="now-meta">
            <div><strong>{t('place')}:</strong> {spotlight.classData?.location || '—'}</div>
            <div><strong>{t('students')}:</strong></div>
            <div className="now-students">
              {spotlight.students.length === 0 ? (
                <div className="muted">{t('noStudents')}</div>
              ) : spotlight.students.map(s => (
                <div key={s.id}>{`${s.firstName || ''} ${s.lastName || ''}`.trim()}</div>
              ))}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
