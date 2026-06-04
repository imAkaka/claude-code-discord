/**
 * Pure helpers that turn Claude Agent SDK / Anthropic API error messages
 * into human-friendly text shown to Discord users.
 *
 * @module claude/error-formatter
 */

export interface FriendlyError {
  /** One-line summary suitable for a Discord ⚠️ message. */
  summary: string;
  /** Whether retrying the same request stands a reasonable chance of succeeding. */
  retryable: boolean;
}

const API_5XX = /API Error: The system encountered an unexpected error/i;
const EDE_TOOL_USE = /\[ede_diagnostic\][^\n]*stop_reason=tool_use/i;
const RATE_LIMIT = /rate.?limit|exit code 1|exited with code 1/i;
const NETWORK = /(ENOTFOUND|ECONNRESET|ETIMEDOUT|fetch failed|dns error|Connect)/i;
const ABORTED = /aborted|AbortError|cancell?ed/i;

export function formatClaudeError(error: unknown): FriendlyError {
  const raw = error instanceof Error ? error.message : String(error);

  if (ABORTED.test(raw)) {
    return { summary: "请求被中断。", retryable: false };
  }
  if (API_5XX.test(raw)) {
    return {
      summary: "Anthropic API 临时不可用，请重新发一遍消息。",
      retryable: true,
    };
  }
  if (EDE_TOOL_USE.test(raw)) {
    return {
      summary: "模型在工具调用阶段出错，请重新发一遍消息。",
      retryable: true,
    };
  }
  if (RATE_LIMIT.test(raw)) {
    return {
      summary: "速率限制，已尝试 Haiku 兜底但仍失败，请稍后再试。",
      retryable: true,
    };
  }
  if (NETWORK.test(raw)) {
    return {
      summary: "网络异常，请检查连接后重试。",
      retryable: true,
    };
  }
  return {
    summary: raw.length > 300 ? raw.slice(0, 297) + "…" : raw,
    retryable: false,
  };
}
