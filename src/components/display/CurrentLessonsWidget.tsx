import { useEffect, useMemo, useState } from 'react'
import { collection, getDocs, query, where, orderBy, limit } from 'firebase/firestore'
import { DateTime } from 'luxon'
import { db } from '../../firebase/app'

type ClassDoc = { id: string; name: string }
type LessonDoc = { id: string; name: string; teacherId: string; classId: string }
type Slot = { id: string; classId: string; lessonId: string; day: number; startMinutes: number; endMinutes: number }

function toHHMM(mins: number) {
  const h = String(Math.floor(mins / 60)).padStart(2, '0')
  const m = String(mins % 60).padStart(2, '0')
  return `${h}:${m}`
}

export default function CurrentLessonsWidget({ classIds }: { classIds?: string[] }) {
  const [classes, setClasses] = useState<ClassDoc[]>([])
  const [lessons, setLessons] = useState<Record<string, LessonDoc>>({})
  const [rows, setRows] = useState<Array<{ className: string; now?: { lesson: string; start: string; end: string } }>>([])

  useEffect(() => {
    (async () => {
      // fetch classes (optionally filter by provided classIds)
      const cSnap = await getDocs(collection(db, 'classes'))
      const cs: ClassDoc[] = cSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
      const filtered = classIds?.length ? cs.filter(c => classIds.includes(c.id)) : cs
      setClasses(filtered)

      const lSnap = await getDocs(collection(db, 'lessons'))
      const lmap: Record<string, LessonDoc> = {}
      for (const d of lSnap.docs) lmap[d.id] = { id: d.id, ...(d.data() as any) }
      setLessons(lmap)
    })()
  }, [JSON.stringify(classIds || [])])

  useEffect(() => {
    (async () => {
      if (!classes.length) return
      const now = DateTime.now().setZone('Asia/Jerusalem')
      const day = now.weekday % 7
      const nowMinutes = now.hour * 60 + now.minute

      const out: Array<{ className: string; now?: { lesson: string; start: string; end: string } }> = []

      for (const c of classes) {
        const qSlots = query(
          collection(db, 'timetableEntries'),
          where('classId', '==', c.id),
          where('day', '==', day),
          orderBy('startMinutes', 'asc'),
          limit(30)
        )
        const sSnap = await getDocs(qSlots)
        const slots: Slot[] = sSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))

        let nowSlot: Slot | undefined
        for (const s of slots) {
          if (s.startMinutes <= nowMinutes && nowMinutes < s.endMinutes) { nowSlot = s; break }
        }

        out.push({
          className: c.name,
          now: nowSlot ? {
            lesson: lessons[nowSlot.lessonId]?.name ?? nowSlot.lessonId,
            start: toHHMM(nowSlot.startMinutes),
            end: toHHMM(nowSlot.endMinutes)
          } : undefined
        })
      }

      out.sort((a, b) => a.className.localeCompare(b.className))
      setRows(out)
    })()
  }, [classes, lessons])

  return (
    <div>
      <h3 style={{margin:'8px 0'}}>Now</h3>
      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))', gap:12}}>
        {rows.map((r, i) => (
          <div key={i} style={{background:'#111', padding:12, borderRadius:8}}>
            <div style={{fontWeight:700, fontSize:18}}>{r.className}</div>
            <div style={{marginTop:6, fontSize:16}}>
              {r.now ? (<span><strong>{r.now.lesson}</strong> ({r.now.start}–{r.now.end})</span>) : '—'}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
