import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

admin.initializeApp();
const db = admin.firestore();
const auth = admin.auth();

async function requireAdmin(context: functions.https.CallableContext) {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in');
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists || snap.get('role') !== 'admin') {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }
}

function synthEmail(username: string) {
  return `${username.toLowerCase()}@school.local`;
}

async function usernameExists(username: string, excludeUid?: string) {
  const snap = await db.collection('users')
    .where('username', '==', username.toLowerCase())
    .limit(1).get();
  if (snap.empty) return false;
  const doc = snap.docs[0];
  return !excludeUid || doc.id !== excludeUid;
}

export const createUserAccount = functions.https.onCall(async (data, context) => {
  await requireAdmin(context);
  const { username, password, name, role } = data as any;
  if (!username || !password || !name || !role) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing fields');
  }
  if (await usernameExists(username)) {
    throw new functions.https.HttpsError('already-exists', 'Username taken');
  }
  const userRecord = await auth.createUser({
    email: synthEmail(username),
    password,
    displayName: name,
    emailVerified: true
  });
  await db.collection('users').doc(userRecord.uid).set({
    username: username.toLowerCase(),
    name,
    role
  }, { merge: true });
  return { uid: userRecord.uid };
});

export const updateUserAccount = functions.https.onCall(async (data, context) => {
  await requireAdmin(context);
  const { uid, username, name, role, password } = data as any;
  if (!uid) throw new functions.https.HttpsError('invalid-argument', 'uid required');

  const updates: admin.auth.UpdateRequest = {};
  const profileUpdates: Record<string, any> = {};

  if (username) {
    if (await usernameExists(username, uid)) {
      throw new functions.https.HttpsError('already-exists', 'Username taken');
    }
    updates.email = synthEmail(username);
    profileUpdates.username = username.toLowerCase();
  }
  if (name) { updates.displayName = name; profileUpdates.name = name; }
  if (role) { profileUpdates.role = role; }
  if (password) { updates.password = password; }

  if (Object.keys(updates).length) await auth.updateUser(uid, updates);
  if (Object.keys(profileUpdates).length) {
    await db.collection('users').doc(uid).set(profileUpdates, { merge: true });
  }
  return { uid };
});

export const deleteUserAccount = functions.https.onCall(async (data, context) => {
  await requireAdmin(context);
  const { uid } = data as any;
  if (!uid) throw new functions.https.HttpsError('invalid-argument', 'uid required');
  await auth.deleteUser(uid);
  await db.collection('users').doc(uid).delete();
  return { uid };
});
