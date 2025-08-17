import React, { useEffect, useMemo, useState } from 'react';
import {
  addDoc, collection, deleteDoc, doc, onSnapshot, query,
  serverTimestamp, updateDoc, getDocs
} from 'firebase/firestore';
import { db } from '../../firebase/app';
import { useTranslation } from 'react-i18next';
import styles from './NewsAdmin.module.css';

type NewsItem = {
  id: string;
  text: string;
  createdAt?: any;
};

export default function NewsAdmin() {
  const { t } = useTranslation();
  const [items, setItems] = useState<NewsItem[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);

  // Live list (no auth/role checks)
  useEffect(() => {
    const q = query(collection(db, 'announcements'));
    const unsub = onSnapshot(
      q,
      snap => {
        setErr(null);
        const list = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as NewsItem[];
        list.sort((a, b) => {
          const ta = a.createdAt?.seconds ?? 0;
          const tb = b.createdAt?.seconds ?? 0;
          return tb - ta || (a.text || '').localeCompare(b.text || '');
        });
        setItems(list);
      },
      async (e) => {
        console.error('NewsAdmin onSnapshot error:', e);
        setErr(t('news:toasts.loadFailLive', 'Failed to load live updates'));
        try {
          const once = await getDocs(q);
          const list = once.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as NewsItem[];
          list.sort((a, b) => {
            const ta = a.createdAt?.seconds ?? 0;
            const tb = b.createdAt?.seconds ?? 0;
            return tb - ta || (a.text || '').localeCompare(b.text || '');
          });
          setItems(list);
          setErr(null);
        } catch (e2: any) {
          console.error('NewsAdmin getDocs fallback error:', e2);
          setErr(t('news:toasts.loadFailOnce', 'Failed to load data'));
        }
      }
    );
    return () => unsub();
  }, [t]);

  const isEditing = useMemo(() => Boolean(editingId), [editingId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const tText = text.trim();
    if (!tText) return;

    try {
      if (editingId) {
        await updateDoc(doc(db, 'announcements', editingId), { text: tText });
        setErr(null);
      } else {
        await addDoc(collection(db, 'announcements'), {
          text: tText,
          createdAt: serverTimestamp(),
        });
      }
      setText('');
      setEditingId(null);
    } catch (e: any) {
      console.error('Save failed:', e);
      setErr(t('news:toasts.saveFail', { msg: e?.message || 'unknown' }) || `Save failed: ${e?.message || 'unknown'}`);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm(t('common:deleteConfirm', 'Are you sure?'))) return;
    try {
      await deleteDoc(doc(db, 'announcements', id));
      if (editingId === id) {
        setEditingId(null);
        setText('');
      }
    } catch (e: any) {
      console.error('Delete failed:', e);
      setErr(t('news:toasts.deleteFail', { msg: e?.message || 'unknown' }) || `Delete failed: ${e?.message || 'unknown'}`);
    }
  }

  function startEdit(n: NewsItem) {
    setEditingId(n.id);
    setText(n.text || '');
  }

  function cancelEdit() {
    setEditingId(null);
    setText('');
  }

  return (
    <div className={styles.wrapper}>
      <h2 className={styles.title}>{t('news:manage', 'Manage announcements')}</h2>

      {err && <div className={styles.alert}>{err}</div>}

      {/* Add / Edit form */}
      <form onSubmit={handleSubmit} className={styles.form}>
        <label className={styles.field}>
          <span className={styles.label}>{t('news:textLabel', 'Text')}</span>
          <input
            type="text"
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={t('news:textPlaceholder', 'Write an announcement')!}
            className={styles.control}
          />
        </label>
        <div className={styles.actions}>
          <button type="submit" className={styles.btnPrimary}>
            {isEditing ? t('common:save', 'Save') : t('common:add', 'Add')}
          </button>
          {isEditing && (
            <button type="button" onClick={cancelEdit} className={styles.btn}>
              {t('common:cancel', 'Cancel')}
            </button>
          )}
        </div>
      </form>

      {/* Current news list */}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead className={styles.thead}>
            <tr>
              <th className={styles.th}>{t('news:table.text', 'Text')}</th>
              <th className={`${styles.th} ${styles.thRight}`}>{t('common:actions', 'Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map(n => (
              <tr key={n.id}>
                <td className={styles.td}>
                  <div title={n.text} className={styles.cellText}>
                    {n.text}
                  </div>
                </td>
                <td className={`${styles.td} ${styles.tdRight}`}>
                  <div className={styles.rowActions}>
                    <button
                      onClick={() => startEdit(n)}
                      className={styles.btn}
                      title={t('common:edit', 'Edit')!}
                    >
                      ✎
                    </button>
                    <button
                      onClick={() => handleDelete(n.id)}
                      className={styles.btnDanger}
                      title={t('common:delete', 'Delete')!}
                    >
                      🗑
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!items.length && (
              <tr>
                <td colSpan={2} className={styles.emptyRow}>
                  {t('news:noItems', 'No announcements yet')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
