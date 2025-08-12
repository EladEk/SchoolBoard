// src/components/display/BirthdayBannerWidget.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { db } from '../../firebase/app';
import styles from './BirthdayBannerWidget.module.css';

type Role = 'admin' | 'teacher' | 'student' | 'kiosk';
type AppUser = {
  id: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  role?: Role;
  birthday?: string;    // "YYYY-MM-DD"
  classGrade?: string;
};

// === CONFIG VARIABLES ===
const BANNER_SHOW_EVERY_SEC = 600;  // seconds until it is displayed
const BANNER_DURATION_SEC = 15;    // seconds it will be displayed

// === Helpers ===
function fullName(f?: string, l?: string) {
  return `${f ?? ''} ${l ?? ''}`.replace(/\s+/g, ' ').trim();
}
function pad(n: number) {
  return n < 10 ? `0${n}` : String(n);
}
function getThisWeekRange(base = new Date()) {
  const d = new Date(base);
  const day = d.getDay(); // Sun=0
  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  start.setDate(d.getDate() - day);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}
function birthdayThisYear(iso: string, year: number) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
  const safeDay = (month === 2 && day === 29 && !isLeap(year)) ? 28 : day;
  return new Date(year, month - 1, safeDay, 12, 0, 0, 0);
}
function isInThisWeek(iso: string, base = new Date()) {
  const { start, end } = getThisWeekRange(base);
  const d = birthdayThisYear(iso, start.getFullYear());
  if (!d) return false;
  return d >= start && d <= end;
}

export default function BirthdayBannerWidget() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<number | null>(null);
  const hideRef = useRef<number | null>(null);

  // Load all users
  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, 'appUsers')), (snap) => {
      setUsers(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as AppUser[]);
    });
    return () => unsub();
  }, []);

  // Filter birthdays for this week
  const birthdayItems = useMemo(() => {
    const now = new Date();
    return users
      .filter(u => u.birthday && isInThisWeek(u.birthday!, now))
      .map(u => {
        const name = fullName(u.firstName, u.lastName) || (u.username ?? '');
        const date = birthdayThisYear(u.birthday!, now.getFullYear())!;
        return {
          id: u.id,
          name,
          role: u.role,
          classGrade: u.role === 'student' ? (u.classGrade || '') : '',
          dayMonth: `${pad(date.getDate())}.${pad(date.getMonth() + 1)}`
        };
      })
      .sort((a, b) => a.dayMonth.localeCompare(b.dayMonth, 'he'));
  }, [users]);

  // Show/hide loop
  useEffect(() => {
    const showOnce = () => {
      if (!birthdayItems.length) return;
      setVisible(true);
      if (hideRef.current) window.clearTimeout(hideRef.current);
      hideRef.current = window.setTimeout(() => setVisible(false), BANNER_DURATION_SEC * 1000);
    };

    showOnce();
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(showOnce, BANNER_SHOW_EVERY_SEC * 1000);

    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (hideRef.current) window.clearTimeout(hideRef.current);
    };
  }, [birthdayItems]);

  if (!visible || birthdayItems.length === 0) return null;

  return (
    <div className={styles.overlay}>
      <div className={styles.card}>
        <div className={styles.header}>
          <div className={styles.title}>
            🎉 ימי הולדת השבוע 🎂
          </div>
          <div className={styles.subtitle}>מזל טוב לכל החוגגים!</div>
        </div>
        <div className={styles.grid}>
          {birthdayItems.map(kid => (
            <div key={kid.id} className={styles.kid}>
              <div className={styles.avatar}>🎈</div>
              <div className={styles.meta}>
                <div className={styles.name}>{kid.name}</div>
                <div className={styles.grade}>
                  {kid.classGrade ? `כיתה ${kid.classGrade}` : (kid.role === 'teacher' ? 'צוות' : '')}
                </div>
                <div className={styles.tag}>
                  🎂 {kid.dayMonth}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
