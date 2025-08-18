import React, { useEffect, useState } from 'react';
import styles from './Parliament.module.css';
import type { ParliamentSubject } from '../../types/parliament';
import {
  collection, doc, getDoc, getDocs, limit, query, where
} from 'firebase/firestore';
import { db } from '../../firebase/app';
import { useTranslation } from 'react-i18next';
import NotesThread from './NotesThread';

type Props = {
  subject: ParliamentSubject;
  onOpen?: (s: ParliamentSubject) => void;
  /** When true, render a read-only notes thread inline. */
  inlineNotes?: boolean;
  /** Pass current user if you want author names computed/fallbacks (not needed for read-only). */
  currentUser?: any;
};

function emailLocalPart(email?: string): string | undefined {
  if (!email || typeof email !== 'string') return undefined;
  const local = email.split('@')[0];
  return local || undefined;
}
function pickUsername(u: any): string | undefined {
  if (!u) return undefined;
  if (u.username && String(u.username).trim()) return String(u.username).trim();
  if (u.user?.username && String(u.user.username).trim()) return String(u.user.username).trim();
  return emailLocalPart(u.email || u.user?.email);
}
function fullNameFromProfile(p?: any): string | undefined {
  if (!p) return undefined;
  const fn = p.firstName || p.given_name;
  const ln = p.lastName || p.family_name;
  const parts = [fn, ln].map(v => (v ? String(v).trim() : '')).filter(Boolean);
  if (parts.length) return parts.join(' ');
  const single =
    p.fullName || p.name || p.displayName ||
    p.user?.fullName || p.user?.name || p.user?.displayName;
  if (single && String(single).trim()) return String(single).trim();
  return undefined;
}

export default function SubjectCard({ subject, onOpen, inlineNotes = false, currentUser }: Props) {
  const { t } = useTranslation(['parliament']);

  const initialAuthor =
    (subject as any).createdByFullName && String((subject as any).createdByFullName).trim()
      ? String((subject as any).createdByFullName).trim()
      : (subject as any).createdByName && /\s/.test(String((subject as any).createdByName))
        ? String((subject as any).createdByName).trim()
        : '';

  const [author, setAuthor] = useState<string>(initialAuthor);

  useEffect(() => {
    let cancelled = false;
    if (author) return; // already have a full name
    const uid = (subject as any).createdByUid;
    if (!uid) return;

    (async () => {
      let prof: any | null = null;
      try {
        const d = await getDoc(doc(db, 'appUsers', uid));
        if (d.exists()) prof = d.data();
      } catch {}
      if (!prof) {
        try {
          const snap = await getDocs(query(collection(db, 'appUsers'), where('uid', '==', uid), limit(1)));
          if (!snap.empty) prof = snap.docs[0].data();
        } catch {}
      }
      if (!prof) {
        try {
          const d = await getDoc(doc(db, 'users', uid));
          if (d.exists()) prof = d.data();
        } catch {}
      }
      if (!prof) {
        try {
          const snap = await getDocs(query(collection(db, 'users'), where('uid', '==', uid), limit(1)));
          if (!snap.empty) prof = snap.docs[0].data();
        } catch {}
      }

      if (!cancelled) {
        const resolved =
          fullNameFromProfile(prof) ||
          pickUsername(prof) ||
          'User';
        setAuthor(resolved);
      }
    })();

    return () => { cancelled = true; };
  }, [author, subject]);

  const discussLabel = subject.notesCount
    ? `${subject.notesCount} ${t('parliament:discuss', 'Discuss / Notes')}`
    : t('parliament:discuss', 'Discuss / Notes');

  return (
    <div className={styles.card}>
      <div className={styles.row} style={{ justifyContent: 'space-between' }}>
        <span className={styles.badge}>{subject.dateTitle}</span>
        <span className={styles.meta}>✅</span>
      </div>

      <h3 style={{ margin: '8px 0 6px' }}>{subject.title}</h3>
      <div className={styles.meta}>{author || 'User'}</div>

      {subject.description && (
        <div className={styles.pre} style={{ marginTop: 10 }}>
          {subject.description}
        </div>
      )}

      {/* Always keep the open button for add/edit/delete */}
      <div className={styles.actions} style={{ marginTop: 10 }}>
        <button
          className="btn btnPrimary"
          onClick={() => onOpen?.(subject)}
          title={t('parliament:openAndAddNotes', 'Open and add notes')}
        >
          💬 {discussLabel}
        </button>
      </div>

      {/* Inline read-only notes (just view) */}
      {inlineNotes && (
        <div style={{ marginTop: 12 }}>
          <NotesThread subject={subject} currentUser={currentUser} readOnly />
        </div>
      )}
    </div>
  );
}
