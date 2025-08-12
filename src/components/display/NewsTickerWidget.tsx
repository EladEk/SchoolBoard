import { useEffect, useRef, useState } from 'react'
import { collection, onSnapshot, query } from 'firebase/firestore'
import { db } from '../../firebase/app'
import './NewsTickerWidget.css'

type Announcement = { id: string; text: string }

// Speed in px/sec (lower = slower)
const SPEED_DESKTOP = 80
const SPEED_MOBILE  = 50
const MOBILE_MAX    = 768
// Pause before starting slide (seconds)
const PAUSE_VISIBLE = 0.8

export default function NewsTickerWidget() {
  const [items, setItems] = useState<string[]>([])
  const [idx, setIdx] = useState(0)
  const [cycle, setCycle] = useState(0) // ← forces rerun even if idx doesn’t change

  const itemRef = useRef<HTMLSpanElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)

  // Live news
  useEffect(() => {
    const q1 = query(collection(db, 'announcements'))
    const unsub = onSnapshot(q1, snap => {
      const texts = snap.docs
        .sort((a, b) => a.id.localeCompare(b.id)) // stable order
        .map(d => String((d.data() as any)?.text ?? '').trim())
        .filter(Boolean)

      const list = texts.length ? texts : ['ברוכים הבאים ל-SchoolBoard! ⭐']
      setItems(list)
      setIdx(0)
      setCycle(0) // restart animation on data changes
    })
    return () => unsub()
  }, [])

  // Animate current item
  useEffect(() => {
    if (!items.length) return
    const el = itemRef.current
    const vp = viewportRef.current
    if (!el || !vp) return

    // Reset position (starts just after the label)
    el.style.transition = 'none'
    el.style.transform = 'translateX(0px)'

    // Measure
    const textWidth = el.scrollWidth
    const vpWidth   = vp.offsetWidth // space to the right of the label
    const speed     = (window.innerWidth <= MOBILE_MAX) ? SPEED_MOBILE : SPEED_DESKTOP
    const distance  = vpWidth + textWidth
    const duration  = Math.max(1, distance / speed) // seconds

    // Start at viewport left edge; end fully off the left side of the screen
    const startX = 0
    const endX   = -(textWidth + vpWidth)

    // Readability pause then slide
    // force reflow before applying transition
    const delay = window.setTimeout(() => {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      el.offsetHeight
      el.style.transition = `transform ${duration}s linear`
      el.style.transform  = `translateX(${endX}px)`
    }, PAUSE_VISIBLE * 1000)

    const advance = () => {
      if (items.length === 1) {
        // single item → bump cycle to re-run effect
        setCycle(c => c + 1)
      } else {
        setIdx(prev => (prev + 1) % items.length)
      }
    }

    const onEnd = () => {
      el.removeEventListener('transitionend', onEnd)
      advance()
    }
    el.addEventListener('transitionend', onEnd)

    // Fallback in case transitionend is missed
    const fallback = window.setTimeout(() => {
      el.removeEventListener('transitionend', onEnd)
      advance()
    }, (PAUSE_VISIBLE + duration + 0.2) * 1000)

    // Restart current item on resize (keeps full-width travel)
    const onResize = () => {
      if (items.length === 1) setCycle(c => c + 1)
      else setIdx(i => i)
    }
    window.addEventListener('resize', onResize)

    return () => {
      window.clearTimeout(delay)
      window.clearTimeout(fallback)
      el.removeEventListener('transitionend', onEnd)
      window.removeEventListener('resize', onResize)
    }
  }, [items, idx, cycle])

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
