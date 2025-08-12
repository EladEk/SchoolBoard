// src/components/display/BigTableWidget.tsx
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { SLOTS, DAY_ORDER } from '../../constants/timetable';
import ClockWidget from '../../components/display/ClockWidget';
import './BigTableWidget.css';

type Entry = {
  id: string;
  classId: string;
  lessonId: string;
  day: number;
  startMinutes: number;
  endMinutes: number;
};

type Lesson = { id: string; name: string };

type Props = {
  entries?: Entry[];
  lessons?: Map<string, Lesson>;
  today: number;
  nowMinutes: number;
};

function lessonLabelOnly(l?: Lesson | null) {
  return l?.name ?? '';
}

export default function BigTableWidget({ entries, lessons, today, nowMinutes }: Props) {
  const { t } = useTranslation('display'); // Use display.json translations

  const safeEntries: Entry[] = Array.isArray(entries) ? entries : [];
  const safeLessons: Map<string, Lesson> = lessons instanceof Map ? lessons : new Map();

  const cellMap = useMemo(() => {
    const m = new Map<string, Entry[]>();
    for (const e of safeEntries) {
      const slot = SLOTS.find(s => s.sm === e.startMinutes && s.em === e.endMinutes);
      if (!slot) continue;
      const key = `${e.day}-${slot.sm}-${slot.em}`;
      const arr = m.get(key) || [];
      arr.push(e);
      m.set(key, arr);
    }
    return m;
  }, [safeEntries]);

  const currentSlot = useMemo(() => {
    return SLOTS.find(s => s.sm <= nowMinutes && nowMinutes < s.em) || null;
  }, [nowMinutes]);

  return (
    <div className="bigtable-widget">
      <div className="plan">
        <table className="ls-table">
          <thead>
            <tr>
              <th className="ls-th-time">{t('timeColumn')}</th>
              {DAY_ORDER.map(dIdx => (
                <th key={dIdx} className="ls-th">{dayName(dIdx, t)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SLOTS.map(({ start, end, sm, em }) => {
              const isNowRow = currentSlot && currentSlot.sm === sm && currentSlot.em === em;
              return (
                <tr key={start} className={isNowRow ? 'ls-row-now' : undefined}>
                  <td className="ls-td-time" style={{ fontWeight: isNowRow ? 800 : 700 }}>
                    {start}–{end}
                  </td>
                  {DAY_ORDER.map(dIdx => {
                    const key = `${dIdx}-${sm}-${em}`;
                    const cellEntries = cellMap.get(key) || [];
                    const isNowCell = isNowRow && dIdx === today;
                    return (
                      <td key={dIdx} className={`ls-td ${isNowCell ? 'ls-td-now' : ''}`}>
                        <div className="ls-cell">
                          {cellEntries.length === 0 ? (
                            <div className="ls-cell-text empty">—</div>
                          ) : cellEntries.map(e => {
                              const l = safeLessons.get(e.lessonId);
                              return <div key={e.id} className="ls-cell-text">{lessonLabelOnly(l)}</div>;
                            })}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="clock-under">
        <ClockWidget />
      </div>
    </div>
  );
}

function dayName(dIdx: number, t: any) {
  const daysMap = {
    0: t('days.sunday'),
    1: t('days.monday'),
    2: t('days.tuesday'),
    3: t('days.wednesday'),
    4: t('days.thursday'),
    5: t('days.friday'),
    6: t('days.saturday')
  };
  return daysMap[dIdx] || t('days.day', { number: dIdx });
}
