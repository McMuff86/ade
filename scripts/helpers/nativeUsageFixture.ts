/** Compiled into the isolated ConPTY fixture by test-dictation-electron.
 * Exercises the real launch argv/env, native files and private OTLP receiver;
 * never calls a provider or writes to a personal CLI home. */
export const nativeUsageFixtureSource = String.raw`
public static class NativeUsageFixture {
  static string Attr(string key, string value) { return "{\"key\":\"" + key + "\",\"value\":{\"stringValue\":\"" + value + "\"}}"; }
  static string Number(string key, string value) { return "{\"key\":\"" + key + "\",\"value\":{\"doubleValue\":" + value + "}}"; }
  public static void Report(string[] args) {
    var provider = System.IO.Path.GetFileNameWithoutExtension(System.Reflection.Assembly.GetExecutingAssembly().Location);
    string id = null; int index = Array.IndexOf(args, "--session-id"); if (index >= 0 && index + 1 < args.Length) id = args[index + 1];
    var now = DateTime.UtcNow;
    var endpoint = Environment.GetEnvironmentVariable("OTEL_EXPORTER_OTLP_LOGS_ENDPOINT");
    string name = "", attributes = "";
    if (provider == "codex") {
      string hex = ((long)(now - new DateTime(1970,1,1,0,0,0,DateTimeKind.Utc)).TotalMilliseconds).ToString("x12");
      id = hex.Substring(0,8) + "-" + hex.Substring(8) + "-7" + Guid.NewGuid().ToString("N").Substring(1,3) + "-8" + Guid.NewGuid().ToString("N").Substring(1,3) + "-" + Guid.NewGuid().ToString("N").Substring(0,12);
      var home = Environment.GetEnvironmentVariable("CODEX_HOME");
      var directory = System.IO.Path.Combine(home, "sessions", now.ToString("yyyy"), now.ToString("MM"), now.ToString("dd"));
      System.IO.Directory.CreateDirectory(directory);
      var meta = "{\"type\":\"session_meta\",\"payload\":{\"id\":\"" + id + "\",\"source\":\"cli\",\"timestamp\":\"" + now.ToString("o") + "\"}}\n";
      var sample = "{\"type\":\"event_msg\",\"payload\":{\"type\":\"token_count\",\"info\":{\"total_token_usage\":{\"input_tokens\":15731,\"cached_input_tokens\":12288,\"cache_write_input_tokens\":0,\"output_tokens\":9,\"reasoning_output_tokens\":0}}}}\n";
      System.IO.File.WriteAllText(System.IO.Path.Combine(directory, "rollout-fixture-" + id + ".jsonl"), meta + sample + sample, new System.Text.UTF8Encoding(false));
      foreach (var arg in args) { var match = System.Text.RegularExpressions.Regex.Match(arg, @"http://127\.0\.0\.1:\d+/v1/logs"); if (match.Success) endpoint = match.Value; }
      name = "codex.conversation_starts"; attributes = Attr("conversation.id", id) + "," + Attr("model", "codex-usage-fixture");
    } else if (provider == "claude") {
      name = "claude_code.api_request"; attributes = Attr("session.id", id) + "," + Attr("request_id", Guid.NewGuid().ToString()) + "," + Attr("model", "claude-usage-fixture")
        + "," + Number("input_tokens", "2") + "," + Number("output_tokens", "18") + "," + Number("cache_read_tokens", "13015") + "," + Number("cache_creation_tokens", "4208") + "," + Number("cost_usd", "0.08833375");
    } else if (provider == "grok") {
      var directory = System.IO.Path.Combine(Environment.GetEnvironmentVariable("GROK_HOME"), "sessions", "fixture-project", id);
      System.IO.Directory.CreateDirectory(directory);
      var sample = "{\"params\":{\"sessionId\":\"" + id + "\",\"_meta\":{\"eventId\":\"" + Guid.NewGuid().ToString() + "\"},\"update\":{\"sessionUpdate\":\"turn_completed\",\"usage\":{\"inputTokens\":5280,\"outputTokens\":37,\"cachedReadTokens\":128,\"cacheCreationTokens\":0,\"reasoningTokens\":26,\"costUsdTicks\":36006000,\"modelUsage\":{\"grok-usage-fixture\":{}}}}}}\n";
      System.IO.File.WriteAllText(System.IO.Path.Combine(directory, "updates.jsonl"), sample, new System.Text.UTF8Encoding(false)); return;
    } else { throw new Exception("Unsupported usage fixture"); }
    var header = Environment.GetEnvironmentVariable("OTEL_EXPORTER_OTLP_LOGS_HEADERS").Split('=');
    var request = (System.Net.HttpWebRequest)System.Net.WebRequest.Create(endpoint); request.Method = "POST"; request.ContentType = "application/json"; request.Timeout = 10000;
    request.Headers[header[0]] = header[1];
    var bytes = System.Text.Encoding.UTF8.GetBytes("{\"resourceLogs\":[{\"scopeLogs\":[{\"logRecords\":[{\"eventName\":\"" + name + "\",\"attributes\":[" + attributes + "]}]}]}]}");
    request.ContentLength = bytes.Length; using (var stream = request.GetRequestStream()) stream.Write(bytes,0,bytes.Length);
    using (var response = request.GetResponse()) { }
  }
}
`;
