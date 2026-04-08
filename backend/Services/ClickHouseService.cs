using System.Text;

namespace backend.Services;

public class ClickHouseService
{
    private readonly HttpClient _http;
    private readonly ILogger<ClickHouseService> _logger;

    public ClickHouseService(IHttpClientFactory httpClientFactory, ILogger<ClickHouseService> logger)
    {
        _http = httpClientFactory.CreateClient("clickhouse");
        _logger = logger;
    }

    public async Task RecordMfaEventAsync(
        string requestId,
        Guid tenantId,
        Guid userId,
        Guid appId,
        string appName,
        string username,
        string outcome,
        string? message)
    {
        // ClickHouse HTTP interface: POST query as body with VALUES
        var row = $"(now(), '{Escape(requestId)}', '{tenantId}', '{userId}', '{appId}', " +
                  $"'{Escape(appName)}', '{Escape(username)}', '{Escape(outcome)}', '{Escape(message ?? "")}')";

        var sql = $"INSERT INTO mfa_events " +
                  $"(event_time, request_id, tenant_id, user_id, app_id, app_name, username, outcome, message) " +
                  $"VALUES {row}";

        try
        {
            var content = new StringContent(sql, Encoding.UTF8, "text/plain");
            // ClickHouse HTTP: POST to /?database=... — path must be / not /dbname
            var response = await _http.PostAsync("/?database=pushmfa", content);
            if (!response.IsSuccessStatusCode)
            {
                var body = await response.Content.ReadAsStringAsync();
                _logger.LogWarning("ClickHouse insert failed ({Status}): {Body}", response.StatusCode, body);
            }
        }
        catch (Exception ex)
        {
            // Fire-and-forget: never let analytics failures affect the MFA flow
            _logger.LogWarning(ex, "ClickHouse insert threw an exception");
        }
    }

    private static string Escape(string value) => value.Replace("'", "\\'");
}
