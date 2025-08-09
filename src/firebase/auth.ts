import { signInWithEmailAndPassword, signOut, onAuthStateChanged, User } from 'firebase/auth'
import { auth } from './app'
import { doc, getDoc } from 'firebase/firestore'
import { db } from './app'

export function login(email: string, password: string) {
  return signInWithEmailAndPassword(auth, email, password)
}

export function logout() {
  return signOut(auth)
}

export function onUser(callback: (u: User | null) => void) {
  return onAuthStateChanged(auth, callback)
}

export interface AppUser {
  uid: string
  name: string
  role: 'admin' | 'teacher' | 'student'|'kiosk'
}

export async function fetchAppUser(uid: string): Promise<AppUser | null> {
  const snap = await getDoc(doc(db, 'users', uid))
  if (!snap.exists()) return null
  const d = snap.data() as any
  return { uid, name: d.name || '', role: d.role || 'student' }
}