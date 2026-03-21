# Implementation Plan: Tenant App Management

## Overview

Implement per-tenant app management and app-scoped push MFA. The work proceeds in layers: data model → secret service → backend API → push endpoint update → frontend dashboard.

## Tasks

- [x] 1. Add `TenantApp` entity and update `PushMfaDbContext`
  - Create `backend/Data/TenantApp.cs` with properties: `Id` (Guid PK), `TenantId` (Guid FK), `Tenant` nav property, `Name`, `Secret`, `IsDisabled`, `IsDefault`, `CreatedAt`
  - Add `public ICollection<TenantApp> Apps { get; set; }` navigation property to `backend/Data/Tenant.cs`
  - Add `DbSet<TenantApp> TenantApps` to `PushMfaDbContext`
  - In `OnModelCreating`: configure unique index on `(TenantId, Name)` and FK `TenantId → Tenants.Id` with cascade delete
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 2. Create EF Core schema migration for `TenantApps` table
  - Run `dotnet ef migrations add AddTenantApps` to generate the migration file
  - Verify the generated migration creates the `TenantApps` table with all columns and the unique index on `(TenantId, Name)`
  - Update `PushMfaDbContextModelSnapshot` to reflect the new entity
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 3. Create EF Core data migration to backfill default apps for existing tenants
  - Add a new migration (e.g. `SeedDefaultApps`) with hand-written `Up` SQL
  - The SQL should insert one row into `TenantApps` for each `Tenants` row that has no existing default app, generating a random 32-char alphanumeric secret via `gen_random_bytes` or equivalent, setting `IsDefault = true`, `Name = 'Default'`, `IsDisabled = false`
  - _Requirements: 2.2, 2.3_

- [x] 4. Implement `AppSecretService`
  - Create `backend/Services/AppSecretService.cs` with a single `Generate()` method
  - Use `RandomNumberGenerator.GetBytes` to produce cryptographically random bytes, then map to the alphanumeric charset `[A-Za-z0-9]` to produce exactly 32 characters
  - Register the service as a singleton or scoped in `Program.cs`
  - _Requirements: 4.1, 4.2, 4.3_

- [x] 5. Add `/tenant/apps` CRUD endpoints to `TenantController`
  - [x] 5.1 Implement `GET /tenant/apps` — query `TenantApps` filtered by caller's `tenantId`, return array of `{ id, name, isDefault, isDisabled, createdAt }` (no secret)
    - _Requirements: 3.1_
  - [x] 5.2 Implement `POST /tenant/apps` — accept `{ name }`, call `AppSecretService.Generate()`, persist new `TenantApp`, return full record including `secret`; return 409 on duplicate name
    - _Requirements: 3.2, 3.3_
  - [x] 5.3 Implement `PATCH /tenant/apps/{appId}` — update `name` and/or `isDisabled`; return 403 if app belongs to a different tenant
    - _Requirements: 3.4, 3.5_
  - [x] 5.4 Implement `DELETE /tenant/apps/{appId}` — return 409 with `cannot_delete_default_app` if `IsDefault = true`; return 403 if app belongs to a different tenant; otherwise delete
    - _Requirements: 3.6, 3.7, 3.8_
  - [x] 5.5 Implement `POST /tenant/apps/{appId}/reset-secret` — generate new secret via `AppSecretService`, persist, return `{ secret }`; return 403 if app belongs to a different tenant
    - _Requirements: 3.9, 3.10_

- [x] 6. Update `AdminController.CreateTenant` to provision a default app
  - Inject `AppSecretService` into `AdminController`
  - After creating the `Tenant` entity (before `SaveChangesAsync`), also add a `TenantApp` with `IsDefault = true`, `Name = "Default"`, and a freshly generated secret, within the same `SaveChangesAsync` call
  - _Requirements: 2.1, 2.3_

- [x] 7. Rewrite `PushController.Push` to use app-based authentication
  - Replace the `PushRequest` DTO: remove `UserId`, add `TenantId` (Guid), `Username` (string), `AppId` (Guid)
  - At the start of `Push`: extract `Authorization: Bearer <token>` header; return 401 if absent or malformed
  - Look up `TenantApp` by `AppId` where `TenantId` matches; return 401 if not found
  - Compare bearer token to `app.Secret`; return 401 if mismatch
  - If `app.IsDisabled`, return 403 with `{ "error": "app_disabled" }`
  - Resolve user by `TenantId + Username`; return 404 with `{ "error": "user_not_found" }` if not found
  - Look up push subscription by resolved `UserId`; return 404 with `{ "error": "device_not_found" }` if absent
  - Continue with existing Web Push dispatch and long-poll logic, passing resolved `userId` and `tenantId`
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9_

- [x] 8. Checkpoint — ensure backend compiles and all existing endpoints still work
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Refactor `TenantAdminDashboard.tsx` to a tabbed layout
  - Add `activeTab` state (`'users' | 'apps'`) defaulting to `'users'`
  - Render two tab buttons ("Users", "Apps") above the content area
  - Wrap the existing users grid + create-user card + login-instructions card in a conditional block shown only when `activeTab === 'users'`
  - Add a placeholder `<div>` for the Apps tab content (to be filled in task 10)
  - _Requirements: 6.1_

- [x] 10. Implement the Apps tab UI in `TenantAdminDashboard.tsx`
  - Add `TenantApp` interface: `{ id: string, name: string, isDefault: boolean, isDisabled: boolean, createdAt: string }`
  - On mount (and after mutations), fetch `GET /tenant/apps` and store in `apps` state; also store the default app's `id` and `secret` separately for use by Simulate Push
  - Render apps list table with columns: Name, Default, Status, Created, Actions
  - "New App" form: name input + submit button; on success store returned `secret` in `newAppSecret` state and display it in a highlighted one-time box with a copy button and "will not be shown again" warning; clear on dismiss
  - Per-app "Reset Secret" button: call `POST /tenant/apps/{appId}/reset-secret`, display returned secret the same way as above
  - Per-app Enable/Disable toggle: call `PATCH /tenant/apps/{appId}` with `{ isDisabled: !current }`
  - Per-app Delete button: `window.confirm` first; if `app.isDefault` show inline error without calling API; otherwise call `DELETE /tenant/apps/{appId}`
  - Display inline `alert alert-error` for any failed action
  - _Requirements: 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_

- [x] 11. Add "Simulate Push" to the Users tab
  - Extend `TenantUser` row state to track per-user push status: `pushStatus: Record<string, 'idle' | 'pending' | 'accepted' | 'denied' | 'timed_out' | string>`
  - Add a "Simulate Push" button to each user row in the Users tab
  - On click: set status to `'pending'`, call `POST /push` with `{ tenantId, username: u.username, appId: defaultApp.id }` and `Authorization: Bearer <defaultApp.secret>` header (use a custom `fetch` call or extend `apiClient` to support per-request auth headers)
  - On response: set status to the returned `response` value (`'accepted'` / `'denied'`) or `'timed_out'` on 408
  - If default app secret is not available (apps not loaded or default app disabled), show an inline error
  - Display status badge inline next to the button: "Accepted" (green), "Denied" (red), "Timed out" (gray), or error message
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 12. Final checkpoint — ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP (none in this plan per user request)
- The data migration (task 3) uses raw SQL in the EF Core migration `Up` method since EF seeding is not appropriate for one-time backfills
- The Simulate Push call (task 11) needs the default app secret in frontend state — this is fetched as part of the apps list load and held in memory only; it is never persisted client-side
- All 401 responses from `/push` use the same generic message to avoid leaking whether an appId exists
