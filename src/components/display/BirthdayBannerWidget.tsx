import React, { useEffect, useState } from 'react'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import { db } from '../../firebase/app'

export default function BirthdayBannerWidget() {
  const [visible, setVisible] = useState(false)
  const [items, setItems] = useState<string[]>([])

  useEffect(() => {
    const cfgDoc = { bannerIntervalSec: 300, bannerDurationSec: 30 }
    const show = () => {
      setVisible(true)
      setTimeout(() => setVisible(false), cfgDoc.bannerDurationSec * 1000)
    }
    const id = setInterval(show, cfgDoc.bannerIntervalSec * 1000)
    show()
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const now = new Date()
    const q = query(
      collection(db, 'announcements'),
      where('type', '==', 'birthday'),
      where('startAt', '<=', now),
      where('endAt', '>=', now)
    )
    const unsub = onSnapshot(q, s => setItems(s.docs.map(d => (d.data() as any).text)))
    return () => unsub()
  }, [])

  if (!visible || items.length === 0) return null
  return (
    <div style={{position:'fixed', top:0, left:0, right:0, background:'#222', color:'#fff', padding:'16px', textAlign:'center', zIndex:10}}>
      <strong>ימי הולדת השבוע:</strong>&nbsp;
      {items.join(' · ')}
    </div>
  )
}