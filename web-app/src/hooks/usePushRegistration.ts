import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

export type PermissionState = 'default' | 'granted' | 'denied' | 'unsupported'
export type DeviceStatus = 'unknown' | 'none' | 'this' | 'other'

function getInitialPermission(): PermissionState {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission as PermissionState
}

// Resolves SW registration with a timeout to avoid hanging forever
async function getSwRegistration(
  ref: React.MutableRefObject<ServiceWorkerRegistration | null>
): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator.serviceWorker === 'undefined') return null

  // Use cached ref if available
  if (ref.current) return ref.current

  // Try registering fresh
  try {
    const reg = await Promise.race([
      navigator.serviceWorker.register('/sw.js'),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('SW timeout')), 5000)),
    ]) as ServiceWorkerRegistration
    ref.current = reg
    return reg
  } catch {
    return null
  }
}

export function usePushRegistration() {
  const { user, token } = useAuth()
  const tokenRef = useRef<string | null>(null)
  tokenRef.current = token

  const [swError, setSwError] = useState(false)
  const [permission, setPermission] = useState<PermissionState>(getInitialPermission)
  const [registrationError, setRegistrationError] = useState(false)
  const [deviceConflict, setDeviceConflict] = useState(false)
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus>('unknown')
  const [registering, setRegistering] = useState(false)

  const subscriptionRef = useRef<PushSubscription | null>(null)
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null)

  // Register SW on mount — no auto-subscribe
  useEffect(() => {
    if (!user || typeof navigator.serviceWorker === 'undefined') return
    navigator.serviceWorker.register('/sw.js')
      .then(reg => { registrationRef.current = reg })
      .catch(() => setSwError(true))
  }, [user])

  // Check device status on mount (read-only)
  useEffect(() => {
    if (!user) return
    checkDeviceStatus()
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  async function checkDeviceStatus() {
    try {
      let endpoint: string | null = null
      if (typeof navigator.serviceWorker !== 'undefined') {
        // getRegistration() returns immediately if SW is already registered — no hanging
        const reg = await navigator.serviceWorker.getRegistration('/sw.js').catch(() => null)
          ?? registrationRef.current
        if (reg) {
          const sub = await reg.pushManager.getSubscription()
          endpoint = sub?.endpoint ?? null
        }
      }

      const url = `${import.meta.env.VITE_API_BASE_URL ?? ''}/register/status${endpoint ? `?endpoint=${encodeURIComponent(endpoint)}` : ''}`
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${tokenRef.current}` },
      })
      if (!res.ok) return

      const data = await res.json()
      if (!data.registered) setDeviceStatus('none')
      else if (data.isActiveDevice) setDeviceStatus('this')
      else setDeviceStatus('other')
    } catch {
      // non-critical
    }
  }

  // Called from button click — satisfies Safari user gesture requirement
  async function requestPermissionAndSubscribe(force = false) {
    if (typeof Notification === 'undefined') return
    setRegistering(true)
    setRegistrationError(false)
    try {
      const result = await Notification.requestPermission()
      setPermission(result as PermissionState)
      if (result === 'granted') {
        await subscribe(force)
      }
    } catch {
      setRegistrationError(true)
    } finally {
      setRegistering(false)
    }
  }

  // Force-register this device (permission already granted)
  async function registerThisDevice() {
    setRegistering(true)
    setRegistrationError(false)
    try {
      if (typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
        const result = await Notification.requestPermission()
        setPermission(result as PermissionState)
        if (result !== 'granted') return
      }
      await subscribe(true)
    } catch {
      setRegistrationError(true)
    } finally {
      setRegistering(false)
    }
  }

  async function subscribe(forceOverride = false) {
    // Get SW registration — with timeout fallback
    const reg = await getSwRegistration(registrationRef)
    if (!reg) {
      setSwError(true)
      setRegistrationError(true)
      return
    }

    // Fetch VAPID key
    const vapidRes = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ''}/vapid-public-key`)
    if (!vapidRes.ok) throw new Error('Failed to fetch VAPID key')
    const { publicKey } = await vapidRes.json()

    // Subscribe via PushManager
    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    })
    subscriptionRef.current = subscription

    const storedEndpoint = localStorage.getItem('push_endpoint')
    const isSameDevice = !forceOverride && storedEndpoint === subscription.endpoint
    await postSubscription(subscription, isSameDevice || forceOverride)

    reg.addEventListener('pushsubscriptionchange', () => subscribe())
  }

  async function postSubscription(subscription: PushSubscription, force: boolean) {
    const body: Record<string, unknown> = { subscription: subscription.toJSON() }
    if (force) body.force = true

    const res = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ''}/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenRef.current}`,
      },
      body: JSON.stringify(body),
    })

    if (res.ok) {
      setRegistrationError(false)
      setDeviceConflict(false)
      setDeviceStatus('this')
      localStorage.setItem('push_endpoint', subscription.endpoint)
      return
    }

    if (res.status === 409) {
      const data = await res.json().catch(() => ({}))
      if (data?.error === 'device_already_bound') {
        setDeviceConflict(true)
        setDeviceStatus('other')
        return
      }
    }

    throw new Error(`Registration failed: ${res.status}`)
  }

  async function confirmReplace() {
    if (!subscriptionRef.current) return
    setRegistering(true)
    try {
      await postSubscription(subscriptionRef.current, true)
    } catch {
      setRegistrationError(true)
    } finally {
      setRegistering(false)
    }
  }

  function cancelReplace() {
    setDeviceConflict(false)
  }

  return {
    swError,
    permission,
    registrationError,
    deviceConflict,
    deviceStatus,
    registering,
    requestPermissionAndSubscribe,
    registerThisDevice,
    confirmReplace,
    cancelReplace,
  }
}
