import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { setAuthToken, setOnUnauthorized } from '../api/apiClient'

export interface DecodedClaims {
  sub: string
  tenantId: string
  username: string
  role: string
  exp: number
}

export interface AuthState {
  token: string | null
  user: DecodedClaims | null
  ready: boolean
  login: (token: string) => void
  logout: () => void
}

export const AuthContext = createContext<AuthState>({
  token: null,
  user: null,
  ready: false,
  login: () => {},
  logout: () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null)
  const [user, setUser] = useState<DecodedClaims | null>(null)
  const [ready, setReady] = useState(false)

  // Restore session on mount
  useEffect(() => {
    const stored = localStorage.getItem('jwt')
    if (stored) {
      try {
        const parts = stored.split('.')
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
        const hasValidRole = ['SuperAdmin', 'TenantAdmin', 'TenantUser'].includes(payload.role)
        if (payload.exp * 1000 > Date.now() && hasValidRole) {
          setToken(stored)
          setUser(payload as DecodedClaims)
          setAuthToken(stored)
        } else {
          localStorage.removeItem('jwt')
        }
      } catch {
        localStorage.removeItem('jwt')
      }
    }

    setOnUnauthorized(() => {
      localStorage.removeItem('jwt')
      setToken(null)
      setUser(null)
      setAuthToken(null)
    })

    setReady(true)
  }, [])

  function login(jwt: string) {
    const parts = jwt.split('.')
    if (parts.length !== 3) throw new Error('Invalid JWT')
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    localStorage.setItem('jwt', jwt)
    setToken(jwt)
    setUser(payload as DecodedClaims)
    setAuthToken(jwt)
  }

  function logout() {
    localStorage.removeItem('jwt')
    setToken(null)
    setUser(null)
    setAuthToken(null)
  }

  return (
    <AuthContext.Provider value={{ token, user, ready, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
