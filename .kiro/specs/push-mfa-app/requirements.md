# Requirements Document

## Introduction

A push-based Multi-Factor Authentication (MFA) system consisting of a browser-based web application and a C# backend. When an authentication challenge is triggered, the backend sends a Web Push notification to a specific web app instance. The user approves or denies the request directly in the browser. The backend returns the user's response to the original caller using a long-polling mechanism. Redis is used to coordinate state across horizontally scaled backend instances.

## Glossary

- **Backend**: The C# HTTP server that handles push notification dispatch and response coordination.
- **Web_App**: The browser-based web application running on the user's device.
- **Client_ID**: A user-defined string entered on first launch that uniquely identifies a Web_App instance. Persisted in browser local storage.
- **Push_Request**: An MFA challenge sent to a specific Web_App instance, identified by Client_ID.
- **Push_Response**: The accept or deny decision made by the user in the Web_App.
- **Caller**: The external system or user that initiates a Push_Request via the `/push` endpoint.
- **Redis**: The shared in-memory data store used by the Backend for state coordination across instances.
- **Long_Poll**: An HTTP technique where the Caller's request is held open until a Push_Response is available or a timeout occurs.
- **Long_Poll_Timeout**: The maximum duration the Backend holds a Caller's connection open, expressed in seconds and read from the Backend configuration at startup.
- **Web_Push**: The Web Push Protocol (RFC 8030) used to deliver push notifications to a browser via a push service, authenticated using VAPID keys.
- **VAPID**: Voluntary Application Server Identification — a standard (RFC 8292) for authenticating the application server when sending Web Push messages, using a public/private key pair.
- **Service_Worker**: A browser-managed background script registered by the Web_App that receives Web Push messages and displays OS-level notifications when the Web_App is not in the foreground.
- **Push_Subscription**: The browser-generated object containing the push service endpoint URL and encryption keys (p256dh and auth) used to deliver Web Push messages to a specific browser instance.
- **Foreground_State**: The condition in which the Web_App page is the active, visible tab in the browser.
- **Background_State**: The condition in which the Web_App tab is not focused or the browser is minimised, but the Service_Worker is still running.
- **Push_Queue**: The ordered sequence of pending Push_Requests associated with a single Client_ID that have not yet been responded to.

---

## Requirements

### Requirement 1: Client ID Registration

**User Story:** As a user, I want to enter a Client ID when I first open the web app, so that the backend can identify and reach my specific browser instance.

#### Acceptance Criteria

1. WHEN the Web_App is opened for the first time, THE Web_App SHALL display a prompt requesting the user to enter a Client_ID.
2. WHEN the user submits a Client_ID, THE Web_App SHALL persist the Client_ID in browser local storage.
3. WHEN the Web_App is opened after a Client_ID has been persisted, THE Web_App SHALL skip the Client_ID prompt and use the stored value.
4. THE Web_App SHALL allow the user to view and update the stored Client_ID from the app settings.
5. IF the user submits an empty Client_ID, THEN THE Web_App SHALL display a validation error and prevent submission.

---

### Requirement 2: Push Subscription Registration

**User Story:** As a backend operator, I want the web app to register its Web Push subscription with the backend, so that push notifications can be delivered to the correct browser instance.

#### Acceptance Criteria

1. WHEN the Web_App obtains a Push_Subscription from the browser, THE Web_App SHALL send the Client_ID and Push_Subscription object to the Backend registration endpoint.
2. WHEN the Backend receives a registration request, THE Backend SHALL store the mapping of Client_ID to Push_Subscription in Redis.
3. WHEN a Push_Subscription is invalidated or renewed by the browser, THE Web_App SHALL re-register the updated Push_Subscription with the Backend.
4. IF the Backend receives a registration request with a Client_ID that already exists, THEN THE Backend SHALL overwrite the existing Push_Subscription with the new value.
5. WHEN requesting notification permission, THE Web_App SHALL use the browser Notifications API and SHALL NOT proceed with registration if permission is denied.

---

### Requirement 3: Initiating a Push Request

**User Story:** As a caller system, I want to send a push MFA challenge to a specific web app instance, so that I can verify user presence.

#### Acceptance Criteria

1. WHEN the Caller sends a POST request to `/push` with a valid Client_ID, THE Backend SHALL look up the Push_Subscription for that Client_ID in Redis.
2. THE Backend SHALL accept a `client_id` field and an optional `message` field in the `/push` request body.
3. WHEN the Push_Subscription is found, THE Backend SHALL send a Web Push notification to the browser via the push service endpoint in the Push_Subscription, signed with the VAPID private key, containing the Push_Request details.
4. IF the Client_ID is not found in Redis, THEN THE Backend SHALL return an HTTP 404 response with a descriptive error message.
5. IF the Web Push delivery fails, THEN THE Backend SHALL return an HTTP 502 response with a descriptive error message.

