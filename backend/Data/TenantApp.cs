namespace backend.Data;

public class TenantApp
{
    public Guid Id { get; set; }
    public Guid TenantId { get; set; }
    public Tenant Tenant { get; set; } = null!;
    public string Name { get; set; } = string.Empty;
    public string Secret { get; set; } = string.Empty;
    public bool IsDisabled { get; set; } = false;
    public bool IsDefault { get; set; } = false;
    public DateTime CreatedAt { get; set; }
}
