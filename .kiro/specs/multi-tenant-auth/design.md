# Design Document: Multi-Tenant Auth

## Overview

This feature adds a full authentication and multi-tenancy layer to the existing Push MFA application. The system currently uses a plain `client_id` string to identify push subscriptions; this design replaces that with a proper identity model: persisted users, tenants, roles, and JWT-based authentication.

The three roles are:
- **SuperAdmin** — global, not scoped to any tenant; manages tenants and their admins.
- **TenantAdmin** — scoped to one tenant; manages users within that tenant.
- **TenantUser** — scoped to one tenant; registers a device and responds to MFA challenges.

The existing VAPID key management, push subscription storage, and Redis pub/sub challenge flow are preserved and extended to be tenant-aware. No existing push infrastructure is removed; it is migrated to use `UserId` as the primary key instead of `ClientId`.

---

## Architecture

```mermaid
graph TD
    subgraph Web App (React/TS)
        LP[Login Page]
        SAD[Super Admin Dashboard]
        TAD[Tenant Admin Dashboard]
        MFA[MFA Challenge View]
    end

    subgraph Backend (ASP.NET Core)
        AUTH[AuthController\nPOST /auth/login]
        ADMIN[AdminController\n/admin/tenants/**]
        TENANT[TenantController\n/tenant/users/**]
        PUSH[PushController\n/register /push /response]
        VAPID[VapidController\n/vapid-public-key]
        JWTMw[JWT Middleware]
    end

    subgraph Data
        PG[(PostgreSQL\nEF Core)]
        RD[(Redis\npub/sub)]
    end

    LP -->|POST /auth/login| AUTH
    SAD -->|Bearer JWT| ADMIN
    TAD -->|Bearer JWT| TENANT
    MFA -->|Bearer JWT| PUSH
    PUSH --> RD
    AUTH --> PG
    ADMIN --> PG
    TENANT --> PG
    PUSH --> PG
    JWTMw --> AUTH
    JWTMw --> ADMIN
    JWTMw --> TENANT
    JWTMw --> PUSH
```

The backend follows a standard layered approach:
- **Controllers** handle HTTP routing and input validation.
- **Services** encapsulate business logic (auth, tenant management, device binding).
- **EF Core DbContext** is the single data access layer for PostgreSQL.
- **JWT middleware** (ASP.NET Core built-in) validates Bearer tokens on every protected route.

---

## Components and Interfaces

### Backend

#### AuthController — `POST /auth/login`
Accepts `{ username, password }`. Looks up the user by username (case-insensitive), verifies the bcrypt hash, and returns a signed JWT.

```csharp
// Request
record LoginRequest(string Username, string Password);

// Response (200)
record LoginResponse(string Token);
```

