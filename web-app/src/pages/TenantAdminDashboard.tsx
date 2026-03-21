import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { apiClient } from '../api/apiClient'
import { useAuth } from '../context/AuthContext'
import { ThemeToggle } from '../components/ThemeToggle'

interface TenantUser {
  id: string
  username: string
  role: string
  isDisabled: boolean
  createdAt: string
}

interface TenantInfo {
  name: string
  domain: string
  loginInstructions: string | null
}

interface TenantApp {
  id: string
  name: string
  isDefault: boolean
  isDisabled: boolean
  createdAt: string
}

export default function TenantAdminDashboard() {
  const { logout, user } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  // ── Tab state ──────────────────────────────────────────────────────────────
  const rawTab = searchParams.get('tab')
  const activeTab: 'users' | 'apps' = rawTab === 'apps' ? 'apps' : 'users'

  function switchTab(tab: 'users' | 'apps') {
    setSearchParams({ tab }, { replace: true })
  }

  // ── Users state ────────────────────────────────────────────────────────────
  const [users, setUsers] = useState<TenantUser[]>([])
  const [listError, setListError] = useState<string | null>(null)
  const [tenantInfo, setTenantInfo] = useState<TenantInfo | null>(null)
  const [creating, setCreating] = useState(false)

  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [createSuccess, setCreateSuccess] = useState<string | null>(null)

  const [deleteError, setDeleteError] = useState<string | null>(null)

  const [resetUserId, setResetUserId] = useState<string | null>(null)
  const [resetPassword, setResetPassword] = useState('')
  const [resetError, setResetError] = useState<string | null>(null)
  const [resetSuccess, setResetSuccess] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)

  const [instructions, setInstructions] = useState('')
  const [instructionsSaving, setInstructionsSaving] = useState(false)
  const [instructionsSuccess, setInstructionsSuccess] = useState<string | null>(null)
  const [instructionsError, setInstructionsError] = useState<string | null>(null)

  // ── Simulate Push state ────────────────────────────────────────────────────
  const [pushStatus, setPushStatus] = useState<Record<string, 'idle' | 'pending' | 'accepted' | 'denied' | 'timed_out' | string>>({})

  // ── Apps state ─────────────────────────────────────────────────────────────
  const [apps, setApps] = useState<TenantApp[]>([])
  const [appsError, setAppsError] = useState<string | null>(null)
  const [newAppName, setNewAppName] = useState('')
  const [creatingApp, setCreatingApp] = useState(false)
  const [createAppError, setCreateAppError] = useState<string | null>(null)
  const [revealedSecret, setRevealedSecret] = useState<{ appId: string; secret: string } | null>(null)
  const [appActionError, setAppActionError] = useState<string | null>(null)

  // ── Data fetching ──────────────────────────────────────────────────────────
  async function fetchUsers() {
    try {
      const data = await apiClient.get<TenantUser[]>('/tenant/users')
      setUsers(data)
      setListError(null)
    } catch {
      setListError('Failed to load users.')
    }
  }

  async function fetchApps() {
    try {
      const data = await apiClient.get<TenantApp[]>('/tenant/apps')
      setApps(data)
      setAppsError(null)
    } catch {
      setAppsError('Failed to load apps.')
    }
  }

  useEffect(() => {
    fetchUsers()
    fetchApps()
    apiClient.get<TenantInfo>('/tenant/info').then(info => {
      setTenantInfo(info)
      setInstructions(info.loginInstructions ?? '')
    }).catch(() => {})
  }, [])

  // ── User handlers ──────────────────────────────────────────────────────────
  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault()
    setCreateError(null)
    setCreateSuccess(null)
    setCreating(true)
    try {
      await apiClient.post('/tenant/users', { username: newUsername, password: newPassword })
      setCreateSuccess(`User "${newUsername}" created.`)
      setNewUsername('')
      setNewPassword('')
      await fetchUsers()
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create user.')
    } finally {
      setCreating(false)
    }
  }

  async function handleToggleUser(userId: string, disable: boolean) {
    try {
      await apiClient.patch(`/tenant/users/${userId}/${disable ? 'disable' : 'enable'}`)
      await fetchUsers()
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to update user.')
    }
  }

  async function handleDeleteUser(userId: string) {
    if (!window.confirm('Delete this user?')) return
    setDeleteError(null)
    try {
      await apiClient.delete(`/tenant/users/${userId}`)
      await fetchUsers()
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete user.')
    }
  }

  function openResetForm(userId: string) {
    setResetUserId(userId)
    setResetPassword('')
    setResetError(null)
    setResetSuccess(null)
  }

  async function handleResetPassword(e: React.FormEvent, userId: string) {
    e.preventDefault()
    setResetError(null)
    setResetSuccess(null)
    setResetting(true)
    try {
      await apiClient.post(`/tenant/users/${userId}/reset-password`, { newPassword: resetPassword })
      setResetSuccess('Password reset.')
      setResetPassword('')
      setResetUserId(null)
    } catch (err: unknown) {
      setResetError(err instanceof Error ? err.message : 'Failed to reset password.')
    } finally {
      setResetting(false)
    }
  }

  async function handleSaveInstructions(e: React.FormEvent) {
    e.preventDefault()
    setInstructionsSuccess(null)
    setInstructionsError(null)
    setInstructionsSaving(true)
    try {
      await apiClient.put<void>('/tenant/instructions', { instructions })
      setInstructionsSuccess('Login instructions saved.')
    } catch (err: unknown) {
      setInstructionsError(err instanceof Error ? err.message : 'Failed to save instructions.')
    } finally {
      setInstructionsSaving(false)
    }
  }

  // ── Simulate Push handler ──────────────────────────────────────────────────
  async function handleSimulatePush(u: TenantUser) {
    setPushStatus(prev => ({ ...prev, [u.id]: 'pending' }))
    try {
      const data = await apiClient.post<{ response: string }>(`/tenant/simulate-push/${u.id}`, {})
      setPushStatus(prev => ({ ...prev, [u.id]: data.response ?? 'accepted' }))
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error'
      // apiClient throws on 408 with the error text; map it to timed_out
      setPushStatus(prev => ({ ...prev, [u.id]: msg === 'request timed out' ? 'timed_out' : msg }))
    }
  }

  // ── App handlers ───────────────────────────────────────────────────────────
  async function handleCreateApp(e: React.FormEvent) {
    e.preventDefault()
    setCreateAppError(null)
    setCreatingApp(true)
    try {
      const result = await apiClient.post<{ id: string; secret: string }>('/tenant/apps', { name: newAppName })
      setRevealedSecret({ appId: result.id, secret: result.secret })
      setNewAppName('')
      await fetchApps()
    } catch (err: unknown) {
      setCreateAppError(err instanceof Error ? err.message : 'Failed to create app.')
    } finally {
      setCreatingApp(false)
    }
  }

  async function handleResetAppSecret(app: TenantApp) {
    setAppActionError(null)
    try {
      const result = await apiClient.post<{ secret: string }>(`/tenant/apps/${app.id}/reset-secret`, {})
      setRevealedSecret({ appId: app.id, secret: result.secret })
    } catch (err: unknown) {
      setAppActionError(err instanceof Error ? err.message : 'Failed to reset secret.')
    }
  }

  async function handleToggleApp(app: TenantApp) {
    setAppActionError(null)
    try {
      await apiClient.patch(`/tenant/apps/${app.id}`, { isDisabled: !app.isDisabled })
      await fetchApps()
    } catch (err: unknown) {
      setAppActionError(err instanceof Error ? err.message : 'Failed to update app.')
    }
  }

  async function handleDeleteApp(app: TenantApp) {
    if (app.isDefault) {
      setAppActionError('Cannot delete the default app.')
      return
    }
    if (!window.confirm('Delete this app?')) return
    setAppActionError(null)
    try {
      await apiClient.delete(`/tenant/apps/${app.id}`)
      await fetchApps()
    } catch (err: unknown) {
      setAppActionError(err instanceof Error ? err.message : 'Failed to delete app.')
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  const roleBadge = (role: string) => {
    if (role === 'TenantAdmin') return <span className="badge badge-purple">Admin</span>
    return <span className="badge badge-blue">User</span>
  }

  const pushStatusBadge = (status: string) => {
    if (status === 'pending') return <span className="badge badge-gray">Sending…</span>
    if (status === 'accepted') return <span className="badge badge-green">Accepted</span>
    if (status === 'denied') return <span className="badge badge-red">Denied</span>
    if (status === 'timed_out') return <span className="badge badge-gray">Timed out</span>
    return <span className="badge badge-red">{status}</span>
  }

  const revealedAppName = revealedSecret ? apps.find(a => a.id === revealedSecret.appId)?.name ?? revealedSecret.appId : null

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Tenant Admin</h1>
          {tenantInfo && (
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 2 }}>
              {tenantInfo.name} &middot; <code style={{ fontSize: 12 }}>{tenantInfo.domain}</code>
            </p>
          )}
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 2 }}>Signed in as {user?.username}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <ThemeToggle />
          <button className="btn btn-ghost" onClick={() => navigate('/mfa')}>My MFA</button>
          <button className="btn btn-ghost" onClick={logout}>Sign out</button>
        </div>
      </div>

      {/* Tab buttons */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
        <button
          className={activeTab === 'users' ? 'btn btn-primary' : 'btn btn-ghost'}
          style={{ borderRadius: '6px 6px 0 0', borderBottom: 'none' }}
          onClick={() => switchTab('users')}
        >
          Users
        </button>
        <button
          className={activeTab === 'apps' ? 'btn btn-primary' : 'btn btn-ghost'}
          style={{ borderRadius: '6px 6px 0 0', borderBottom: 'none' }}
          onClick={() => switchTab('apps')}
        >
          Apps
        </button>
      </div>

      {/* ── Users tab ─────────────────────────────────────────────────────── */}
      {activeTab === 'users' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 20, alignItems: 'start' }}>
            {/* Users table */}
            <div className="card" style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <h2>Users</h2>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{users.length} total</span>
              </div>
              {listError && <div className="alert alert-error">{listError}</div>}
              {deleteError && <div className="alert alert-error">{deleteError}</div>}
              {users.length === 0 && !listError ? (
                <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>No users yet.</p>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Username</th>
                        <th>Role</th>
                        <th>Created</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((u) => (
                        <>
                          <tr key={u.id}>
                            <td style={{ color: 'var(--text-strong)', fontWeight: 500 }}>
                              {u.username}
                              {u.isDisabled && <span className="badge badge-gray" style={{ marginLeft: 6 }}>Disabled</span>}
                            </td>
                            <td>{roleBadge(u.role)}</td>
                            <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                            <td>
                              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                                <button
                                  className="btn btn-ghost"
                                  style={{ fontSize: 12, padding: '4px 10px' }}
                                  onClick={() => resetUserId === u.id ? setResetUserId(null) : openResetForm(u.id)}
                                >
                                  Reset password
                                </button>
                                {u.id !== user?.sub && (
                                  <>
                                    <button
                                      className={u.isDisabled ? 'btn btn-ghost' : 'btn btn-warning'}
                                      style={{ fontSize: 12, padding: '4px 10px' }}
                                      onClick={() => handleToggleUser(u.id, !u.isDisabled)}
                                    >
                                      {u.isDisabled ? 'Enable' : 'Disable'}
                                    </button>
                                    <button
                                      className="btn btn-danger"
                                      style={{ fontSize: 12, padding: '4px 10px' }}
                                      onClick={() => handleDeleteUser(u.id)}
                                    >
                                      Delete
                                    </button>
                                    <button
                                      className="btn btn-ghost"
                                      style={{ fontSize: 12, padding: '4px 10px' }}
                                      onClick={() => handleSimulatePush(u)}
                                      disabled={pushStatus[u.id] === 'pending'}
                                    >
                                      Simulate Push
                                    </button>
                                    {pushStatus[u.id] && pushStatus[u.id] !== 'idle' && pushStatusBadge(pushStatus[u.id])}
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                          {resetUserId === u.id && (
                            <tr key={`reset-${u.id}`}>
                              <td colSpan={4} style={{ background: 'var(--bg-elevated)', padding: '12px 14px' }}>
                                <form onSubmit={(e) => handleResetPassword(e, u.id)} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                  <input
                                    className="input"
                                    type="password"
                                    placeholder="New password"
                                    value={resetPassword}
                                    onChange={(e) => setResetPassword(e.target.value)}
                                    required
                                    style={{ maxWidth: 220 }}
                                  />
                                  <button type="submit" className="btn btn-primary" style={{ fontSize: 13 }} disabled={resetting}>
                                    {resetting ? 'Saving…' : 'Save'}
                                  </button>
                                  <button type="button" className="btn btn-ghost" style={{ fontSize: 13 }} onClick={() => setResetUserId(null)}>
                                    Cancel
                                  </button>
                                </form>
                                {resetSuccess && <div className="alert alert-success" style={{ marginTop: 8 }}>{resetSuccess}</div>}
                                {resetError && <div className="alert alert-error" style={{ marginTop: 8 }}>{resetError}</div>}
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

            {/* Create User */}
            <div className="card" style={{ minWidth: 260 }}>
              <h2 style={{ marginBottom: 16 }}>New User</h2>
              <form onSubmit={handleCreateUser} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <input
                  className="input"
                  type="text"
                  placeholder="Username"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  required
                />
                <input
                  className="input"
                  type="password"
                  placeholder="Password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
                <button type="submit" className="btn btn-primary" disabled={creating}>
                  {creating ? 'Creating…' : 'Create User'}
                </button>
              </form>
              {createSuccess && <div className="alert alert-success">{createSuccess}</div>}
              {createError && <div className="alert alert-error">{createError}</div>}
            </div>
          </div>

          {/* Login Instructions */}
          <div className="card" style={{ marginTop: 20 }}>
            <h2 style={{ marginBottom: 16 }}>Login Instructions</h2>
            <form onSubmit={handleSaveInstructions} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <textarea
                className="input"
                rows={4}
                placeholder="Enter login instructions shown to users on the login page…"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                style={{ resize: 'vertical' }}
              />
              <div>
                <button type="submit" className="btn btn-primary" disabled={instructionsSaving}>
                  {instructionsSaving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
            {instructionsSuccess && <div className="alert alert-success" style={{ marginTop: 8 }}>{instructionsSuccess}</div>}
            {instructionsError && <div className="alert alert-error" style={{ marginTop: 8 }}>{instructionsError}</div>}
          </div>
        </>
      )}

      {/* ── Apps tab ──────────────────────────────────────────────────────── */}
      {activeTab === 'apps' && (
        <div>
          {/* New App form */}
          <div className="card" style={{ marginBottom: 20 }}>
            <h2 style={{ marginBottom: 16 }}>Apps</h2>
            <form onSubmit={handleCreateApp} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 13, color: 'var(--text-muted)' }}>App name</label>
                <input
                  className="input"
                  type="text"
                  placeholder="e.g. My Integration"
                  value={newAppName}
                  onChange={(e) => setNewAppName(e.target.value)}
                  required
                  style={{ minWidth: 220 }}
                />
              </div>
              <button type="submit" className="btn btn-primary" disabled={creatingApp}>
                {creatingApp ? 'Creating…' : 'New App'}
              </button>
            </form>
            {createAppError && <div className="alert alert-error" style={{ marginTop: 8 }}>{createAppError}</div>}
          </div>

          {/* Apps table */}
          <div className="card">
            {appsError && <div className="alert alert-error">{appsError}</div>}
            {appActionError && <div className="alert alert-error">{appActionError}</div>}
            {apps.length === 0 && !appsError ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>No apps yet.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Status</th>
                      <th>Created</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {apps.map((app) => (
                      <tr key={app.id}>
                        <td style={{ color: 'var(--text-strong)', fontWeight: 500 }}>
                          <div>{app.name}</div>

                          <code style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400, display: 'block', marginTop: 2, userSelect: 'all' }}>
                            {app.id}
                          </code>
                        </td>
                        <td>
                          {app.isDisabled
                            ? <span className="badge badge-gray">Disabled</span>
                            : <span className="badge badge-green">Active</span>}
                        </td>
                        <td>{new Date(app.createdAt).toLocaleDateString()}</td>
                        <td>
                          {app.isDefault && (
                            <span
                              className="badge badge-purple"
                              style={{ fontSize: 11 }}
                            >
                              The Default app is used for PushMFA simulation
                            </span>
                          )}
                          {!app.isDefault && (
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button
                                className="btn btn-ghost"
                                style={{ fontSize: 12, padding: '4px 10px' }}
                                onClick={() => handleResetAppSecret(app)}
                              >
                                Reset Secret
                              </button>
                              <button
                                className={app.isDisabled ? 'btn btn-ghost' : 'btn btn-warning'}
                                style={{ fontSize: 12, padding: '4px 10px' }}
                                onClick={() => handleToggleApp(app)}
                              >
                                {app.isDisabled ? 'Enable' : 'Disable'}
                              </button>
                              <button
                                className="btn btn-danger"
                                style={{ fontSize: 12, padding: '4px 10px' }}
                                onClick={() => handleDeleteApp(app)}
                              >
                                Delete
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* One-time secret reveal */}
            {revealedSecret && (
              <div style={{
                marginTop: 16,
                padding: '14px 16px',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 8,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14 }}>
                    Secret for app <strong>{revealedAppName}</strong>:
                  </span>
                  <code style={{ fontSize: 13, background: 'var(--bg)', padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border)' }}>
                    {revealedSecret.secret}
                  </code>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 12, padding: '4px 10px' }}
                    onClick={() => navigator.clipboard.writeText(revealedSecret.secret)}
                  >
                    Copy
                  </button>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 12, padding: '4px 10px' }}
                    onClick={() => setRevealedSecret(null)}
                  >
                    Dismiss
                  </button>
                </div>
                <p style={{ marginTop: 8, fontSize: 13, color: 'var(--text-muted)' }}>
                  ⚠ Warning: This secret will not be shown again.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
