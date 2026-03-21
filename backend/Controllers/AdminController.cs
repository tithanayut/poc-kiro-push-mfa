using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using backend.Data;
using backend.Services;
using BCrypt.Net;

namespace backend.Controllers;

public record CreateTenantRequest(string Name, string Domain);
public record CreateAdminRequest(string Username, string Password);

[ApiController]
[Route("admin")]
[Authorize(Roles = "SuperAdmin")]
public class AdminController : ControllerBase
{
    private readonly PushMfaDbContext _db;
    private readonly AppSecretService _secretService;

    public AdminController(PushMfaDbContext db, AppSecretService secretService)
    {
        _db = db;
        _secretService = secretService;
    }

    private static readonly Regex DomainRegex = new(@"^[a-z0-9]+(-[a-z0-9]+)*$", RegexOptions.Compiled);

    private static bool IsValidDomain(string domain) => DomainRegex.IsMatch(domain);

    // POST /admin/tenants
    [HttpPost("tenants")]
    public async Task<IActionResult> CreateTenant([FromBody] CreateTenantRequest request)
    {
        if (!IsValidDomain(request.Domain))
            return BadRequest(new { error = "invalid domain format" });

        var nameExists = await _db.Tenants.AnyAsync(t => t.Name == request.Name);
        if (nameExists)
            return Conflict(new { error = "tenant name already exists" });

        var domainExists = await _db.Tenants.AnyAsync(t => t.Domain == request.Domain);
        if (domainExists)
            return Conflict(new { error = "domain already exists" });

        var tenant = new Tenant
        {
            Id = Guid.NewGuid(),
            Name = request.Name,
            Domain = request.Domain,
            CreatedAt = DateTime.UtcNow
        };

        _db.Tenants.Add(tenant);

        _db.TenantApps.Add(new TenantApp
        {
            Id = Guid.NewGuid(),
            TenantId = tenant.Id,
            Name = "Default",
            Secret = _secretService.Generate(),
            IsDefault = true,
            IsDisabled = false,
            CreatedAt = DateTime.UtcNow
        });

        try
        {
            await _db.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            return Conflict(new { error = "tenant name already exists" });
        }

        return CreatedAtAction(nameof(CreateTenant), new { id = tenant.Id },
            new { id = tenant.Id, name = tenant.Name, domain = tenant.Domain, createdAt = tenant.CreatedAt });
    }

    // GET /admin/tenants
    [HttpGet("tenants")]
    public async Task<IActionResult> GetTenants()
    {
        var tenants = await _db.Tenants
            .Select(t => new { id = t.Id, name = t.Name, domain = t.Domain, isDisabled = t.IsDisabled, createdAt = t.CreatedAt })
            .ToListAsync();

        return Ok(tenants);
    }

    // GET /admin/tenants/{tenantId}/users
    [HttpGet("tenants/{tenantId}/users")]
    public async Task<IActionResult> GetTenantUsers(Guid tenantId)
    {
        var tenant = await _db.Tenants.FindAsync(tenantId);
        if (tenant is null)
            return NotFound(new { error = "tenant not found" });

        var users = await _db.Users
            .Where(u => u.TenantId == tenantId)
            .Select(u => new { id = u.Id, username = u.Username, role = u.Role, isDisabled = u.IsDisabled, createdAt = u.CreatedAt })
            .ToListAsync();

        return Ok(users);
    }

    // DELETE /admin/tenants/{tenantId}/users/{userId}
    [HttpDelete("tenants/{tenantId}/users/{userId}")]
    public async Task<IActionResult> DeleteTenantUser(Guid tenantId, Guid userId)
    {
        var user = await _db.Users.FindAsync(userId);
        if (user is null || user.TenantId != tenantId)
            return NotFound(new { error = "user not found" });
        _db.Users.Remove(user);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    // PATCH /admin/tenants/{tenantId}/users/{userId}/disable
    [HttpPatch("tenants/{tenantId}/users/{userId}/disable")]
    public async Task<IActionResult> DisableTenantUser(Guid tenantId, Guid userId)
    {
        var user = await _db.Users.FindAsync(userId);
        if (user is null || user.TenantId != tenantId)
            return NotFound(new { error = "user not found" });
        user.IsDisabled = true;
        await _db.SaveChangesAsync();
        return NoContent();
    }

    // PATCH /admin/tenants/{tenantId}/users/{userId}/enable
    [HttpPatch("tenants/{tenantId}/users/{userId}/enable")]
    public async Task<IActionResult> EnableTenantUser(Guid tenantId, Guid userId)
    {
        var user = await _db.Users.FindAsync(userId);
        if (user is null || user.TenantId != tenantId)
            return NotFound(new { error = "user not found" });
        user.IsDisabled = false;
        await _db.SaveChangesAsync();
        return NoContent();
    }

    // PATCH /admin/tenants/{tenantId}/disable
    [HttpPatch("tenants/{tenantId}/disable")]
    public async Task<IActionResult> DisableTenant(Guid tenantId)
    {
        var tenant = await _db.Tenants.FindAsync(tenantId);
        if (tenant is null) return NotFound(new { error = "tenant not found" });
        tenant.IsDisabled = true;
        await _db.SaveChangesAsync();
        return NoContent();
    }

    // PATCH /admin/tenants/{tenantId}/enable
    [HttpPatch("tenants/{tenantId}/enable")]
    public async Task<IActionResult> EnableTenant(Guid tenantId)
    {
        var tenant = await _db.Tenants.FindAsync(tenantId);
        if (tenant is null) return NotFound(new { error = "tenant not found" });
        tenant.IsDisabled = false;
        await _db.SaveChangesAsync();
        return NoContent();
    }

    // POST /admin/tenants/{tenantId}/admins
    [HttpPost("tenants/{tenantId}/admins")]
    public async Task<IActionResult> CreateTenantAdmin(Guid tenantId, [FromBody] CreateAdminRequest request)
    {
        var tenant = await _db.Tenants.FindAsync(tenantId);
        if (tenant is null)
            return NotFound(new { error = "tenant not found" });

        var usernameExists = await _db.Users
            .AnyAsync(u => u.TenantId == tenantId && u.Username == request.Username);
        if (usernameExists)
            return Conflict(new { error = "username already exists" });

        var user = new User
        {
            Id = Guid.NewGuid(),
            TenantId = tenantId,
            Username = request.Username,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password),
            Role = "TenantAdmin",
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

        return CreatedAtAction(nameof(CreateTenantAdmin), new { tenantId, id = user.Id },
            new { id = user.Id, username = user.Username, tenantId = user.TenantId });
    }
}
