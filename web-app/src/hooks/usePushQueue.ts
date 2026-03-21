import { useState, useEffect } from 'react'

export interface PushRequest {
  request_id: string
  client_id: string
  message?: string
  app_name?: string
  expires_at: number
}

export function usePushQueue() {
  const [queue, setQueue] = useState<PushRequest[]>([])

  useEffect(() => {
    if (!navigator.serviceWorker) return

    const handler = (event: MessageEvent) => {
      if (event.data?.type !== 'PUSH_REQUEST') return
      const data = event.data.data as PushRequest
      if (data.expires_at * 1000 < Date.now()) return
      setQueue(prev => [...prev, data])
    }

    navigator.serviceWorker.addEventListener('message', handler)

    // Tell the SW we're ready to receive any pending notification-click payload
    navigator.serviceWorker.ready.then(reg => {
      reg.active?.postMessage({ type: 'CLIENT_READY' })
    })

    return () => navigator.serviceWorker.removeEventListener('message', handler)
  }, [])

  const removeFromQueue = (requestId: string) => {
    setQueue(prev => prev.filter(r => r.request_id !== requestId))
  }

  return { queue, removeFromQueue }
}
