import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './ParliamentAdminTab.module.css';

import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '../../firebase/app';
import type { ParliamentDate, ParliamentSubject } from '../../types/parliament';
import { deleteParliamentDateCascade } from '../../utils/parliamentCascade';

type SubTab = 'queue' | 'approved' | 'rejected' | 'dates';

function tsMillis(x: any): number {
  if (!x) return 0;
  if (typeof x?.toMillis === 'function') return x.toMillis();
  const d = x instanceof Date ? x : new Date(x);
  const t = d.getTime();
  return Number.isFinite(t) ? t : 0;
}

export default function ParliamentAdminTab() {
  const { t } = useTranslation(['parliament']);
  const [subTab, setSubTab] = useState<SubTab>('queue');

  const [queue, setQueue] = useState<ParliamentSubject[]>([]);
  const [approved, setApproved] = useState<ParliamentSubject[]>([]);
  const [rejected, setRejected] = useState<ParliamentSubject[]>([]);
  const [dates, setDates] = useState<ParliamentDate[]>([]);

  // Create Date form
  const [newTitle, setNewTitle] = useState('');
  const [newWhen, setNewWhen] = useState(''); // YYYY-MM-DD

  // Live listeners
  useEffect(() => {
    const unsubQ = onSnapshot(
      query(collection(db, 'parliamentSubjects'), where('status', '==', 'pending')),
      (snap) => {
        const list = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as ParliamentSubject[];
        list.sort((a, b) => tsMillis(b.createdAt) - tsMillis(a.createdAt));
        setQueue(list);
      }
    );
    const unsubA = onSnapshot(
      query(collection(db, 'parliamentSubjects'), where('status', '==', 'approved')),
      (snap) => {
        const list = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as ParliamentSubject[];
        list.sort((a, b) => tsMillis(b.createdAt) - tsMillis(a.createdAt));
        setApproved(list);
      }
    );
    const unsubR = onSnapshot(
      query(collection(db, 'parliamentSubjects'), where('status', '==', 'rejected')),
      (snap) => {
        const list = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as ParliamentSubject[];
        list.sort((a, b) => tsMillis(b.createdAt) - tsMillis(a.createdAt));
        setRejected(list);
      }
    );
    const unsubD = onSnapshot(
      query(collection(db, 'parliamentDates'), orderBy('date', 'asc')),
      (snap) => {
        const list = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as ParliamentDate[];
        list.sort((a, b) => tsMillis(a.date) - tsMillis(b.date));
        setDates(list);
      }
    );
    return () => {
      unsubQ(); unsubA(); unsubR(); unsubD();
    };
  }, []);

  async function approveSubject(s: ParliamentSubject) {
    await updateDoc(doc(db, 'parliamentSubjects', s.id), {
      status: 'approved',
      statusReason: '',
      approvedAt: serverTimestamp(),
    });
  }

  async function rejectSubject(s: ParliamentSubject) {
    const reason = prompt(
      t('parliament:rejectReason', 'Reason for rejection:')
    )?.trim();
    if (!reason) return;
    await updateDoc(doc(db, 'parliamentSubjects', s.id), {
      status: 'rejected',
      statusReason: reason,
      rejectedAt: serverTimestamp(),
    });
  }

  async function toggleDateOpen(d: ParliamentDate) {
    await updateDoc(doc(db, 'parliamentDates', d.id), {
      isOpen: !d.isOpen,
      updatedAt: serverTimestamp(),
    });
  }

  async function onCreateDate(e: React.FormEvent) {
    e.preventDefault();
    const title = newTitle.trim();
    const when = newWhen.trim();
    if (!title || !when) return;

    const iso = new Date(when);
    if (Number.isNaN(iso.getTime())) {
      alert(t('parliament:newDateWhen', 'Enter ISO date (YYYY-MM-DD)'));
      return;
    }
    await addDoc(collection(db, 'parliamentDates'), {
      title,
      date: iso.toISOString(),
      isOpen: true,
      createdAt: serverTimestamp(),
    });
    setNewTitle('');
    setNewWhen('');
  }

  async function onDeleteDate(d: ParliamentDate) {
    const ok = confirm(
      t(
        'parliament:confirmDeleteDateCascade',
        'Delete this date and ALL its subjects and notes? This cannot be undone.'
      )
    );
    if (!ok) return;
    await deleteParliamentDateCascade(d.id);
  }

  const subTabs = useMemo(
    () => ([
      { key: 'queue',    label: t('parliament:queue', 'Moderation queue') },
      { key: 'approved', label: t('parliament:approved', 'Approved') },
      { key: 'rejected', label: t('parliament:rejected', 'Rejected') },
      { key: 'dates',    label: t('parliament:createDate', 'Create date') },
    ]) as Array<{ key: SubTab; label: string }>,
    [t]
  );

  return (
    <div className={styles.wrapper}>
      {/* Sub-tabs */}
      <div className={styles.subTabs}>
        {subTabs.map((tab) => (
          <button
            key={tab.key}
            className={`${styles.btn} ${subTab === tab.key ? styles.btnPrimary : ''}`}
            onClick={() => setSubTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Queue */}
      {subTab === 'queue' && (
        <div>
          <div className={styles.actionBar}>
            <div className={styles.panelTitle}>{t('parliament:queue', 'Moderation queue')}</div>
          </div>

          {queue.length === 0 ? (
            <div className={styles.empty}>{t('parliament:empty', 'Empty')}</div>
          ) : (
            <div className={styles.grid}>
              {queue.map((s) => (
                <div key={s.id} className={styles.panel}>
                  <div className={styles.metaRow}>
                    <span className={styles.badge}>{s.dateTitle || t('parliament:unknownDate', 'Unknown date')}</span>
                    <span className={styles.metaText}>{s.createdByName || ''}</span>
                  </div>
                  <div className={styles.panelTitle} style={{ marginTop: 6 }}>{s.title}</div>
                  {s.description && <div style={{ marginTop: 6 }}>{s.description}</div>}

                  <div className={styles.actionsRow} style={{ marginTop: 10 }}>
                    <button className={styles.btnPrimary} onClick={() => approveSubject(s)}>
                      {t('parliament:approve', 'Approve')}
                    </button>
                    <button className={styles.btn} onClick={() => rejectSubject(s)}>
                      {t('parliament:reject', 'Reject')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Approved */}
      {subTab === 'approved' && (
        <div>
          <div className={styles.actionBar}>
            <div className={styles.panelTitle}>{t('parliament:approved', 'Approved')}</div>
          </div>

          {approved.length === 0 ? (
            <div className={styles.empty}>{t('parliament:empty', 'Empty')}</div>
          ) : (
            <div className={styles.grid}>
              {approved.map((s) => (
                <div key={s.id} className={styles.panel}>
                  <div className={styles.metaRow}>
                    <span className={styles.badge}>{s.dateTitle || t('parliament:unknownDate', 'Unknown date')}</span>
                    <span className={styles.metaText}>{s.createdByName || ''}</span>
                  </div>
                  <div className={styles.panelTitle} style={{ marginTop: 6 }}>{s.title}</div>
                  {s.description && <div style={{ marginTop: 6 }}>{s.description}</div>}

                  <div className={styles.actionsRow} style={{ marginTop: 10 }}>
                    <button className={styles.btn} onClick={() => rejectSubject(s)}>
                      {t('parliament:markRejected', 'Mark Rejected')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Rejected */}
      {subTab === 'rejected' && (
        <div>
          <div className={styles.actionBar}>
            <div className={styles.panelTitle}>{t('parliament:rejected', 'Rejected')}</div>
          </div>

          {rejected.length === 0 ? (
            <div className={styles.empty}>{t('parliament:empty', 'Empty')}</div>
          ) : (
            <div className={styles.grid}>
              {rejected.map((s) => (
                <div key={s.id} className={styles.panel}>
                  <div className={styles.metaRow}>
                    <span className={styles.badge}>{s.dateTitle || t('parliament:unknownDate', 'Unknown date')}</span>
                    <span className={styles.metaText}>{s.createdByName || ''}</span>
                  </div>
                  <div className={styles.panelTitle} style={{ marginTop: 6 }}>{s.title}</div>
                  {s.statusReason && (
                    <div className={styles.metaText} style={{ marginTop: 6 }}>
                      {t('parliament:rejectedReason', 'Reason')}: {s.statusReason}
                    </div>
                  )}
                  {s.description && <div style={{ marginTop: 6 }}>{s.description}</div>}

                  <div className={styles.actionsRow} style={{ marginTop: 10 }}>
                    <button className={styles.btnPrimary} onClick={() => approveSubject(s)}>
                      {t('parliament:markApproved', 'Mark Approved')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Dates */}
      {subTab === 'dates' && (
        <div>
          <div className={styles.actionBar}>
            <div className={styles.panelTitle}>{t('parliament:createDate', 'Create date')}</div>
          </div>

          {/* Create Date Form */}
          <form className={styles.panel} onSubmit={onCreateDate} style={{ marginBottom: 12 }}>
            <div className={styles.dateForm}>
              <div className={styles.field}>
                <label className={styles.fieldLabel}>
                  {t('parliament:newDateTitle', 'Title for the new parliament date (e.g., "Parliament – Sep 15")')}
                </label>
                <input
                  className={styles.fieldControl}
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  maxLength={120}
                  required
                />
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel}>
                  {t('parliament:newDateWhen', 'Enter ISO date (YYYY-MM-DD)')}
                </label>
                <input
                  className={styles.fieldControl}
                  type="date"
                  value={newWhen}
                  onChange={(e) => setNewWhen(e.target.value)}
                  required
                />
              </div>
              <button className={styles.btnPrimary} type="submit">
                {t('parliament:createDate', 'Create date')}
              </button>
            </div>
          </form>

          {/* Dates list */}
          {dates.length === 0 ? (
            <div className={styles.empty}>{t('parliament:empty', 'Empty')}</div>
          ) : (
            <div className={styles.dateGrid}>
              {dates.map((d) => (
                <div key={d.id} className={styles.panel}>
                  <div className={styles.metaRow}>
                    <div className={styles.panelTitle}>{d.title}</div>
                    <span className={styles.badge}>
                      {d.isOpen ? t('parliament:open', 'Open') : t('parliament:closed', 'Closed')}
                    </span>
                  </div>
                  <div className={styles.metaText} style={{ marginTop: 6 }}>
                    {new Date(d.date as any).toLocaleDateString()}
                  </div>

                  <div className={styles.actionsRow} style={{ marginTop: 10 }}>
                    <button className={styles.btn} onClick={() => toggleDateOpen(d)}>
                      {d.isOpen ? t('parliament:close', 'Close') : t('parliament:reopen', 'Reopen')}
                    </button>
                    <button className={styles.btnDanger} onClick={() => onDeleteDate(d)}>
                      {t('parliament:delete', 'Delete')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
