// src/pages/Unauthorized.tsx
export default function Unauthorized() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0b0b0b', color: '#fff' }}>
      <div style={{ textAlign: 'center' }}>
        <h1>🚫 Unauthorized</h1>
        <p>You do not have permission to view this page.</p>
        <a href="/" style={{ color: '#4da3ff', textDecoration: 'underline' }}>
          Go Home
        </a>
      </div>
    </div>
  );
}
