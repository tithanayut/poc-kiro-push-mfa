using backend.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;

namespace backend.Services;

public class AuthService : IAuthService
{
    private readonly PushMfaDbContext _db;
    private readonly IConfiguration _configuration;

    public AuthService(PushMfaDbContext db, IConfiguration configuration)
    {
        _db = db;
        _configuration = configuration;
    }

    public async Task<(LoginResult Result, string? Token)> LoginAsync(string tenantDomain, string username, string password)
    {
        User? user;

        if (!string.IsNullOrEmpty(tenantDomain))
        {
            var tenant = await _db.Tenants
                .FirstOrDefaultAsync(t => t.Domain.ToLower() == tenantDomain.ToLower());

            if (tenant is null)
                return (LoginResult.InvalidCredentials, null);

            if (tenant.IsDisabled)
                return (LoginResult.TenantDisabled, null);

            user = await _db.Users
                .FirstOrDefaultAsync(u => u.TenantId == tenant.Id && u.Username.ToLower() == username.ToLower());
        }
        else
        {
            user = await _db.Users
                .FirstOrDefaultAsync(u => u.Username.ToLower() == username.ToLower());

            if (user?.Role != "SuperAdmin")
                return (LoginResult.InvalidCredentials, null);
        }

        if (user is null || !BCrypt.Net.BCrypt.Verify(password, user.PasswordHash))
            return (LoginResult.InvalidCredentials, null);

        if (user.IsDisabled)
            return (LoginResult.UserDisabled, null);

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_configuration["Jwt:Key"]!));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new Claim("tenantId", user.TenantId?.ToString() ?? string.Empty),
            new Claim("username", user.Username),
            new Claim("role", user.Role)
        };

        var expiry = DateTime.UtcNow.AddHours(_configuration.GetValue<int>("Jwt:ExpiryHours", 8));

        var token = new JwtSecurityToken(
            issuer: _configuration["Jwt:Issuer"],
            audience: _configuration["Jwt:Audience"],
            claims: claims,
            expires: expiry,
            signingCredentials: creds
        );

        return (LoginResult.Success, new JwtSecurityTokenHandler().WriteToken(token));
    }
}
