// Centralized timetable constants — single source of truth for days & time slots.
// Edit TIME_POINTS below to change the whole app's bell schedule alignment.
// Sunday = 0 (like JS Date.getDay()). Times use [start,end) in minutes from midnight.

export type TimePoint = string; // 'HH:MM'
export type TimeSlot = { start: TimePoint; end: TimePoint; sm: number; em: number };

export function toMinutes(hm: string){ const [h,m]=hm.split(':').map(Number); return h*60+m; }
export function toHHMM(mins: number){
  const h = String(Math.floor(mins/60)).padStart(2,'0');
  const m = String(mins%60).padStart(2,'0');
  return `${h}:${m}`;
}

// Which days to show and in what order (Sun..Fri by default)
export const DAY_ORDER: number[] = [0,1,2,3,4,5];

// *** EDIT HERE *** — your bell schedule
export const TIME_POINTS: TimePoint[] = [
  '08:00','08:45','09:30','10:15','11:00','11:45','12:30','13:15','14:00'
];

// Derived slots from TIME_POINTS
export const SLOTS: TimeSlot[] = TIME_POINTS.slice(0,-1).map((start, i) => {
  const end = TIME_POINTS[i+1]!;
  return { start, end, sm: toMinutes(start), em: toMinutes(end) };
});
