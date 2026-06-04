/** @module claude/error-formatter_test — Friendly error message tests. */
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { formatClaudeError } from "./error-formatter.ts";

Deno.test("API 5xx → retryable with friendly Chinese summary", () => {
  const out = formatClaudeError(
    new Error(
      "Claude Code returned an error result: API Error: The system encountered an unexpected error during processing. Try your request again.",
    ),
  );
  assertEquals(out.retryable, true);
  assertEquals(out.summary.includes("Anthropic API"), true);
});

Deno.test("ede_diagnostic stop_reason=tool_use → friendly retryable", () => {
  const out = formatClaudeError(
    new Error(
      "Claude Code returned an error result: [ede_diagnostic] result_type=user last_content_type=n/a stop_reason=tool_use",
    ),
  );
  assertEquals(out.retryable, true);
  assertEquals(out.summary.includes("工具调用"), true);
});

Deno.test("rate limit → retryable mention", () => {
  const out = formatClaudeError(new Error("Process exited with code 1"));
  assertEquals(out.retryable, true);
  assertEquals(out.summary.includes("速率限制"), true);
});

Deno.test("network DNS error → retryable network message", () => {
  const out = formatClaudeError(new Error("fetch failed: dns error: ENOTFOUND"));
  assertEquals(out.retryable, true);
  assertEquals(out.summary.includes("网络"), true);
});

Deno.test("AbortError → not retryable", () => {
  const out = formatClaudeError(new Error("AbortError: aborted"));
  assertEquals(out.retryable, false);
  assertEquals(out.summary.includes("中断"), true);
});

Deno.test("unknown short error → returned verbatim", () => {
  const out = formatClaudeError(new Error("Something went wrong"));
  assertEquals(out.retryable, false);
  assertEquals(out.summary, "Something went wrong");
});

Deno.test("unknown long error → truncated with ellipsis", () => {
  const long = "x".repeat(500);
  const out = formatClaudeError(new Error(long));
  assertEquals(out.summary.length, 298);
  assertEquals(out.summary.endsWith("…"), true);
});

Deno.test("non-Error input is stringified", () => {
  const out = formatClaudeError("plain string failure");
  assertEquals(out.summary, "plain string failure");
});
