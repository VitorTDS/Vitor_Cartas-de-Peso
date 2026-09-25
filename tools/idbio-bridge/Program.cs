using System;
using ControliD;

namespace IdbioBridge
{
    internal static class Program
    {
        private const int Success = 0;

        private static int Main(string[] args)
        {
            try
            {
                string action = Env("BIOMETRIC_ACTION", args.Length > 0 ? args[0] : "");
                string port = Env("BIOMETRIC_PORT", "COM3");
                long id = action == "info" ? 0 : ParseId(Env("BIOMETRIC_TEMPLATE_ID", Env("BIOMETRIC_USER_ID", "")));

                var portRet = CIDBio.SetSerialCommPort(port);
                if ((int)portRet < Success) Fail("set_port", portRet);

                var initRet = CIDBio.Init();
                if ((int)initRet < Success) Fail("init", initRet);

                try
                {
                    if (action == "info")
                    {
                        string version;
                        string serialNumber;
                        string model;
                        var ret = new CIDBio().GetDeviceInfo(out version, out serialNumber, out model);
                        if ((int)ret < Success) Fail("info", ret);
                        Console.WriteLine("{\"ok\":true,\"provider\":\"idbio-pro\",\"model\":\"" + Escape(model) + "\",\"serialNumber\":\"" + Escape(serialNumber) + "\",\"version\":\"" + Escape(version) + "\"}");
                        return 0;
                    }

                    if (action == "enroll")
                    {
                        var ret = new CIDBio().CaptureAndEnroll(id);
                        if ((int)ret < Success) Fail("enroll", ret);
                        Console.WriteLine("{\"ok\":true,\"provider\":\"idbio-pro\",\"templateId\":\"" + id + "\"}");
                        return 0;
                    }

                    if (action == "verify")
                    {
                        int score;
                        int quality;
                        var ret = new CIDBio().CaptureAndMatch(id, out score, out quality);
                        bool ok = (int)ret >= Success;
                        Console.WriteLine("{\"ok\":" + JsonBool(ok) + ",\"verified\":" + JsonBool(ok) + ",\"recognized\":" + JsonBool(ok) + ",\"score\":" + score + ",\"quality\":" + quality + ",\"templateId\":\"" + id + "\"}");
                        return 0;
                    }

                    throw new InvalidOperationException("Acao invalida. Use enroll ou verify.");
                }
                finally
                {
                    CIDBio.Terminate();
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine(ex.Message);
                Console.WriteLine("{\"ok\":false,\"error\":\"" + Escape(ex.Message) + "\"}");
                return 1;
            }
        }

        private static string Env(string name, string fallback)
        {
            string value = Environment.GetEnvironmentVariable(name);
            return string.IsNullOrWhiteSpace(value) ? fallback : value.Trim();
        }

        private static long ParseId(string value)
        {
            long id;
            if (!long.TryParse(value, out id) || id <= 0) {
                throw new InvalidOperationException("ID biometrico invalido: " + value);
            }
            return id;
        }

        private static void Fail(string step, RetCode ret)
        {
            throw new InvalidOperationException(step + ": " + CIDBio.GetErrorMessage(ret));
        }

        private static string JsonBool(bool value)
        {
            return value ? "true" : "false";
        }

        private static string Escape(string value)
        {
            return (value ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"");
        }
    }
}
