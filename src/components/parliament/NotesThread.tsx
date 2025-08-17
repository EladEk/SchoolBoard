import React, { useEffect, useRef, useState } from 'react';
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  where,
  limit,
} from 'firebase/firestore';
import { db } from '../../firebase/app';
import styles from './Parliament.module.css';
import type { ParliamentSubject } from '../../types/parliament';
import { useEffectiveRole } from '../../utils/requireRole';
import { useTranslation } from 'react-i18next';

type Props = {
  subject: ParliamentSubject;
  currentUser?: any; // guests can still comment
};

type Note = {
  id: string;
  text: string;
  createdAt?: any;
  createdByUid?: string;
  createdByName?: string;
  createdByFullName?: string;
  editedAt?: any;
};

type Profile = {
  uid?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  name?: string;
  displayName?: string;
  username?: string;
  email?: string;
  [k: string]: any;
};

function toMillis(x: any): number {
  if (!x) return 0;
  if (typeof x?.toMillis === 'function') return x.toMillis();
  const d = x instanceof Date ? x : new Date(x);
  const t = d.getTime();
  return Number.isFinite(t) ? t : 0;
}

function fmtDateTime(x: any): string {
  if (!x) return '';
  const d =
    typeof x?.toDate === 'function' ? x.toDate() :
    x instanceof Date ? x :
    new Date(x);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

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

function fullNameFromProfile(p?: Profile): string | undefined {
  if (!p) return undefined;
  const fn = p.firstName || (p as any).given_name;
  const ln = p.lastName || (p as any).family_name;
  const parts = [fn, ln].map(v => (v ? String(v).trim() : '')).filter(Boolean);
  if (parts.length) return parts.join(' ');
  const single =
    p.fullName || p.name || p.displayName ||
    (p as any)?.user?.fullName || (p as any)?.user?.name || (p as any)?.user?.displayName;
  if (single && String(single).trim()) return String(single).trim();
  return undefined;
}

function fullNameFromCurrentUser(u: any): string {
  return (
    fullNameFromProfile(u) ||
    pickUsername(u) ||
    'User'
  );
}

function authorForNote(n: Note, profileMap: Record<string, Profile>): string {
  const uid = n.createdByUid || '';
  const prof = uid ? profileMap[uid] : undefined;
  const fromProfile =
    fullNameFromProfile(prof) ||
    pickUsername(prof);
  if (fromProfile && String(fromProfile).trim()) return String(fromProfile).trim();

  if (n.createdByFullName && String(n.createdByFullName).trim()) return String(n.createdByFullName).trim();
  if (n.createdByName && String(n.createdByName).trim()) return String(n.createdByName).trim();
  return 'User';
}

async function fetchProfileByUid(uid: string): Promise<Profile | null> {
  if (!uid) return null;

  try {
    const d = await getDoc(doc(db, 'appUsers', uid));
    if (d.exists()) return { uid, ...(d.data() as any) } as Profile;
  } catch {}

  try {
    const snap = await getDocs(query(collection(db, 'appUsers'), where('uid','==', uid), limit(1)));
    if (!snap.empty) return { uid, ...(snap.docs[0].data() as any) } as Profile;
  } catch {}

  try {
    const d = await getDoc(doc(db, 'users', uid));
    if (d.exists()) return { uid, ...(d.data() as any) } as Profile;
  } catch {}

  try {
    const snap = await getDocs(query(collection(db, 'users'), where('uid','==', uid), limit(1)));
    if (!snap.empty) return { uid, ...(snap.docs[0].data() as any) } as Profile;
  } catch {}

  return null;
}

export default function NotesThread({ subject, currentUser }: Props) {
  const { t } = useTranslation(['parliament']);
  const [notes, setNotes] = useState<Note[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const { role } = useEffectiveRole();
  const isAdmin = role === 'admin';

  const uid: string =
    (currentUser as any)?.uid ||
    (currentUser as any)?.id ||
    (currentUser as any)?.user?.uid ||
    '';

  const currentDisplayName = fullNameFromCurrentUser(currentUser);

  useEffect(() => {
    const col = collection(db, 'parliamentSubjects', subject.id, 'notes');
    const unsub = onSnapshot(query(col, orderBy('createdAt', 'asc')), (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Note[];
      list.sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt));
      setNotes(list);
    });
    return () => unsub();
  }, [subject.id]);

  useEffect(() => {
    const uids = Array.from(
      new Set(
        notes
          .map(n => n.createdByUid || '')
          .filter(Boolean)
      )
    ).filter(u => !profiles[u]);

    if (uids.length === 0) return;

    let cancelled = false;
    (async () => {
      const entries: Array<[string, Profile]> = [];
      for (const id of uids) {
        const p = await fetchProfileByUid(id);
        if (p) entries.push([id, p]);
      }
      if (!cancelled && entries.length) {
        setProfiles(prev => {
          const next = { ...prev };
          for (const [id, p] of entries) next[id] = p;
          return next;
        });
      }
    })();

    return () => { cancelled = true; };
  }, [notes, profiles]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const clean = text.trim();
    if (!clean) return;
    setSending(true);
    try {
      const col = collection(db, 'parliamentSubjects', subject.id, 'notes');
      await addDoc(col, {
        text: clean,
        createdAt: serverTimestamp(),
        createdByUid: uid,
        createdByFullName: currentDisplayName,
        createdByName: currentDisplayName,
      });
      setText('');
      setTimeout(() => inputRef.current?.focus(), 0);
    } finally {
      setSending(false);
    }
  }

  function startEdit(n: Note) {
    const isOwner = uid && n.createdByUid === uid;
    if (!(isAdmin || isOwner)) return;
    setEditingId(n.id);
    setEditText(n.text);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditText('');
  }

  async function saveEdit(e: React.FormEvent, n: Note) {
    e.preventDefault();
    const isOwner = uid && n.createdByUid === uid;
    if (!(isAdmin || isOwner)) return;
    const clean = editText.trim();
    if (!clean) return;
    await updateDoc(doc(db, 'parliamentSubjects', subject.id, 'notes', n.id), {
      text: clean,
      editedAt: serverTimestamp(),
    });
    setEditingId(null);
    setEditText('');
  }

  async function removeNote(n: Note) {
    if (!isAdmin) return;
    if (!confirm(t('parliament:deleteConfirmNote', 'Delete this note?'))) return;
    await deleteDoc(doc(db, 'parliamentSubjects', subject.id, 'notes', n.id));
  }

  return (
    <div className={styles.card}>
      <div className={styles.row} style={{ justifyContent: 'space-between' }}>
        <div className={styles.panelTitle} style={{ margin: 0 }}>
          {t('parliament:notes', 'Notes')}
        </div>
        <span className={styles.meta}>
          {notes.length} {notes.length === 1 ? t('parliament:note', 'note') : t('parliament:notes', 'Notes')}
        </span>
      </div>

      {/* Composer */}
      <form onSubmit={send} className={styles.mt10}>
        <label className={styles.meta} style={{ display: 'block', marginBottom: 6 }}>
          {t('parliament:addNoteAs', 'Add a note as')} <strong>{currentDisplayName}</strong>
        </label>
        <textarea
          ref={inputRef}
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('parliament:openAndAddNotes', 'Open and add notes')}
        />
        <div className={styles.actions} style={{ marginTop: 8 }}>
          <button className="btn btnPrimary" type="submit" disabled={sending}>
            {sending ? t('parliament:sending', 'Sending…') : t('parliament:addNote', 'Add note')}
          </button>
        </div>
      </form>

      {/* Notes list */}
      <div className={styles.mt10}>
        {notes.length === 0 ? (
          <div className={styles.empty}>{t('parliament:noNotes', 'No notes yet. Be the first to comment.')}</div>
        ) : (
          notes.map((n) => {
            const isOwner = Boolean(uid) && n.createdByUid === uid;
            const isEditing = editingId === n.id;

            const author = authorForNote(n, profiles);
            const createdStr = fmtDateTime(n.createdAt);
            const editedStr = n.editedAt ? fmtDateTime(n.editedAt) : '';

            return (
              <div key={n.id} className={styles.noteItem}>
                <div className={styles.row} style={{ justifyContent: 'space-between' }}>
                  <div className={styles.meta}>
                    <strong>{author}</strong>
                    {createdStr && <span> · {createdStr}</span>}
                    {editedStr && <span> · {t('parliament:edited', 'edited')} {editedStr}</span>}
                  </div>

                  {/* Actions: owner can edit; admin can edit & delete */}
                  <div className={styles.actions}>
                    {(isOwner || isAdmin) && !isEditing && (
                      <button
                        type="button"
                        className="btn btnGhost"
                        onClick={() => startEdit(n)}
                        title={t('parliament:edit', 'Edit')}
                      >
                        {t('parliament:edit', 'Edit')}
                      </button>
                    )}
                    {isAdmin && !isEditing && (
                      <button
                        type="button"
                        className="btn btnWarn"
                        onClick={() => removeNote(n)}
                        title={t('parliament:delete', 'Delete')}
                      >
                        {t('parliament:delete', 'Delete')}
                      </button>
                    )}
                  </div>
                </div>

                {/* View mode */}
                {!isEditing && (
                  <div className={styles.pre} style={{ marginTop: 6 }}>
                    {n.text}
                  </div>
                )}

                {/* Edit mode */}
                {isEditing && (
                  <form onSubmit={(e) => saveEdit(e, n)} className={styles.mt8}>
                    <textarea
                      rows={3}
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                    />
                    <div className={styles.actions} style={{ marginTop: 8 }}>
                      <button className="btn btnPrimary" type="submit">
                        {t('parliament:save', 'Save')}
                      </button>
                      <button type="button" className="btn btnGhost" onClick={cancelEdit}>
                        {t('parliament:cancel', 'Cancel')}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
