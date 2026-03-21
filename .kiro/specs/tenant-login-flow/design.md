# Design Document: Tenant Login Flow

## Overview

This document describes the technical design for the tenant-aware login flow. The changes span the backend (ASP.NET Core) and frontend (React/TypeScript). The core work is:

1. Add a `Domain` column to the `Tenants` table with a migration that backfills existing rows.
2. Update `POST /admin/tenants` to accept an explicit `domain` field.
3. Add `GET /auth/tenant/:domain` — a public endpoint to resolve a tenant by domain.
4. Update `POST /auth/login` to require `tenantDomain` (breaking change, intentional).
5. Add `PUT /tenant/instructions` for TenantAdmins to set login instructions.
6. Rewrite `LoginPage` as a two-step flow; add `/login/:tenantDomain` route.

---

## Architecture

No new services or infrastructure are introduced. All changes are additive to the existing ASP.NET Core + React stack.

```
Browser
  └─ /login or /login/:tenantDomain
       └─ LoginPage (two-step)
            ├─ Step 1: GET /auth/tenant/:domain  →  AuthController
            └─ Step 2: POST /auth/login           →  AuthController → AuthService
                                                        └─ scoped user lookup by tenantId + username
```

---

## Database Changes

### New column: `Tenants.Domain`

```sql
ALTER TABLE "Tenants" ADD COLUMN "Domain" text NOT NULL DEFAULT '';
CREATE UNIQUE INDEX "IX_Tenants_Domain" ON "Tenants" ("Domain");
```

The EF Core migration will:
1. Add the `Domain` column (nullable initially to allow backfill).
2. Backfill existing rows: `Domain = lower(regexp_replace(Name, '\s+', '-', 'g'))`.
3. Set the column to NOT NULL and add the unique index.

### Updated `Tenant` entity

```csharp
public class Tenant
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Domain { get; set; } = string.Empty;  // NEW — unique, URL-safe
    public string? LoginInstructions { get; set; }       // NEW — optional
    public DateTime CreatedAt { get; set; }
    public ICollection<User> Users { get; set; } = new List<User>();
}
```

### DbContext changes

```csharp
modelBuilder.Entity<Tenant>()
    .HasIndex(t => t.Domain)
    .IsUnique();
```

---

## Backend Changes

### 1. Migration: `AddTenantDomain`

File: `backend/Migrations/<timestamp>_AddTenantDomain.cs`

```csharp
protected override void Up(MigrationBuilder migrationBuilder)
{
    // Add nullable Domain column
    migrationBuilder.AddColumn<string>(
        name: "Domain",
        table: "Tenants",
        type: "text",
        nullable: true);

    // Add nullable LoginInstructions column
    migrationBuilder.AddColumn<string>(
        name: "LoginInstructions",
        table: "Tenants",
        type: "text",
        nullable: true);

    // Backfill Domain from Name for existing tenants
    migrationBuilder.Sql(
        "UPDATE \"Tenants\" SET \"Domain\" = lower(regexp_replace(\"Name\", '\\s+', '-', 'g')) WHERE \"Domain\" IS NULL");

    // Make Domain NOT NULL and add unique index
    migrationBuilder.AlterColumn<string>(
        name: "Domain",
        table: "Tenants",
        type: "text",
        nullable: false,
        oldClrType: typeof(string),
        oldNullable: true);

    migrationBuilder.CreateIndex(
        name: "IX_Tenants_Domain",
        table: "Tenants",
        column: "Domain",
        unique: true);
}
```

### 2. AdminController — updated `CreateTenant`

`CreateTenantRequest` gains a required `Domain` field. Validation is done in the controller before persistence.

