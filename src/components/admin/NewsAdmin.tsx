import React, { useEffect, useMemo, useState } from 'react';
import {
  addDoc, collection, deleteDoc, doc, onSnapshot, query,
  serverTimestamp, updateDoc, getDocs
} from 'firebase/firestore';
import { db } from '../../firebase/app';

type NewsItem = {
  id: string;
  text: string;
  createdAt?: any;
};

export default function NewsAdmin() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);

  // Live list of announcements (all are news)
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
        setErr(e?.message || 'Failed to load news (live). Trying once via getDocs…');
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
          setErr(e2?.message || 'Failed to load news.');
        }
      }
    );
    return () => unsub();
  }, []);

  const isEditing = useMemo(() => Boolean(editingId), [editingId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;

    try {
      if (editingId) {
        await updateDoc(doc(db, 'announcements', editingId), { text: t });
      } else {
        await addDoc(collection(db, 'announcements'), {
          text: t,
          createdAt: serverTimestamp(),
        });
      }
      setText('');
      setEditingId(null);
      setErr(null);
    } catch (e: any) {
      console.error('Save failed:', e);
      setErr(e?.message || 'Save failed');
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this news item?')) return;
    try {
      await deleteDoc(doc(db, 'announcements', id));
      if (editingId === id) {
        setEditingId(null);
        setText('');
      }
    } catch (e: any) {
      console.error('Delete failed:', e);
      setErr(e?.message || 'Delete failed');
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
    <div style={{ display: 'grid', gap: 16 }}>
      <h2 style={{ margin: 0 }}>News</h2>

      {err && (
        <div style={{ padding: 10, border: '1px solid #f5c2c7', background: '#f8d7da', color: '#842029', borderRadius: 8 }}>
          {err}
        </div>
      )}

      {/* Add / Edit form */}
      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 8 }}>
        <label style={{ display: 'grid', gap: 6 }}>
          <span>Text</span>
          <input
            type="text"
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="News text to show in the ticker"
            style={{ padding: '10px 12px', border: '1px solid #cfd6e4', borderRadius: 10 }}
          />
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="submit" style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #90caf9', background: '#e3f2fd' }}>
            {isEditing ? 'Save' : 'Add'}
          </button>
          {isEditing && (
            <button type="button" onClick={cancelEdit} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #cfd6e4', background: '#fff' }}>
              Cancel
            </button>
          )}
        </div>
      </form>

      {/* Current news list with Edit/Delete */}
      <div style={{ border: '1px solid #e3e7ef', borderRadius: 12, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead style={{ background: '#f3f6ff' }}>
            <tr>
              <th style={{ textAlign: 'right', padding: 10, borderBottom: '1px solid #e3e7ef' }}>Text</th>
              <th style={{ width: 120, borderBottom: '1px solid #e3e7ef' }} />
            </tr>
          </thead>
          <tbody>
            {items.map(n => (
              <tr key={n.id}>
                <td style={{ padding: 10, borderBottom: '1px solid #eef2fa' }}>
                  <div title={n.text} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {n.text}
                  </div>
                </td>
                <td style={{ padding: 10, borderBottom: '1px solid #eef2fa' }}>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <button
                      onClick={() => startEdit(n)}
                      style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #cfd6e4', background: '#fff', cursor: 'pointer' }}
                      title="Edit"
                    >
                      ✎
                    </button>
                    <button
                      onClick={() => handleDelete(n.id)}
                      style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #ffcdd2', background: '#ffebee', cursor: 'pointer' }}
                      title="Delete"
                    >
                      🗑
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={2} style={{ padding: 16, textAlign: 'center', color: '#667085' }}>
                  No news yet. Add one above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
