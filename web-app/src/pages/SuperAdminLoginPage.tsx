import { useState } from 'react'
import { useNavigate, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { ThemeToggle } from '../components/ThemeToggle'
import { apiClient } from '../api/apiClient'

export default function SuperAdminLoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const { login, user, ready } = useAuth()
  const navigate = useNavigate()

  if (ready && user) {
    if (user.role === 'SuperAdmin') return <Navigate to="/admin" replace />
    return <Navigate to="/mfa" replace />
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const { token } = await apiClient.post<{ token: string }>('/auth/login', {
        tenantDomain: '',
        username,
        password,
      })
      login(token)
      navigate('/admin')
    } catch {
      setError('Invalid username or password.')
      setPassword('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={styles.root}>
      <div style={{ position: 'absolute', top: 16, right: 16 }}>
        <ThemeToggle />
      </div>
      <div style={styles.card}>
        <div style={styles.logo}>
          <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
            <rect width="36" height="36" rx="10" fill="#6c63ff" fillOpacity="0.15"/>
            <path d="M18 8l8 4.5v9L18 26l-8-4.5v-9L18 8z" stroke="#6c63ff" strokeWidth="1.8" fill="none"/>
            <circle cx="18" cy="18" r="3.5" fill="#6c63ff"/>
          </svg>
        </div>
        <h1 style={styles.title}>Admin Sign In</h1>
        <p style={styles.subtitle}>Super Admin access only</p>
        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.field}>
            <label htmlFor="username" style={styles.label}>Username</label>
            <input
              id="username"
              className="input"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter your username"
              autoComplete="username"
              autoFocus
              required
            />
          </div>
          <div style={styles.field}>
            <label htmlFor="password" style={styles.label}>Password</label>
            <input
              id="password"
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              autoComplete="current-password"
              required
            />
          </div>
          {error && <div className="alert alert-error" role="alert">{error}</div>}
          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading}
            style={{ width: '100%', padding: '10px', marginTop: 4 }}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    minHeight: '100svh',
    position: 'relative',
  },
  card: {
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '40px 36px',
    width: '100%',
    maxWidth: 380,
    boxShadow: 'var(--shadow)',
  },
  logo: { display: 'flex', justifyContent: 'center', marginBottom: 20 },
  title: { textAlign: 'center', fontSize: '1.5rem', marginBottom: 6 },
  subtitle: { textAlign: 'center', color: 'var(--text-muted)', fontSize: 14, marginBottom: 28 },
  form: { display: 'flex', flexDirection: 'column', gap: 16 },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 13, fontWeight: 500, color: 'var(--text)' },
}
