#!/usr/bin/env python3
"""
Apply the 88 G4F.space model entries and 11 owner-based provider ids to:
  - src/lib/providers/registry.ts (ProviderId, MODELS, gf() helper, PROVIDER_INFO)
  - src/lib/providers/index.ts    (PROVIDERS map)

This script does surgical find-and-replace on the existing files.
"""

import re
from pathlib import Path

ROOT = Path("/home/z/my-project")
REGISTRY = ROOT / "src/lib/providers/registry.ts"
INDEX = ROOT / "src/lib/providers/index.ts"
ENTRIES_BODY = ROOT / "scripts/g4f_registry_entries.ts"

# ---------------------------------------------------------------------------
# 1. registry.ts
# ---------------------------------------------------------------------------
reg_text = REGISTRY.read_text()

# 1a. Replace ProviderId type
old_pid = '''export type ProviderId =
  | "toolbaz"
  | "nsfwlover"
  | "surfsense"
  | "jollygen"
  | "unlimitedai"
  | "pollinations"
  | "kilocode"
  | "llm7"
  | "heckai"
  | "g4fspace";'''

new_pid = '''export type ProviderId =
  | "toolbaz"
  | "nsfwlover"
  | "surfsense"
  | "jollygen"
  | "unlimitedai"
  | "pollinations"
  | "kilocode"
  | "llm7"
  | "heckai"
  // G4F.space — each upstream owner becomes its own provider id, but all are
  // backed by the single g4fSpaceProvider instance in providers/index.ts
  // (same endpoint, no auth).
  | "nvidia-com"
  | "crowllm-com"
  | "modelscope-ai"
  | "openrouter-ai"
  | "qwen"
  | "api-airforce"
  | "community-day-2026"
  | "kobold-llamacpp-swarm"
  | "ktai"
  | "perplexity"
  | "opencode-ai-zen";'''

assert old_pid in reg_text, "ProviderId block not found exactly"
reg_text = reg_text.replace(old_pid, new_pid)

# 1b. Replace the existing G4F section in MODELS array.
# Locate the comment header "  // ─── G4F.space models" through the end of the
# Perplexity entry (the last gf(...) call before the closing "];" of MODELS).
# Find the start of the G4F section.
section_start = reg_text.index("  // ─── G4F.space models")
# Find the closing "];" of the MODELS array (the next occurrence after section_start).
modesl_close = reg_text.index("];", section_start)
# Trim trailing whitespace/newlines between last entry and "];"
# We'll insert the new section right before "];".
g4f_block_old = reg_text[section_start:modesl_close]
# Determine indentation of the "];" line: everything from end of last entry
# to (but not including) "];".
# Replace with new block.
entries_text = ENTRIES_BODY.read_text()
# Strip the leading file-header block; keep only the model entries (from the
# first "  // ───" comment onward).
# The entries file has a header block at the top (lines 1-14) before the first
# "  // ───" line. Locate the first comment-header line.
header_idx = entries_text.index("  // ───")
entries_body = entries_text[header_idx:].rstrip() + "\n"

new_g4f_section = (
    "  // ─── G4F.space models (88 working, grouped by upstream `owned_by`) ────\n"
    "  // Each model's `provider` field is the owner-based id; g4fspace.ts handles\n"
    "  // the actual HTTP request to https://g4f.space/v1/chat/completions (no auth).\n"
    "  // gf(providerId, id, upstream, description, ownerLabel, category, contextWindow)\n"
    + entries_body
)

# Replace from section_start up to (but not including) modesl_close
reg_text = reg_text[:section_start] + new_g4f_section + reg_text[modesl_close:]

# 1c. Update gf() helper signature & docstring.
old_gf = '''/** G4F.space model helper. Real upstream provider name shown in description. */
function gf(
  id: string,
  upstream: string,
  description: string,
  ownerLabel: string,
  category: GatewayModel["category"],
  contextWindow: number,
): GatewayModel {
  return {
    id,
    provider: "g4fspace",
    upstream,
    description,
    category,
    contextWindow,
    capabilities: {
      streaming: true,
      tools: true,
      systemPrompt: true,
      multiTurn: true,
      vision: false,
      webSearch: false,
    },
  };
}'''

new_gf = '''/**
 * G4F.space model helper. The first arg `providerId` is an owner-based id
 * (e.g. "nvidia-com", "crowllm-com") — the model's `provider` field is set
 * to this value so callers see the real upstream owner. All such ids are
 * backed by the single g4fSpaceProvider instance in providers/index.ts
 * (same endpoint, no auth). The `ownerLabel` arg is the cleaned `owned_by`
 * string from the g4f.space /v1/models endpoint, kept for display.
 */
function gf(
  providerId: ProviderId,
  id: string,
  upstream: string,
  description: string,
  ownerLabel: string,
  category: GatewayModel["category"],
  contextWindow: number,
): GatewayModel {
  return {
    id,
    provider: providerId,
    upstream,
    description,
    category,
    contextWindow,
    capabilities: {
      streaming: true,
      tools: true,
      systemPrompt: true,
      multiTurn: true,
      vision: false,
      webSearch: false,
    },
  };
}'''

assert old_gf in reg_text, "gf() helper block not found exactly"
reg_text = reg_text.replace(old_gf, new_gf)

