// src/pages/DisplayPage.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase/app';
import NewsTickerWidget from '../components/display/NewsTickerWidget';
import BirthdayBannerWidget from '../components/display/BirthdayBannerWidget';
import BigTableWidget from '../components/display/BigTableWidget';
import SidePanelWidget from '../components/display/SidePanelWidget';
import './DisplayPage.css';
import ClockWidget from '../components/display/ClockWidget';
import { useTranslation } from 'react-i18next';
import { withRole } from '../utils/requireRole';

// -------- Types --------
type AppUser = {
  id: string;
  firstName?: string;
  lastName?: string;
  role?: 'admin'|'teacher'|'student'|'kiosk';
};
type SchoolClass = { id: string; classId?: string; name?: string; location?: string };
type Lesson = {
  id: string; name: string;
  teacherFirstName?: string | null;
  teacherLastName?: string | null;
  isStudentTeacher?: boolean;
  studentFirstName?: string | null;
  studentLastName?: string | null;
  studentsUserIds?: string[];
};
type Entry = {
  id: string;
  classId: string;
  lessonId: string;
  day: number;
  startMinutes: number;
  endMinutes: number;
};

// -------- Time helpers --------
function parseHHMM(v?: string | null): number | null {
  if (!v) return null;
  const m = String(v).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Math.max(0, Math.min(23, parseInt(m[1], 10)));
  const min = Math.max(0, Math.min(59, parseInt(m[2], 10)));
  return h * 60 + min;
}
function getTestConfig() {
  const sp = new URLSearchParams(window.location.search);
  const urlTime = sp.get('testTime'); // "HH:MM"
  const urlDay = sp.get('testDay');   // "0..6"

  const lsTime = localStorage.getItem('DISPLAY_TEST_TIME'); // "HH:MM"
  const lsDay = localStorage.getItem('DISPLAY_TEST_DAY');   // "0..6"

  // @ts-ignore
  const winTime = (window as any).__DISPLAY_TEST_TIME__ as string | undefined;
  // @ts-ignore
  const winDay = (window as any).__DISPLAY_TEST_DAY__ as number | string | undefined;

  const minutes = parseHHMM(urlTime) ?? parseHHMM(lsTime) ?? parseHHMM(winTime ?? null);
  const dayRaw = (urlDay ?? lsDay ?? (winDay as any)) as any;
  const dayParsed = dayRaw != null ? Number(dayRaw) : null;
  const day = Number.isFinite(dayParsed) ? Math.max(0, Math.min(6, Number(dayParsed))) : null;

  const enabled = minutes != null || day != null;
  return { enabled, minutes: minutes ?? null, day: day ?? null };
}
const realNowMinutes = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};
const realToday = () => new Date().getDay(); // Sunday=0

// -------- Small helpers --------
function fullName(first?: string | null, last?: string | null) {
  return `${first ?? ''} ${last ?? ''}`.replace(/\s+/g, ' ').trim();
}
function findClassByAnyId(classes: SchoolClass[], anyId: string) {
  return classes.find(c => c.id === anyId || (c.classId && c.classId === anyId)) || null;
}

