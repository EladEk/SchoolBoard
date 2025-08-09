import * as admin from "firebase-admin";
import {
  onCall,
  HttpsError,
  CallableRequest,
} from "firebase-functions/v2/https";

admin.initializeApp();
const db = admin.firestore();
const auth = admin.auth();

/**
 * Ensure the caller is an admin based on /users/{uid}.role.
 * @returns caller uid if admin
 * @throws HttpsError if unauthenticated or not admin
 */
async function requireAdminForRequest(
  request: CallableRequest<unknown>,
): Promise<string> {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "Sign in");
  }
  const snap = await db.collection("users").doc(uid).get();
  const role = snap.exists ? (snap.get("role") as string | null) : null;
  if (role !== "admin") {
    throw new HttpsError("permission-denied", "Admin only");
  }
  return uid;
}

/** Build synthetic email from username (for password auth). */
function synthEmail(username: string): string {
  return `${username.toLowerCase()}@school.local`;
}

/** Check if a username already exists (case-insensitive). */
async function usernameExists(
  username: string,
  excludeUid?: string,
): Promise<boolean> {
  const snap = await db
    .collection("users")
    .where("username", "==", username.toLowerCase())
    .limit(1)
    .get();
  if (snap.empty) return false;
  const doc = snap.docs[0];
  return excludeUid ? doc.id !== excludeUid : true;
}

type Role = "admin" | "teacher" | "student" | "kiosk";

interface CreateUserData {
  username: string;
  password: string;
  name: string;
  role: Role;
}

interface UpdateUserData {
  uid: string;
  username?: string;
  name?: string;
  role?: Role;
  password?: string;
}

interface DeleteUserData {
  uid: string;
}

/** Admin-only: create user in Auth and profile in Firestore. */
export const createUserAccount = onCall<CreateUserData>(
  async (request): Promise<{ uid: string }> => {
    await requireAdminForRequest(request);
    const { username, password, name, role } = request.data;

    if (!username || !password || !name || !role) {
      throw new HttpsError("invalid-argument", "Missing fields");
    }
    if (await usernameExists(username)) {
      throw new HttpsError("already-exists", "Username taken");
    }

    const userRecord = await auth.createUser({
      email: synthEmail(username),
      password,
      displayName: name,
      emailVerified: true,
    });

    await db
      .collection("users")
      .doc(userRecord.uid)
      .set(
        { username: username.toLowerCase(), name, role },
        { merge: true },
      );

    return { uid: userRecord.uid };
  },
);

/** Admin-only: update user Auth fields and profile. */
export const updateUserAccount = onCall<UpdateUserData>(
  async (request): Promise<{ uid: string }> => {
    await requireAdminForRequest(request);
    const { uid, username, name, role, password } = request.data;

    if (!uid) {
      throw new HttpsError("invalid-argument", "uid required");
    }

    const updates: admin.auth.UpdateRequest = {};
    const profileUpdates: Record<string, unknown> = {};

    if (username) {
      if (await usernameExists(username, uid)) {
        throw new HttpsError("already-exists", "Username taken");
      }
      updates.email = synthEmail(username);
      profileUpdates.username = username.toLowerCase();
    }
    if (name) {
      updates.displayName = name;
      profileUpdates.name = name;
    }
    if (role) {
      profileUpdates.role = role;
    }
    if (password) {
      updates.password = password;
    }

    if (Object.keys(updates).length) {
      await auth.updateUser(uid, updates);
    }
    if (Object.keys(profileUpdates).length) {
      await db
        .collection("users")
        .doc(uid)
        .set(profileUpdates, { merge: true });
    }
    return { uid };
  },
);

/** Admin-only: delete user in Auth and profile in Firestore. */
export const deleteUserAccount = onCall<DeleteUserData>(
  async (request): Promise<{ uid: string }> => {
    await requireAdminForRequest(request);
    const { uid } = request.data;

    if (!uid) {
      throw new HttpsError("invalid-argument", "uid required");
    }

    await auth.deleteUser(uid);
    await db.collection("users").doc(uid).delete();
    return { uid };
  },
);
