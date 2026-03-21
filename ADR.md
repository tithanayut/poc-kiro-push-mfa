# Architecture Decision Records

## ADR-001: Redis Pub/Sub for long-poll response delivery

**Status:** Accepted

**Context:**
The `/push` endpoint holds the caller's HTTP connection open until the user responds. Multiple backend instances may be running, and the instance that receives `/response` from the browser may differ from the one holding the caller's connection.

**Decision:**
Use Redis pub/sub. The `/push` handler subscribes to channel `response:{request_id}` and awaits a message via `TaskCompletionSource`. The `/response` handler publishes to that channel. Any backend instance can publish; the correct subscriber receives it immediately.

**Alternatives considered:**
- **Redis key polling** — simple but wastes CPU and adds latency proportional to poll interval (was the initial implementation, replaced by this ADR)
- **SignalR / WebSockets** — overkill for a server-to-server long-poll; adds complexity without benefit here

**Consequences:**
- Response latency is near-zero (pub/sub is push-based)
- Works correctly across any number of horizontally scaled backend instances
- Redis must be available; failure returns HTTP 503

---

## ADR-002: Push subscriptions stored in PostgreSQL

**Status:** Accepted

**Context:**
Browser Web Push subscriptions (endpoint + keys) need to be persisted and looked up by user ID. The initial implementation stored them in Redis strings.

**Decision:**
Store push subscriptions in a `PushSubscriptions` table in PostgreSQL via EF Core. `UserId` is the primary key (one subscription per user); upsert on re-registration.

**Alternatives considered:**
- **Redis strings** — fast but no durability guarantees; subscriptions lost on Redis flush or restart
- **In-memory** — not viable for horizontal scaling

**Consequences:**
- Subscriptions survive Redis restarts and flushes
- Consistent with VAPID key storage (also in Postgres), keeping Redis purely for ephemeral coordination state
- Slightly higher latency on `/push` due to a Postgres read (negligible in practice)

---

## ADR-003: VAPID keys stored in PostgreSQL, loaded once at startup

**Status:** Accepted

**Context:**
VAPID keys (public/private key pair + subject) are required to sign every Web Push message. They must be consistent across all backend instances and should not be committed to source control.

**Decision:**
Store VAPID keys in a `VapidKeys` table in PostgreSQL. On first startup, generate a key pair using `VapidHelper.GenerateVapidKeys()` and seed the table. Load the single row at startup via `VapidKeyProvider` (singleton) and cache it in-process for the lifetime of the process.

**Alternatives considered:**
- **appsettings.json / environment variables** — risks accidental exposure in source control; harder to rotate without config changes
- **Generate on every request** — breaks Web Push; the public key registered by the browser must match the key used to sign messages

**Consequences:**
- Keys are durable and consistent across instances
- Key rotation requires inserting a new row and restarting all backend instances (cache invalidated on restart)
- No secrets in source control

---

## ADR-004: Web Push (VAPID) over FCM/APNs direct integration

**Status:** Accepted

**Context:**
Push notifications need to reach a browser-based client. Options include Firebase Cloud Messaging (FCM), direct Web Push Protocol, or a third-party service.

**Decision:**
Use the Web Push Protocol (RFC 8030) with VAPID authentication (RFC 8292) directly. The `WebPush` NuGet package handles signing and delivery to the browser's push service endpoint.

**Alternatives considered:**
- **FCM HTTP v1 API** — requires a Google account, Firebase project, and service account credentials; adds an external dependency
- **Third-party services (OneSignal, Pusher)** — vendor lock-in, cost at scale, unnecessary for a self-hosted system

**Consequences:**
- No external service accounts or API keys required beyond VAPID keys
- Works with any browser that supports the Push API (Chrome, Firefox, Edge, Safari 16+)
- The browser's push service (Google, Mozilla, Apple) acts as the intermediary — the backend does not need direct access to the device

---

## ADR-005: Service Worker handles foreground/background split

**Status:** Accepted

**Context:**
Web Push messages are always received by the Service Worker, even when the tab is open. The app needs different behaviour depending on whether the tab is visible (show in-app UI) or not (show OS notification).

**Decision:**
In the Service Worker `push` handler, check `clients.matchAll()` for a visible client. If found, relay via `postMessage` without showing an OS notification. If not found, call `showNotification()`. On `notificationclick`, store the payload in a `pendingPayloads` map and flush it when the React app signals `CLIENT_READY` on mount.

**Alternatives considered:**
- **Always show OS notification** — poor UX when the tab is already open
- **Always use in-app only** — breaks background delivery entirely

**Consequences:**
- Seamless UX in both foreground and background states
- The `CLIENT_READY` handshake solves the race condition where `postMessage` fires before the React listener is registered after a notification click opens the tab

---

## ADR-006: Long-poll over WebSockets or SSE for caller response

**Status:** Accepted

**Context:**
The caller (external system) needs to receive the accept/deny result synchronously after triggering a push. Options include long-polling, Server-Sent Events (SSE), or WebSockets.

**Decision:**
Use HTTP long-polling on `POST /push`. The endpoint holds the connection open until Redis pub/sub delivers the response or the configurable timeout elapses.

**Alternatives considered:**
- **SSE** — better for streaming but requires the caller to implement an event-stream client; most HTTP clients handle a blocking POST more naturally
- **WebSockets** — bidirectional, but the caller only needs a single response; adds protocol complexity
- **Callback / webhook** — requires the caller to expose an endpoint; not suitable for all callers (e.g. CLI tools, curl)

