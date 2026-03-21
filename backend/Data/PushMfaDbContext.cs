using Microsoft.EntityFrameworkCore;

namespace backend.Data;

public class PushMfaDbContext : DbContext
{
    public PushMfaDbContext(DbContextOptions<PushMfaDbContext> options) : base(options) { }

    public DbSet<VapidKey> VapidKeys { get; set; }
    public DbSet<PushSubscriptionEntity> PushSubscriptions { get; set; }
    public DbSet<Tenant> Tenants { get; set; }
    public DbSet<User> Users { get; set; }
    public DbSet<TenantApp> TenantApps { get; set; }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<VapidKey>().HasKey(v => v.Id);

        modelBuilder.Entity<Tenant>()
            .HasIndex(t => t.Name)
            .IsUnique();

        modelBuilder.Entity<Tenant>().HasIndex(t => t.Domain).IsUnique();

        modelBuilder.Entity<User>()
            .HasIndex(u => new { u.TenantId, u.Username })
            .IsUnique();

        modelBuilder.Entity<User>()
            .HasOne(u => u.Tenant)
            .WithMany(t => t.Users)
            .HasForeignKey(u => u.TenantId)
            .IsRequired(false);

        modelBuilder.Entity<PushSubscriptionEntity>()
            .HasKey(p => p.UserId);

        modelBuilder.Entity<PushSubscriptionEntity>()
            .HasOne(p => p.User)
            .WithOne(u => u.PushSubscription)
            .HasForeignKey<PushSubscriptionEntity>(p => p.UserId);

        modelBuilder.Entity<TenantApp>()
            .HasIndex(a => new { a.TenantId, a.Name })
            .IsUnique();

        modelBuilder.Entity<TenantApp>()
            .HasOne(a => a.Tenant)
            .WithMany(t => t.Apps)
            .HasForeignKey(a => a.TenantId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
