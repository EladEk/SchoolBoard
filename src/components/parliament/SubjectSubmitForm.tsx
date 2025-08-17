import React, { useMemo, useState } from 'react';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase/app';
import { useTranslation } from 'react-i18next';
import styles from './Parliament.module.css';
import type { ParliamentDate } from '../../types/parliament';

type Props = {
  dates: ParliamentDate[];
  currentUser: { uid?: string; id?: string; displayName?: string; username?: string; user?: any; firstName?: string; lastName?: string; email?: string } | null;
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
/** Build best display name: first+last > fullName/name/displayName > username/email-local > 'User' */
function fullNameFromUser(u: any): string {
  if (!u) return 'User';
  const fn = u.firstName || u.given_name || u.user?.firstName || u.user?.given_name;
  const ln = u.lastName || u.family_name || u.user?.lastName || u.user?.family_name;
  const parts = [fn, ln].map(p => (p ? String(p).trim() : '')).filter(Boolean);
  if (parts.length) return parts.join(' ');
  const single =
    u.fullName || u.name || u.displayName ||
    u.user?.fullName || u.user?.name || u.user?.displayName;
  if (single && String(single).trim()) return String(single).trim();
  const uname = pickUsername(u);
  return uname || 'User';
}

export default function SubjectSubmitForm({ dates, currentUser }: Props) {
  const { t } = useTranslation(['parliament']);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [dateId, setDateId] = useState('');

  const openDates = useMemo(() => dates.filter(d => d.isOpen), [dates]);

  // Robust UID + full display name
  const uid =
    (currentUser as any)?.uid ||
    (currentUser as any)?.id ||
    (currentUser as any)?.user?.uid ||
    '';

  const displayName = fullNameFromUser(currentUser);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!uid || !dateId || !title.trim()) return;

    const date = openDates.find(d => d.id === dateId);
    await addDoc(collection(db, 'parliamentSubjects'), {
      title: title.trim(),
      description: desc.trim(),
      createdByUid: uid,
      createdByName: displayName,        // legacy
      createdByFullName: displayName,    // preferred
      createdAt: serverTimestamp(),
      status: 'pending',
      dateId,
      dateTitle: date?.title || '',
      notesCount: 0,
    });
    setTitle('');
    setDesc('');
    setDateId('');
    alert(t('parliament:submitted', 'Submitted for approval!'));
  }

  if (openDates.length === 0) {
    return <div className={styles.card}>{t('parliament:noOpenDates', 'No open parliament dates right now.')}</div>;
  }

  return (
    <form className={styles.card} onSubmit={onSubmit}>
      <div className={styles.row}>
        <div style={{flex:1}}>
          <label>{t('parliament:subjectTitle', 'Subject title')}</label>
          <input value={title} onChange={e=>setTitle(e.target.value)} maxLength={120} required />
        </div>
        <div style={{width:280}}>
          <label>{t('parliament:chooseDate', 'Choose date')}</label>
          <select value={dateId} onChange={e=>setDateId(e.target.value)} required>
            <option value="">{t('parliament:select', 'Select...')}</option>
            {openDates.map(d => (
              <option key={d.id} value={d.id}>{d.title}</option>
            ))}
          </select>
        </div>
      </div>
      <label>{t('parliament:description', 'Description')}</label>
      <textarea rows={4} value={desc} onChange={e=>setDesc(e.target.value)} />
      <div className={styles.actions}>
        <button className="btn btnPrimary" type="submit">{t('parliament:submit', 'Submit')}</button>
      </div>
    </form>
  );
}