#### AdminController — `/admin/tenants/**`
Protected by `[Authorize(Roles = "SuperAdmin")]`.

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/admin/tenants` | Create tenant |
| GET | `/admin/tenants` | List all tenants |
| POST | `/admin/tenants/{tenantId}/admins` | Create TenantAdmin |

#### TenantController — `/tenant/users/**`
Protected by `[Authorize(Roles = "TenantAdmin")]`. Tenant scope is read from the JWT `tenantId` claim.

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/tenant/users` | Create TenantUser |
| GET | `/tenant/users` | List users in tenant |
| DELETE | `/tenant/users/{userId}` | Delete user |
| POST | `/tenant/users/{userId}/reset-password` | Reset password |

#### PushController — `/register`, `/push`, `/response`
`/register` is protected by `[Authorize(Roles = "TenantUser")]`. The `client_id` field is replaced by the authenticated user's `userId` and `tenantId` from the JWT.

`/push` accepts `{ userId, tenantId, message }` instead of `{ client_id, message }`.

#### JWT Configuration
`Microsoft.AspNetCore.Authentication.JwtBearer` is added to the DI container. Token parameters:

```json
{
  "Jwt": {
    "Key": "<32+ byte secret>",
    "Issuer": "push-mfa",
    "Audience": "push-mfa",
    "ExpiryHours": 8
  }
}
```

Claims embedded in the token: `sub` (userId), `tenantId`, `username`, `role`.

#### IAuthService
```csharp
public interface IAuthService
{
    Task<string?> LoginAsync(string username, string password);
}
```

#### IDeviceService
```csharp
public interface IDeviceService
{
    Task<DeviceBindResult> BindAsync(Guid userId, Guid tenantId, PushSubscriptionDto sub, bool force);
}

public enum DeviceBindResult { Bound, AlreadyBound }
```

### Frontend

The existing `App.tsx` / `ClientIdPrompt` flow is replaced by a router-based shell.

#### Routing (React Router v6)
```
/login                → LoginPage
/admin                → SuperAdminDashboard   (role: SuperAdmin)
/tenant               → TenantAdminDashboard  (role: TenantAdmin)
/mfa                  → MfaApp               (role: TenantUser)
```

A `ProtectedRoute` wrapper reads the decoded JWT from in-memory state and redirects to `/login` if absent or expired.

#### AuthContext
```typescript
interface AuthState {
  token: string | null;          // raw JWT, in-memory only
  user: DecodedClaims | null;    // { sub, tenantId, username, role }
  login: (token: string) => void;
  logout: () => void;
}
```

The token is **never written to localStorage**. It lives in React state only.

#### apiClient
A thin wrapper around `fetch` that injects `Authorization: Bearer <token>` from `AuthContext` on every request and redirects to `/login` on 401.

#### usePushRegistration (updated)
The hook no longer accepts a `clientId` parameter. It reads `userId` and `tenantId` from `AuthContext` and posts them to `/register`. On HTTP 409 with `device_already_bound`, it sets a `deviceConflict` flag that triggers a confirmation dialog.

---

## Data Models

### EF Core Entities

#### Tenant
```csharp
public class Tenant
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;   // unique
    public DateTime CreatedAt { get; set; }

    public ICollection<User> Users { get; set; } = [];
}
```

#### User
```csharp
public class User
{
    public Guid Id { get; set; }
    public Guid? TenantId { get; set; }                // null for SuperAdmin
    public Tenant? Tenant { get; set; }
    public string Username { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;  // bcrypt
    public string Role { get; set; } = string.Empty;   // SuperAdmin | TenantAdmin | TenantUser
    public DateTime CreatedAt { get; set; }

    public PushSubscriptionEntity? PushSubscription { get; set; }
}
```

#### PushSubscriptionEntity (migrated)
```csharp
public class PushSubscriptionEntity
{
    public Guid UserId { get; set; }          // PK — replaces ClientId string
    public User User { get; set; } = null!;
    public Guid TenantId { get; set; }
    public string Endpoint { get; set; } = string.Empty;
    public string P256dh { get; set; } = string.Empty;
    public string Auth { get; set; } = string.Empty;
    public DateTime UpdatedAt { get; set; }
}
```

#### DbContext additions
```csharp
public DbSet<Tenant> Tenants { get; set; }
public DbSet<User> Users { get; set; }
```

`OnModelCreating` additions:
- `Tenant.Name` — unique index.
- `User` — unique index on `(TenantId, Username)`.
- `PushSubscriptionEntity` — PK changed to `UserId`; FK to `Users.Id`.
- `User.TenantId` — FK to `Tenants.Id`, nullable.

### PostgreSQL Schema (via EF Core migrations)

```sql
CREATE TABLE "Tenants" (
    "Id"        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "Name"      varchar NOT NULL UNIQUE,
    "CreatedAt" timestamptz NOT NULL
);

CREATE TABLE "Users" (
    "Id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "TenantId"     uuid REFERENCES "Tenants"("Id"),
    "Username"     varchar NOT NULL,
    "PasswordHash" varchar NOT NULL,
    "Role"         varchar NOT NULL,
    "CreatedAt"    timestamptz NOT NULL,
    UNIQUE ("TenantId", "Username")
);

-- PushSubscriptions: drop ClientId PK, add UserId PK + FK
ALTER TABLE "PushSubscriptions"
    DROP CONSTRAINT "PK_PushSubscriptions",
    ADD COLUMN "UserId" uuid NOT NULL REFERENCES "Users"("Id"),
    ADD COLUMN "TenantId" uuid NOT NULL,
    DROP COLUMN "ClientId",
    ADD CONSTRAINT "PK_PushSubscriptions" PRIMARY KEY ("UserId");
```

All changes are applied via EF Core migrations (not raw SQL); the above is illustrative.

### JWT Payload
```json
{
  "sub": "<userId>",
  "tenantId": "<tenantId | null>",
  "username": "alice",
  "role": "TenantUser",
  "exp": 1234567890
}
```

---


## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Tenant creation round-trip

*For any* unique tenant name, creating a tenant via `POST /admin/tenants` and then calling `GET /admin/tenants` should return a list that contains a tenant with that name and a non-empty ID.

**Validates: Requirements 1.1, 1.3**

---

### Property 2: Duplicate tenant name rejected

*For any* tenant name that already exists in the system, a second `POST /admin/tenants` request with the same name should return HTTP 409.

**Validates: Requirements 1.2**

---

### Property 3: Duplicate username within tenant rejected

*For any* tenant and username combination that already exists, a second attempt to create a user (TenantAdmin or TenantUser) with the same username in the same tenant should return HTTP 409.

**Validates: Requirements 2.3, 3.2**

---

### Property 4: User creation stores correct role and hashed password

*For any* user created with a given role and plaintext password, the stored record should have the correct role string and a password hash that (a) is not equal to the plaintext and (b) verifies successfully against the plaintext via bcrypt.

**Validates: Requirements 2.5, 4.4**

---

### Property 5: User list is tenant-scoped

*For any* TenantAdmin JWT, calling `GET /tenant/users` should return only users whose `TenantId` matches the tenant encoded in that JWT — never users from other tenants.

**Validates: Requirements 3.3**

---

### Property 6: Cross-tenant operations return 403

*For any* TenantAdmin and any user belonging to a different tenant, attempting to delete that user or reset their password should return HTTP 403.

**Validates: Requirements 3.5, 4.2**

---

### Property 7: Unauthenticated requests return 401

*For any* protected endpoint (`/admin/**`, `/tenant/**`, `/register`) and any request that carries no JWT or an invalid/expired JWT, the response should be HTTP 401.

**Validates: Requirements 1.4, 2.4, 3.6, 4.3, 6.6**

---

### Property 8: Password reset round-trip

*For any* TenantUser and new plaintext password, after a successful `POST /tenant/users/{userId}/reset-password`, calling `POST /auth/login` with the new password should succeed, and calling it with the old password should return HTTP 401.

**Validates: Requirements 4.1**

---

### Property 9: Login with valid credentials returns JWT with correct claims

*For any* user in the system, logging in with their correct username and password should return a JWT whose decoded claims contain the correct `sub` (userId), `tenantId`, `username`, and `role` values matching the stored user record.

**Validates: Requirements 5.2**

---

### Property 10: Login with invalid credentials returns 401

*For any* combination of username and password where either the username does not exist or the password does not match, `POST /auth/login` should return HTTP 401 with a response body that does not distinguish between the two failure modes.

**Validates: Requirements 5.3**

---

### Property 11: JWT expiry claim matches configured value

*For any* issued JWT, the `exp` claim should be within one second of `now + configured expiry duration`, ensuring the token lifetime is correctly applied.

**Validates: Requirements 5.5**

---

### Property 12: Device registration round-trip

*For any* TenantUser and push subscription object, a successful `POST /register` should result in the subscription being retrievable from the database keyed by that user's ID and tenant ID.

**Validates: Requirements 6.1**

---

### Property 13: Second registration without force returns 409

*For any* TenantUser who already has a device bound, a second `POST /register` request without `force: true` should return HTTP 409 with an error code of `device_already_bound`.

**Validates: Requirements 6.2**

---

### Property 14: Force registration replaces existing device

*For any* TenantUser who already has a device bound, a `POST /register` request with `force: true` and a new subscription should replace the old subscription, so that only the new subscription is stored for that user.

**Validates: Requirements 6.5**

---

### Property 15: Push lookup by userId and tenantId

*For any* `POST /push` request, the backend should look up the push subscription using `userId` + `tenantId`. If no subscription exists for that combination, the response should be HTTP 404; if one exists, the push notification should be sent to that subscription's endpoint.

**Validates: Requirements 7.1, 7.2**

---

### Property 16: Push payload contains tenantId

*For any* push notification sent by the backend, the JSON payload delivered to the browser should contain a `tenantId` field matching the tenant of the target user.

**Validates: Requirements 7.3**

---

## Error Handling

### Backend

| Scenario | HTTP Status | Response body |
|----------|-------------|---------------|
| Missing or invalid JWT | 401 | `{ "error": "unauthorized" }` |
| Valid JWT but wrong role | 403 | `{ "error": "forbidden" }` |
| Cross-tenant resource access | 403 | `{ "error": "forbidden" }` |
| Resource not found | 404 | `{ "error": "not found" }` |
| Duplicate name/username | 409 | `{ "error": "<descriptive message>" }` |
| Device already bound | 409 | `{ "error": "device_already_bound" }` |
| Invalid request body | 400 | `{ "error": "invalid request" }` |
| Push delivery failure | 502 | `{ "error": "push delivery failed" }` |
| Long-poll timeout | 408 | `{ "error": "request timed out" }` |
| Redis unavailable | 503 | `{ "error": "service unavailable" }` |

Login failures always return 401 with `{ "error": "invalid credentials" }` regardless of whether the username or password was wrong.

### Frontend

- All API calls go through `apiClient`, which catches 401 responses and triggers a logout + redirect to `/login`.
- Each dashboard component displays inline error messages from API responses.
- The device-replace confirmation dialog is shown only when the backend returns `device_already_bound`; the user must explicitly confirm before the force re-registration is sent.
- JWT expiry is detected either by a 401 response or by checking the `exp` claim before making a request; either path redirects to `/login`.

---

## Testing Strategy

Since the requirements specify no tests are needed for this feature, the testing strategy below is provided as guidance for future implementation.

### Dual Testing Approach

Both unit tests and property-based tests are complementary:

- **Unit tests** cover specific examples, integration points, and error conditions (e.g., "login with a known user returns the expected role claim").
- **Property-based tests** verify universal properties across randomly generated inputs (e.g., "for any valid user, login always returns a JWT with matching claims").

### Property-Based Testing

Use **FsCheck** (for F# / C# interop) or **CsCheck** for the ASP.NET Core backend. Each property test should run a minimum of **100 iterations**.

Each test must be tagged with a comment referencing the design property:

```csharp
// Feature: multi-tenant-auth, Property 3: Duplicate username within tenant rejected
[Property]
public Property DuplicateUsernameWithinTenantReturns409(...)
```

Each correctness property (P1–P16) should be implemented by a single property-based test.

### Unit Testing

Use **xUnit** for the backend. Focus on:
- Specific login examples (SuperAdmin, TenantAdmin, TenantUser).
- Edge cases: empty password, null tenantId for SuperAdmin, force-replace flow.
- Integration points: EF Core unique constraint violations surface as 409, not 500.

For the frontend, use **Vitest** + **React Testing Library**:
- `LoginPage` renders error on 401.
- `ProtectedRoute` redirects to `/login` when token is absent.
- `usePushRegistration` sets `deviceConflict` flag on 409 `device_already_bound`.
