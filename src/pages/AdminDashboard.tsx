import AdminUsers from '../components/admin/AdminUsers';
import ClassesEditor from '../components/admin/ClassesEditor';
import LessonsScheduler from '../components/lessons/LessonsScheduler';

export default function AdminDashboard() {
  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <h1>Admin</h1>
      <AdminUsers />
      <ClassesEditor />
      <LessonsScheduler />
    </div>
  );
}