```csharp
public record CreateTenantRequest(string Name, string Domain);

// Validation helper (static, reusable)
private static bool IsValidDomain(string domain) =>
    System.Text.RegularExpressions.Regex.IsMatch(domain, @"^[a-z0-9]+(-[a-z0-9]+)*$");

[HttpPost("tenants")]
public async Task<IActionResult> CreateTenant([FromBody] CreateTenantRequest request)
{
    if (!IsValidDomain(request.Domain))
        return BadRequest(new { error = "domain must be lowercase letters, digits, and hyphens with no leading/trailing hyphens" });

    var nameExists = await _db.Tenants.AnyAsync(t => t.Name == request.Name);
    if (nameExists)
        return Conflict(new { error = "tenant name already exists" });

    var domainExists = await _db.Tenants.AnyAsync(t => t.Domain == request.Domain);
    if (domainExists)
        return Conflict(new { error = "tenant domain already exists" });

    var tenant = new Tenant
    {
        Id = Guid.NewGuid(),
        Name = request.Name,
        Domain = request.Domain,
        CreatedAt = DateTime.UtcNow
    };

    _db.Tenants.Add(tenant);
    try { await _db.SaveChangesAsync(); }
    catch (DbUpdateException) { return Conflict(new { error = "tenant already exists" }); }

    return CreatedAtAction(nameof(CreateTenant), new { id = tenant.Id },
        new { id = tenant.Id, name = tenant.Name, domain = tenant.Domain, createdAt = tenant.CreatedAt });
}
```

`GET /admin/tenants` response is updated to include `domain` in the projection.

### 3. AuthController — new tenant resolution endpoint

```csharp
// GET /auth/tenant/{domain}
[HttpGet("tenant/{domain}")]
[AllowAnonymous]
public async Task<IActionResult> GetTenantByDomain(string domain)
{
    var tenant = await _db.Tenants
        .FirstOrDefaultAsync(t => t.Domain.ToLower() == domain.ToLower());

    if (tenant is null)
        return NotFound(new { error = "tenant not found" });

    return Ok(new { name = tenant.Name, domain = tenant.Domain, loginInstructions = tenant.LoginInstructions });
}
```

### 4. AuthController / AuthService — updated login (breaking change)

`LoginRequest` adds a required `TenantDomain` field. `IAuthService` and `AuthService` are updated accordingly.

```csharp
// AuthController.cs
public record LoginRequest(string TenantDomain, string Username, string Password);

[HttpPost("login")]
public async Task<IActionResult> Login([FromBody] LoginRequest request)
{
    var token = await _authService.LoginAsync(request.TenantDomain, request.Username, request.Password);
    if (token is null)
        return Unauthorized(new { error = "invalid credentials" });
    return Ok(new LoginResponse(token));
}
```

```csharp
// IAuthService.cs
Task<string?> LoginAsync(string tenantDomain, string username, string password);
```

```csharp
// AuthService.cs — LoginAsync
public async Task<string?> LoginAsync(string tenantDomain, string username, string password)
{
    var tenant = await _db.Tenants
        .FirstOrDefaultAsync(t => t.Domain.ToLower() == tenantDomain.ToLower());

    if (tenant is null) return null;  // caller maps null → 401; tenant not found is treated as bad credentials

    var user = await _db.Users
        .FirstOrDefaultAsync(u => u.TenantId == tenant.Id
                               && u.Username.ToLower() == username.ToLower());

    if (user is null || !BCrypt.Net.BCrypt.Verify(password, user.PasswordHash))
        return null;

    // JWT claims — same as before, tenantId claim preserved
    var claims = new[]
    {
        new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
        new Claim("tenantId", user.TenantId?.ToString() ?? string.Empty),
        new Claim("username", user.Username),
        new Claim("role", user.Role)
    };
    // ... token construction unchanged
}
```

Note: SuperAdmin users have `TenantId == null`. The login flow for SuperAdmin does not go through the tenant-scoped path. The frontend will route SuperAdmins to `/login` without a tenant domain, and the backend will need a separate handling path or the SuperAdmin login remains on the old contract. See the "SuperAdmin Login" section below.

### 5. TenantController — login instructions endpoint

```csharp
public record SetLoginInstructionsRequest(string? Instructions);

// PUT /tenant/instructions
[HttpPut("instructions")]
public async Task<IActionResult> SetLoginInstructions([FromBody] SetLoginInstructionsRequest request)
{
    var tenantId = GetTenantId();
    if (tenantId is null) return Unauthorized();

    var tenant = await _db.Tenants.FindAsync(tenantId.Value);
    if (tenant is null) return NotFound();

    tenant.LoginInstructions = string.IsNullOrWhiteSpace(request.Instructions) ? null : request.Instructions;
    await _db.SaveChangesAsync();

    return NoContent();
}
```

