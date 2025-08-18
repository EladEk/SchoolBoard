import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase/app';
import Header from '../components/Header';
import { useTranslation } from 'react-i18next';
import page from './ParliamentPage.module.css';

import type { ParliamentDate, ParliamentSubject } from '../types/parliament';
import SubjectSubmitForm from '../components/parliament/SubjectSubmitForm';
import SubjectCard from '../components/parliament/SubjectCard';
import NotesThread from '../components/parliament/NotesThread';
import SubjectEditModal from '../components/parliament/SubjectEditModal';

function tsMillis(x: any): number {
  if (!x) return 0;
  if (typeof x?.toMillis === 'function') return x.toMillis();
  const d = x instanceof Date ? x : new Date(x);
  const t = d.getTime();
  return Number.isFinite(t) ? t : 0;
}

export default function Parliament() {
  const { t } = useTranslation(['parliament']);
  const [dates, setDates] = useState<ParliamentDate[]>([]);
  const [subjects, setSubjects] = useState<ParliamentSubject[]>([]);
  const [myPending, setMyPending] = useState<ParliamentSubject[]>([]);
  const [myRejected, setMyRejected] = useState<ParliamentSubject[]>([]);
  const [editing, setEditing] = useState<ParliamentSubject | null>(null);

  // NEW: subject opened in popup for full notes (add/edit/delete)
  const [current, setCurrent] = useState<ParliamentSubject | null>(null);

  const session = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('session') || '{}') || {}; } catch { return {}; }
  }, []);
  const user = (session as any)?.user || session;

  const userUid =
    (user as any)?.uid ||
    (user as any)?.id ||
    (user as any)?.user?.uid ||
    '';

  // Dates
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'parliamentDates')),
      snap => {
        const list = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as ParliamentDate[];
        list.sort((a, b) => tsMillis(a.date) - tsMillis(b.date));
        setDates(list);
      }
    );
    return () => unsub();
  }, []);

  // Approved subjects (public)
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'parliamentSubjects'), where('status','==','approved')),
      snap => {
        const list = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as ParliamentSubject[];
        list.sort((a, b) => tsMillis(b.createdAt) - tsMillis(a.createdAt));
        setSubjects(list);
      }
    );
    return () => unsub();
  }, []);

  // My submissions (pending + rejected)
  useEffect(() => {
    if (!userUid) return;
    const unsub = onSnapshot(
      query(collection(db, 'parliamentSubjects'), where('createdByUid','==', userUid)),
      snap => {
        const mine = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as ParliamentSubject[];
        const pendingOnly = mine.filter(s => s.status === 'pending');
        const rejectedOnly = mine.filter(s => s.status === 'rejected');

        const sortFn = (a: any, b: any) => {
          const ta = ((a.createdAt?.toMillis?.() ?? new Date(a.createdAt || 0).getTime()) || 0);
          const tb = ((b.createdAt?.toMillis?.() ?? new Date(b.createdAt || 0).getTime()) || 0);
          return tb - ta;
        };
        pendingOnly.sort(sortFn);
        rejectedOnly.sort(sortFn);

        setMyPending(pendingOnly);
        setMyRejected(rejectedOnly);
      }
    );
    return () => unsub();
  }, [userUid]);

  // Group approved subjects by date
  const byDate = useMemo(() => {
    const map = new Map<string, { date: ParliamentDate | null; items: ParliamentSubject[] }>();
    for (const s of subjects) {
      const date = dates.find(d => d.id === s.dateId) || null;
      const k = s.dateId;
      if (!map.has(k)) map.set(k, { date, items: [] });
      map.get(k)!.items.push(s);
    }
    return Array.from(map.values()).sort((a, b) => {
      const ta = tsMillis(a.date?.date);
      const tb = tsMillis(b.date?.date);
      return ta - tb;
    });
  }, [subjects, dates]);

  return (
    <div className={page.page}>
      <Header
        title={t('parliament:title', 'Parliament')}
        navMode="logoutOnly"
        userName={(user as any)?.displayName || (user as any)?.username || ''}
        role={(session as any)?.role}
      />

      <div className={page.headerRow}>
        <h2 className={page.title}>
          {t('parliament:headline', 'Submit, review and discuss school parliament topics')}
        </h2>
      </div>

      {/* Approved subjects (TOP) with inline read-only notes */}
      <section className={page.section}>
        <h3 className={page.sectionTitle}>{t('parliament:approvedSubjects', 'Approved subjects')}</h3>
        {byDate.length === 0 ? (
          <div className={page.empty}>{t('parliament:noApproved', 'No approved subjects yet.')}</div>
        ) : (
          byDate.map(group => (
            <div key={group.date?.id || 'unknown'} className={page.mb10}>
              <div className={page.sectionTitle}>
                {group.date?.title || t('parliament:unknownDate', 'Unknown date')}
              </div>
              <div className={page.grid}>
                {group.items.map(s => (
                  <SubjectCard
                    key={s.id}
                    subject={s}
                    inlineNotes
                    currentUser={user}
                    onOpen={setCurrent}  // <-- click "💬 Discuss / Notes" opens popup
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </section>

      {/* Submit new subject */}
      <section className={page.section}>
        <SubjectSubmitForm dates={dates} currentUser={user} />
      </section>

      {/* My pending submissions */}
      {userUid && (
        <section className={page.section}>
          <h3 className={page.sectionTitle}>{t('parliament:myPending', 'My pending submissions')}</h3>
          {myPending.length === 0 ? (
            <div className={page.empty}>{t('parliament:noMyPending','You have no pending subjects.')}</div>
          ) : (
            <div className={page.grid}>
              {myPending.map(p => (
                <div key={p.id} className={page.panel}>
                  <div className={page.meta}>
                    <span className={page.badge}>{p.dateTitle}</span>
                  </div>
                  <h3 className={page.mt8}>{p.title}</h3>
                  <div className={`${page.meta} ${page.mt6}`}>{p.createdByName}</div>
                  <div className={`${page.mt10} ${page.pre}`}>{p.description}</div>
                  <div className={`${page.actions} ${page.mt10}`}>
                    <button className="btn btnPrimary" onClick={() => setEditing(p)}>
                      {t('parliament:edit','Edit')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* My rejected submissions */}
      {userUid && (
        <section className={page.section}>
          <h3 className={page.sectionTitle}>{t('parliament:myRejected', 'My rejected subjects')}</h3>
          {myRejected.length === 0 ? (
            <div className={page.empty}>{t('parliament:noMyRejected','You have no rejected subjects.')}</div>
          ) : (
            <div className={page.grid}>
              {myRejected.map(r => (
                <div key={r.id} className={page.panel}>
                  <div className={page.meta}>
                    <span className={page.badge}>{r.dateTitle}</span>
                  </div>
                  <h3 className={page.mt8}>{r.title}</h3>
                  <div className={`${page.meta} ${page.mt6}`}>{r.createdByName}</div>
                  {r.statusReason && (
                    <div className={`${page.mt8} ${page.meta}`}>
                      {t('parliament:rejectedReason','Reason')}: {r.statusReason}
                    </div>
                  )}
                  <div className={`${page.mt10} ${page.pre}`}>{r.description}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Popup modal to ADD / EDIT / DELETE notes on an approved subject */}
      {current && (
        <div className={page.modalBackdrop} onClick={() => setCurrent(null)}>
          <div className={page.modalPanel} onClick={(e)=>e.stopPropagation()}>
            <div className={page.section}>
              <div className={page.modalHeader}>
                <h3 className={page.mt0}>{current.title}</h3>
                <button className="btn btnGhost" onClick={() => setCurrent(null)}>✖</button>
              </div>
              <div className={page.mt4}>
                <span className={page.badge}>{current.dateTitle}</span>
              </div>
              {current.description && (
                <div className={`${page.mt10} ${page.pre}`}>{current.description}</div>
              )}
            </div>

            <div className={page.mt10}>
              <section className={page.section}>
                {/* Full-power notes thread (not readOnly) */}
                <NotesThread subject={current} currentUser={user} />
              </section>
            </div>
          </div>
        </div>
      )}

      {/* Edit modal for my pending items */}
      {editing && (
        <SubjectEditModal
          subject={editing}
          dates={dates}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      )}
    </div>
  );
}
