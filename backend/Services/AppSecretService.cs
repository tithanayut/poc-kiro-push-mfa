using System.Security.Cryptography;

namespace backend.Services;

public class AppSecretService
{
    private const string Charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    public string Generate()
    {
        var bytes = RandomNumberGenerator.GetBytes(32);
        return new string(bytes.Select(b => Charset[b % Charset.Length]).ToArray());
    }
}
