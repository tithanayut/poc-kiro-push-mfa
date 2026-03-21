export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''

let authToken: string | null = null
let onUnauthorized: (() => void) | null = null

export function setAuthToken(token: string | null) {
  authToken = token
}

export function setOnUnauthorized(cb: () => void) {
  onUnauthorized = cb
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const fullUrl = url.startsWith('http') ? url : `${API_BASE_URL}${url}`
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  }

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`
  }

  const response = await fetch(fullUrl, { ...options, headers })

  if (response.status === 401) {
    const text = await response.text()
    let message = 'Unauthorized'
    try { message = JSON.parse(text)?.error ?? message } catch { /* ignore */ }
    if (message === 'Unauthorized') onUnauthorized?.()
    throw new Error(message)
  }

  if (!response.ok) {
    const text = await response.text()
    let message = `Request failed (${response.status})`
    try { message = JSON.parse(text)?.error ?? message } catch { /* ignore */ }
    throw new Error(message)
  }

  // 204 No Content — nothing to parse
  if (response.status === 204 || response.headers.get('content-length') === '0') {
    return undefined as T
  }

  return response.json() as Promise<T>
}

export const apiClient = {
  get<T>(url: string): Promise<T> {
    return request<T>(url, { method: 'GET' })
  },

  post<T>(url: string, body: unknown): Promise<T> {
    return request<T>(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  },

  put<T>(url: string, body: unknown): Promise<T> {
    return request<T>(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  },

  delete<T>(url: string): Promise<T> {
    return request<T>(url, { method: 'DELETE' })
  },

  patch<T>(url: string, body?: unknown): Promise<T> {
    return request<T>(url, {
      method: 'PATCH',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    })
  },
}
