using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using StackExchange.Redis;
using WebPush;
using backend.Data;
using backend.Services;

namespace backend.Controllers;

public record CreateUserRequest(string Username, string Password);
public record ResetPasswordRequest(string NewPassword);
public record SetLoginInstructionsRequest(string? Instructions);
public record CreateAppRequest(string Name);
public record UpdateAppRequest(string? Name, bool? IsDisabled);

[ApiController]
[Route("tenant")]
[Authorize(Roles = "TenantAdmin")]
public class TenantController : ControllerBase
{
    private readonly PushMfaDbContext _db;
    private readonly AppSecretService _secretService;
    private readonly IConnectionMultiplexer _redis;
    private readonly IVapidKeyProvider _vapidKeyProvider;
    private readonly int _longPollTimeoutSeconds;

    public TenantController(
        PushMfaDbContext db,
        AppSecretService secretService,
        IConnectionMultiplexer redis,
        IVapidKeyProvider vapidKeyProvider,
        IConfiguration configuration)
    {
        _db = db;
        _secretService = secretService;
        _redis = redis;
        _vapidKeyProvider = vapidKeyProvider;
        _longPollTimeoutSeconds = configuration.GetValue<int>("LongPollTimeoutSeconds", 60);
    }

    private Guid? GetTenantId()
    {
        var claim = User.FindFirstValue("tenantId");
        return Guid.TryParse(claim, out var id) ? id : null;
    }

    private Guid? GetCurrentUserId()
    {
        var claim = User.FindFirstValue(System.Security.Claims.ClaimTypes.NameIdentifier)
                    ?? User.FindFirstValue("sub");
        return Guid.TryParse(claim, out var id) ? id : null;
    }

    // GET /tenant/info
    [HttpGet("info")]
    public async Task<IActionResult> GetTenantInfo()
    {
        var tenantId = GetTenantId();
        if (tenantId is null)
            return Unauthorized();

        var tenant = await _db.Tenants.FindAsync(tenantId.Value);
        if (tenant is null)
            return NotFound(new { error = "tenant not found" });

        return Ok(new { name = tenant.Name, domain = tenant.Domain, loginInstructions = tenant.LoginInstructions });
    }

    // PUT /tenant/instructions
    [HttpPut("instructions")]
    public async Task<IActionResult> SetLoginInstructions([FromBody] SetLoginInstructionsRequest request)
    {
        var tenantId = GetTenantId();
        if (tenantId is null)
            return Unauthorized();

        var tenant = await _db.Tenants.FindAsync(tenantId.Value);
        if (tenant is null)
            return NotFound(new { error = "tenant not found" });

        tenant.LoginInstructions = string.IsNullOrWhiteSpace(request.Instructions)
            ? null
            : request.Instructions;

        await _db.SaveChangesAsync();

        return NoContent();
    }

