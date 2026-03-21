using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Text.RegularExpressions;
using backend.Data;
using backend.Services;

namespace backend.Controllers;

public record LoginRequest(string TenantDomain, string Username, string Password);
public record LoginResponse(string Token);
public record RegisterOrgRequest(string OrgName, string Domain, string Username, string Password);

[ApiController]
[Route("auth")]
public class AuthController : ControllerBase
{
    private readonly IAuthService _authService;
    private readonly PushMfaDbContext _db;
    private readonly AppSecretService _secretService;
    private static readonly Regex DomainRegex = new(@"^[a-z0-9]+([.\-][a-z0-9]+)*$", RegexOptions.Compiled);

    public AuthController(IAuthService authService, PushMfaDbContext db, AppSecretService secretService)
    {
        _authService = authService;
        _db = db;
        _secretService = secretService;
    }

    [HttpPost("login")]
    public async Task<IActionResult> Login([FromBody] LoginRequest request)
    {
        var (result, token) = await _authService.LoginAsync(request.TenantDomain, request.Username, request.Password);
        return result switch
        {
            LoginResult.TenantDisabled => Unauthorized(new { error = "tenant_disabled" }),
            LoginResult.UserDisabled   => Unauthorized(new { error = "user_disabled" }),
            LoginResult.Success        => Ok(new LoginResponse(token!)),
            _                          => Unauthorized(new { error = "invalid_credentials" }),
        };
    }

    [HttpGet("tenant/{domain}")]
    [AllowAnonymous]
    public async Task<IActionResult> GetTenantByDomain(string domain)
    {
        var tenant = await _db.Tenants
            .FirstOrDefaultAsync(t => t.Domain.ToLower() == domain.ToLower());

        if (tenant is null)
            return NotFound(new { error = "tenant not found" });

        return Ok(new { name = tenant.Name, domain = tenant.Domain, loginInstructions = tenant.LoginInstructions, isDisabled = tenant.IsDisabled });
    }

    [HttpPost("register-org")]
    [AllowAnonymous]
    public async Task<IActionResult> RegisterOrg([FromBody] RegisterOrgRequest request)
    {
        if (!DomainRegex.IsMatch(request.Domain))
            return BadRequest(new { error = "invalid_domain", message = "Domain must be lowercase letters, numbers, and hyphens only." });

        if (string.IsNullOrWhiteSpace(request.OrgName))
            return BadRequest(new { error = "invalid_name", message = "Organisation name is required." });

        if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrWhiteSpace(request.Password))
            return BadRequest(new { error = "invalid_credentials", message = "Username and password are required." });

        var nameExists = await _db.Tenants.AnyAsync(t => t.Name == request.OrgName);
        if (nameExists)
            return Conflict(new { error = "name_taken", message = "An organisation with that name already exists." });

        var domainExists = await _db.Tenants.AnyAsync(t => t.Domain == request.Domain);
        if (domainExists)
            return Conflict(new { error = "domain_taken", message = "That domain is already taken." });

        var tenant = new Tenant
        {
            Id = Guid.NewGuid(),
            Name = request.OrgName,
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

        var admin = new User
        {
            Id = Guid.NewGuid(),
            TenantId = tenant.Id,
            Username = request.Username,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(request.Password),
            Role = "TenantAdmin",
            CreatedAt = DateTime.UtcNow
        };
        _db.Users.Add(admin);

        try
        {
            await _db.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            return Conflict(new { error = "conflict", message = "Organisation name or domain already exists." });
        }

        var (_, token) = await _authService.LoginAsync(tenant.Domain, request.Username, request.Password);
        return Ok(new LoginResponse(token!));
    }
}
