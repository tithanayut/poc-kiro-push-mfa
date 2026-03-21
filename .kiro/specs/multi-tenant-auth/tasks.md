# Implementation Plan: Multi-Tenant Auth

## Overview

Incremental implementation of multi-tenant support and JWT authentication for the Push MFA app. The plan migrates the existing `ClientId`-based push infrastructure to a `UserId`-based identity model, adds three-role auth (SuperAdmin, TenantAdmin, TenantUser), and builds the corresponding React frontend.

Each task builds on the previous one. The backend is wired up first (data → auth → admin APIs → push migration), then the frontend (routing shell → auth → dashboards → push hook update).

## Tasks

- [x] 1. Add NuGet packages and configure JWT + bcrypt in the backend
  - Add `Microsoft.AspNetCore.Authentication.JwtBearer` and `BCrypt.Net-Next` to `backend.csproj`
  - Add `Jwt` section to `appsettings.json` (`Key`, `Issuer`, `Audience`, `ExpiryHours: 8`)
  - Register JWT bearer authentication in `Program.cs` (`AddAuthentication().AddJwtBearer(...)`)
  - Add `app.UseAuthentication()` before `app.UseAuthorization()` in the middleware pipeline
  - _Requirements: 5.1, 5.5_

- [x] 2. Define EF Core entities and update DbContext
  - [x] 2.1 Create `backend/Data/Tenant.cs` entity (`Id`, `Name`, `CreatedAt`, `Users` nav)
    - _Requirements: 11.1_
  - [x] 2.2 Create `backend/Data/User.cs` entity (`Id`, `TenantId?`, `Username`, `PasswordHash`, `Role`, `CreatedAt`, `PushSubscription` nav)
    - _Requirements: 11.2_
  - [x] 2.3 Update `PushSubscriptionEntity.cs` — replace `ClientId` string PK with `UserId` (Guid PK + FK → Users) and add `TenantId` (Guid)
    - _Requirements: 11.4_
  - [x] 2.4 Update `PushMfaDbContext.cs` — add `DbSet<Tenant>` and `DbSet<User>`; update `OnModelCreating` with unique index on `Tenant.Name`, composite unique index on `(User.TenantId, User.Username)`, and reconfigure `PushSubscriptionEntity` PK/FK
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

- [x] 3. Create and apply EF Core migrations
  - Run `dotnet ef migrations add AddMultiTenantAuth` to generate the migration covering Tenants, Users, and PushSubscriptions schema changes
  - Verify the generated migration SQL matches the design (Tenants table, Users table, PushSubscriptions PK swap)
  - _Requirements: 11.5_

- [x] 4. Implement `IAuthService` and `JwtService`
  - [x] 4.1 Create `backend/Services/IAuthService.cs` with `LoginAsync(string username, string password) → Task<string?>`
    - _Requirements: 5.1, 5.2_
  - [x] 4.2 Create `backend/Services/AuthService.cs` — look up user by username (case-insensitive), verify bcrypt hash via `BCrypt.Net.BCrypt.Verify`, build and sign JWT with claims `sub`, `tenantId`, `username`, `role`, and configured expiry
    - _Requirements: 5.2, 5.3, 5.4, 5.5_
  - [x] 4.3 Register `AuthService` as scoped in `Program.cs`
    - _Requirements: 5.1_

- [x] 5. Implement `AuthController`
  - Create `backend/Controllers/AuthController.cs` with `POST /auth/login`
  - Accept `LoginRequest { Username, Password }`, call `IAuthService.LoginAsync`, return `LoginResponse { Token }` on success or HTTP 401 `{ "error": "invalid credentials" }` on failure
  - _Requirements: 5.1, 5.2, 5.3_

- [x] 6. Implement Super Admin seeding on startup
  - In `Program.cs` startup block (after migrations), check if any `SuperAdmin` user exists; if not, create one using credentials from config (`Seeding:SuperAdmin:Username` / `Password`) with a bcrypt-hashed password
  - Add seed credentials to `appsettings.Development.json`
  - _Requirements: 5.4, 11.2_

