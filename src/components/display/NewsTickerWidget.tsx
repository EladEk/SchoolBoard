import { useEffect, useRef, useState } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { DateTime } from 'luxon'
import { db } from '../../firebase/app'

type Announcement = { id: string; type: 'news'|'birthday'; text: string; startAt?: any; endAt?: any }

export default function NewsTickerWidget() {
  const [items, setItems] = useState<string[]>([])
  const [idx, setIdx] = useState(0)
  const intervalRef = useRef<number | null>(null)

  useEffect(() => {
    (async () => {
      const now = DateTime.now()
      const q1 = query(collection(db, 'announcements'), where('type', '==', 'news'))
      const snap = await getDocs(q1)
      const active: string[] = []
      for (const d of snap.docs) {
        const a = { id: d.id, ...(d.data() as any) } as Announcement
        const start = a.startAt?.toDate ? a.startAt.toDate() : null
        const end = a.endAt?.toDate ? a.endAt.toDate() : null
        if ((start == null || start <= now.toJSDate()) && (end == null || end >= now.toJSDate())) {
          active.push(a.text)
        }
      }
      setItems(active.length ? active : ['Welcome to SchoolBoard!'])
    })()
  }, [])

  useEffect(() => {
    if (intervalRef.current) window.clearInterval(intervalRef.current)
    intervalRef.current = window.setInterval(() => {
      setIdx(i => (i + 1) % items.length)
    }, 8000)
    return () => { if (intervalRef.current) window.clearInterval(intervalRef.current) }
  }, [items])

  return (
    <div style={{overflow:'hidden', whiteSpace:'nowrap', background:'#0a0a0a', borderRadius:8, padding:'8px 12px', border:'1px solid #1f1f1f'}}>
      <span style={{opacity:0.6, marginRight:12}}>NEWS</span>
      <span style={{display:'inline-block', animation:'ticker 8s linear infinite'}} key={idx}>
        {items[idx]}
      </span>
      <style>{`
        @keyframes ticker {
          0% { transform: translateX(100%); }
          100% { transform: translateX(-100%); }
        }
      `}</style>
    </div>
  )
}