# 1d. Update PROVIDER_INFO — replace g4fspace entry with 11 new entries.
old_pinfo = '''  g4fspace: {
    name: "G4F.space",
    description: "20 models from NVIDIA NIM, OpenRouter, Google Antigravity, CrowLLM, KTAI, API.AirForce, GeminiCLI, Perplexity",
  },'''

new_pinfo = '''  "nvidia-com": {
    name: "NVIDIA NIM",
    description: "34 models (DeepSeek, Gemma, Guard, Llama, Mistral, Nemotron) via NVIDIA NIM",
  },
  "crowllm-com": {
    name: "CrowLLM",
    description: "20 models (DeepSeek, GLM, Gemma, Grok, Llama, Minimax) via CrowLLM",
  },
  "modelscope-ai": {
    name: "Modelscope AI",
    description: "8 models (DeepSeek, Qwen) via Modelscope AI",
  },
  "openrouter-ai": {
    name: "OpenRouter",
    description: "7 models (Auto, Gemma, Nemotron, Tencent) via OpenRouter",
  },
  qwen: {
    name: "Qwen",
    description: "5 models (Qwen) via Qwen",
  },
  "api-airforce": {
    name: "API.AirForce",
    description: "4 models (GPT, Gemini, Qwen) via API.AirForce",
  },
  "community-day-2026": {
    name: "Community Day 2026",
    description: "4 models (Gemma, Qwen) via Community Day 2026",
  },
  "kobold-llamacpp-swarm": {
    name: "Kobold / llama.cpp",
    description: "3 models (Qwen) via Kobold / llama.cpp",
  },
  ktai: {
    name: "KTAI",
    description: "1 model (MiMo) via KTAI",
  },
  "opencode-ai-zen": {
    name: "OpenCode.ai",
    description: "1 model (Nemotron) via OpenCode.ai",
  },
  perplexity: {
    name: "Perplexity",
    description: "1 model (Turbo) via Perplexity",
  },'''

assert old_pinfo in reg_text, "PROVIDER_INFO g4fspace entry not found exactly"
reg_text = reg_text.replace(old_pinfo, new_pinfo)

REGISTRY.write_text(reg_text)
print(f"Updated {REGISTRY}")

# ---------------------------------------------------------------------------
# 2. index.ts
# ---------------------------------------------------------------------------
idx_text = INDEX.read_text()

old_idx = '''export const PROVIDERS: Record<ProviderId, Provider> = {
  toolbaz: toolbazProvider,
  nsfwlover: nsfwloverProvider,
  surfsense: surfSenseProvider,
  jollygen: jollyGenProvider,
  unlimitedai: unlimitedAiProvider,
  pollinations: pollinationsProvider,
  kilocode: kiloCodeProvider,
  llm7: llm7Provider,
  heckai: heckAiProvider,
  g4fspace: g4fSpaceProvider,
};'''

new_idx = '''export const PROVIDERS: Record<ProviderId, Provider> = {
  toolbaz: toolbazProvider,
  nsfwlover: nsfwloverProvider,
  surfsense: surfSenseProvider,
  jollygen: jollyGenProvider,
  unlimitedai: unlimitedAiProvider,
  pollinations: pollinationsProvider,
  kilocode: kiloCodeProvider,
  llm7: llm7Provider,
  heckai: heckAiProvider,
  // G4F.space — all 11 owner-based provider ids route to the single
  // g4fSpaceProvider instance (same endpoint, no auth).
  "nvidia-com": g4fSpaceProvider,
  "crowllm-com": g4fSpaceProvider,
  "modelscope-ai": g4fSpaceProvider,
  "openrouter-ai": g4fSpaceProvider,
  qwen: g4fSpaceProvider,
  "api-airforce": g4fSpaceProvider,
  "community-day-2026": g4fSpaceProvider,
  "kobold-llamacpp-swarm": g4fSpaceProvider,
  ktai: g4fSpaceProvider,
  perplexity: g4fSpaceProvider,
  "opencode-ai-zen": g4fSpaceProvider,
};'''

assert old_idx in idx_text, "PROVIDERS map in index.ts not found exactly"
idx_text = idx_text.replace(old_idx, new_idx)

INDEX.write_text(idx_text)
print(f"Updated {INDEX}")

# ---------------------------------------------------------------------------
# 3. g4fspace.ts — fix the misleading `id: "heckai"` field
# ---------------------------------------------------------------------------
G4FSPACE = ROOT / "src/lib/providers/g4fspace.ts"
g4_text = G4FSPACE.read_text()
old_id = 'export const g4fSpaceProvider: Provider = {\n  id: "heckai", // reuse id space; actual provider tracked per-model'
new_id = ('export const g4fSpaceProvider: Provider = {\n'
          '  id: "nvidia-com", // nominal id; actual provider is tracked per-model\n'
          '                       // via the owner-based ids in registry.ts')
if old_id in g4_text:
    g4_text = g4_text.replace(old_id, new_id)
    G4FSPACE.write_text(g4_text)
    print(f"Updated {G4FSPACE} (fixed provider id field)")
else:
    print(f"WARNING: g4fspace.ts id field not patched (already changed?)")

print("Done.")
