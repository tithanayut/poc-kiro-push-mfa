import { useState } from 'react'

interface ClientIdPromptProps {
  onComplete: (clientId: string) => void
}

export function ClientIdPrompt({ onComplete }: ClientIdPromptProps) {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!value.trim()) {
      setError('Client ID cannot be empty.')
      return
    }
    localStorage.setItem('push_mfa_client_id', value.trim())
    onComplete(value.trim())
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: '4rem' }}>
      <h1>Push MFA Setup</h1>
      <p>Enter a Client ID to identify this device.</p>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: '280px' }}>
        <input
          type="text"
          value={value}
          onChange={(e) => { setValue(e.target.value); setError('') }}
          placeholder="e.g. alice-laptop"
          aria-label="Client ID"
          style={{ padding: '0.5rem', fontSize: '1rem' }}
        />
        {error && <span style={{ color: 'red', fontSize: '0.875rem' }}>{error}</span>}
        <button type="submit" style={{ padding: '0.5rem 1rem', fontSize: '1rem', cursor: 'pointer' }}>
          Continue
        </button>
      </form>
    </div>
  )
}
