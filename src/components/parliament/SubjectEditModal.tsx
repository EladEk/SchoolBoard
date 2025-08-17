import React, { useMemo, useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase/app';
import styles from './Parliament.module.css';
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

  const selectableDates = useMemo(() => dates, [dates]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const date = selectableDates.find(d => d.id === dateId);
      await updateDoc(doc(db, 'parliamentSubjects', subject.id), {
        title: title.trim(),
        description: desc.trim(),
        dateId,
        dateTitle: date?.title || subject.dateTitle,
      });
      onSaved?.();
    } catch (err) {
      console.error(err);
      alert(t('parliament:saveFailed','Could not save changes'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={`${styles.modalPanel} ${styles.modalPanelNarrow}`} onClick={e=>e.stopPropagation()}>
        <form className={styles.card} onSubmit={save}>
          <div className={styles.modalCloseRow}>
            <h3 className={styles.mt0}>{t('parliament:editSubject','Edit subject')}</h3>
            <button type="button" className="btn btnGhost" onClick={onClose}>✖</button>
          </div>

          <label>{t('parliament:subjectTitle','Subject title')}</label>
          <input value={title} onChange={e=>setTitle(e.target.value)} maxLength={120} required />

          <label className={styles.mt10}>{t('parliament:description','Description')}</label>
          <textarea rows={5} value={desc} onChange={e=>setDesc(e.target.value)} />

          <label className={styles.mt10}>{t('parliament:chooseDate','Choose date')}</label>
          <select value={dateId} onChange={e=>setDateId(e.target.value)} required>
            {selectableDates.map(d => (
              <option key={d.id} value={d.id}>{d.title}</option>
            ))}
          </select>

          <div className={`${styles.actions} ${styles.mt10}`}>
            <button type="button" className="btn btnGhost" onClick={onClose}>
              {t('parliament:cancel','Cancel')}
            </button>
            <button className="btn btnPrimary" type="submit" disabled={busy}>
              {t('parliament:saveChanges','Save changes')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
