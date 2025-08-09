import React, { useEffect, useRef, useState } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../../firebase/app'

export default function NewsTickerWidget() {
  const [items, setItems] = useState<string[]>([])
  const [offset, setOffset] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const now = new Date()
    const q = query(
      collection(db, 'announcements'),
      where('type', '==', 'news'),
      where('startAt', '<=', now),
      where('endAt', '>=', now)
    )
    const unsub = onSnapshot(q, (snap) => {
      setItems(snap.docs.map(d => (d.data() as any).text).filter(Boolean))
    })
    return () => unsub()
  }, [])

  useEffect(() => {
    let id: any
    function tick() {
      if (!ref.current || !inner.current) return
      const total = inner.current.scrollWidth
      setOffset(v => {
        const next = (v - 1)
        if (-next > total) return ref.current!.offsetWidth
        return next
      })
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [items])

  return (
    <div className="ticker" ref={ref}>
      <div ref={inner} className="ticker-inner" style={{ transform: `translateX(${offset}px)` }}>
        {(items.length ? items : ['ברוכים הבאים']).map((t, i) => (
          <span className="ticker-item" key={i}>{t}</span>
        ))}
      </div>
    </div>
  )
}