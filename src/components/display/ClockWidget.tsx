import React, { useEffect, useState } from 'react';
import './ClockWidget.css';

const pad = (n: number) => String(n).padStart(2, '0');

export default function ClockWidget() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const hh = pad(now.getHours());
  const mm = pad(now.getMinutes());

  return (
    // Force LTR so RTL pages don’t flip to MM:HH
    <div className="clock-widget" dir="ltr" aria-label="current time">
      <span>{hh}</span>
      <span className="blink-colon">:</span>
      <span>{mm}</span>
    </div>
  );
}
