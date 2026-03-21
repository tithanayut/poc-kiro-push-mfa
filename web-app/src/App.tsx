import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './App.css'
import { ProtectedRoute } from './components/ProtectedRoute'
import { useAuth } from './context/AuthContext'
import LoginPage from './pages/LoginPage'
import SuperAdminLoginPage from './pages/SuperAdminLoginPage'
import SuperAdminDashboard from './pages/SuperAdminDashboard'
import TenantAdminDashboard from './pages/TenantAdminDashboard'
import MfaApp from './pages/MfaApp'
import LandingPage from './pages/LandingPage'

function AppRedirect() {
  const { user, ready } = useAuth()
  if (!ready) return null
  if (!user) return <Navigate to="/app" replace />
  if (user.role === 'SuperAdmin') return <Navigate to="/admin" replace />
  if (user.role === 'TenantAdmin') return <Navigate to="/tenant" replace />
  return <Navigate to="/mfa" replace />
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/login/:tenantDomain" element={<LoginPage />} />
        <Route path="/admin/login" element={<SuperAdminLoginPage />} />
        <Route
          path="/admin"
          element={
            <ProtectedRoute allowedRoles={['SuperAdmin']} loginPath="/admin/login">
              <SuperAdminDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/tenant"
          element={
            <ProtectedRoute allowedRoles={['TenantAdmin']}>
              <TenantAdminDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/mfa"
          element={
            <ProtectedRoute allowedRoles={['TenantUser', 'TenantAdmin']}>
              <MfaApp />
            </ProtectedRoute>
          }
        />
        <Route path="/" element={<LandingPage />} />
        <Route path="/app" element={<AppRedirect />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
