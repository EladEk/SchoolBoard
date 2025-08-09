# School Display — React + Firebase

Corridor display for current lessons, with roles (admin / teacher / student), kiosk `/display`, and Firebase Auth + Firestore.

## Quick start

1. **Install**

```bash
npm i
```

2. **Create `.env.local`** with your Firebase web config:

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

3. **Firestore rules**

```bash
firebase deploy --only firestore:rules
```

4. **Run**

```bash
npm run dev
```

Open http://localhost:5173

### Kiosk
Open `/display` (no login). Use Firebase App Check if you want to lock it down further.

### Data model
- `users/{uid}`: `{ name, role }`
- `classes/{id}`: `{ name, teacherId, location, studentIds: string[] }`
- `subjects/{id}`: `{ name }`
- `lessons/{id}`: `{ classId, subjectId, teacherId, dayOfWeek, start, end, overrideLocation? }`
- `announcements/{id}`: `{ type: 'news'|'birthday', text, startAt, endAt }`
- `display_config/singleton`: `{ bannerIntervalSec, bannerDurationSec }`

### Import from your old Excel
Place `database.xlsx` next to `tools/importFromXlsx.js`, add your `serviceAccount.json` (from Firebase), then:

```bash
npm run import:xlsx
```

> The import script is a template — adjust the sheet/column names to match your file.

## Notes
- Role-based guards are implemented client-side; Firestore security rules enforce them server-side.
- The display view rotates active lessons and shows a Hebrew RTL clock with a blinking colon, plus ticker and birthday banner."# SchoolBoard" 
