using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace backend.Migrations
{
    /// <inheritdoc />
    public partial class SeedDefaultApps : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Insert a default app for each tenant that doesn't already have one.
            // The secret is a deterministic 32-char hex string derived from the tenant ID.
            // NOTE: Admins should reset these generated secrets after migration.
            migrationBuilder.Sql(@"
                INSERT INTO ""TenantApps"" (""Id"", ""TenantId"", ""Name"", ""Secret"", ""IsDisabled"", ""IsDefault"", ""CreatedAt"")
                SELECT
                    gen_random_uuid(),
                    t.""Id"",
                    'Default',
                    substring(md5(t.""Id""::text) || md5(t.""Id""::text), 1, 32),
                    false,
                    true,
                    NOW()
                FROM ""Tenants"" t
                WHERE NOT EXISTS (
                    SELECT 1 FROM ""TenantApps"" a
                    WHERE a.""TenantId"" = t.""Id"" AND a.""IsDefault"" = true
                )
            ");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"DELETE FROM ""TenantApps"" WHERE ""IsDefault"" = true");
        }
    }
}
