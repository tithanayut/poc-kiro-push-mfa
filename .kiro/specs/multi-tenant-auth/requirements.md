# Requirements Document

## Introduction

This feature adds multi-tenant support and a full authentication layer to the Push MFA application. The system introduces three roles: Super Admin (global), Tenant Admin (per-tenant), and Tenant User. Super Admins manage tenants and their admins. Tenant Admins manage users within their tenant. Tenant Users authenticate, register their browser device for push notifications, and respond to MFA challenges. All user and tenant data is persisted in PostgreSQL via EF Core.

The existing push notification infrastructure (VAPID keys, push subscriptions, Redis pub/sub) is preserved and extended to be tenant-aware.

## Glossary

- **System**: The Push MFA backend (ASP.NET Core API) and web-app (React/TypeScript) collectively.
- **Backend**: The ASP.NET Core API.
- **Web_App**: The React/TypeScript frontend.
- **Super_Admin**: A globally privileged user who manages tenants and tenant admins. Not scoped to any tenant.
- **Tenant**: An isolated organisational unit containing its own admins and users.
- **Tenant_Admin**: A user within a tenant who has the `TenantAdmin` role and can manage users in that tenant.
- **Tenant_User**: A regular authenticated user belonging to a tenant who can register a device and respond to MFA challenges.
- **Device**: A browser push subscription (endpoint + VAPID keys) bound to a Tenant_User.
- **JWT**: A JSON Web Token issued by the Backend upon successful login, used to authenticate subsequent requests.
- **Credential**: A username/password pair stored as a salted bcrypt hash in PostgreSQL.
- **Password_Reset**: The act of a Tenant_Admin setting a new password for a Tenant_User.
- **Role**: A string claim embedded in the JWT — one of `SuperAdmin`, `TenantAdmin`, or `TenantUser`.

---

## Requirements

### Requirement 1: Tenant Management by Super Admin

**User Story:** As a Super Admin, I want to create and list tenants, so that I can onboard new organisations into the Push MFA system.

#### Acceptance Criteria

1. THE Backend SHALL expose a `POST /admin/tenants` endpoint that creates a new Tenant with a unique name and returns the created Tenant's ID.
2. WHEN a `POST /admin/tenants` request is received with a tenant name that already exists, THE Backend SHALL return HTTP 409 with a descriptive error.
3. THE Backend SHALL expose a `GET /admin/tenants` endpoint that returns a list of all Tenants with their IDs and names.
4. WHEN a request to `/admin/tenants` is received without a valid Super Admin JWT, THE Backend SHALL return HTTP 401.
5. THE Backend SHALL store Tenant records in PostgreSQL with at minimum: `Id` (UUID), `Name` (unique string), `CreatedAt` (timestamp).

---

### Requirement 2: Tenant Admin Management by Super Admin

**User Story:** As a Super Admin, I want to create Tenant Admin accounts for a given tenant, so that each tenant has an administrator who can manage its users.

#### Acceptance Criteria

1. THE Backend SHALL expose a `POST /admin/tenants/{tenantId}/admins` endpoint that creates a Tenant Admin user scoped to the specified tenant.
2. WHEN a `POST /admin/tenants/{tenantId}/admins` request is received for a non-existent tenant, THE Backend SHALL return HTTP 404.
3. WHEN a `POST /admin/tenants/{tenantId}/admins` request is received with a username that already exists within that tenant, THE Backend SHALL return HTTP 409.
4. WHEN a request to `/admin/tenants/{tenantId}/admins` is received without a valid Super Admin JWT, THE Backend SHALL return HTTP 401.
5. THE Backend SHALL store the Tenant Admin as a user record with the `TenantAdmin` role, scoped to the given tenant, with a bcrypt-hashed password.

---

### Requirement 3: User Management by Tenant Admin

**User Story:** As a Tenant Admin, I want to create, list, and delete Tenant Users within my tenant, so that I can control who has access to the MFA system.

#### Acceptance Criteria

1. THE Backend SHALL expose a `POST /tenant/users` endpoint that creates a new Tenant User scoped to the authenticated Tenant Admin's tenant.
2. WHEN a `POST /tenant/users` request is received with a username that already exists within the same tenant, THE Backend SHALL return HTTP 409.
3. THE Backend SHALL expose a `GET /tenant/users` endpoint that returns all users belonging to the authenticated Tenant Admin's tenant.
4. THE Backend SHALL expose a `DELETE /tenant/users/{userId}` endpoint that removes the specified user from the tenant.
5. WHEN a `DELETE /tenant/users/{userId}` request targets a user belonging to a different tenant, THE Backend SHALL return HTTP 403.
6. WHEN any `/tenant/users` request is received without a valid Tenant Admin JWT, THE Backend SHALL return HTTP 401.

---

### Requirement 4: Password Reset by Tenant Admin

**User Story:** As a Tenant Admin, I want to reset a Tenant User's password, so that I can recover access for users who are locked out.

#### Acceptance Criteria

1. THE Backend SHALL expose a `POST /tenant/users/{userId}/reset-password` endpoint that sets a new bcrypt-hashed password for the specified user.
2. WHEN a `POST /tenant/users/{userId}/reset-password` request targets a user outside the authenticated Tenant Admin's tenant, THE Backend SHALL return HTTP 403.
3. WHEN a `POST /tenant/users/{userId}/reset-password` request is received without a valid Tenant Admin JWT, THE Backend SHALL return HTTP 401.
4. THE Backend SHALL accept the new password as a plain-text string in the request body and store only the bcrypt hash.

---

