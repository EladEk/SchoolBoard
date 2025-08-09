export function nowTimeHHMM() {
  const now = new Date()
  return now.toTimeString().slice(0,5)
}
export function todayDow(): number {
  // Sunday = 0
  return new Date().getDay()
}
export function between(time: string, start: string, end: string) {
  return start <= time && time <= end
}