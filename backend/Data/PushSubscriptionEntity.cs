namespace backend.Data;

public class PushSubscriptionEntity
{
    public Guid UserId { get; set; }              // PK + FK → Users.Id
    public User User { get; set; } = null!;
    public Guid TenantId { get; set; }
    public string Endpoint { get; set; } = string.Empty;
    public string P256dh { get; set; } = string.Empty;
    public string Auth { get; set; } = string.Empty;
    public DateTime UpdatedAt { get; set; }
}
