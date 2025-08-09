import TeacherClassRoster from '../components/teacher/TeacherClassRoster';
import LessonsScheduler from '../components/lessons/LessonsScheduler';

export default function TeacherDashboard() {
  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <h1>Teacher</h1>
      <p>Manage your lesson schedule and the student roster of your classes.</p>
      <TeacherClassRoster />
      <LessonsScheduler />
    </div>
  );
}
