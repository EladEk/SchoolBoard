import { useEffect, useRef, useState } from 'react'
import { collection, onSnapshot, query } from 'firebase/firestore'
import { db } from '../../firebase/app'
import './NewsTickerWidget.css'

type Announcement = { id: string; text: string }

// Speed in px/sec (lower = slower)
const SPEED_DESKTOP = 80
const SPEED_MOBILE = 50
const MOBILE_MAX = 768

// Pause before starting slide (seconds)
const PAUSE_VISIBLE = 0.8

export default function NewsTickerWidget() {
  const [items, setItems] = useState<string[]>([])
  const [idx, setIdx] = useState(0)
  const itemRef = useRef<HTMLSpanElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)

  // Fetch live news
  useEffect(() => {
    const q1 = query(collection(db, 'announcements'))
    const unsub = onSnapshot(q1, snap => {
      const texts = snap.docs
        .map(d => String((d.data() as any)?.text ?? '').trim())
        .filter(Boolean)
      setItems(texts.length ? texts : ['ברוכים הבאים לבית הספר דב"ש ⭐'])
      setIdx(0)
    })
    return () => unsub()
  }, [])

  // Animate current item
  useEffect(() => {
    if (!items.length) return
    const el = itemRef.current
    const vp = viewportRef.current
    if (!el || !vp) return

    const textWidth = el.scrollWidth
    const vpWidth = vp.offsetWidth // only the space to the right of the label
    const speed = (window.innerWidth <= MOBILE_MAX) ? SPEED_MOBILE : SPEED_DESKTOP
    const distance = vpWidth + textWidth
    const duration = Math.max(1, distance / speed) // seconds

    // Start just after label (position 0 inside viewport)
    const startX = 0
    // End fully past left edge of screen
    const endX = -(textWidth + vpWidth)

    // Reset and start from initial position
    el.style.transition = 'none'
    el.style.transform = `translateX(${startX}px)`

    // Delay start for readability
    const delay = setTimeout(() => {
      el.style.transition = `transform ${duration}s linear`
      el.style.transform = `translateX(${endX}px)`
    }, PAUSE_VISIBLE * 1000)

    const handleEnd = () => {
      el.removeEventListener('transitionend', handleEnd)
      setIdx(prev => (prev + 1) % items.length)
    }
    el.addEventListener('transitionend', handleEnd)

    const onResize = () => setIdx(i => i) // force re-run on resize
    window.addEventListener('resize', onResize)

    return () => {
      clearTimeout(delay)
      el.removeEventListener('transitionend', handleEnd)
      window.removeEventListener('resize', onResize)
    }
  }, [items, idx])

  if (!items.length) return null

  return (
    <div className="news-ticker" role="marquee" aria-label="School news">
      <span className="news-label" aria-hidden="true">📣 חדשות</span>
      <div className="news-viewport" ref={viewportRef}>
        <span ref={itemRef} className="news-item">
          {items[idx]}
        </span>
      </div>
    </div>
  )
}
