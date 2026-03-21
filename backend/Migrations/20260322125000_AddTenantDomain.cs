using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace backend.Migrations
{
    /// <inheritdoc />
    public partial class AddTenantDomain : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Domain",
                table: "Tenants",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LoginInstructions",
                table: "Tenants",
                type: "text",
                nullable: true);

            migrationBuilder.Sql(
                @"UPDATE ""Tenants"" SET ""Domain"" = lower(regexp_replace(""Name"", '\s+', '-', 'g')) WHERE ""Domain"" IS NULL OR ""Domain"" = ''");

            migrationBuilder.AlterColumn<string>(
                name: "Domain",
                table: "Tenants",
                type: "text",
                nullable: false,
                defaultValue: "",
                oldClrType: typeof(string),
                oldType: "text",
                oldNullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Tenants_Domain",
                table: "Tenants",
                column: "Domain",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Tenants_Domain",
                table: "Tenants");

            migrationBuilder.AlterColumn<string>(
                name: "Domain",
                table: "Tenants",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "text");

            migrationBuilder.DropColumn(
                name: "Domain",
                table: "Tenants");

            migrationBuilder.DropColumn(
                name: "LoginInstructions",
                table: "Tenants");
        }
    }
}