function DisplayPage() {
  const { t } = useTranslation('display');

  // live "now"
  const testCfgRef = useRef(getTestConfig());
  const computeNow = () => {
    const cfg = testCfgRef.current;
    const minutes = cfg.enabled && cfg.minutes != null ? cfg.minutes : realNowMinutes();
    const day = cfg.enabled && cfg.day != null ? cfg.day : realToday();
    return { minutes, day };
  };
  const firstNow = computeNow();
  const [nowMinutes, setNowMinutes] = useState(firstNow.minutes);
  const [today, setToday] = useState(firstNow.day);

  useEffect(() => {
    const id = setInterval(() => {
      testCfgRef.current = getTestConfig();
      const n = computeNow();
      setNowMinutes(n.minutes);
      setToday(n.day);
    }, 30_000);
    return () => clearInterval(id);
  }, []);

  // Firestore: classes
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, 'classes')), s => {
      setClasses(s.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    });
    return () => unsub();
  }, []);

  // Firestore: lessons
  const [lessons, setLessons] = useState<Lesson[]>([]);
  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, 'lessons')), s => {
      setLessons(s.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    });
    return () => unsub();
  }, []);

  // Firestore: timetableEntries
  const [entries, setEntries] = useState<Entry[]>([]);
  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, 'timetableEntries')), s => {
      const list = s.docs.map(d => {
        const raw = d.data() as any;
        const toInt = (v: any) => typeof v === 'string' ? parseInt(v, 10) : Number(v);
        return {
          id: d.id,
          classId: String(raw.classId ?? ''),
          lessonId: String(raw.lessonId ?? ''),
          day: toInt(raw.day ?? 0) || 0,
          startMinutes: toInt(raw.startMinutes ?? raw.sm ?? 0) || 0,
          endMinutes: toInt(raw.endMinutes ?? raw.em ?? 0) || 0,
        } as Entry;
      });
      setEntries(list);
    });
    return () => unsub();
  }, []);

  // Firestore: students (for side panel)
  const [allStudents, setAllStudents] = useState<AppUser[]>([]);
  useEffect(() => {
    const qStu = query(collection(db, 'appUsers'), where('role', '==', 'student'));
    const unsub = onSnapshot(qStu, s => {
      const list = s.docs.map(d => ({ id: d.id, ...(d.data() as any) } as AppUser));
      list.sort((a, b) => fullName(a.firstName, a.lastName).localeCompare(fullName(b.firstName, b.lastName)));
      setAllStudents(list);
    });
    return () => unsub();
  }, []);
  const studentById = useMemo(() => {
    const m = new Map<string, AppUser>();
    for (const s of allStudents) m.set(s.id, s);
    return m;
  }, [allStudents]);

  // Convenience maps
  const lessonById = useMemo(() => {
    const m = new Map<string, Lesson>();
    for (const l of lessons) m.set(l.id, l);
    return m;
  }, [lessons]);

  // Now entries (on current day & current time)
  const nowEntries = useMemo(() => {
    return entries
      .filter(e => e.day === today && e.startMinutes <= nowMinutes && nowMinutes < e.endMinutes)
      .sort((a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes);
  }, [entries, today, nowMinutes]);

  // Build side-panel items
  const sideItems = useMemo(() => {
    return nowEntries.map(e => {
      const cls = findClassByAnyId(classes, e.classId);
      const les = lessonById.get(e.lessonId) || null;
      const enrolled = (les?.studentsUserIds || [])
        .map(id => studentById.get(id) || null)
        .filter(Boolean) as AppUser[];
      return { entry: e, cls, les, students: enrolled };
    });
  }, [nowEntries, classes, lessonById, studentById]);

  // Spotlight rotation
  const [spotIndex, setSpotIndex] = useState(0);
  const spotTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (spotTimerRef.current) { window.clearInterval(spotTimerRef.current); spotTimerRef.current = null; }
    if (sideItems.length === 0) return;
    setSpotIndex(prev => (prev >= sideItems.length ? 0 : prev));
    spotTimerRef.current = window.setInterval(() => {
      setSpotIndex(prev => (prev + 1) % sideItems.length);
    }, 5000);
    return () => {
      if (spotTimerRef.current) { window.clearInterval(spotTimerRef.current); spotTimerRef.current = null; }
    };
  }, [sideItems.length]);

  // Transform to SidePanelWidget shape
  const sidePanelItems = sideItems.map((it, idx) => ({
    entryId: it.entry.id,
    lesson: it.les,
    classData: it.cls,
    students: it.students,
    isSpotlight: idx === spotIndex,
    onClick: () => setSpotIndex(idx),
  }));
  const spotlight = sidePanelItems[spotIndex] ?? null;

  // Decide students columns: 3 if many names, else 2
  const studentsCols = spotlight?.students && spotlight.students.length >= 10 ? 3 : 2;

  return (
    <div className="display-root">
      {/* News bar & banner */}
      <NewsTickerWidget />
      <BirthdayBannerWidget />

      {/* Header */}
      <div className="display-header">
        <h1 className="display-title fancy-title">
          {t('title', 'School Schedule')}
        </h1>
        <div className="top-clock small-clock">
          <ClockWidget />
        </div>
      </div>

      {/* Main layout */}
      <div className="display-layout">
        <BigTableWidget
          entries={entries || []}
          lessons={lessonById || new Map()}
          today={today}
          nowMinutes={nowMinutes}
        />
        <SidePanelWidget
          items={sidePanelItems}
          spotlight={spotlight}
        />
      </div>

      {/* Force 3 columns for many students */}
      {studentsCols === 3 && (
        <style>
          {`.now-students { grid-template-columns: repeat(3, 1fr) !important; }`}
        </style>
      )}
    </div>
  );
}

export default withRole(DisplayPage, ['kiosk', 'admin']);