---

### Requirement 4: Long-Polling for Push Response

**User Story:** As a caller system, I want my request to wait for the user's decision, so that I receive the accept or deny result synchronously.

#### Acceptance Criteria

1. WHEN the Backend dispatches a Push_Request, THE Backend SHALL create a pending entry in Redis keyed by a unique request ID with a TTL equal to the Long_Poll_Timeout value.
2. THE Backend SHALL read the Long_Poll_Timeout value from the application configuration file at startup and SHALL NOT use a hardcoded timeout value.
3. WHILE a Push_Request is pending, THE Backend SHALL hold the Caller's HTTP connection open and poll Redis for a Push_Response.
4. WHEN a Push_Response is written to Redis, THE Backend SHALL return the response to the Caller with HTTP 200 and a body indicating `accepted` or `denied`.
5. WHEN the Long_Poll_Timeout elapses before a Push_Response is received, THE Backend SHALL return HTTP 408 to the Caller.
6. THE Backend SHALL support multiple concurrent pending Push_Requests across horizontally scaled instances by coordinating state exclusively through Redis.

---

### Requirement 5: User Response in the Web App

**User Story:** As a user, I want to accept or deny an MFA push notification, so that I can control access to my account.

#### Acceptance Criteria

1. WHEN the Web_App receives a Push_Request (via the Service_Worker or directly in the foreground), THE Web_App SHALL add the Push_Request to the Push_Queue for the corresponding Client_ID.
2. WHILE the Push_Queue contains one or more Push_Requests, THE Web_App SHALL display the details of the oldest unresponded Push_Request and present an Accept button and a Deny button.
3. WHEN the user clicks Accept, THE Web_App SHALL send an HTTP request to the Backend with the request ID and a response value of `accepted`.
4. WHEN the user clicks Deny, THE Web_App SHALL send an HTTP request to the Backend with the request ID and a response value of `denied`.
5. WHEN the Backend receives a Push_Response, THE Backend SHALL write the response to Redis under the corresponding request ID key.
6. IF the Web_App fails to deliver the Push_Response to the Backend, THEN THE Web_App SHALL display an error message and allow the user to retry.
7. WHEN a Push_Response has been submitted, THE Web_App SHALL remove the corresponding Push_Request from the Push_Queue and display the next pending Push_Request if one exists, or return to the idle state if the Push_Queue is empty.

---

### Requirement 6: Push Notification Delivery in Foreground and Background

**User Story:** As a user, I want to receive and act on MFA push notifications regardless of whether the browser tab is active or in the background, so that I am never blocked from responding.

#### Acceptance Criteria

1. WHILE the Web_App is in Background_State, THE Service_Worker SHALL receive the incoming Web Push message and display an OS-level notification containing the Push_Request details.
2. WHEN the user clicks the OS-level notification while in Background_State, THE Service_Worker SHALL focus the Web_App tab and THE Web_App SHALL display the Push_Request response UI for that request.
3. WHILE the Web_App is in Foreground_State, THE Web_App SHALL handle the incoming Push_Request directly without delegating to the Service_Worker notification display, and SHALL present an in-app notification banner or dialog for the Push_Request.
4. WHEN the user clicks an in-app notification banner while in Foreground_State, THE Web_App SHALL navigate to the Push_Request response UI for that request.
5. IF the Web_App is in Foreground_State and a Push_Request arrives while another Push_Request is already displayed, THEN THE Web_App SHALL add the new Push_Request to the Push_Queue without interrupting the currently displayed request.

---

### Requirement 7: Request Expiry Handling in the Web App

**User Story:** As a user, I want to be informed when an MFA request has expired, so that I am not confused by stale notifications.

#### Acceptance Criteria

1. WHEN the Web_App receives a Push_Request that has already expired, THE Web_App SHALL display a message indicating the request is no longer valid.
2. IF the user attempts to respond to an expired Push_Request, THEN THE Backend SHALL return HTTP 410 and THE Web_App SHALL display an expiry message.

---

### Requirement 8: Backend Horizontal Scaling

**User Story:** As an operator, I want the backend to scale horizontally without losing push request state, so that the system remains reliable under load.

#### Acceptance Criteria

1. THE Backend SHALL store all Push_Request state exclusively in Redis, with no in-process state that affects correctness.
2. WHEN a Push_Response is received by any Backend instance, THE Backend SHALL write the result to Redis so that any other instance holding the Long_Poll connection can retrieve it.
3. THE Backend SHALL use Redis key TTLs to automatically clean up expired Push_Request entries without manual intervention.
