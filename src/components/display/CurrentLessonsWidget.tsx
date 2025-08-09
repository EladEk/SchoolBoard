import React, { useEffect, useMemo, useState } from 'react'
import { collection, getDocs, onSnapshot, query, where, doc, getDoc } from 'firebase/firestore'
import { db } from '../../firebase/app'
import { todayDow, nowTimeHHMM, between } from '../../utils/time'

type Lesson = {
  id: string
  classId: string
  subjectId: string
  teacherId: string
  dayOfWeek: number
  start: string
  end: string
  overrideLocation?: string
}

export default function CurrentLessonsWidget() {
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [classes, setClasses] = useState<Record<string, any>>({})
  const [subjects, setSubjects] = useState<Record<string, any>>({})
  const [users, setUsers] = useState<Record<string, any>>({})
  const [index, setIndex] = useState(0)

  // subscribe to today's lessons
  useEffect(() => {
    const qToday = query(collection(db, 'lessons'), where('dayOfWeek', '==', todayDow()))
    const unsub = onSnapshot(qToday, async (snap) => {
      const ls: Lesson[] = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
      setLessons(ls)
      // prefetch referenced docs (classes, subjects, teachers)
      const classIds = [...new Set(ls.map(l => l.classId))]
      const subjectIds = [...new Set(ls.map(l => l.subjectId))]
      const teacherIds = [...new Set(ls.map(l => l.teacherId))]
      const [cls, sub, tchs] = await Promise.all([
        Promise.all(classIds.map(id => getDoc(doc(db, 'classes', id)))),
        Promise.all(subjectIds.map(id => getDoc(doc(db, 'subjects', id)))),
        Promise.all(teacherIds.map(id => getDoc(doc(db, 'users', id)))),
      ])
      const clsMap: any = {}; cls.forEach(s => s.exists() && (clsMap[s.id] = s.data()))
      const subMap: any = {}; sub.forEach(s => s.exists() && (subMap[s.id] = s.data()))
      const usrMap: any = {}; tchs.forEach(s => s.exists() && (usrMap[s.id] = s.data()))
      setClasses(clsMap); setSubjects(subMap); setUsers(usrMap)
    })
    return () => unsub()
  }, [])

  // rotate between multiple active lessons
  useEffect(() => {
    const id = setInterval(() => setIndex(i => i + 1), 5000)
    return () => clearInterval(id)
  }, [])

  const currentTime = nowTimeHHMM()
  const active = useMemo(() => lessons.filter(l => between(currentTime, l.start, l.end)), [lessons, currentTime])
  const showing = active.length ? active[index % active.length] : null

  if (!showing) return <div style={{padding: 16, fontSize: '2rem'}}>אין שיעור פעיל כרגע</div>

  const cls = classes[showing.classId] || {}
  const sub = subjects[showing.subjectId] || {}
  const tch = users[showing.teacherId] || {}

  const students: string[] = (cls.studentIds || []).slice(0, 60) // keep UI sane

  return (
    <div style={{padding: 16}}>
      <div style={{fontSize:'3rem', fontWeight:700}}>{sub.name || '—'}</div>
      <div style={{fontSize:'1.5rem', opacity:.8}}>כיתה: {cls.name || '—'} · מורה: {tch.name || '—'} · כיתה: {showing.overrideLocation || cls.location || '—'}</div>
      <div style={{marginTop:16, display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:8}}>
        {students.map((s,i) => <div key={i} style={{background:'#1a2140', padding:'8px 12px', borderRadius:8}}>{s}</div>)}
      </div>
    </div>
  )
}