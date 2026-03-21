import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { ThemeToggle } from '../components/ThemeToggle'
import { usePushRegistration } from '../hooks/usePushRegistration'
import { usePushQueue } from '../hooks/usePushQueue'
import { NotificationBanner } from '../components/NotificationBanner'
import { PushRequestView } from '../components/PushRequestView'

export default function MfaApp() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const { swError, permission, registrationError, deviceConflict, deviceStatus, registering, requestPermissionAndSubscribe, registerThisDevice, confirmReplace, cancelReplace } = usePushRegistration()
  const { queue, removeFromQueue } = usePushQueue()

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 24px' }}>
      {/* Header */}
      <div style={{ width: '100%', maxWidth: 480, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={iconWrap}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6c63ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
          </div>
          <div>
            <div style={{ color: 'var(--text-strong)', fontWeight: 600, fontSize: 15 }}>{user?.username}</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>MFA Device</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <ThemeToggle />
          {user?.role === 'TenantAdmin' && (
            <button className="btn btn-ghost" onClick={() => navigate('/tenant')} style={{ fontSize: 13 }}>Manage users</button>
          )}
          <button className="btn btn-ghost" onClick={logout} style={{ fontSize: 13 }}>Sign out</button>
        </div>
      </div>

      {/* Alerts */}
      <div style={{ width: '100%', maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
        {swError && (
          <div className="alert alert-warning">
            Service worker unavailable — running in foreground-only mode.
          </div>
        )}
        {permission === 'denied' && (
          <div className="alert alert-error">
            Notification permission denied. Push MFA will not work.
          </div>
        )}
        {permission === 'unsupported' && (
          <div className="alert alert-warning">
            Push notifications are not supported in this browser.
          </div>
        )}
        {registrationError && (
          <div className="alert alert-error">
            Failed to register device with the server.
          </div>
        )}
      </div>

      {/* Enable notifications prompt — shown when not yet registered or permission not yet granted */}
      {(permission === 'default' || (permission === 'granted' && deviceStatus === 'none')) && (
        <div style={{ ...idleCard, maxWidth: 480, marginBottom: 16 }}>
          <div style={{ ...idleIcon, background: 'var(--accent-glow)', color: 'var(--accent)', marginBottom: 16 }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
          </div>
          <p style={{ color: 'var(--text-strong)', fontWeight: 500, marginBottom: 6 }}>Enable notifications</p>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>
            {deviceStatus === 'other'
              ? 'Another device is already registered. Enabling here will replace it.'
              : 'Tap below to allow push notifications so you can approve MFA requests.'}
          </p>
          <button className="btn btn-primary" onClick={() => requestPermissionAndSubscribe(deviceStatus === 'other')} disabled={registering} style={{ width: '100%' }}>
            {registering ? 'Registering…' : deviceStatus === 'other' ? 'Enable & replace other device' : 'Enable notifications'}
          </button>
        </div>
      )}

      {/* Other device registered — prompt to take over */}
      {permission === 'granted' && deviceStatus === 'other' && !deviceConflict && (
        <div style={{ ...idleCard, maxWidth: 480, marginBottom: 16, borderColor: 'var(--warning)' }}>
          <div style={{ ...idleIcon, background: 'var(--warning-bg)', color: 'var(--warning)', marginBottom: 16 }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </div>
          <p style={{ color: 'var(--text-strong)', fontWeight: 500, marginBottom: 6 }}>Another device is active</p>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>
            MFA requests are going to a different device. Register this device to receive them here — this will replace the other device.
          </p>
          <button className="btn btn-primary" onClick={registerThisDevice} disabled={registering} style={{ width: '100%' }}>
            {registering ? 'Registering…' : 'Use this device instead'}
          </button>
        </div>
      )}

      <PushRequestView queue={queue} removeFromQueue={removeFromQueue} />
      <NotificationBanner count={Math.max(0, queue.length - 1)} />

      {/* Idle state — this device is active */}
      {queue.length === 0 && !swError && permission === 'granted' && deviceStatus === 'this' && !registrationError && (
        <div style={idleCard}>
          <div style={idleIcon}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
              <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
          </div>
          <p style={{ color: 'var(--text-strong)', fontWeight: 500, marginBottom: 4 }}>Device registered</p>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Waiting for authentication requests…</p>
        </div>
      )}

      {/* Device conflict modal */}
      {deviceConflict && (
        <div className="overlay">
          <div className="modal">
            <div style={{ fontSize: 32, marginBottom: 12 }}>📱</div>
            <h3>Device already registered</h3>
            <p style={{ marginTop: 8 }}>
              This account is linked to another device. Replace it with this device?
            </p>
            <div className="modal-actions">
              <button className="btn btn-danger" onClick={confirmReplace}>Replace device</button>
              <button className="btn btn-ghost" onClick={cancelReplace}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const iconWrap: React.CSSProperties = {
  width: 38,
  height: 38,
  borderRadius: 10,
  background: 'rgba(108,99,255,0.12)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}

const idleCard: React.CSSProperties = {
  marginTop: 40,
  textAlign: 'center',
  padding: '40px 32px',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  maxWidth: 360,
  width: '100%',
}

const idleIcon: React.CSSProperties = {
  width: 56,
  height: 56,
  borderRadius: '50%',
  background: 'var(--success-bg)',
  color: 'var(--success)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  margin: '0 auto 16px',
}
