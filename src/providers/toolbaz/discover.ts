/**
 * Toolbaz discoverer — `https://data.toolbaz.com/` is captcha-bound (token.php
 * issues a token but writing.php rejects every captcha). The legacy
 * `src/lib/toolbaz.ts` hardcodes 22 model names. We surface the same list
 * here so the catalog always has them.
 */
import { manualModels } from "../_shared";

const IDS = [
  "toolbaz-v4.5-fast",
  "toolbaz_v4",
  "gpt-5",
  "gpt-5.2",
  "gpt-4o-latest",
  "gpt-oss-120b",
  "o3-mini",
  "claude-sonnet-4",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-3-flash",
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash",
  "gemini-3.6-flash",
  "codestral-latest",
  "gpt-oss-20b",
  "deepseek-r1",
  "deepseek-v3",
  "deepseek-v3.1",
  "grok-4-fast",
  "L3-70B-Euryale-v2.1",
  "midnight-rose",
];

export async function discover() {
  return manualModels(IDS, {
    source: "manual",
    endpoint: "https://data.toolbaz.com",
    note: "toolbaz has no /models endpoint (captcha-bound); 22 hardcoded slugs",
  });
}