- [x] 7. Implement `AdminController` (tenant + tenant admin management)
  - [x] 7.1 Create `backend/Controllers/AdminController.cs` decorated with `[Authorize(Roles = "SuperAdmin")]`
    - _Requirements: 1.4, 2.4_
  - [x] 7.2 Implement `POST /admin/tenants` — create tenant, return 201 with ID; return 409 on duplicate name
    - _Requirements: 1.1, 1.2, 1.5_
  - [x] 7.3 Implement `GET /admin/tenants` — return list of all tenants (`Id`, `Name`, `CreatedAt`)
    - _Requirements: 1.3_
  - [x] 7.4 Implement `POST /admin/tenants/{tenantId}/admins` — create TenantAdmin user with bcrypt-hashed password scoped to tenant; return 404 if tenant not found, 409 if username already exists in tenant
    - _Requirements: 2.1, 2.2, 2.3, 2.5_

- [x] 8. Implement `TenantController` (user management + password reset)
  - [x] 8.1 Create `backend/Controllers/TenantController.cs` decorated with `[Authorize(Roles = "TenantAdmin")]`; extract `tenantId` claim from JWT for all operations
    - _Requirements: 3.6, 4.3_
  - [x] 8.2 Implement `POST /tenant/users` — create TenantUser with bcrypt-hashed password; return 409 on duplicate username within tenant
    - _Requirements: 3.1, 3.2_
  - [x] 8.3 Implement `GET /tenant/users` — return users scoped to the authenticated admin's tenant only
    - _Requirements: 3.3_
  - [x] 8.4 Implement `DELETE /tenant/users/{userId}` — delete user; return 403 if user belongs to a different tenant, 404 if not found
    - _Requirements: 3.4, 3.5_
  - [x] 8.5 Implement `POST /tenant/users/{userId}/reset-password` — accept `{ newPassword }`, bcrypt-hash and store; return 403 if cross-tenant, 404 if not found
    - _Requirements: 4.1, 4.2, 4.4_

- [x] 9. Migrate `PushController` to JWT-based identity
  - [x] 9.1 Add `[Authorize(Roles = "TenantUser")]` to the `POST /register` endpoint; replace `ClientId` field with `userId` and `tenantId` read from `HttpContext.User` claims
    - _Requirements: 6.1, 6.6_
  - [x] 9.2 Implement device-already-bound check in `Register` — if a subscription exists for this `UserId` and `force` is not `true`, return HTTP 409 `{ "error": "device_already_bound" }`; if `force: true`, replace the existing record
    - _Requirements: 6.2, 6.4, 6.5_
  - [x] 9.3 Update `POST /push` to accept `{ userId, tenantId, message }` instead of `{ client_id, message }`; look up subscription by `UserId`; include `tenantId` in the push payload
    - _Requirements: 7.1, 7.2, 7.3_
  - [x] 9.4 Remove the now-unused `client_id` fields from `RegisterRequest` and `PushRequest` DTOs; update `ResponseRequest` if needed
    - _Requirements: 11.4_

- [x] 10. Checkpoint — backend wired up
  - Ensure the app builds (`dotnet build`), migrations apply cleanly, and all endpoints are reachable via Swagger. Ask the user if questions arise.

- [x] 11. Install React Router and scaffold frontend routing shell
  - Run `npm install react-router-dom` and `npm install -D @types/react-router-dom` in `web-app/`
  - Replace `App.tsx` with a `<BrowserRouter>` shell containing `<Routes>` for `/login`, `/admin`, `/tenant`, `/mfa`
  - _Requirements: 10.1_

