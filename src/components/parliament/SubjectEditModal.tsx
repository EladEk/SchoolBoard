import React, { useEffect, useMemo, useRef, useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase/app';
import styles from './SubjectEditModal.module.css';
import type { ParliamentDate, ParliamentSubject } from '../../types/parliament';
import { useTranslation } from 'react-i18next';

type Props = {
  subject: ParliamentSubject;
  dates: ParliamentDate[];
  onClose: () => void;
  onSaved?: () => void;
};

export default function SubjectEditModal({ subject, dates, onClose, onSaved }: Props) {
  const { t } = useTranslation(['parliament']);
  const [title, setTitle] = useState(subject.title);
  const [desc, setDesc] = useState(subject.description);
  const [dateId, setDateId] = useState(subject.dateId);
  const [busy, setBusy] = useState(false);

  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Map for quick lookup
  const dateById = useMemo(() => {
    const m = new Map<string, ParliamentDate>();
    for (const d of dates) m.set(d.id, d);
    return m;
  }, [dates]);

  // Close on ESC
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;

    const chosen = dateById.get(dateId);
    if (!chosen) {
      alert(t('parliament:unknownDate', 'Unknown date'));
      return;
    }
    // Block switching to a closed date (but allow keeping the original closed date)
    if (!chosen.isOpen && dateId !== subject.dateId) {
      alert(
        t(
          'parliament:cannotMoveToClosed',
          'Cannot move subject to a closed date. Choose an open date.'
        )
      );
      return;
    }

    setBusy(true);
    try {
      await updateDoc(doc(db, 'parliamentSubjects', subject.id), {
        title: title.trim(),
        description: (desc || '').trim(),
        dateId,
        dateTitle: chosen.title || subject.dateTitle,
      });
      onSaved?.();
      onClose();
    } catch (err) {
      console.error(err);
      alert(t('parliament:saveFailed','Could not save changes'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={styles.backdrop}
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-subject-title"
        onClick={(e) => e.stopPropagation()}
      >
        <form className={styles.form} onSubmit={save}>
          <div className={styles.headerRow}>
            <h3 id="edit-subject-title" className={styles.title}>
              {t('parliament:editSubject','Edit subject')}
            </h3>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={onClose}
              aria-label={t('parliament:cancel','Cancel') || 'Close'}
              title={t('parliament:cancel','Cancel') || 'Close'}
            >
              ✖
            </button>
          </div>

          <label className={styles.field}>
            <span className={styles.label}>{t('parliament:subjectTitle','Subject title')}</span>
            <input
              className={styles.control}
              value={title}
              onChange={e=>setTitle(e.target.value)}
              maxLength={120}
              required
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>{t('parliament:description','Description')}</span>
            <textarea
              className={styles.control}
              rows={5}
              value={desc}
              onChange={e=>setDesc(e.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>{t('parliament:chooseDate','Choose date')}</span>
            <select
              className={styles.control}
              value={dateId}
              onChange={e=>setDateId(e.target.value)}
              required
            >
              {dates.map(d => {
                const isCurrent = d.id === subject.dateId;
                const disabled = !d.isOpen && !isCurrent; // allow keeping current closed date, but not switching to another closed one
                const label = d.isOpen
                  ? d.title
                  : `${d.title} · ${t('parliament:closed','Closed')}`;
                return (
                  <option key={d.id} value={d.id} disabled={disabled}>
                    {label}
                  </option>
                );
              })}
            </select>
          </label>

          <div className={styles.actions}>
            <button type="button" className={styles.btnGhost} onClick={onClose}>
              {t('parliament:cancel','Cancel')}
            </button>
            <button className={styles.btnPrimary} type="submit" disabled={busy}>
              {t('parliament:saveChanges','Save changes')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