---

## SuperAdmin Login

SuperAdmins have no tenant. To avoid breaking SuperAdmin login while adding the `tenantDomain` requirement, the `AuthService.LoginAsync` will handle the case where `tenantDomain` is an empty string or a special sentinel:

- If `tenantDomain` is empty/null, the service looks up the user globally (no tenant filter) and only succeeds if the user's role is `SuperAdmin`.
- The frontend `LoginPage` at `/login` (no tenant domain in URL) will skip the tenant step and show credentials directly, sending an empty `tenantDomain`.

This keeps the SuperAdmin path working without a separate endpoint.

---

## Frontend Changes

### 1. App.tsx — add `/login/:tenantDomain` route

```tsx
<Route path="/login" element={<LoginPage />} />
<Route path="/login/:tenantDomain" element={<LoginPage />} />
```

### 2. LoginPage — two-step flow

The page reads the optional `tenantDomain` param from the URL. If present, it skips step 1.

State machine:
- `step: 'tenant' | 'credentials'`
- `resolvedTenant: { name: string; domain: string; loginInstructions: string | null } | null`

```
/login                → step='tenant'  (SuperAdmin path: skip tenant step, send empty domain)
/login/:tenantDomain  → auto-resolve → step='credentials' (or error back to 'tenant')
```

Step 1 (Tenant step):
- Input for tenant domain
- On submit: `GET /auth/tenant/:domain`
  - 200 → advance to step 2, store `resolvedTenant`
  - 404 → show "Tenant not found" error, stay on step 1

Step 2 (Credentials step):
- Shows resolved tenant name as context
- Shows `loginInstructions` if present
- Username + password inputs
- On submit: `POST /auth/login` with `{ tenantDomain, username, password }`
  - 200 → `login(token)` → redirect by role
  - 401 → show "Invalid username or password", stay on step 2

### 3. TenantAdminDashboard — login instructions UI

Add a section to `TenantAdminDashboard.tsx` with a textarea and save button that calls `PUT /tenant/instructions`.

### 4. SuperAdminDashboard — tenant creation form update

The existing tenant creation form in `SuperAdminDashboard.tsx` gains a "Domain" input field alongside the existing "Name" field. The domain field is required and validated client-side with the same regex (`^[a-z0-9]+(-[a-z0-9]+)*$`) before submission.

---

## API Contract Summary

| Method | Path | Auth | Change |
|--------|------|------|--------|
| `POST` | `/admin/tenants` | SuperAdmin | **Updated** — body now requires `domain` field |
| `GET` | `/admin/tenants` | SuperAdmin | **Updated** — response includes `domain` field |
| `GET` | `/auth/tenant/:domain` | Public | **New** |
| `POST` | `/auth/login` | Public | **Breaking** — body now requires `tenantDomain` field |
| `PUT` | `/tenant/instructions` | TenantAdmin | **New** |

---

## Data Flow: Login

```
1. User visits /login/:tenantDomain
2. LoginPage calls GET /auth/tenant/:tenantDomain
3. Backend returns { name, domain, loginInstructions }
4. LoginPage shows Credentials_Step with tenant name + instructions
5. User submits username + password
6. LoginPage calls POST /auth/login { tenantDomain, username, password }
7. AuthService resolves tenant by domain, looks up user within that tenant
8. JWT issued with sub, tenantId, username, role claims
9. Frontend stores JWT, redirects by role
```

---

## Correctness Properties

1. Domain format invariant: any `Tenant_Domain` stored in the database matches `^[a-z0-9]+(-[a-z0-9]+)*$`.
2. Domain uniqueness invariant: no two tenants share the same `Domain` value (enforced by unique index).
3. Tenant-scoped auth: a user authenticated under tenant A cannot be returned when authenticating under tenant B, even if usernames match.
4. Migration backfill: after the migration runs, every existing tenant row has a non-null, non-empty `Domain`.
5. Login instructions round-trip: a value set via `PUT /tenant/instructions` is returned verbatim in `GET /auth/tenant/:domain`.
