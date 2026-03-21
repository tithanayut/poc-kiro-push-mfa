using backend.Data;
using backend.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using StackExchange.Redis;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Serialization;
using WebPush;

namespace backend.Controllers;

[ApiController]
public class PushController : ControllerBase
{
    private readonly IConnectionMultiplexer _redis;
    private readonly IVapidKeyProvider _vapidKeyProvider;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly int _longPollTimeoutSeconds;

    public PushController(
        IConnectionMultiplexer redis,
        IVapidKeyProvider vapidKeyProvider,
        IServiceScopeFactory scopeFactory,
        IConfiguration configuration)
    {
        _redis = redis;
        _vapidKeyProvider = vapidKeyProvider;
        _scopeFactory = scopeFactory;
        _longPollTimeoutSeconds = configuration.GetValue<int>("LongPollTimeoutSeconds", 60);
    }

    [Authorize(Roles = "TenantUser,TenantAdmin")]
    [HttpGet("/register/status")]
    public async Task<IActionResult> GetRegistrationStatus([FromQuery] string? endpoint)
    {
        var userIdStr = User.FindFirstValue(JwtRegisteredClaimNames.Sub);
        if (!Guid.TryParse(userIdStr, out var userId))
            return Unauthorized(new { error = "invalid token claims" });

        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PushMfaDbContext>();
        var existing = await db.PushSubscriptions.FindAsync(userId);

        if (existing is null)
            return Ok(new { registered = false, isActiveDevice = false });

        var isActiveDevice = !string.IsNullOrEmpty(endpoint) && existing.Endpoint == endpoint;
        return Ok(new { registered = true, isActiveDevice });
    }

    [Authorize(Roles = "TenantUser,TenantAdmin")]
    [HttpPost("/register")]
    public async Task<IActionResult> Register([FromBody] RegisterRequest request)
    {
        var userIdStr = User.FindFirstValue(JwtRegisteredClaimNames.Sub);
        var tenantIdStr = User.FindFirstValue("tenantId");

        if (!Guid.TryParse(userIdStr, out var userId) || !Guid.TryParse(tenantIdStr, out var tenantId))
            return Unauthorized(new { error = "invalid token claims" });

        if (request.Subscription is null ||
            string.IsNullOrEmpty(request.Subscription.Endpoint) ||
            request.Subscription.Keys is null)
            return BadRequest(new { error = "invalid request" });

        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PushMfaDbContext>();

        // If this endpoint is already registered to a different user, remove it first
        // to prevent a stale subscription being used to receive another user's MFA push
        var staleByEndpoint = await db.PushSubscriptions
            .Where(s => s.Endpoint == request.Subscription.Endpoint && s.UserId != userId)
            .ToListAsync();
        if (staleByEndpoint.Count > 0)
            db.PushSubscriptions.RemoveRange(staleByEndpoint);

        var existing = await db.PushSubscriptions.FindAsync(userId);

        if (existing is not null)
        {
            if (request.Force != true)
                return Conflict(new { error = "device_already_bound" });

            // force == true: update existing record
            existing.Endpoint = request.Subscription.Endpoint;
            existing.P256dh = request.Subscription.Keys.P256dh;
            existing.Auth = request.Subscription.Keys.Auth;
            existing.UpdatedAt = DateTime.UtcNow;
        }
        else
        {
            db.PushSubscriptions.Add(new PushSubscriptionEntity
            {
                UserId = userId,
                TenantId = tenantId,
                Endpoint = request.Subscription.Endpoint,
                P256dh = request.Subscription.Keys.P256dh,
                Auth = request.Subscription.Keys.Auth,
                UpdatedAt = DateTime.UtcNow
            });
        }

        await db.SaveChangesAsync();
        return Ok();
    }

