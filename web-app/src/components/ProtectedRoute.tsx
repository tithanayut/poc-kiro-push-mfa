import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

interface ProtectedRouteProps {
  allowedRoles?: string[]
  loginPath?: string
  children: ReactNode
}

export function ProtectedRoute({ allowedRoles, loginPath = '/login', children }: ProtectedRouteProps) {
  const { token, user, ready } = useAuth()

  if (!ready) return null

  if (!token || !user) {
    return <Navigate to={loginPath} replace />
  }

  if (user.exp * 1000 < Date.now()) {
    return <Navigate to={loginPath} replace />
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <div>Access denied</div>
  }

  return <>{children}</>
}
