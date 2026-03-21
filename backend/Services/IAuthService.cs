namespace backend.Services;

public enum LoginResult { Success, InvalidCredentials, TenantDisabled, UserDisabled }

public interface IAuthService
{
    Task<(LoginResult Result, string? Token)> LoginAsync(string tenantDomain, string username, string password);
}