    [HttpPost("/push")]
    public async Task<IActionResult> Push([FromBody] PushRequest request)
    {
        // Extract and validate Authorization: Bearer <token>
        var authHeader = Request.Headers["Authorization"].FirstOrDefault();
        if (string.IsNullOrEmpty(authHeader) || !authHeader.StartsWith("Bearer "))
            return Unauthorized(new { error = "unauthorized" });

        var bearerToken = authHeader.Substring("Bearer ".Length);

        // Look up TenantApp by AppId + TenantId
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PushMfaDbContext>();

        var app = await db.TenantApps
            .FirstOrDefaultAsync(a => a.Id == request.AppId && a.TenantId == request.TenantId);
        if (app is null)
            return Unauthorized(new { error = "unauthorized" });

        // Validate bearer token against app secret
        if (bearerToken != app.Secret)
            return Unauthorized(new { error = "unauthorized" });

        // Check if app is disabled
        if (app.IsDisabled)
            return StatusCode(403, new { error = "app_disabled" });

        // Look up user by TenantId + Username
        var user = await db.Users
            .FirstOrDefaultAsync(u => u.TenantId == request.TenantId && u.Username == request.Username);
        if (user is null)
            return NotFound(new { error = "user_not_found" });

        // Look up push subscription by user ID
        var sub = await db.PushSubscriptions.FindAsync(user.Id);
        if (sub is null)
            return NotFound(new { error = "device_not_found" });

        var userId = user.Id;
        var requestId = Guid.NewGuid().ToString();
        var expiresAt = DateTimeOffset.UtcNow.AddSeconds(_longPollTimeoutSeconds).ToUnixTimeSeconds();

        var payload = JsonSerializer.Serialize(new
        {
            request_id = requestId,
            user_id = userId,
            tenant_id = request.TenantId,
            app_name = app.Name,
            message = request.Message,
            expires_at = expiresAt
        });

        // Send Web Push notification
        try
        {
            var webPushSub = new WebPush.PushSubscription(sub.Endpoint, sub.P256dh, sub.Auth);
            var vapidKey = await _vapidKeyProvider.GetAsync();
            var client = new WebPushClient();
            client.SetVapidDetails(vapidKey.Subject, vapidKey.PublicKey, vapidKey.PrivateKey);
            await client.SendNotificationAsync(webPushSub, payload);
        }
        catch (WebPushException)
        {
            return StatusCode(502, new { error = "push delivery failed" });
        }

        // Mark request as pending in Redis with TTL
        var redisDb = _redis.GetDatabase();
        await redisDb.StringSetAsync(
            $"pending:{requestId}",
            userId.ToString(),
            TimeSpan.FromSeconds(_longPollTimeoutSeconds));

        // Wait for response via Redis pub/sub
        var channel = RedisChannel.Literal($"response:{requestId}");
        var tcs = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        var sub2 = _redis.GetSubscriber();

        await sub2.SubscribeAsync(channel, (_, message) =>
        {
            tcs.TrySetResult(message.ToString());
        });

        try
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(_longPollTimeoutSeconds));
            cts.Token.Register(() => tcs.TrySetCanceled());

            var response = await tcs.Task;
            return Ok(new { request_id = requestId, response });
        }
        catch (OperationCanceledException)
        {
            return StatusCode(408, new { error = "request timed out" });
        }
        finally
        {
            await sub2.UnsubscribeAsync(channel);
        }
    }

    [HttpPost("/response")]
    public async Task<IActionResult> SubmitResponse([FromBody] ResponseRequest request)
    {
        if (string.IsNullOrEmpty(request.RequestId) ||
            (request.Response != "accepted" && request.Response != "denied"))
            return BadRequest(new { error = "invalid request" });

        var db = _redis.GetDatabase();

        var pending = await db.StringGetAsync($"pending:{request.RequestId}");
        if (pending.IsNullOrEmpty)
            return StatusCode(410, new { error = "request expired" });

        // Publish response to the waiting /push handler
        var sub = _redis.GetSubscriber();
        await sub.PublishAsync(
            RedisChannel.Literal($"response:{request.RequestId}"),
            request.Response);

        return Ok();
    }
}

public class PushRequest
{
    [JsonPropertyName("tenantId")]
    public Guid TenantId { get; set; }

    [JsonPropertyName("username")]
    public string Username { get; set; } = string.Empty;

    [JsonPropertyName("appId")]
    public Guid AppId { get; set; }

    [JsonPropertyName("message")]
    public string? Message { get; set; }
}

public class RegisterRequest
{
    [JsonPropertyName("subscription")]
    public StoredPushSubscription? Subscription { get; set; }

    [JsonPropertyName("force")]
    public bool? Force { get; set; }
}

public class StoredPushSubscription
{
    [JsonPropertyName("endpoint")]
    public string Endpoint { get; set; } = string.Empty;

    [JsonPropertyName("keys")]
    public PushSubscriptionKeys? Keys { get; set; }
}

public class PushSubscriptionKeys
{
    [JsonPropertyName("p256dh")]
    public string P256dh { get; set; } = string.Empty;

    [JsonPropertyName("auth")]
    public string Auth { get; set; } = string.Empty;
}

public class ResponseRequest
{
    [JsonPropertyName("request_id")]
    public string RequestId { get; set; } = string.Empty;

    [JsonPropertyName("response")]
    public string Response { get; set; } = string.Empty;
}