- [x] 12. Implement `AuthContext` and `apiClient`
  - [x] 12.1 Create `web-app/src/context/AuthContext.tsx` — provide `token`, `user` (decoded claims: `sub`, `tenantId`, `username`, `role`), `login(token)`, `logout()` in React state only (no localStorage)
    - _Requirements: 5.6_
  - [x] 12.2 Create `web-app/src/api/apiClient.ts` — thin `fetch` wrapper that injects `Authorization: Bearer <token>` from `AuthContext` and calls `logout()` + redirects to `/login` on any 401 response
    - _Requirements: 5.6, 10.4_

- [x] 13. Implement `LoginPage`
  - Create `web-app/src/pages/LoginPage.tsx` with username/password form
  - On submit call `POST /auth/login`; on success call `AuthContext.login(token)` and redirect to the appropriate route based on `role` claim (`/admin`, `/tenant`, or `/mfa`)
  - On failure display a generic error message (no username/password distinction)
  - _Requirements: 10.1, 10.2, 10.3_

- [x] 14. Implement `ProtectedRoute` and wire role-based routing
  - Create `web-app/src/components/ProtectedRoute.tsx` — reads decoded JWT from `AuthContext`; redirects to `/login` if token is absent or `exp` is in the past; optionally checks `allowedRoles` prop and returns 403 view if role doesn't match
  - Wrap `/admin`, `/tenant`, and `/mfa` routes in `<ProtectedRoute>` in `App.tsx`
  - _Requirements: 10.1, 10.4_

- [x] 15. Implement `SuperAdminDashboard`
  - Create `web-app/src/pages/SuperAdminDashboard.tsx`
  - [x] 15.1 Fetch and display tenant list via `GET /admin/tenants` on mount
    - _Requirements: 8.1_
  - [x] 15.2 Add "Create Tenant" form that calls `POST /admin/tenants`; display result or error inline
    - _Requirements: 8.2, 8.4_
  - [x] 15.3 Add "Create Tenant Admin" form (tenant selector + username + password) that calls `POST /admin/tenants/{tenantId}/admins`; display result or error inline
    - _Requirements: 8.3, 8.4_

- [x] 16. Implement `TenantAdminDashboard`
  - Create `web-app/src/pages/TenantAdminDashboard.tsx`
  - [x] 16.1 Fetch and display user list via `GET /tenant/users` on mount
    - _Requirements: 9.1_
  - [x] 16.2 Add "Create User" form that calls `POST /tenant/users`; display result or error inline
    - _Requirements: 9.2, 9.5_
  - [x] 16.3 Add delete button per user row with a confirmation prompt; calls `DELETE /tenant/users/{userId}` on confirm
    - _Requirements: 9.3, 9.5_
  - [x] 16.4 Add "Reset Password" form per user that calls `POST /tenant/users/{userId}/reset-password`; display result or error inline
    - _Requirements: 9.4, 9.5_

- [x] 17. Update `usePushRegistration` hook and wire into `MfaApp`
  - [x] 17.1 Rewrite `usePushRegistration` to remove the `clientId` parameter; read `userId` and `tenantId` from `AuthContext`; post `{ userId, tenantId, subscription }` to `/register` with JWT Bearer header via `apiClient`
    - _Requirements: 6.1_
  - [x] 17.2 Handle HTTP 409 `device_already_bound` — set a `deviceConflict` boolean state; render a confirmation dialog asking the user to confirm device replacement; on confirm re-submit with `force: true`
    - _Requirements: 6.2, 6.3, 6.4_
  - [x] 17.3 Create `web-app/src/pages/MfaApp.tsx` (extracted from the old `App.tsx` `MainApp` component) that uses the updated hook and removes all `clientId` / `ClientIdPrompt` references
    - _Requirements: 6.1, 6.3_

- [x] 18. Final checkpoint — full stack wired up
  - Ensure `dotnet build` passes, `npm run build` passes, and all routes render without console errors. Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP (none in this plan per user request)
- Each task references specific requirements for traceability
- Checkpoints (tasks 10 and 18) ensure incremental validation at natural seams
- The `ClientIdPrompt` and `Settings` components can be removed or left unused once `MfaApp` no longer references `clientId`
