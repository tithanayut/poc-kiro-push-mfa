using backend.Data;
using Microsoft.EntityFrameworkCore;

namespace backend.Services;

public class VapidKeyProvider : IVapidKeyProvider
{
    private VapidKey? _cached;
    private readonly IServiceScopeFactory _scopeFactory;

    public VapidKeyProvider(IServiceScopeFactory scopeFactory) => _scopeFactory = scopeFactory;

    public async Task<VapidKey> GetAsync()
    {
        if (_cached is not null) return _cached;
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PushMfaDbContext>();
        _cached = await db.VapidKeys.SingleAsync();
        return _cached;
    }
}
