import { useState, useEffect } from 'react'
import { useNavigate, Navigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { ThemeToggle } from '../components/ThemeToggle'
import { apiClient } from '../api/apiClient'

interface ResolvedTenant {
  name: string
  domain: string
  loginInstructions: string | null
  isDisabled: boolean
}

export default function LoginPage() {
  const { tenantDomain: tenantDomainParam } = useParams<{ tenantDomain?: string }>()

  const [step, setStep] = useState<'tenant' | 'credentials' | 'register'>(
    tenantDomainParam ? 'credentials' : 'tenant'
  )
  const [resolvedTenant, setResolvedTenant] = useState<ResolvedTenant | null>(null)
  const [domain, setDomain] = useState(() => tenantDomainParam ?? localStorage.getItem('lastTenantDomain') ?? '')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  // register form state
  const [regOrgName, setRegOrgName] = useState('')
  const [regDomain, setRegDomain] = useState('')
  const [regUsername, setRegUsername] = useState('')
  const [regPassword, setRegPassword] = useState('')

  const { login, user, ready } = useAuth()
  const navigate = useNavigate()

  // Auto-resolve tenant when URL param is present
  useEffect(() => {
    if (!tenantDomainParam) return
    setLoading(true)
    setError(null)
    apiClient.get<ResolvedTenant>(`/auth/tenant/${tenantDomainParam}`)
      .then((tenant) => {
        if (tenant.isDisabled) {
          setError('This organisation has been disabled. Please contact support.')
          setStep('tenant')
          return
        }
        setResolvedTenant(tenant)
        setStep('credentials')
      })
      .catch(() => {
        setError('Tenant not found. Please check the URL or enter your tenant domain below.')
        setStep('tenant')
      })
      .finally(() => setLoading(false))
  }, [tenantDomainParam])

  if (ready && user) {
    if (user.role === 'SuperAdmin') return <Navigate to="/admin" replace />
    if (user.role === 'TenantAdmin') return <Navigate to="/tenant" replace />
    return <Navigate to="/mfa" replace />
  }

  async function handleTenantSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const tenant = await apiClient.get<ResolvedTenant>(`/auth/tenant/${domain}`)
      if (tenant.isDisabled) {
        setError('This organisation has been disabled. Please contact support.')
        return
      }
      setResolvedTenant(tenant)
      setStep('credentials')
    } catch {
      setError('Tenant not found. Please check the domain and try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleCredentialsSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const { token } = await apiClient.post<{ token: string }>('/auth/login', {
        tenantDomain: resolvedTenant?.domain ?? '',
        username,
        password,
      })
      login(token)
      localStorage.setItem('lastTenantDomain', resolvedTenant?.domain ?? '')
      const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
      if (payload.role === 'SuperAdmin') navigate('/admin')
      else if (payload.role === 'TenantAdmin') navigate('/tenant')
      else navigate('/mfa')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ''
      if (msg === 'tenant_disabled') {
        setError('This organisation has been disabled. Please contact support.')
      } else if (msg === 'user_disabled') {
        setError('Your account has been disabled. Please contact your administrator.')
      } else {
        setError('Invalid username or password.')
      }
      setPassword('')
    } finally {
      setLoading(false)
    }
  }

  function handleBack() {
    setStep('tenant')
    setError(null)
    setUsername('')
    setPassword('')
  }

  async function handleRegisterSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const { token } = await apiClient.post<{ token: string }>('/auth/register-org', {
        orgName: regOrgName,
        domain: regDomain,
        username: regUsername,
        password: regPassword,
      })
      login(token)
      localStorage.setItem('lastTenantDomain', regDomain)
      navigate('/tenant')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : ''
      if (msg === 'name_taken') setError('An organisation with that name already exists.')
      else if (msg === 'domain_taken') setError('That domain is already taken.')
      else if (msg === 'invalid_domain') setError('Domain must be lowercase letters, numbers, dots, and hyphens only (e.g. acme-corp).')
      else setError('Could not create organisation. Please try again.')
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

        {step === 'tenant' && (
          <>
            <h1 style={styles.title}>Welcome back</h1>
            <p style={styles.subtitle}>Enter your organisation's domain to continue</p>
            <form onSubmit={handleTenantSubmit} style={styles.form}>
              <div style={styles.field}>
                <label htmlFor="domain" style={styles.label}>Tenant Domain</label>
                <input
                  id="domain"
                  className="input"
                  type="text"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  placeholder="e.g. acme-corp"
                  autoComplete="organization"
                  autoFocus
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
                {loading ? 'Looking up…' : 'Continue'}
              </button>
            </form>
            <div style={{ textAlign: 'center', marginTop: 20, fontSize: 13, color: 'var(--text-muted)' }}>
              New here?{' '}
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => { setStep('register'); setError(null) }}
                style={{ fontSize: 13, padding: '3px 5px', color: 'var(--color-primary, #6c63ff)' }}
              >
                Create new organisation
              </button>
            </div>
          </>
        )}

        {step === 'credentials' && (
          <>
            <h1 style={styles.title}>Sign in</h1>
            {resolvedTenant && (
              <p style={styles.subtitle}>{resolvedTenant.name}</p>
            )}
            {resolvedTenant?.loginInstructions && (
              <div style={styles.instructions}>{resolvedTenant.loginInstructions}</div>
            )}
            <form onSubmit={handleCredentialsSubmit} style={styles.form}>
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
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={handleBack}
                style={{ fontSize: 13, color: 'var(--text-muted)' }}
              >
                ← Back
              </button>
            </div>
          </>
        )}

        {step === 'register' && (
          <>
            <h1 style={styles.title}>Create organisation</h1>
            <p style={styles.subtitle}>Set up your organisation and admin account</p>
            <form onSubmit={handleRegisterSubmit} style={styles.form}>
              <div style={styles.field}>
                <label htmlFor="reg-org-name" style={styles.label}>Organisation name</label>
                <input
                  id="reg-org-name"
                  className="input"
                  type="text"
                  value={regOrgName}
                  onChange={(e) => setRegOrgName(e.target.value)}
                  placeholder="e.g. Acme Corp"
                  autoFocus
                  required
                />
              </div>
              <div style={styles.field}>
                <label htmlFor="reg-domain" style={styles.label}>Domain</label>
                <input
                  id="reg-domain"
                  className="input"
                  type="text"
                  value={regDomain}
                  onChange={(e) => setRegDomain(e.target.value.toLowerCase().replace(/[^a-z0-9.-]/g, ''))}
                  placeholder="e.g. acme-corp"
                  required
                />
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Lowercase letters, numbers, hyphens, and dots only</span>
              </div>
              <div style={styles.field}>
                <label htmlFor="reg-username" style={styles.label}>Admin username</label>
                <input
                  id="reg-username"
                  className="input"
                  type="text"
                  value={regUsername}
                  onChange={(e) => setRegUsername(e.target.value)}
                  placeholder="Choose a username"
                  autoComplete="username"
                  required
                />
              </div>
              <div style={styles.field}>
                <label htmlFor="reg-password" style={styles.label}>Admin password</label>
                <input
                  id="reg-password"
                  className="input"
                  type="password"
                  value={regPassword}
                  onChange={(e) => setRegPassword(e.target.value)}
                  placeholder="Choose a password"
                  autoComplete="new-password"
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
                {loading ? 'Creating…' : 'Create organisation'}
              </button>
            </form>
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => { setStep('tenant'); setError(null) }}
                style={{ fontSize: 13, color: 'var(--text-muted)' }}
              >
                ← Back to sign in
              </button>
            </div>
          </>
        )}
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
  instructions: {
    background: 'var(--bg-subtle, var(--bg-surface))',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '10px 14px',
    fontSize: 13,
    color: 'var(--text)',
    marginBottom: 8,
    whiteSpace: 'pre-wrap',
  },
}
