using backend.Data;

namespace backend.Services;

public interface IVapidKeyProvider
{
    Task<VapidKey> GetAsync();
}
