import { useState, useEffect } from 'react'
import type { PushRequest } from '../hooks/usePushQueue'

interface PushRequestViewProps {
  queue: PushRequest[]
  removeFromQueue: (requestId: string) => void
}

export function PushRequestView({ queue, removeFromQueue }: PushRequestViewProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const request = queue[0]

  useEffect(() => {
    setLoading(false)
    setError(null)
  }, [request?.request_id])

  if (!request) return null

  const isExpired = request.expires_at * 1000 < Date.now()

  const submitResponse = async (response: 'accepted' | 'denied') => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ''}/response`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: request.request_id, response }),
      })
      if (res.ok) {
        removeFromQueue(request.request_id)
      } else if (res.status === 410) {
        setError('This request has expired.')
        removeFromQueue(request.request_id)
      } else {
        setError('Failed to submit. Please retry.')
        setLoading(false)
      }
    } catch {
      setError('Failed to submit. Please retry.')
      setLoading(false)
    }
  }

  return (
    <div style={card}>
      {/* Icon */}
      <div style={iconWrap}>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#6c63ff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
      </div>

      <h2 style={{ color: 'var(--text-strong)', marginBottom: 8 }}>
        {request.app_name}
      </h2>

      <p style={{ color: 'var(--text-strong)', marginBottom: 6 }}>
        {request.message ?? 'Authentication Request'}
      </p>
 
      <p style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 20, wordBreak: 'break-all' }}>
        ID: {request.request_id}
      </p>

      {isExpired || error === 'This request has expired.' ? (
        <>
          <div className="alert alert-error" style={{ marginBottom: 16 }}>This request has expired.</div>
          <button className="btn btn-ghost" onClick={() => removeFromQueue(request.request_id)}>Dismiss</button>
        </>
      ) : (
        <>
          {error && (
            <div className="alert alert-error" style={{ marginBottom: 12 }}>
              {error}
              <button
                className="btn btn-ghost"
                style={{ marginLeft: 8, fontSize: 12, padding: '2px 10px' }}
                onClick={() => setError(null)}
              >
                Retry
              </button>
            </div>
          )}
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <button
              className="btn btn-success"
              style={{ minWidth: 110, padding: '10px 20px' }}
              disabled={loading}
              onClick={() => submitResponse('accepted')}
            >
              {loading ? '…' : '✓ Approve'}
            </button>
            <button
              className="btn btn-danger"
              style={{ minWidth: 110, padding: '10px 20px' }}
              disabled={loading}
              onClick={() => submitResponse('denied')}
            >
              {loading ? '…' : '✕ Deny'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

const card: React.CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  padding: '32px 28px',
  maxWidth: 480,
  width: '100%',
  textAlign: 'center',
  boxShadow: 'var(--shadow-sm)',
}

const iconWrap: React.CSSProperties = {
  width: 60,
  height: 60,
  borderRadius: '50%',
  background: 'rgba(108,99,255,0.12)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  margin: '0 auto 20px',
}
