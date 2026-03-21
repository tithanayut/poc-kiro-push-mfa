using backend.Data;
using backend.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using StackExchange.Redis;
using System.IdentityModel.Tokens.Jwt;
using System.Text;
using WebPush;

// Prevent the JWT handler from remapping claim types (e.g. "role" → ClaimTypes.Role URI)
// This must happen before any JWT processing so [Authorize(Roles = "...")] works with plain claim names
JwtSecurityTokenHandler.DefaultInboundClaimTypeMap.Clear();

var builder = WebApplication.CreateBuilder(args);

// Add services to the container.

builder.Services.AddDbContext<PushMfaDbContext>(options =>
    options.UseNpgsql(builder.Configuration.GetConnectionString("Postgres")));

builder.Services.AddSingleton<IVapidKeyProvider, VapidKeyProvider>();
builder.Services.AddSingleton<AppSecretService>();
builder.Services.AddScoped<IAuthService, AuthService>();

builder.Services.AddSingleton<IConnectionMultiplexer>(_ =>
    ConnectionMultiplexer.Connect(builder.Configuration.GetConnectionString("Redis")!));

builder.Services.AddCors(options =>
    options.AddDefaultPolicy(policy =>
        policy.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader()));

builder.Services.AddControllers();
// Learn more about configuring Swagger/OpenAPI at https://aka.ms/aspnetcore/swashbuckle
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var jwtSection = builder.Configuration.GetSection("Jwt");
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = jwtSection["Issuer"],
            ValidAudience = jwtSection["Audience"],
            IssuerSigningKey = new SymmetricSecurityKey(
                Encoding.UTF8.GetBytes(jwtSection["Key"]!)),
            RoleClaimType = "role",
            NameClaimType = "username"
        };
    });

var app = builder.Build();

// Configure the HTTP request pipeline.
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();

app.UseCors();

app.Use(async (context, next) =>
{
    try
    {
        await next(context);
    }
    catch (RedisConnectionException)
    {
        context.Response.StatusCode = 503;
        context.Response.ContentType = "application/json";
        await context.Response.WriteAsync("{\"error\":\"service unavailable\"}");
    }
});

app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();

// Apply migrations and seed VAPID keys if not present
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<PushMfaDbContext>();
    await db.Database.MigrateAsync();
    if (!await db.VapidKeys.AnyAsync())
    {
        var keys = VapidHelper.GenerateVapidKeys();
        db.VapidKeys.Add(new VapidKey
        {
            Id = 1,
            PublicKey = keys.PublicKey,
            PrivateKey = keys.PrivateKey,
            Subject = "mailto:admin@example.com",
            CreatedAt = DateTime.UtcNow
        });
        await db.SaveChangesAsync();
    }

    if (!await db.Users.AnyAsync(u => u.Role == "SuperAdmin"))
    {
        var config = scope.ServiceProvider.GetRequiredService<IConfiguration>();
        var username = config["Seeding:SuperAdmin:Username"]!;
        var password = config["Seeding:SuperAdmin:Password"]!;
        db.Users.Add(new User
        {
            Id = Guid.NewGuid(),
            TenantId = null,
            Username = username,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(password),
            Role = "SuperAdmin",
            CreatedAt = DateTime.UtcNow
        });
        await db.SaveChangesAsync();
    }
}

app.Run();
