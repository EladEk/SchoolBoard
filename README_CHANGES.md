# School Display — Update Pack (Teachers can manage class rosters)

What's new in this pack:
- **Rules:** Teachers can now add/remove students (`studentIds`) **only** on classes they own. Admins still have full classes CRUD.
- **Teacher UI:** Added `TeacherClassRoster` so teachers can manage student lists for their classes.
- Kept the weekly **Lessons Scheduler** for Admin/Teacher, and Admin-only **ClassesEditor**.

## Files
- `firestore.rules`
- `src/pages/TeacherDashboard.tsx`
- `src/components/teacher/TeacherClassRoster.tsx`
- `src/components/lessons/LessonsScheduler.tsx`
- `src/components/admin/ClassesEditor.tsx`
- `src/pages/AdminDashboard.tsx`
- `functions/src/index.ts` (unchanged logic, doc-based admin auth)

## Deploy
1. Copy files into your repo at the same paths.
2. Update rules:
   ```bash
   firebase deploy --only firestore:rules
   ```
3. (If using functions) deploy them:
   ```bash
   cd functions
   npm i
   npm run build
   firebase deploy --only functions
   ```

## Notes
- Rules ensure teachers can't change `name`, `location`, or `teacherId` of a class — only `studentIds`.
- `TeacherClassRoster` loads all students (role=`student`) for quick selection; paginate if your list is large.
- Adjust `LessonsScheduler` time slots and days to match your bell schedule.
