# Implementation Plan: Tenant Login Flow

## Overview

Incremental implementation of tenant-aware login across the backend (C# / ASP.NET Core) and frontend (React / TypeScript). Each task builds on the previous one; the final tasks wire everything together end-to-end.

## Tasks

- [x] 1. EF Core migration — add Domain and LoginInstructions columns
  - [x] 1.1 Create migration `AddTenantDomain` in `backend/Migrations/`
    - Add nullable `Domain` (text) column to `Tenants`
    - Add nullable `LoginInstructions` (text) column to `Tenants`
    - SQL backfill: `UPDATE "Tenants" SET "Domain" = lower(regexp_replace("Name", '\s+', '-', 'g')) WHERE "Domain" IS NULL`
    - Alter `Domain` to NOT NULL
    - Add unique index `IX_Tenants_Domain` on `Tenants.Domain`
    - _Requirements: 1.6_

- [x] 2. Update Tenant entity and DbContext
  - [x] 2.1 Add `Domain` and `LoginInstructions` properties to `backend/Data/Tenant.cs`
    - `public string Domain { get; set; } = string.Empty;`
    - `public string? LoginInstructions { get; set; }`
    - _Requirements: 1.5_
  - [x] 2.2 Add unique index configuration to `backend/Data/PushMfaDbContext.cs`
    - `modelBuilder.Entity<Tenant>().HasIndex(t => t.Domain).IsUnique();`
    - _Requirements: 1.4_

- [x] 3. Update AdminController — CreateTenant and tenant list
  - [x] 3.1 Update `CreateTenantRequest` record in `backend/Controllers/AdminController.cs` to include `string Domain`
    - Add `IsValidDomain` static helper: `^[a-z0-9]+(-[a-z0-9]+)*$`
    - Validate domain format, return 400 on failure
    - Check domain uniqueness, return 409 on conflict
    - Persist `Domain` on the new `Tenant` entity
    - Return `domain` in the 201 response body
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
  - [x] 3.2 Update `GetTenants` projection in `AdminController` to include `domain` field
    - _Requirements: 1.5_

- [x] 4. Add AuthController.GetTenantByDomain
  - [x] 4.1 Add `[AllowAnonymous] GET /auth/tenant/{domain}` action to `backend/Controllers/AuthController.cs`
    - Inject `PushMfaDbContext` into `AuthController`
    - Case-insensitive lookup: `t.Domain.ToLower() == domain.ToLower()`
    - Return 200 `{ name, domain, loginInstructions }` on match
    - Return 404 `{ error: "tenant not found" }` on miss
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 5. Update IAuthService, AuthService, and AuthController.Login
  - [x] 5.1 Update `IAuthService` signature in `backend/Services/IAuthService.cs`
    - Change to `Task<string?> LoginAsync(string tenantDomain, string username, string password);`
    - _Requirements: 6.1, 6.6_
  - [x] 5.2 Rewrite `AuthService.LoginAsync` in `backend/Services/AuthService.cs`
    - If `tenantDomain` is non-empty: resolve tenant by domain (case-insensitive), return null if not found; look up user scoped to `tenant.Id`
    - If `tenantDomain` is empty: look up user globally, return null unless `user.Role == "SuperAdmin"`
    - Verify password with BCrypt; build and return JWT (claims unchanged)
    - _Requirements: 6.2, 6.3, 6.5_
  - [x] 5.3 Update `LoginRequest` record and `Login` action in `backend/Controllers/AuthController.cs`
    - Change record to `LoginRequest(string TenantDomain, string Username, string Password)`
    - Pass `request.TenantDomain` to `_authService.LoginAsync`
    - _Requirements: 6.1, 6.4, 6.6_

- [x] 6. Add TenantController.SetLoginInstructions
  - [x] 6.1 Add `SetLoginInstructionsRequest` record and `PUT /tenant/instructions` action to `backend/Controllers/TenantController.cs`
    - Resolve `tenantId` from JWT claim; return 401 if missing
    - Load tenant from DB; return 404 if not found
    - Set `LoginInstructions` to null when value is empty/whitespace, otherwise store as-is
    - Save and return 204
    - _Requirements: 2.1, 2.2, 2.5_

- [x] 7. Checkpoint — backend complete
  - Ensure the project builds (`dotnet build`). Ask the user if questions arise.

- [x] 8. Frontend: add PUT helper to apiClient and update App.tsx routes
  - [x] 8.1 Add `put<T>` method to `apiClient` in `web-app/src/api/apiClient.ts`
    - Mirror the existing `post` implementation with `method: 'PUT'`
    - _Requirements: 2.1_
  - [x] 8.2 Add `/login/:tenantDomain` route to `web-app/src/App.tsx`
    - Add `<Route path="/login/:tenantDomain" element={<LoginPage />} />` alongside the existing `/login` route
    - _Requirements: 5.1_

- [x] 9. Frontend: rewrite LoginPage as two-step flow
  - [x] 9.1 Rewrite `web-app/src/pages/LoginPage.tsx`
    - Read optional `tenantDomain` param via `useParams`
    - State: `step: 'tenant' | 'credentials'`, `resolvedTenant: { name, domain, loginInstructions } | null`
    - On mount with URL param: call `GET /auth/tenant/:domain`; on success advance to credentials step; on 404 show error and stay on tenant step
    - Tenant step: single domain input; on submit call `GET /auth/tenant/:domain`; advance or show error
    - Credentials step: show resolved tenant name; show `loginInstructions` if present; username + password inputs
    - On login submit: `POST /auth/login` with `{ tenantDomain: resolvedTenant.domain, username, password }`; on success call `login(token)` and redirect by role; on 401 show error
    - `/login` with no param: skip tenant step, send empty `tenantDomain` (SuperAdmin path)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 5.2, 5.3, 5.4, 5.5, 6.1_

- [x] 10. Frontend: update SuperAdminDashboard — domain field in tenant creation
  - [x] 10.1 Update `Tenant` interface and tenant creation form in `web-app/src/pages/SuperAdminDashboard.tsx`
    - Add `domain: string` to the `Tenant` interface
    - Add `tenantDomain` state and a "Domain" text input to the New Tenant form
    - Client-side validation: test against `^[a-z0-9]+(-[a-z0-9]+)*$` before submit; show inline error if invalid
    - Pass `{ name: tenantName, domain: tenantDomain }` in the POST body
    - Show `domain` column in the tenants table
    - _Requirements: 1.1, 1.2, 1.3_

- [x] 11. Frontend: update TenantAdminDashboard — login instructions UI
  - [x] 11.1 Add login instructions section to `web-app/src/pages/TenantAdminDashboard.tsx`
    - Add state: `instructions`, `instructionsSaving`, `instructionsSuccess`, `instructionsError`
    - Render a card with a `<textarea>` and Save button
    - On save: call `apiClient.put('/tenant/instructions', { instructions })` and show success/error feedback
    - _Requirements: 2.1, 2.2, 2.5_

- [x] 12. Final checkpoint — Ensure all tests pass
  - Ensure the frontend builds (`npm run build` in `web-app/`) and the backend compiles. Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- The SuperAdmin login path uses an empty `tenantDomain` string — no separate endpoint needed
- The `PUT` helper added in task 8.1 is reused by task 11.1
