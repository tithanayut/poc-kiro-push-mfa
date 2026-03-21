# Implementation Plan: push-mfa-app

## Overview

Implement a push-based MFA system with a React 18 + TypeScript + Vite frontend (with Service Worker) and a C# ASP.NET Core backend. Redis coordinates long-poll state; PostgreSQL stores VAPID keys via EF Core. Docker Compose provides infrastructure dependencies.

## Tasks

- [x] 1. Project scaffolding and infrastructure setup
  - Create `docker-compose.yml` with Postgres 16 and Redis 7 services
  - Scaffold the C# ASP.NET Core backend project (`backend/`) with `WebPush`, `StackExchange.Redis`, `Npgsql.EntityFrameworkCore.PostgreSQL` NuGet packages
  - Scaffold the React 18 + TypeScript + Vite frontend project (`web-app/`) with `vite-plugin-pwa` or manual Service Worker setup
  - Add `appsettings.json` with `LongPollTimeoutSeconds`, `ConnectionStrings.Postgres`, and `ConnectionStrings.Redis`
  - _Requirements: 4.2, 8.1_

- [ ] 2. Backend — VAPID key storage and EF Core setup
  - [x] 2.1 Define `VapidKey` entity, `PushMfaDbContext`, and `IVapidKeyProvider` / `VapidKeyProvider` singleton as specified in the design
  - Register `PushMfaDbContext` with Npgsql and `VapidKeyProvider` as singleton in `Program.cs`
  - _Requirements: 3.3_

  - [x] 2.2 Add EF Core migration `InitialVapidKeys` and startup seed logic
  - In `Program.cs` after `app.Build()`: call `db.Database.MigrateAsync()`, then generate and insert VAPID keys if the table is empty using `VapidHelper.GenerateVapidKeys()`
  - _Requirements: 3.3_

  - [x] 2.3 Implement `GET /vapid-public-key` endpoint
  - Returns the base64url-encoded VAPID public key from `VapidKeyProvider`
  - _Requirements: 2.1_

- [ ] 3. Backend — Redis subscription storage and registration endpoint
  - [x] 3.1 Wire up `StackExchange.Redis` `IConnectionMultiplexer` as a singleton in `Program.cs`
  - Add Redis 503 error handling middleware/filter: if Redis is unavailable, return HTTP 503
  - _Requirements: 8.1_

  - [x] 3.2 Implement `POST /register` endpoint
  - Accept `{ client_id, subscription }` body; validate fields (return 400 on invalid)
  - Write `subscription:{client_id}` → JSON-serialised Push_Subscription to Redis (no TTL); overwrite if exists
  - _Requirements: 2.1, 2.2, 2.4_

- [ ] 4. Backend — Push request dispatch and long-poll
  - [x] 4.1 Implement `POST /push` endpoint (dispatch phase)
  - Accept `{ client_id, message }` body; return 404 if `subscription:{client_id}` not in Redis
  - Generate a GUID `request_id`; compute `expires_at = now + LongPollTimeoutSeconds`
  - Build Push_Request JSON payload; send Web Push via `WebPush` NuGet signed with VAPID keys from `VapidKeyProvider`; return 502 on delivery failure
  - Write `pending:{request_id}` to Redis with TTL = `LongPollTimeoutSeconds`
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 4.1_

  - [x] 4.2 Implement long-poll loop in `POST /push`
  - After dispatch, poll Redis for `response:{request_id}` in a loop with a short sleep interval until value found or `LongPollTimeoutSeconds` elapses
  - Return HTTP 200 `{ request_id, response }` when found; return HTTP 408 on timeout
  - Read `LongPollTimeoutSeconds` from `IConfiguration` — no hardcoded value
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [ ] 5. Backend — Response endpoint
  - [x] 5.1 Implement `POST /response` endpoint
  - Accept `{ request_id, response }` body; return 400 on invalid input
  - Check `pending:{request_id}` exists in Redis; return 410 if key is missing (expired)
  - Write `response:{request_id}` to Redis with TTL = `LongPollTimeoutSeconds`
  - _Requirements: 5.5, 7.2, 8.2_

