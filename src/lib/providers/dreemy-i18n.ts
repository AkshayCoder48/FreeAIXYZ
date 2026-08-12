/**
 * Dreemy.ai i18n — Translate Chinese/Japanese API messages to English.
 *
 * Dreemy.ai is a Chinese-origin service. Its API always returns Chinese
 * messages in the `msg` field regardless of the `x-language: en` header.
 * This module provides translation for all known Chinese/Japanese messages
 * so users always see English.
 */

// ─── Known Chinese → English translations ────────────────────────────────────
const ZH_EN_MAP: Record<string, string> = {
  // Success / status
  "操作成功": "Success",
  "操作失败": "Operation failed",

  // Auth errors
  "未登录": "Not logged in — token is missing or expired",
  "登录已过期": "Login expired — please re-login",
  "登录失败": "Login failed",
  "用户不存在": "User not found",
  "密码错误": "Incorrect password",
  "权限不足": "Insufficient permissions",
  "账号已被禁用": "Account has been disabled",
  "账号异常": "Account abnormality — please contact support",
  "验证码错误": "Verification code error",
  "验证码已过期": "Verification code expired",

  // Quota / rate limit
  "积分不足": "Insufficient credits — your account does not have enough integral to complete this operation",
  "余额不足": "Insufficient balance",
  "请求过于频繁": "Too many requests — please try again later",
  "超过限制": "Limit exceeded",
  "次数已用完": "Usage quota exhausted",
  "今日生成次数已达上限": "Daily generation limit reached — try again tomorrow",
  "每周生成次数已达上限": "Weekly generation limit reached",

  // Content moderation
  "内容审核不通过": "Content failed moderation review — try a different prompt",
  "内容违规": "Content violates policy — try a different prompt",
  "敏感内容": "Sensitive content detected — try a different prompt",
  "图片审核失败": "Image moderation failed",
  "包含违禁词": "Contains prohibited words — try a different prompt",

  // Generation errors
  "生成失败": "Generation failed — please try again",
  "生成超时": "Generation timed out — please try again",
  "生成排队中": "Generation queued — please wait",
  "任务不存在": "Task not found",
  "任务已失败": "Task has failed",
  "任务已取消": "Task was cancelled",

  // Parameter errors
  "参数错误": "Invalid parameters",
  "参数不能为空": "Parameters cannot be empty",
  "模型不存在": "Model not found",
  "分辨率不支持": "Resolution not supported",

  // System errors
  "系统异常": "System error — please try again later",
  "系统繁忙": "System busy — please try again later",
  "服务不可用": "Service unavailable",
  "网络错误": "Network error",

  // Resource errors
  "资源不存在": "Resource not found",
  "图片不存在": "Image not found",
  "视频不存在": "Video not found",

  // Japanese messages (less common but possible)
  "操作成功です": "Success",
  "ログインしていません": "Not logged in — token is missing or expired",
  "ログイン期限切れ": "Login expired — please re-login",
  "権限不足": "Insufficient permissions",
  "クレジット不足": "Insufficient credits",
  "リクエストが多すぎます": "Too many requests — please try again later",
  "生成に失敗しました": "Generation failed — please try again",
  "システムエラー": "System error — please try again later",
  "パラメータエラー": "Invalid parameters",
};

/**
 * Translate a Dreemy `msg` field from Chinese/Japanese to English.
 * If the message is already in English or unknown, return as-is.
 * Also handles partial matches (e.g., "积分不足，请充值" contains "积分不足").
 */
export function translateDreemyMsg(msg: string | undefined | null): string {
  if (!msg) return "";

  // Exact match first (fast path)
  if (ZH_EN_MAP[msg]) return ZH_EN_MAP[msg];

  // Partial match: check if any known Chinese phrase is contained in the message
  for (const [zh, en] of Object.entries(ZH_EN_MAP)) {
    if (msg.includes(zh)) {
      // Replace the Chinese part with English, keep any remaining text
      return msg.replace(zh, en);
    }
  }

  // Check if the message contains CJK characters (might be an untranslated message)
  const hasCJK = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(msg);
  if (hasCJK) {
    // Unknown Chinese/Japanese message — prefix with note
    return `[Dreemy] ${msg} ( untranslated Chinese/Japanese message — contact support if unclear)`;
  }

  // Already English or non-CJK — return as-is
  return msg;
}

/**
 * Translate a Dreemy API response's msg field and interpret data.code.
 * Returns a user-friendly English error message.
 */
export function translateDreemyError(
  msg: string | undefined | null,
  dataCode?: number | null,
): string {
  const translated = translateDreemyMsg(msg);

  // Interpret Dreemy's data.code error codes
  if (dataCode === -1) {
    return translated === "Success"
      ? "Insufficient credits or quota exceeded — guest tokens may have 0 integral. Use a registered account token (dreemy_token) for credits."
      : translated;
  }

  if (dataCode === -5) {
    return translated === "Success"
      ? "Rate limited — too many requests. Please wait and try again."
      : translated;
  }

  return translated;
}

/**
 * Check if a string contains Chinese/Japanese/Korean characters.
 */
export function hasCJK(str: string): boolean {
  return /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(str);
}
