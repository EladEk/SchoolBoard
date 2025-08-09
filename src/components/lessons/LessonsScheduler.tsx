import { useEffect, useMemo, useState } from 'react'
import { addDoc, collection, deleteDoc, doc, getDocs, orderBy, query, where } from 'firebase/firestore'
import { db } from '../../firebase/app'

const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

function toMinutes(hm: string) {
  const [h,m] = hm.split(':').map(Number)
  return h*60 + m
}

export default function LessonsScheduler() {
  const [classes, setClasses] = useState<any[]>([])
  const [lessons, setLessons] = useState<any[]>([])
  const [selectedClass, setSelectedClass] = useState<string>('')
  const [timeSlots, setTimeSlots] = useState<string[]>(['08:00','08:45','09:30','10:15','11:00','11:45','12:30','13:15'])
  const [entries, setEntries] = useState<any[]>([])

  useEffect(() => {
    (async () => {
      const clsSnap = await getDocs(collection(db, 'classes'))
      setClasses(clsSnap.docs.map(d => ({ id:d.id, ...(d.data() as any) })))

      const lSnap = await getDocs(collection(db, 'lessons'))
      setLessons(lSnap.docs.map(d => ({ id:d.id, ...(d.data() as any) })))
    })()
  }, [])

  useEffect(() => {
    (async () => {
      if (!selectedClass) return
      const q1 = query(
        collection(db, 'timetableEntries'),
        where('classId', '==', selectedClass),
        orderBy('day', 'asc'),
        orderBy('startMinutes', 'asc')
      )
      const snap = await getDocs(q1)
      setEntries(snap.docs.map(d => ({ id:d.id, ...(d.data() as any) })))
    })()
  }, [selectedClass])

  const lessonsForClass = useMemo(() => lessons.filter(l => l.classId === selectedClass), [lessons, selectedClass])

  async function toggleCell(dayIdx: number, slotIdx: number, lessonId: string) {
    if (!selectedClass || !lessonId) return
    const start = timeSlots[slotIdx]
    const end = timeSlots[slotIdx+1]
    if (!end) return

    const startMinutes = toMinutes(start)
    const endMinutes = toMinutes(end)

    const existing = entries.find(e => e.day===dayIdx && e.classId===selectedClass && e.startMinutes===startMinutes && e.endMinutes===endMinutes)
    if (existing) {
      await deleteDoc(doc(db, 'timetableEntries', existing.id))
      setEntries(prev => prev.filter(x => x.id !== existing.id))
    } else {
      const ref = await addDoc(collection(db, 'timetableEntries'), {
        classId: selectedClass,
        lessonId,
        day: dayIdx,
        startMinutes,
        endMinutes,
        createdBy: 'EDITOR'
      })
      setEntries(prev => prev.concat([{ id: ref.id, classId: selectedClass, lessonId, day: dayIdx, startMinutes, endMinutes }]))
    }
  }

  return (
    <div style={{padding:16}}>
      <h2>Lessons Scheduler</h2>

      <div style={{display:'flex', gap:12, alignItems:'center', marginBottom:16}}>
        <label>Class:</label>
        <select value={selectedClass} onChange={e=>setSelectedClass(e.target.value)}>
          <option value="">Select</option>
          {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        <label>Slots:</label>
        <select onChange={e=>{
          const v = e.target.value
          if (v === '40m') setTimeSlots(['08:00','08:40','09:20','10:00','10:40','11:20','12:00','12:40'])
          if (v === '45m') setTimeSlots(['08:00','08:45','09:30','10:15','11:00','11:45','12:30','13:15'])
        }}>
          <option value="custom">Preset</option>
          <option value="40m">40m</option>
          <option value="45m">45m</option>
        </select>

        <label>Lesson:</label>
        <select id="lessonPick">
          <option value="">Pick lesson…</option>
          {lessonsForClass.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </div>

      {selectedClass && (
        <div style={{overflowX:'auto'}}>
          <table style={{borderCollapse:'collapse', minWidth:900}}>
            <thead>
              <tr>
                <th style={{borderBottom:'1px solid #ccc', padding:8}}>Day / Time</th>
                {timeSlots.slice(0,-1).map((t, i) => (
                  <th key={i} style={{borderBottom:'1px solid #ccc', padding:8}}>{t}–{timeSlots[i+1]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DAYS.map((d, dayIdx) => (
                <tr key={d}>
                  <td style={{borderRight:'1px solid #ccc', padding:8, fontWeight:600}}>{d}</td>
                  {timeSlots.slice(0,-1).map((_, slotIdx) => {
                    const sm = toMinutes(timeSlots[slotIdx])
                    const em = toMinutes(timeSlots[slotIdx+1])
                    const cell = entries.find(e => e.day===dayIdx && e.startMinutes===sm && e.endMinutes===em && e.classId===selectedClass)
                    const lesson = cell ? lessons.find(l => l.id === cell.lessonId) : null
                    return (
                      <td key={slotIdx}
                          onClick={()=>{
                            const el = document.getElementById('lessonPick') as HTMLSelectElement | null
                            const lessonId = el?.value || ''
                            if (!lessonId) { alert('Pick a lesson first'); return }
                            toggleCell(dayIdx, slotIdx, lessonId)
                          }}
                          title={lesson ? lesson.name : 'Empty'}
                          style={{border:'1px solid #e6e6e6', padding:10, cursor:'pointer', background: lesson ? '#e6f7ff' : 'transparent'}}>
                        {lesson ? lesson.name : ''}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
