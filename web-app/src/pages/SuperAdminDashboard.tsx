import { useEffect, useState } from 'react'
import { apiClient } from '../api/apiClient'
import { useAuth } from '../context/AuthContext'
import { ThemeToggle } from '../components/ThemeToggle'

interface Tenant {
  id: string
  name: string
  domain: string
  isDisabled: boolean
  createdAt: string
}

interface TenantUser {
  id: string
  username: string
  role: string
  isDisabled: boolean
  createdAt: string
}

export default function SuperAdminDashboard() {
  const { logout, user } = useAuth()
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [tenantError, setTenantError] = useState<string | null>(null)

  const [tenantName, setTenantName] = useState('')
  const [tenantDomain, setTenantDomain] = useState('')
  const [domainError, setDomainError] = useState<string | null>(null)
  const [createTenantError, setCreateTenantError] = useState<string | null>(null)
  const [createTenantSuccess, setCreateTenantSuccess] = useState<string | null>(null)
  const [creatingTenant, setCreatingTenant] = useState(false)

  const [selectedTenantId, setSelectedTenantId] = useState('')
  const [expandedTenantId, setExpandedTenantId] = useState<string | null>(null)
  const [tenantUsers, setTenantUsers] = useState<Record<string, TenantUser[]>>({})
  const [tenantUsersLoading, setTenantUsersLoading] = useState<string | null>(null)

  const [adminUsername, setAdminUsername] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [createAdminError, setCreateAdminError] = useState<string | null>(null)
  const [createAdminSuccess, setCreateAdminSuccess] = useState<string | null>(null)
  const [creatingAdmin, setCreatingAdmin] = useState(false)

  async function handleToggleTenantUser(tenantId: string, userId: string, disable: boolean) {
    try {
      await apiClient.patch(`/admin/tenants/${tenantId}/users/${userId}/${disable ? 'disable' : 'enable'}`)
      setTenantUsers(prev => ({
        ...prev,
        [tenantId]: prev[tenantId].map(u => u.id === userId ? { ...u, isDisabled: disable } : u)
      }))
    } catch { /* ignore */ }
  }

  async function handleDeleteTenantUser(tenantId: string, userId: string) {
    if (!window.confirm('Delete this user?')) return
    try {
      await apiClient.delete(`/admin/tenants/${tenantId}/users/${userId}`)
      setTenantUsers(prev => ({
        ...prev,
        [tenantId]: prev[tenantId].filter(u => u.id !== userId)
      }))
    } catch { /* ignore */ }
  }

  async function handleToggleTenant(tenantId: string, disable: boolean) {
    try {
      await apiClient.patch(`/admin/tenants/${tenantId}/${disable ? 'disable' : 'enable'}`)
      await fetchTenants()
    } catch { /* ignore */ }
  }

  async function toggleTenantUsers(tenantId: string) {
    if (expandedTenantId === tenantId) {
      setExpandedTenantId(null)
      return
    }
    setExpandedTenantId(tenantId)
    if (tenantUsers[tenantId]) return
    setTenantUsersLoading(tenantId)
    try {
      const users = await apiClient.get<TenantUser[]>(`/admin/tenants/${tenantId}/users`)
      setTenantUsers(prev => ({ ...prev, [tenantId]: users }))
    } catch {
      setTenantUsers(prev => ({ ...prev, [tenantId]: [] }))
    } finally {
      setTenantUsersLoading(null)
    }
  }

  async function fetchTenants() {    try {
      const data = await apiClient.get<Tenant[]>('/admin/tenants')
      setTenants(data)
      setTenantError(null)
    } catch {
      setTenantError('Failed to load tenants.')
    }
  }

  useEffect(() => { fetchTenants() }, [])

  async function handleCreateTenant(e: React.FormEvent) {
    e.preventDefault()
    setCreateTenantError(null)
    setCreateTenantSuccess(null)
    const domainRegex = /^[a-z0-9]+(-[a-z0-9]+)*$/
    if (!domainRegex.test(tenantDomain)) {
      setDomainError('Domain must be lowercase alphanumeric, with optional hyphens (e.g. acme-corp)')
      return
    }
    setDomainError(null)
    setCreatingTenant(true)
    try {
      await apiClient.post('/admin/tenants', { name: tenantName, domain: tenantDomain })
      setCreateTenantSuccess(`Tenant "${tenantName}" created.`)
      setTenantName('')
      setTenantDomain('')
      await fetchTenants()
    } catch (err: unknown) {
      setCreateTenantError(err instanceof Error ? err.message : 'Failed to create tenant.')
    } finally {
      setCreatingTenant(false)
    }
  }

  async function handleCreateAdmin(e: React.FormEvent) {
    e.preventDefault()
    setCreateAdminError(null)
    setCreateAdminSuccess(null)
    setCreatingAdmin(true)
    try {
      await apiClient.post(`/admin/tenants/${selectedTenantId}/admins`, {
        username: adminUsername,
        password: adminPassword,
      })
      setCreateAdminSuccess(`Admin "${adminUsername}" created.`)
      setAdminUsername('')
      setAdminPassword('')
    } catch (err: unknown) {
      setCreateAdminError(err instanceof Error ? err.message : 'Failed to create tenant admin.')
    } finally {
      setCreatingAdmin(false)
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Super Admin</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>Signed in as {user?.username}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <ThemeToggle />
          <button className="btn btn-ghost" onClick={logout}>Sign out</button>
        </div>
      </div>

      {/* Tenants table */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2>Tenants</h2>
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{tenants.length} total</span>
        </div>
        {tenantError && <div className="alert alert-error">{tenantError}</div>}
        {tenants.length === 0 && !tenantError ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>No tenants yet. Create one below.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Domain</th>
                  <th>ID</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((t) => (
                  <>
                    <tr key={t.id}>
                      <td style={{ color: 'var(--text-strong)', fontWeight: 500 }}>
                        {t.name}
                        {t.isDisabled && <span className="badge badge-gray" style={{ marginLeft: 6 }}>Disabled</span>}
                      </td>
                      <td><code style={{ fontSize: 11 }}>{t.domain}</code></td>
                      <td><code style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t.id}</code></td>
                      <td>{new Date(t.createdAt).toLocaleDateString()}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            className={t.isDisabled ? 'btn btn-ghost' : 'btn btn-warning'}
                            style={{ fontSize: 12, padding: '4px 10px' }}
                            onClick={() => handleToggleTenant(t.id, !t.isDisabled)}
                          >
                            {t.isDisabled ? 'Enable' : 'Disable'}
                          </button>
                          <button
                            className="btn btn-ghost"
                            style={{ fontSize: 12, padding: '4px 10px' }}
                            onClick={() => toggleTenantUsers(t.id)}
                          >
                            {expandedTenantId === t.id ? 'Hide users' : 'View users'}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expandedTenantId === t.id && (
                      <tr key={`users-${t.id}`}>
                        <td colSpan={5} style={{ background: 'var(--bg-elevated)', padding: '12px 16px' }}>
                          {tenantUsersLoading === t.id ? (
                            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading…</span>
                          ) : (tenantUsers[t.id] ?? []).length === 0 ? (
                            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>No users.</span>
                          ) : (
                            <table style={{ width: '100%', fontSize: 13 }}>
                              <thead>
                                <tr>
                                  <th style={{ textAlign: 'left', paddingBottom: 6, color: 'var(--text-muted)', fontWeight: 500 }}>Username</th>
                                  <th style={{ textAlign: 'left', paddingBottom: 6, color: 'var(--text-muted)', fontWeight: 500 }}>Role</th>
                                  <th style={{ textAlign: 'left', paddingBottom: 6, color: 'var(--text-muted)', fontWeight: 500 }}>Created</th>
                                  <th style={{ textAlign: 'left', paddingBottom: 6, color: 'var(--text-muted)', fontWeight: 500 }}>Actions</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(tenantUsers[t.id] ?? []).map(u => (
                                  <tr key={u.id}>
                                    <td style={{ paddingBottom: 4 }}>
                                      {u.username}
                                      {u.isDisabled && <span className="badge badge-gray" style={{ marginLeft: 6 }}>Disabled</span>}
                                    </td>
                                    <td style={{ paddingBottom: 4 }}>
                                      <span className={u.role === 'TenantAdmin' ? 'badge badge-purple' : 'badge badge-blue'}>
                                        {u.role === 'TenantAdmin' ? 'Admin' : 'User'}
                                      </span>
                                    </td>
                                    <td style={{ paddingBottom: 4, color: 'var(--text-muted)' }}>{new Date(u.createdAt).toLocaleDateString()}</td>
                                    <td style={{ paddingBottom: 4 }}>
                                      <div style={{ display: 'flex', gap: 6 }}>
                                        <button
                                          className={u.isDisabled ? 'btn btn-ghost' : 'btn btn-warning'}
                                          style={{ fontSize: 11, padding: '3px 8px' }}
                                          onClick={() => handleToggleTenantUser(t.id, u.id, !u.isDisabled)}
                                        >
                                          {u.isDisabled ? 'Enable' : 'Disable'}
                                        </button>
                                        <button
                                          className="btn btn-danger"
                                          style={{ fontSize: 11, padding: '3px 8px' }}
                                          onClick={() => handleDeleteTenantUser(t.id, u.id)}
                                        >
                                          Delete
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20, marginTop: 20 }}>
        {/* Create Tenant */}
        <div className="card">
          <h2 style={{ marginBottom: 16 }}>New Tenant</h2>
          <form onSubmit={handleCreateTenant} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input
              className="input"
              type="text"
              placeholder="Tenant name"
              value={tenantName}
              onChange={(e) => setTenantName(e.target.value)}
              required
            />
            <div>
              <input
                className="input"
                type="text"
                placeholder="e.g. acme-corp"
                value={tenantDomain}
                onChange={(e) => setTenantDomain(e.target.value)}
                required
              />
              {domainError && <div className="alert alert-error" style={{ marginTop: 4 }}>{domainError}</div>}
            </div>
            <button type="submit" className="btn btn-primary" disabled={creatingTenant}>
              {creatingTenant ? 'Creating…' : 'Create Tenant'}
            </button>
          </form>
          {createTenantSuccess && <div className="alert alert-success">{createTenantSuccess}</div>}
          {createTenantError && <div className="alert alert-error">{createTenantError}</div>}
        </div>

        {/* Create Tenant Admin */}
        <div className="card">
          <h2 style={{ marginBottom: 16 }}>New Tenant Admin</h2>
          <form onSubmit={handleCreateAdmin} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <select
              className="input"
              value={selectedTenantId}
              onChange={(e) => setSelectedTenantId(e.target.value)}
              required
            >
              <option value="">Select tenant…</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <input
              className="input"
              type="text"
              placeholder="Username"
              value={adminUsername}
              onChange={(e) => setAdminUsername(e.target.value)}
              required
            />
            <input
              className="input"
              type="password"
              placeholder="Password"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              required
            />
            <button type="submit" className="btn btn-primary" disabled={creatingAdmin}>
              {creatingAdmin ? 'Creating…' : 'Create Admin'}
            </button>
          </form>
          {createAdminSuccess && <div className="alert alert-success">{createAdminSuccess}</div>}
          {createAdminError && <div className="alert alert-error">{createAdminError}</div>}
        </div>
      </div>
    </div>
  )
}
