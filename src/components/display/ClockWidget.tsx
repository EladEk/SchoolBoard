import React, { useEffect, useState } from 'react'

export default function ClockWidget() {
  const [t, setT] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setT(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  const hh = String(t.getHours()).padStart(2,'0')
  const mm = String(t.getMinutes()).padStart(2,'0')
  return (
    <div style={{fontSize:'6rem', fontWeight:700}}>
      {hh}<span className="blink-colon">:</span>{mm}
    </div>
  )
}