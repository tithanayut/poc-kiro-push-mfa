import { useState } from 'react'

interface SettingsProps {
  clientId: string
  onUpdate: (newClientId: string) => void
}

export function Settings({ clientId, onUpdate }: SettingsProps) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(clientId)
  const [error, setError] = useState('')

  function handleEdit() {
    setValue(clientId)
    setError('')
    setEditing(true)
  }

  function handleSave() {
    if (!value.trim()) {
      setError('Client ID cannot be empty.')
      return
    }
    localStorage.setItem('push_mfa_client_id', value.trim())
    onUpdate(value.trim())
    setEditing(false)
    setError('')
  }

  function handleCancel() {
    setValue(clientId)
    setError('')
    setEditing(false)
  }

  return (
    <div style={{ padding: '1rem', border: '1px solid #ccc', borderRadius: '6px', maxWidth: '400px', marginTop: '1rem' }}>
      <h3 style={{ margin: '0 0 0.75rem' }}>Settings</h3>
      <label style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.875rem' }}>Client ID</label>
      {editing ? (
        <>
          <input
            type="text"
            value={value}
            onChange={(e) => { setValue(e.target.value); setError('') }}
            aria-label="Client ID"
            style={{ padding: '0.4rem', fontSize: '1rem', width: '100%', boxSizing: 'border-box' }}
          />
          {error && <span style={{ color: 'red', fontSize: '0.8rem', display: 'block', marginTop: '0.25rem' }}>{error}</span>}
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
            <button onClick={handleSave} style={{ padding: '0.4rem 0.8rem', cursor: 'pointer' }}>Save</button>
            <button onClick={handleCancel} style={{ padding: '0.4rem 0.8rem', cursor: 'pointer' }}>Cancel</button>
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input
            type="text"
            value={clientId}
            readOnly
            aria-label="Client ID"
            style={{ padding: '0.4rem', fontSize: '1rem', flex: 1, background: '#f5f5f5', cursor: 'default' }}
          />
          <button onClick={handleEdit} style={{ padding: '0.4rem 0.8rem', cursor: 'pointer' }}>Edit</button>
        </div>
      )}
    </div>
  )
}
