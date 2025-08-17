import React, { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { db } from '../firebase/app';
import Header from '../components/Header';
import styles from '../components/parliament/Parliament.module.css';
import type { ParliamentDate, ParliamentSubject } from '../types/parliament';
import { useTranslation } from 'react-i18next';

export default function ParliamentAdmin() {
  const { t } = useTranslation(['parliament']);
  const [dates, setDates] = useState<ParliamentDate[]>([]);
  const [pending, setPending] = useState<ParliamentSubject[]>([]);
  const [approved, setApproved] = useState<ParliamentSubject[]>([]);
  const [rejected, setRejected] = useState<ParliamentSubject[]>([]);
  const [tab, setTab] = useState<'queue'|'dates'|'approved'|'rejected'>('queue');

  const session = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('session') || '{}') || {}; } catch { return {}; }
  }, []);
  const user = session?.user || session;

  useEffect(() => {
    const dq = query(collection(db, 'parliamentDates'), orderBy('date','asc'));
    return onSnapshot(dq, snap => setDates(snap.docs.map(d => ({ id:d.id, ...(d.data() as any) })) as ParliamentDate[]));
  }, []);

  useEffect(() => {
    const pq = query(collection(db, 'parliamentSubjects'), where('status','==','pending'), orderBy('createdAt','desc'));
    const aq = query(collection(db, 'parliamentSubjects'), where('status','==','approved'), orderBy('createdAt','desc'));
    const rq = query(collection(db, 'parliamentSubjects'), where('status','==','rejected'), orderBy('createdAt','desc'));

    const u1 = onSnapshot(pq, s=> setPending(s.docs.map(d=>({id:d.id, ...(d.data() as any)})) as ParliamentSubject[]));
    const u2 = onSnapshot(aq, s=> setApproved(s.docs.map(d=>({id:d.id, ...(d.data() as any)})) as ParliamentSubject[]));
    const u3 = onSnapshot(rq, s=> setRejected(s.docs.map(d=>({id:d.id, ...(d.data() as any)})) as ParliamentSubject[]));
    return () => { u1(); u2(); u3(); };
  }, []);

  async function createDate() {
    const title = prompt(t('parliament:newDateTitle', 'Title for the new parliament date (e.g., "Parliament – Sep 15")') as string);
    if (!title) return;
    const when = prompt(t('parliament:newDateWhen', 'Enter ISO date (YYYY-MM-DD)') as string);
    if (!when) return;
    await addDoc(collection(db, 'parliamentDates'), {
      title,
      date: new Date(when),
      isOpen: true,
      createdAt: serverTimestamp(),
      createdByUid: user?.uid || '',
      createdByName: user?.displayName || user?.username || 'Admin',
    });
  }

  async function toggleDate(d: ParliamentDate) {
    await updateDoc(doc(db, 'parliamentDates', d.id), { isOpen: !d.isOpen });
  }

  async function deleteDate(d: ParliamentDate) {
    if (!confirm(t('parliament:confirmDeleteDate', 'Delete this date? This does not delete subjects.'))) return;
    await deleteDoc(doc(db, 'parliamentDates', d.id));
  }

  async function approve(s: ParliamentSubject) {
    await updateDoc(doc(db, 'parliamentSubjects', s.id), { status: 'approved', statusReason: '' });
  }

  async function reject(s: ParliamentSubject) {
    const reason = prompt(t('parliament:rejectReason', 'Reason for rejection:') as string) || '';
    if (!reason.trim()) return;
    await updateDoc(doc(db, 'parliamentSubjects', s.id), { status: 'rejected', statusReason: reason.trim() });
  }

  function renderList(list: ParliamentSubject[]) {
    if (list.length === 0) return <div className={styles.card}>{t('parliament:empty', 'Empty')}</div>;
    return (
      <div className={styles.grid}>
        {list.map(s => (
          <div key={s.id} className={styles.card}>
            <div className={styles.row} style={{justifyContent:'space-between'}}>
              <div><span className={styles.badge}>{s.dateTitle}</span></div>
              <div style={{fontSize:13, opacity:.7}}>{s.createdByName}</div>
            </div>
            <h3 style={{margin:'8px 0 6px'}}>{s.title}</h3>
            <div style={{whiteSpace:'pre-wrap'}}>{s.description}</div>

            <div className={styles.actions} style={{marginTop:12}}>
              {s.status === 'pending' && (
                <>
                  <button className="btn btnPrimary" onClick={()=>approve(s)}>{t('parliament:approve', 'Approve')}</button>
                  <button className="btn btnWarn" onClick={()=>reject(s)}>{t('parliament:reject', 'Reject')}</button>
                </>
              )}
              {s.status !== 'pending' && (
                <>
                  <button className="btn btnGhost" onClick={()=>approve(s)}>{t('parliament:markApproved', 'Mark Approved')}</button>
                  <button className="btn btnGhost" onClick={()=>reject(s)}>{t('parliament:markRejected', 'Mark Rejected')}</button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <Header title={t('parliament:adminTitle', 'Parliament Admin')} navMode="logoutOnly" userName={user?.displayName || user?.username || ''} role={session?.role} />
      <div className={styles.toolbar}>
        <button className="btn btnPrimary" onClick={()=>setTab('queue')}>{t('parliament:queue','Moderation queue')}</button>
        <button className="btn btnGhost" onClick={()=>setTab('approved')}>{t('parliament:approved','Approved')}</button>
        <button className="btn btnGhost" onClick={()=>setTab('rejected')}>{t('parliament:rejected','Rejected')}</button>
        <button className="btn btnGhost" onClick={()=>setTab('dates')}>{t('parliament:dates','Dates')}</button>
      </div>

      {tab === 'queue' && (
        <section className={styles.section}>
          <h3>{t('parliament:queue','Moderation queue')}</h3>
          {renderList(pending)}
        </section>
      )}

      {tab === 'approved' && (
        <section className={styles.section}>
          <h3>{t('parliament:approved','Approved')}</h3>
          {renderList(approved)}
        </section>
      )}

      {tab === 'rejected' && (
        <section className={styles.section}>
          <h3>{t('parliament:rejected','Rejected')}</h3>
          {renderList(rejected)}
        </section>
      )}

      {tab === 'dates' && (
        <section className={styles.section}>
          <div className={styles.actions} style={{marginBottom:12}}>
            <button className="btn btnPrimary" onClick={createDate}>{t('parliament:createDate','Create date')}</button>
          </div>
          <div className={styles.grid}>
            {dates.map(d => (
              <div className={styles.card} key={d.id}>
                <div className={styles.row} style={{justifyContent:'space-between'}}>
                  <div style={{fontWeight:700}}>{d.title}</div>
                  <div className={styles.badge}>{d.isOpen ? t('parliament:open','Open') : t('parliament:closed','Closed')}</div>
                </div>
                <div style={{fontSize:13, opacity:.7, marginTop:6}}>{new Date(d.date?.toDate?.() || d.date).toLocaleDateString()}</div>
                <div className={styles.actions} style={{marginTop:12}}>
                  <button className="btn btnGhost" onClick={()=>toggleDate(d)}>{d.isOpen ? t('parliament:close','Close') : t('parliament:reopen','Reopen')}</button>
                  <button className="btn btnWarn" onClick={()=>deleteDate(d)}>{t('parliament:delete','Delete')}</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