**Consequences:**
- Any HTTP client (curl, fetch, HttpClient) works out of the box
- Timeout is configurable via `LongPollTimeoutSeconds` in `appsettings.json`
- ASP.NET Core handles concurrent long-poll connections efficiently via async/await without blocking threads

---

## ADR-007: Multi-tenant architecture with domain-based routing

**Status:** Accepted

**Context:**
The system needs to support multiple isolated organisations (tenants), each with their own users and login instructions, while sharing a single backend deployment.

**Decision:**
Each tenant has a unique `Domain` (lowercase, hyphen-separated, e.g. `acme-corp`) stored in the `Tenants` table. Login is a two-step flow: the user first enters their tenant domain (resolved via `GET /auth/tenant/{domain}`), then enters credentials. Users are scoped to a tenant via `TenantId` on the `Users` table. JWT claims include `tenantId` so all tenant-scoped endpoints can enforce isolation without additional lookups.

**Alternatives considered:**
- **Subdomain routing** (`acme-corp.app.example.com`) — cleaner UX but requires wildcard DNS and TLS, adds infrastructure complexity
- **Single shared user namespace** — simpler but no isolation between organisations; username collisions across tenants

**Consequences:**
- Tenant isolation is enforced at the database query level (all tenant-scoped queries filter by `TenantId`)
- Direct URL login (`/login/<domain>`) is supported for bookmarking and SSO-style linking
- The tenant domain is saved in `localStorage` and prefilled on next visit
- Adding a new tenant requires no infrastructure changes — just a database row

---

## ADR-008: Role-based access with three roles (SuperAdmin, TenantAdmin, TenantUser)

**Status:** Accepted

**Context:**
Different actors need different levels of access: a platform operator managing all tenants, a tenant administrator managing their own users, and end users who only interact with MFA challenges.

**Decision:**
Three roles stored as a string on the `Users` table and included as a JWT claim:
- `SuperAdmin` — no tenant affiliation; manages tenants and all users via `/admin/*`
- `TenantAdmin` — scoped to one tenant; manages users and settings via `/tenant/*`; can also use MFA like a regular user
- `TenantUser` — scoped to one tenant; can register a push device and respond to MFA challenges

SuperAdmin has a separate login page (`/admin/login`) to avoid exposing it on the tenant-facing login flow.

**Alternatives considered:**
- **Permission-based ACL** — more granular but significantly more complex for the current feature set
- **Separate SuperAdmin service** — clean separation but unnecessary operational overhead

**Consequences:**
- Role is enforced via `[Authorize(Roles = "...")]` on all controllers
- TenantAdmin cannot delete or disable themselves (enforced in both backend and UI)
- SuperAdmin can disable entire tenants, blocking all logins for that tenant's users

---

## ADR-009: Push subscription endpoint uniqueness enforced at registration

**Status:** Accepted

**Context:**
A browser push subscription endpoint is tied to a specific browser profile on a specific device. If user A registers on a device, logs out, and user B logs in and registers on the same device, both users would share the same endpoint. User A's stored subscription would point to an endpoint now controlled by user B's browser session, meaning user B could receive user A's MFA push notifications.

**Decision:**
On `POST /register`, before upserting the new subscription, delete any existing `PushSubscriptions` row where `Endpoint` matches the incoming endpoint but `UserId` differs. This ensures each endpoint is bound to exactly one user at any time.

**Alternatives considered:**
- **Allow multiple users per endpoint** — simpler but creates the security vulnerability described above
- **Warn the user on conflict** — UX complexity without fully closing the vulnerability

**Consequences:**
- A device can only be the registered MFA device for one user at a time
- Re-registering on a shared device automatically revokes the previous user's binding
- No migration needed; enforced purely at the application layer

---

## ADR-010: App-based authentication for the push endpoint

**Status:** Accepted

**Context:**
The `/push` endpoint was previously unauthenticated — any caller who knew a `userId` could trigger a push challenge. With multi-tenant support, this creates a risk of cross-tenant abuse and makes it impossible to audit or revoke access per integration.

**Decision:**
Introduce a `TenantApps` table. Each app belongs to a tenant, has a UUID `appId`, and is authenticated by a 32-character cryptographically random alphanumeric secret (`AppSecretService` using `RandomNumberGenerator`). The `/push` endpoint now requires:
- `tenantId`, `username`, `appId` in the request body (replacing the legacy `userId`)
- `Authorization: Bearer <app-secret>` header

The backend validates the secret, checks the app is not disabled, resolves the user by `tenantId + username`, then proceeds with the existing push flow. All 401 responses use a generic message to avoid leaking whether an `appId` exists.

Every tenant is provisioned with a non-deletable **Default App** at creation time (and backfilled for existing tenants via a data migration). The Default App is used server-side by the `POST /tenant/simulate-push/{userId}` endpoint so the Tenant Admin can test push delivery without ever handling a secret in the browser.

**Alternatives considered:**
- **JWT-based caller auth** — would require issuing and managing tokens for external integrations; opaque secrets are simpler for machine-to-machine use
- **Per-tenant shared secret** — coarser granularity; no way to revoke a single integration without rotating the tenant-wide secret
- **Keep unauthenticated** — unacceptable security posture for a production MFA system

**Consequences:**
- External callers must obtain an `appId` and secret from the Tenant Admin dashboard before calling `/push`
- Secrets are shown exactly once (on creation or reset) and stored in plain text as opaque tokens — they are not passwords and do not need hashing
- Disabling an app immediately blocks all push requests from that integration without affecting other apps or users
- The simulate-push endpoint keeps app secrets server-side, so the Tenant Admin dashboard never needs to store or transmit a secret to the browser
