namespace backend.Data;

public class Tenant
{
    public Guid Id { get; set; }
    public string Name { get; set; } = string.Empty;   // unique — enforced via DbContext
    public string Domain { get; set; } = string.Empty;
    public string? LoginInstructions { get; set; }
    public bool IsDisabled { get; set; } = false;
    public DateTime CreatedAt { get; set; }

    public ICollection<User> Users { get; set; } = new List<User>();
    public ICollection<TenantApp> Apps { get; set; } = new List<TenantApp>();
}
