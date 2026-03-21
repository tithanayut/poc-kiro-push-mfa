namespace backend.Data;

public class User
{
    public Guid Id { get; set; }
    public Guid? TenantId { get; set; }           // null for SuperAdmin
    public Tenant? Tenant { get; set; }
    public string Username { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;  // bcrypt hash
    public string Role { get; set; } = string.Empty;          // "SuperAdmin" | "TenantAdmin" | "TenantUser"
    public bool IsDisabled { get; set; } = false;
    public DateTime CreatedAt { get; set; }
    public PushSubscriptionEntity? PushSubscription { get; set; }
}