### Requirement 5: Authentication (Login)

**User Story:** As any user (Super Admin, Tenant Admin, or Tenant User), I want to log in with my username and password, so that I can receive a JWT to authenticate further requests.

#### Acceptance Criteria

1. THE Backend SHALL expose a `POST /auth/login` endpoint that accepts a username and password.
2. WHEN valid credentials are provided, THE Backend SHALL return a signed JWT containing the user's ID, tenant ID (if applicable), username, and Role claim.
3. WHEN invalid credentials are provided, THE Backend SHALL return HTTP 401 with a generic error message (no indication of whether username or password was wrong).
4. THE Backend SHALL validate passwords by comparing the submitted plain-text password against the stored bcrypt hash.
5. THE Backend SHALL set a configurable JWT expiry (default 8 hours).
6. THE Web_App SHALL store the JWT in memory (not localStorage) and attach it as a Bearer token on all authenticated API requests.

---

### Requirement 6: Device Registration by Tenant User

**User Story:** As a Tenant User, I want to register my browser as my MFA device, so that I can receive push MFA challenges.

#### Acceptance Criteria

1. WHEN a `POST /register` request is received with a valid Tenant User JWT, THE Backend SHALL associate the push subscription with the authenticated user's ID and tenant.
2. WHEN a `POST /register` request is received and the authenticated user already has a Device bound, THE Backend SHALL return HTTP 409 with a `device_already_bound` error code.
3. WHERE the Web_App detects a `device_already_bound` response, THE Web_App SHALL prompt the user to confirm whether they want to replace the existing device.
4. WHEN the user confirms replacement, THE Web_App SHALL re-submit the `POST /register` request with a `force: true` flag.
5. WHEN a `POST /register` request is received with `force: true` and a valid Tenant User JWT, THE Backend SHALL replace the existing Device binding with the new push subscription.
6. WHEN a `POST /register` request is received without a valid JWT, THE Backend SHALL return HTTP 401.

---

### Requirement 7: Tenant-Scoped Push Challenges

**User Story:** As an external caller, I want to trigger an MFA challenge for a specific user within a tenant, so that the correct user's device receives the push notification.

#### Acceptance Criteria

1. WHEN a `POST /push` request is received, THE Backend SHALL look up the push subscription by user ID and tenant ID rather than the legacy `client_id` field.
2. WHEN no Device is bound to the specified user, THE Backend SHALL return HTTP 404.
3. THE Backend SHALL include the tenant ID in the push payload so the Web_App can display tenant context to the user.

---

### Requirement 8: Super Admin Web Interface

**User Story:** As a Super Admin, I want a dedicated section in the Web_App to manage tenants and tenant admins, so that I can perform administrative tasks without using raw API calls.

#### Acceptance Criteria

1. WHEN a Super Admin logs in, THE Web_App SHALL display a Super Admin dashboard with options to list tenants, create a tenant, and create a Tenant Admin for a selected tenant.
2. WHEN a tenant creation form is submitted, THE Web_App SHALL call `POST /admin/tenants` and display the result.
3. WHEN a Tenant Admin creation form is submitted, THE Web_App SHALL call `POST /admin/tenants/{tenantId}/admins` and display the result.
4. WHEN an API call returns an error, THE Web_App SHALL display a human-readable error message to the Super Admin.

---

### Requirement 9: Tenant Admin Web Interface

**User Story:** As a Tenant Admin, I want a dedicated section in the Web_App to manage users in my tenant, so that I can create, view, and remove users and reset their passwords.

#### Acceptance Criteria

1. WHEN a Tenant Admin logs in, THE Web_App SHALL display a Tenant Admin dashboard listing all users in the tenant.
2. THE Web_App SHALL provide a form to create a new Tenant User within the tenant.
3. THE Web_App SHALL provide a button to delete a Tenant User, with a confirmation prompt before deletion.
4. THE Web_App SHALL provide a form to reset a Tenant User's password.
5. WHEN any management action fails, THE Web_App SHALL display a human-readable error message.

---

### Requirement 10: Login Page

**User Story:** As any user, I want a login page in the Web_App, so that I can authenticate before accessing any functionality.

#### Acceptance Criteria

1. THE Web_App SHALL display a login page as the default route when no valid JWT is present in memory.
2. WHEN login succeeds, THE Web_App SHALL redirect the user to the appropriate dashboard based on their Role claim.
3. WHEN login fails, THE Web_App SHALL display a generic error message without revealing whether the username or password was incorrect.
4. WHEN a JWT expires, THE Web_App SHALL redirect the user back to the login page.

---

### Requirement 11: Data Model — Users and Tenants

**User Story:** As a developer, I want a well-defined PostgreSQL schema for users and tenants, so that the system has a reliable, queryable data foundation.

#### Acceptance Criteria

1. THE Backend SHALL define a `Tenants` table with columns: `Id` (UUID, PK), `Name` (varchar, unique), `CreatedAt` (timestamptz).
2. THE Backend SHALL define a `Users` table with columns: `Id` (UUID, PK), `TenantId` (UUID, FK → Tenants, nullable for Super Admin), `Username` (varchar), `PasswordHash` (varchar), `Role` (varchar), `CreatedAt` (timestamptz).
3. THE Backend SHALL enforce a unique constraint on `(TenantId, Username)` so usernames are unique per tenant.
4. THE Backend SHALL define a `PushSubscriptions` table with a foreign key from `UserId` (UUID) → `Users.Id`, replacing the legacy `ClientId` string key.
5. THE Backend SHALL apply all schema changes via EF Core migrations.