- [ ] 6. Checkpoint — Backend wired end-to-end
  - Ensure all backend endpoints compile and the Docker Compose stack starts cleanly (`docker compose up -d`)
  - Manually verify: register a subscription, POST /push, POST /response, confirm long-poll returns the response
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Web App — Client ID management
  - [x] 7.1 Implement Client_ID prompt screen
  - On first launch (no `push_mfa_client_id` in localStorage), render a form with a text input and submit button
  - Validate non-empty input; display inline error on empty submission
  - On valid submit, write `push_mfa_client_id` to localStorage and proceed to main app
  - _Requirements: 1.1, 1.2, 1.5_

  - [x] 7.2 Implement settings UI for viewing and updating Client_ID
  - Render current Client_ID with an edit control; on save, update localStorage value and re-register subscription
  - _Requirements: 1.3, 1.4_

- [ ] 8. Web App — Service Worker and push subscription registration
  - [x] 8.1 Implement Service Worker (`sw.ts` / `sw.js`)
  - Handle `push` event: parse Push_Request payload; if client is in foreground (`clients.matchAll` with `visibilityState`), relay via `postMessage` without showing OS notification; otherwise show OS notification with request details
  - Handle `notificationclick`: focus the Web App tab and `postMessage` the Push_Request details
  - _Requirements: 6.1, 6.2, 6.3_

  - [x] 8.2 Implement push subscription registration in the Web App
  - Register the Service Worker via `navigator.serviceWorker.register`; show warning banner on failure (foreground-only mode)
  - Call `Notification.requestPermission()`; if denied, show persistent banner and skip registration
  - Fetch VAPID public key from `GET /vapid-public-key`; call `PushManager.subscribe()` with `applicationServerKey`
  - POST `{ client_id, subscription }` to `/register` with exponential backoff (3 attempts); show error if all fail
  - Re-register when subscription changes (`pushsubscriptionchange` event)
  - _Requirements: 2.1, 2.3, 2.5_

- [ ] 9. Web App — Push_Queue and response UI
  - [x] 9.1 Implement Push_Queue state and incoming message handling
  - Listen for `message` events from the Service Worker; parse Push_Request and append to Push_Queue (ordered array in React state)
  - Check `expires_at` on receipt; if expired, display expiry message instead of accept/deny UI
  - _Requirements: 5.1, 6.3, 6.5, 7.1_

  - [x] 9.2 Implement Push_Request response UI
  - While Push_Queue is non-empty, display the oldest Push_Request details with Accept and Deny buttons
  - On Accept/Deny click, POST `{ request_id, response }` to `/response`; on failure show inline error with Retry button (keep request in queue)
  - On success, remove the request from Push_Queue; display next request or return to idle state
  - On 410 response from backend, display expiry message and remove from queue after acknowledgement
  - _Requirements: 5.2, 5.3, 5.4, 5.6, 5.7, 7.2_

- [x] 10. Web App — Foreground in-app notification banner
  - When a Push_Request arrives while the Web App is in Foreground_State, display an in-app notification banner
  - If another Push_Request is already displayed, add to Push_Queue without interrupting the current display
  - Clicking the banner navigates to the Push_Request response UI for that request
  - _Requirements: 6.3, 6.4, 6.5_

- [ ] 11. Final checkpoint — Full integration
  - Ensure the frontend builds without errors (`npm run build` in `web-app/`)
  - Ensure the backend compiles without errors (`dotnet build` in `backend/`)
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- No automated tests are required per project brief; checkpoints use manual verification
- All backend state lives in Redis — no in-process mutable state that affects correctness
- Long-poll timeout is always read from `appsettings.json`; never hardcoded
- VAPID keys are seeded into PostgreSQL on first startup and cached in-process for the lifetime of the backend