    // POST /tenant/users
    [HttpPost("users")]
    public async Task<IActionResult> CreateUser([FromBody] CreateUserRequest request)
    {
        var tenantId = GetTenantId();
        if (tenantId is null)
            return Unauthorized();

        var exists = await _db.Users
            .AnyAsync(u => u.TenantId == tenantId && u.Username == request.Username);
        if (exists)
            return Conflict(new { error = "username already exists" });

        var user = new User
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId.Value,
            Username = request.Username,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password),
            Role = "TenantUser",
            CreatedAt = DateTime.UtcNow
        };

        _db.Users.Add(user);

        try
        {
            await _db.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            return Conflict(new { error = "username already exists" });
        }

        return CreatedAtAction(nameof(CreateUser), new { id = user.Id },
            new { id = user.Id, username = user.Username, tenantId = user.TenantId });
    }

    // GET /tenant/users
    [HttpGet("users")]
    public async Task<IActionResult> GetUsers()
    {
        var tenantId = GetTenantId();
        if (tenantId is null)
            return Unauthorized();

        var users = await _db.Users
            .Where(u => u.TenantId == tenantId)
            .Select(u => new { id = u.Id, username = u.Username, role = u.Role, isDisabled = u.IsDisabled, createdAt = u.CreatedAt })
            .ToListAsync();

        return Ok(users);
    }

    // DELETE /tenant/users/{userId}
    [HttpDelete("users/{userId}")]
    public async Task<IActionResult> DeleteUser(Guid userId)
    {
        var tenantId = GetTenantId();
        if (tenantId is null) return Unauthorized();

        if (userId == GetCurrentUserId())
            return BadRequest(new { error = "you cannot delete yourself" });

        var user = await _db.Users.FindAsync(userId);
        if (user is null)
            return NotFound(new { error = "user not found" });

        if (user.TenantId != tenantId)
            return StatusCode(403, new { error = "forbidden" });

        _db.Users.Remove(user);
        await _db.SaveChangesAsync();

        return NoContent();
    }

    // PATCH /tenant/users/{userId}/disable
    [HttpPatch("users/{userId}/disable")]
    public async Task<IActionResult> DisableUser(Guid userId)
    {
        var tenantId = GetTenantId();
        if (tenantId is null) return Unauthorized();
        if (userId == GetCurrentUserId())
            return BadRequest(new { error = "you cannot disable yourself" });
        var user = await _db.Users.FindAsync(userId);
        if (user is null) return NotFound(new { error = "user not found" });
        if (user.TenantId != tenantId) return StatusCode(403, new { error = "forbidden" });
        user.IsDisabled = true;
        await _db.SaveChangesAsync();
        return NoContent();
    }

    // PATCH /tenant/users/{userId}/enable
    [HttpPatch("users/{userId}/enable")]
    public async Task<IActionResult> EnableUser(Guid userId)
    {
        var tenantId = GetTenantId();
        if (tenantId is null) return Unauthorized();
        var user = await _db.Users.FindAsync(userId);
        if (user is null) return NotFound(new { error = "user not found" });
        if (user.TenantId != tenantId) return StatusCode(403, new { error = "forbidden" });
        user.IsDisabled = false;
        await _db.SaveChangesAsync();
        return NoContent();
    }

    // POST /tenant/users/{userId}/reset-password
    [HttpPost("users/{userId}/reset-password")]
    public async Task<IActionResult> ResetPassword(Guid userId, [FromBody] ResetPasswordRequest request)
    {
        var tenantId = GetTenantId();
        if (tenantId is null)
            return Unauthorized();

        var user = await _db.Users.FindAsync(userId);
        if (user is null)
            return NotFound(new { error = "user not found" });

        if (user.TenantId != tenantId)
            return StatusCode(403, new { error = "forbidden" });

        user.PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.NewPassword);
        await _db.SaveChangesAsync();

        return NoContent();
    }

    // GET /tenant/apps
    [HttpGet("apps")]
    public async Task<IActionResult> GetApps()
    {
        var tenantId = GetTenantId();
        if (tenantId is null) return Unauthorized();

        var apps = await _db.TenantApps
            .Where(a => a.TenantId == tenantId)
            .Select(a => new { id = a.Id, name = a.Name, isDefault = a.IsDefault, isDisabled = a.IsDisabled, createdAt = a.CreatedAt })
            .ToListAsync();

        return Ok(apps);
    }

    // POST /tenant/apps
    [HttpPost("apps")]
    public async Task<IActionResult> CreateApp([FromBody] CreateAppRequest request)
    {
        var tenantId = GetTenantId();
        if (tenantId is null) return Unauthorized();

        var secret = _secretService.Generate();
        var app = new TenantApp
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId.Value,
            Name = request.Name,
            Secret = secret,
            IsDefault = false,
            IsDisabled = false,
            CreatedAt = DateTime.UtcNow
        };

        _db.TenantApps.Add(app);

        try
        {
            await _db.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            return Conflict(new { error = "app_name_already_exists" });
        }

        return StatusCode(201, new { id = app.Id, name = app.Name, isDefault = app.IsDefault, isDisabled = app.IsDisabled, createdAt = app.CreatedAt, secret = app.Secret });
    }

    // PATCH /tenant/apps/{appId}
    [HttpPatch("apps/{appId}")]
    public async Task<IActionResult> UpdateApp(Guid appId, [FromBody] UpdateAppRequest request)
    {
        var tenantId = GetTenantId();
        if (tenantId is null) return Unauthorized();

        var app = await _db.TenantApps.FindAsync(appId);
        if (app is null) return NotFound(new { error = "app not found" });
        if (app.TenantId != tenantId) return StatusCode(403, new { error = "forbidden" });

        if (request.Name is not null) app.Name = request.Name;
        if (request.IsDisabled is not null) app.IsDisabled = request.IsDisabled.Value;

        await _db.SaveChangesAsync();

        return NoContent();
    }

    // DELETE /tenant/apps/{appId}
    [HttpDelete("apps/{appId}")]
    public async Task<IActionResult> DeleteApp(Guid appId)
    {
        var tenantId = GetTenantId();
        if (tenantId is null) return Unauthorized();

        var app = await _db.TenantApps.FindAsync(appId);
        if (app is null) return NotFound(new { error = "app not found" });
        if (app.TenantId != tenantId) return StatusCode(403, new { error = "forbidden" });
        if (app.IsDefault) return Conflict(new { error = "cannot_delete_default_app" });

        _db.TenantApps.Remove(app);
        await _db.SaveChangesAsync();

        return NoContent();
    }

    // POST /tenant/apps/{appId}/reset-secret
    [HttpPost("apps/{appId}/reset-secret")]
    public async Task<IActionResult> ResetAppSecret(Guid appId)
    {
        var tenantId = GetTenantId();
        if (tenantId is null) return Unauthorized();

        var app = await _db.TenantApps.FindAsync(appId);
        if (app is null) return NotFound(new { error = "app not found" });
        if (app.TenantId != tenantId) return StatusCode(403, new { error = "forbidden" });

        var newSecret = _secretService.Generate();
        app.Secret = newSecret;
        await _db.SaveChangesAsync();

        return Ok(new { secret = newSecret });
    }

    // POST /tenant/simulate-push/{userId}
    [HttpPost("simulate-push/{userId}")]
    public async Task<IActionResult> SimulatePush(Guid userId)
    {
        var tenantId = GetTenantId();
        if (tenantId is null) return Unauthorized();

        // Verify user belongs to this tenant
        var user = await _db.Users.FindAsync(userId);
        if (user is null || user.TenantId != tenantId)
            return NotFound(new { error = "user_not_found" });

        // Look up the default app for this tenant
        var defaultApp = await _db.TenantApps
            .FirstOrDefaultAsync(a => a.TenantId == tenantId && a.IsDefault);
        if (defaultApp is null)
            return StatusCode(500, new { error = "default_app_not_found" });

        if (defaultApp.IsDisabled)
            return StatusCode(403, new { error = "app_disabled" });

        // Look up push subscription
        var sub = await _db.PushSubscriptions.FindAsync(userId);
        if (sub is null)
            return NotFound(new { error = "device_not_found" });

        var requestId = Guid.NewGuid().ToString();
        var expiresAt = DateTimeOffset.UtcNow.AddSeconds(_longPollTimeoutSeconds).ToUnixTimeSeconds();

        var payload = JsonSerializer.Serialize(new
        {
            request_id = requestId,
            user_id = userId,
            tenant_id = tenantId,
            app_name = defaultApp.Name,
            message = "Simulate push from Tenant Admin",
            expires_at = expiresAt
        });

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

        var redisDb = _redis.GetDatabase();
        await redisDb.StringSetAsync(
            $"pending:{requestId}",
            userId.ToString(),
            TimeSpan.FromSeconds(_longPollTimeoutSeconds));

        var channel = RedisChannel.Literal($"response:{requestId}");
        var tcs = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        var subscriber = _redis.GetSubscriber();

        await subscriber.SubscribeAsync(channel, (_, message) =>
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
            await subscriber.UnsubscribeAsync(channel);
        }
    }
}
