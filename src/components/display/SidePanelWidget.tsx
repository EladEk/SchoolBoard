// src/components/display/SidePanelWidget.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './SidePanelWidget.css';

type AppUser = { id: string; firstName?: string; lastName?: string };
type Lesson = {
  id: string;
  name: string;
  teacherFirstName?: string | null;
  teacherLastName?: string | null;
};
type SchoolClass = { id: string; name?: string; classId?: string; location?: string };

type NowItem = {
  entryId: string;
  lesson: Lesson | null;
  classData: SchoolClass | null;
  students: AppUser[];
  isSpotlight: boolean;   // ignored for rotation
  onClick: () => void;    // ignored; we manage clicks locally
};

const ROTATE_MS = 10000;  // change to your taste
const FADE_MS    = 300;   // must match CSS fade timings

const fullName = (first?: string | null, last?: string | null) =>
  `${first ?? ''} ${last ?? ''}`.replace(/\s+/g, ' ').trim();
const userName = (u: AppUser) =>
  `${u.firstName || ''} ${u.lastName || ''}`.replace(/\s+/g, ' ').trim();

export default function SidePanelWidget({
  items,
  spotlight, // unused
}: { items: NowItem[]; spotlight: NowItem | null }) {
  const { t } = useTranslation('display');

  // Build a stable signature of the incoming list that only changes
  // when the *order or set of IDs* actually changes.
  const idsSig = useMemo(() => items.map(it => it.entryId).join('|'), [items]);

  const [orderIds, setOrderIds] = useState<string[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Fade helpers
  const [leavingId, setLeavingId]   = useState<string | null>(null);
  const [enteringId, setEnteringId] = useState<string | null>(null);
  const animatingRef = useRef(false);
  const fadeTimerRef = useRef<number | null>(null);

  // Map id -> item for fast lookup
  const byId = useMemo(() => {
    const m = new Map<string, NowItem>();
    for (const it of items) m.set(it.entryId, it);
    return m;
  }, [items]);

  // Only reset our internal order when the *IDs actually change*.
  useEffect(() => {
    const next = idsSig ? idsSig.split('|') : [];
    setOrderIds(next);
    setExpandedId(next.length ? next[next.length - 1] : null); // bottom card expanded
    // clear any ongoing fade
    setLeavingId(null);
    setEnteringId(null);
    animatingRef.current = false;
    if (fadeTimerRef.current) { window.clearTimeout(fadeTimerRef.current); fadeTimerRef.current = null; }
  }, [idsSig]);

  // Compute ordered items from current orderIds
  const orderedItems = useMemo(() => {
    const arr: NowItem[] = [];
    for (const id of orderIds) {
      const it = byId.get(id);
      if (it) arr.push(it);
    }
    return arr;
  }, [orderIds, byId]);

  // Helper: perform a rotation with fade-out/fade-in, and guard reentry
  const applyReorderWithFade = (makeNext: (prev: string[]) => string[]) => {
    if (animatingRef.current) return;
    if (orderIds.length <= 1) return;

    const currentExpanded = orderIds[orderIds.length - 1];
    setLeavingId(currentExpanded);
    animatingRef.current = true;

    // After fade-out, reorder and fade-in new bottom
    fadeTimerRef.current = window.setTimeout(() => {
      setOrderIds(prev => {
        const next = makeNext(prev);
        const nextExpanded = next[next.length - 1] || null;
        setExpandedId(nextExpanded);
        setEnteringId(nextExpanded);

        // clear entering class after fade-in completes
        fadeTimerRef.current = window.setTimeout(() => {
          setEnteringId(null);
          animatingRef.current = false;
          fadeTimerRef.current = null;
        }, FADE_MS);

        return next;
      });
      setLeavingId(null);
    }, FADE_MS);
  };

  // Auto-rotate: last → top (so previous second-last becomes bottom+expanded)
  useEffect(() => {
    if (orderIds.length <= 1) return;
    const timer = window.setInterval(() => {
      applyReorderWithFade(prev => {
        const last = prev[prev.length - 1];
        return [last, ...prev.slice(0, -1)];
      });
    }, ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [orderIds.length]); // depends on count only, not on parent re-renders

  // Click: send clicked card to bottom (and expand it) with fade
  const bringToBottom = (id: string) => {
    if (!orderIds.includes(id)) return;
    if (orderIds.length <= 1) { setExpandedId(id); return; }
    applyReorderWithFade(prev => {
      const next = prev.filter(x => x !== id);
      next.push(id);
      return next;
    });
  };

  return (
    <aside className="now-panel">
      <div className="now-title">{t('happeningNow')}</div>

      <div className="now-list" role="list">
        {orderedItems.length === 0 ? (
          <div className="muted">{t('noClassesNow')}</div>
        ) : orderedItems.map((it) => {
          const isExpanded = it.entryId === expandedId;
          const classLabel = (it.classData?.name || it.classData?.classId || '').trim();
          const location   = (it.classData?.location || '').trim();
          const teacher    = it.lesson ? fullName(it.lesson.teacherFirstName, it.lesson.teacherLastName) : '';

          const fadingOut = it.entryId === leavingId;
          const fadingIn  = it.entryId === enteringId;

          return (
            <div
              key={it.entryId}
              role="listitem"
              className={[
                'now-item',
                isExpanded ? 'expanded spot' : '',
                fadingOut ? 'fade-out' : '',
                fadingIn  ? 'fade-enter' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => bringToBottom(it.entryId)}
            >
              <div className="now-item-head">
                <div className="now-lesson--title">{it.lesson?.name || '—'}</div>

                <div className="now-classline">
                  <div className="now-class--subtitle">{classLabel || '—'}</div>
                  {location && <div className="loc-chip" title={location}>📍 {location}</div>}
                  <div className={`caret ${isExpanded ? 'open' : ''}`} aria-hidden>▾</div>
                </div>
              </div>

              {/* Collapsible details */}
              <div className="now-item-details" aria-hidden={!isExpanded}>
                <div className="now-meta-row now-teacher">
                  <strong>{t('teacher', 'Teacher')}:</strong>
                  <span>{teacher || t('unknown', '—')}</span>
                </div>

                <div className="now-meta-row"><strong>{t('students')}:</strong></div>
                <div className="now-students inner">
                  {it.students.length === 0 ? (
                    <div className="muted">{t('noStudents')}</div>
                  ) : it.students.map(s => (
                    <div key={s.id}>{userName(s)}</div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
