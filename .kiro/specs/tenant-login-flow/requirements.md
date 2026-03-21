# Requirements Document

## Introduction

This feature introduces a tenant-aware login flow. Users must identify their tenant domain before entering credentials, ensuring authentication is scoped to the correct tenant. Tenant admins can provide custom login instructions displayed on their tenant's login page. Tenants are addressable via a dedicated URL path (`/login/<tenant-domain>`). When creating a new tenant, the SuperAdmin explicitly provides the Tenant_Domain. Existing tenants without a domain will have one auto-generated via a database migration derived from their name.

## Glossary

- **System**: The full-stack application (ASP.NET Core backend + React/TypeScript frontend).
- **Tenant**: An isolated organizational unit identified by a unique tenant domain.
- **Tenant_Domain**: A URL-safe identifier derived from the tenant name — lowercase letters and digits, words separated by hyphens (e.g., `acme-corp`).
- **Login_Page**: The frontend page at `/login` or `/login/<tenant-domain>` where users authenticate.
- **Tenant_Step**: The first step of the login flow where the user enters a tenant domain.
- **Credentials_Step**: The second step of the login flow where the user enters username and password.
- **Login_Instructions**: Optional free-text content a tenant admin configures to display on their tenant's login page.
- **TenantAdmin**: A user with the `TenantAdmin` role who manages a specific tenant.
- **SuperAdmin**: A user with the `SuperAdmin` role who manages all tenants.
- **Auth_API**: The backend authentication endpoints under `/auth`.
- **Tenant_API**: The backend tenant management endpoints under `/tenant` and `/admin`.

---

## Requirements

### Requirement 1: Tenant Domain Format

**User Story:** As a SuperAdmin, I want to explicitly set a tenant domain when creating a tenant, so that I control the URL-safe identifier used for tenant-scoped login.

#### Acceptance Criteria

1. WHEN a tenant creation request is submitted, THE Tenant_API SHALL require the SuperAdmin to provide an explicit Tenant_Domain value.
2. WHEN a tenant creation request is submitted, THE Tenant_API SHALL reject any Tenant_Domain that contains characters other than lowercase letters, digits, and hyphens.
3. WHEN a tenant creation request is submitted, THE Tenant_API SHALL reject any Tenant_Domain that starts or ends with a hyphen.
4. THE Tenant_API SHALL enforce uniqueness of Tenant_Domain across all tenants.
5. WHEN a tenant is created, THE Tenant_API SHALL store and return the Tenant_Domain alongside the tenant record.
6. WHEN the database migration runs, THE System SHALL auto-generate a Tenant_Domain for each existing tenant that does not have one, derived by converting the tenant name to lowercase and replacing spaces with hyphens.

---

### Requirement 2: Tenant-Specific Login Instructions

**User Story:** As a TenantAdmin, I want to configure custom login instructions for my tenant, so that my users see relevant guidance on the login page.

#### Acceptance Criteria

1. THE Tenant_API SHALL provide an endpoint for a TenantAdmin to set or update Login_Instructions for their tenant.
2. WHEN Login_Instructions are updated, THE Tenant_API SHALL persist the new value and return a success response.
3. WHERE Login_Instructions are not configured, THE Login_Page SHALL display no instructions section.
4. WHEN a tenant's Login_Instructions are configured, THE Login_Page SHALL display the Login_Instructions text on that tenant's login page.
5. THE Tenant_API SHALL allow Login_Instructions to be cleared by submitting an empty or null value.

---

### Requirement 3: Tenant Domain Resolution Endpoint

**User Story:** As a frontend client, I want to look up a tenant by domain, so that I can validate the tenant before prompting for credentials.

#### Acceptance Criteria

1. THE Auth_API SHALL provide a public (unauthenticated) endpoint that accepts a Tenant_Domain and returns whether the tenant exists.
2. WHEN a valid Tenant_Domain is provided, THE Auth_API SHALL return the tenant's display name and Login_Instructions (if any).
3. WHEN an unknown Tenant_Domain is provided, THE Auth_API SHALL return a 404 response with a descriptive error message.
4. THE Auth_API SHALL perform the Tenant_Domain lookup in a case-insensitive manner.

---

### Requirement 4: Two-Step Login Flow

**User Story:** As a user, I want to first identify my tenant and then enter my credentials, so that I am authenticated within the correct tenant context.

#### Acceptance Criteria

1. WHEN a user navigates to `/login`, THE Login_Page SHALL display the Tenant_Step prompting for a Tenant_Domain.
2. WHEN a user submits a Tenant_Domain in the Tenant_Step, THE Login_Page SHALL call the tenant resolution endpoint before advancing.
3. WHEN the tenant resolution endpoint returns a valid tenant, THE Login_Page SHALL advance to the Credentials_Step displaying username and password fields.
4. WHEN the tenant resolution endpoint returns a 404, THE Login_Page SHALL display an error message indicating the tenant was not found and SHALL remain on the Tenant_Step.
5. WHEN the Credentials_Step is displayed, THE Login_Page SHALL include the tenant's display name so the user can confirm their tenant context.
6. WHEN Login_Instructions are present for the resolved tenant, THE Login_Page SHALL display them on the Credentials_Step before the credential fields.
7. WHEN a user submits credentials in the Credentials_Step, THE Auth_API SHALL authenticate the user within the scope of the resolved tenant.
8. IF authentication fails, THEN THE Login_Page SHALL display an error message and SHALL remain on the Credentials_Step.
9. WHEN authentication succeeds, THE Login_Page SHALL redirect the user to the appropriate dashboard based on their role.

---

### Requirement 5: Direct Tenant URL Navigation

**User Story:** As a user, I want to navigate directly to my tenant's login page via a URL, so that I can bookmark or share a direct link.

#### Acceptance Criteria

1. THE Login_Page SHALL be accessible at the route `/login/<tenant-domain>`.
2. WHEN a user navigates to `/login/<tenant-domain>`, THE Login_Page SHALL automatically resolve the Tenant_Domain from the URL and skip the Tenant_Step.
3. WHEN the Tenant_Domain in the URL is valid, THE Login_Page SHALL display the Credentials_Step directly.
4. WHEN the Tenant_Domain in the URL is invalid, THE Login_Page SHALL display an error message and SHALL show the Tenant_Step so the user can enter a different domain.
5. WHEN a user navigates to `/login` without a tenant domain, THE Login_Page SHALL display the Tenant_Step.

---

### Requirement 6: Tenant-Scoped Authentication

**User Story:** As a user, I want my login to be scoped to my tenant, so that users with the same username in different tenants do not conflict.

#### Acceptance Criteria

1. WHEN a login request is submitted, THE Auth_API SHALL require a Tenant_Domain in addition to username and password.
2. WHEN authenticating, THE Auth_API SHALL look up the user by username within the scope of the specified tenant only.
3. WHEN two users in different tenants share the same username, THE Auth_API SHALL authenticate each user independently within their respective tenant scope.
4. IF a Tenant_Domain is not provided in a login request, THEN THE Auth_API SHALL return a 400 response with a descriptive error message.
5. IF the provided Tenant_Domain does not correspond to an existing tenant, THEN THE Auth_API SHALL return a 404 response.
6. THE Auth_API login endpoint SHALL add the required `tenantDomain` field to the login request contract, replacing the previous contract that accepted only username and password.
