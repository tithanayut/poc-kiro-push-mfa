using backend.Services;
using Microsoft.AspNetCore.Mvc;

namespace backend.Controllers;

[ApiController]
public class VapidController : ControllerBase
{
    private readonly IVapidKeyProvider _vapidKeyProvider;

    public VapidController(IVapidKeyProvider vapidKeyProvider)
    {
        _vapidKeyProvider = vapidKeyProvider;
    }

    [HttpGet("/vapid-public-key")]
    public async Task<IActionResult> GetPublicKey()
    {
        var key = await _vapidKeyProvider.GetAsync();
        return Ok(new { publicKey = key.PublicKey });
    }
}
