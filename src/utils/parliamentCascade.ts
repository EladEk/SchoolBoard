import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase/app';

const BATCH_LIMIT = 400;

async function deleteNotesForSubject(subjectId: string) {
  const notesCol = collection(db, 'parliamentSubjects', subjectId, 'notes');
  const notesSnap = await getDocs(notesCol);

  if (notesSnap.empty) return;

  let batch = writeBatch(db);
  let ops = 0;

  for (const nDoc of notesSnap.docs) {
    batch.delete(doc(db, 'parliamentSubjects', subjectId, 'notes', nDoc.id));
    ops++;
    if (ops % BATCH_LIMIT === 0) {
      await batch.commit();
      batch = writeBatch(db);
    }
  }
  if (ops % BATCH_LIMIT !== 0) {
    await batch.commit();
  }
}

/**
 * Deletes a parliament date AND all related subjects (and their notes).
 * Use with care – this is irreversible.
 */
export async function deleteParliamentDateCascade(dateId: string) {
  // 1) collect all subjects for the date
  const subjectsQ = query(
    collection(db, 'parliamentSubjects'),
    where('dateId', '==', dateId)
  );
  const subjectsSnap = await getDocs(subjectsQ);

  // 2) delete notes for each subject, then delete the subject itself (batched)
  let batch = writeBatch(db);
  let ops = 0;

  for (const sDoc of subjectsSnap.docs) {
    // delete subcollection /notes
    await deleteNotesForSubject(sDoc.id);

    // delete subject
    batch.delete(doc(db, 'parliamentSubjects', sDoc.id));
    ops++;
    if (ops % BATCH_LIMIT === 0) {
      await batch.commit();
      batch = writeBatch(db);
    }
  }
  if (ops % BATCH_LIMIT !== 0) {
    await batch.commit();
  }

  // 3) finally delete the date doc
  await deleteDoc(doc(db, 'parliamentDates', dateId));
}
