import Link from 'next/link';

export default function Home() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '2rem',
        padding: '2rem',
      }}
    >
      <h1 style={{ fontSize: '3rem', fontWeight: 800, letterSpacing: '-0.02em' }}>Calash</h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: '1.125rem' }}>
        Multiplayer card game — play with friends in real time.
      </p>
      <div style={{ display: 'flex', gap: '1rem' }}>
        <Link
          href="/auth/register"
          style={{
            background: 'var(--accent)',
            color: '#fff',
            padding: '0.75rem 1.5rem',
            borderRadius: '0.5rem',
            fontWeight: 600,
          }}
        >
          Get started
        </Link>
        <Link
          href="/auth/login"
          style={{
            background: 'var(--surface)',
            color: 'var(--text-primary)',
            padding: '0.75rem 1.5rem',
            borderRadius: '0.5rem',
            fontWeight: 600,
            border: '1px solid var(--border)',
          }}
        >
          Log in
        </Link>
      </div>
    </main>
  );
}
