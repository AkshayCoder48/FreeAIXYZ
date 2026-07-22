#!/usr/bin/env python3
"""
Generate G4F.space registry entries and PROVIDER_INFO entries from
g4f_working_final.json (88 working models).

Outputs:
  /home/z/my-project/scripts/g4f_registry_entries.ts
  /home/z/my-project/scripts/g4f_provider_info.ts
"""

import json
import re
from collections import defaultdict, OrderedDict
from pathlib import Path

SCRIPTS_DIR = Path("/home/z/my-project/scripts")
WORKING_FILE = SCRIPTS_DIR / "g4f_working_final.json"
ENTRIES_OUT = SCRIPTS_DIR / "g4f_registry_entries.ts"
PROVIDER_INFO_OUT = SCRIPTS_DIR / "g4f_provider_info.ts"

# ---------------------------------------------------------------------------
# Owner metadata:  raw owned_by -> (cleaned owner label, provider id slug,
#                                   short id prefix, display name, comment name)
# ---------------------------------------------------------------------------
OWNER_META = {
    "nvidia.com": {
        "clean_label": "nvidia.com",
        "provider_id": "nvidia-com",
        "id_prefix": "nvidia",
        "display_name": "NVIDIA NIM",
    },
    "crowllm.com": {
        "clean_label": "crowllm.com",
        "provider_id": "crowllm-com",
        "id_prefix": "crowllm",
        "display_name": "CrowLLM",
    },
    "Modelscope AI": {
        "clean_label": "Modelscope AI",
        "provider_id": "modelscope-ai",
        "id_prefix": "modelscope",
        "display_name": "Modelscope AI",
    },
    "openrouter.ai": {
        "clean_label": "openrouter.ai",
        "provider_id": "openrouter-ai",
        "id_prefix": "openrouter",
        "display_name": "OpenRouter",
    },
    "qwen": {
        "clean_label": "qwen",
        "provider_id": "qwen",
        "id_prefix": "qwen",
        "display_name": "Qwen",
    },
    "api.airforce": {
        "clean_label": "api.airforce",
        "provider_id": "api-airforce",
        "id_prefix": "airforce",
        "display_name": "API.AirForce",
    },
    "community-day-2026": {
        "clean_label": "community-day-2026",
        "provider_id": "community-day-2026",
        "id_prefix": "cd2026",
        "display_name": "Community Day 2026",
    },
    "kobold & llama.cpp swarm": {
        "clean_label": "kobold & llama.cpp swarm",
        "provider_id": "kobold-llamacpp-swarm",
        "id_prefix": "kobold",
        "display_name": "Kobold / llama.cpp",
    },
    "KTAI - Free - Models  (https://discord.gg/n6B5KCN3ZV)": {
        "clean_label": "KTAI",
        "provider_id": "ktai",
        "id_prefix": "ktai",
        "display_name": "KTAI",
    },
    "perplexity": {
        "clean_label": "perplexity",
        "provider_id": "perplexity",
        "id_prefix": "perplexity",
        "display_name": "Perplexity",
    },
    "opencode.ai/zen": {
        "clean_label": "opencode.ai/zen",
        "provider_id": "opencode-ai-zen",
        "id_prefix": "opencode",
        "display_name": "OpenCode.ai",
    },
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def slugify(s: str) -> str:
    """Lowercase, replace non-alphanumeric with hyphens, collapse repeats."""
    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    s = re.sub(r"-+", "-", s)
    return s.strip("-")


def make_short_id(owner_prefix: str, model_name: str) -> str:
    """
    Derive a clean short id from the model name, prefixed with owner short name.
    Examples:
      meta/llama-3.1-8b-instruct -> llama-3-1-8b (owner prefix -> nvidia-llama-3-1-8b)
      glm-5.2                    -> glm-5-2       (-> crowllm-glm-5-2)
      deepseek-ai/deepseek-v4-pro -> deepseek-v4-pro
    """
    # strip vendor prefix (e.g. "meta/", "nvidia/", "deepseek-ai/", "z-ai/")
    name = model_name.split("/")[-1]
    # remove :free / :latest suffixes
    name = re.sub(r":\w+$", "", name)
    # drop trailing "-instruct" / "-it" / "-preview" / "-chat" markers? Keep them short.
    name = re.sub(r"-instruct$", "", name)
    name = re.sub(r"-it$", "", name)
    name = re.sub(r"-preview$", "", name)
    name = re.sub(r"-chat$", "", chat_keep(name))
    slug = slugify(name)
    return f"{owner_prefix}-{slug}"


def chat_keep(name: str) -> str:
    """Helper for the regex chain above; keeps name as-is otherwise."""
    return name


def categorize(model_name: str) -> str:
    """Return one of: reasoning, professional, sfw."""
    n = model_name.lower()
    sfw_patterns = [
        "nemoguard", "llama-guard", "content-safety", "prompt-guard",
        "guard", "moderation", "safety",
    ]
    # SFW check first (highest priority)
    for p in sfw_patterns:
        if p in n:
            return "sfw"

    # Negative lookbehind: "non-reasoning" is NOT a reasoning model
    if "non-reasoning" in n or "nonreasoning" in n:
        return "professional"

    reasoning_patterns = [
        "thinking", "reasoning", "reasoner",
        "r1",           # deepseek-r1, qwq-r1, etc.
        "nemotron-ultra", "nemotron-3-ultra",
        "qwythos",      # special-case per task spec
        "qwq",
        "thinkingcap",  # ThinkingCap-* family
    ]
    for p in reasoning_patterns:
        if p in n:
            return "reasoning"
    return "professional"


def context_window_for(model_name: str) -> int:
    """Heuristic context window by family."""
    n = model_name.lower()

    # Gemini family
    if "gemini" in n:
        return 1_000_000

    # Qwen family
    if "qwen" in n:
        return 262_144

    # DeepSeek family
    if "deepseek" in n:
        return 64_000

    # Large flagship / ultra / 200B+ / Nemotron Ultra / GLM 5.2
    if any(k in n for k in ["ultra", "550b", "120b", "70b", "glm-5", "gpt-5", "gpt-4", "gpt-o4", "o3-mini", "claude", "grok-4"]):
        return 200_000

    # Smaller 7B/8B class
    if re.search(r"(^|[-/])7b($|-)", n) or re.search(r"(^|[-/])8b($|-)", n) or "nano" in n:
        return 8_000

    # Default
    return 128_000


def make_description(model_name: str, display_name: str) -> str:
    """
    Build a human-readable description. Uses the model name and the provider
    display name. Lightly canonicalises well-known families.
    """
    # Strip vendor prefix for readability
    short = model_name.split("/")[-1]
    short = re.sub(r":\w+$", "", short)
    short_pretty = short

    # Light family-aware phrasing (use exact-version checks where it matters)
    n = short.lower()
    if "nemotron-ultra" in n or "nemotron-3-ultra" in n:
        short_pretty = f"NVIDIA Nemotron 3 Ultra ({short})"
    elif "nemotron-3-super" in n:
        short_pretty = f"NVIDIA Nemotron 3 Super ({short})"
    elif "nemotron-3-nano" in n:
        short_pretty = f"NVIDIA Nemotron 3 Nano ({short})"
    elif "llama-3" in n:
        short_pretty = f"Meta {short}"
    elif "glm-5.2" in n:
        short_pretty = f"GLM 5.2 — Zhipu AI flagship ({short})"
    elif "glm-5.1" in n:
        short_pretty = f"GLM 5.1 — Zhipu AI ({short})"
    elif "glm-4" in n:
        short_pretty = f"GLM 4 — Zhipu AI ({short})"
    elif "gemma-4" in n:
        short_pretty = f"Google Gemma 4 ({short})"
    elif "gemma-2" in n:
        short_pretty = f"Google Gemma 2 ({short})"
    elif "deepseek" in n:
        short_pretty = f"DeepSeek ({short})"
    elif "qwen" in n:
        short_pretty = f"Alibaba Qwen ({short})"
    elif "minimax" in n:
        short_pretty = f"Minimax ({short})"
    elif "mistral" in n or "codestral" in n:
        short_pretty = f"Mistral ({short})"
    elif "gpt" in n:
        short_pretty = f"OpenAI {short}"
    elif "gemma" in n:
        short_pretty = f"Google {short}"
    elif "step" in n and "fun" in n:
        short_pretty = f"StepFun ({short})"
    elif "nemoguard" in n or "guard" in n or "safety" in n:
        short_pretty = f"Safety / moderation model ({short})"
    elif "turbo" in n:
        short_pretty = f"Fast search-optimized ({short})"
    elif short == "auto":
        short_pretty = "Auto-router (best available model)"
    elif "free" in n:
        short_pretty = f"Free auto-route ({short})"

    return f"{short_pretty} (via {display_name})"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    working = json.loads(WORKING_FILE.read_text())
    print(f"Loaded {len(working)} working models from {WORKING_FILE.name}")

    # Group by raw owned_by
    grouped: "OrderedDict[str, list]" = OrderedDict()
    for m in working:
        grouped.setdefault(m["owned_by"], []).append(m)

    # Sort groups by descending count for nicer output
    sorted_owners = sorted(grouped.keys(), key=lambda o: (-len(grouped[o]), o))

    # Sanity: every owner should be in OWNER_META
    unknown_owners = [o for o in sorted_owners if o not in OWNER_META]
    if unknown_owners:
        print("WARNING: unknown owners (will skip):", unknown_owners)

    total = 0
    provider_counts: "OrderedDict[str, int]" = OrderedDict()
    # Track all generated short ids to de-duplicate within and across providers
    used_short_ids: dict[str, int] = {}

    def reserve_short_id(base: str) -> str:
        """Return a unique short id, suffixing with -2, -3, ... on collision."""
        if base not in used_short_ids:
            used_short_ids[base] = 1
            return base
        # collision — but only suffix if the underlying upstream differs
        used_short_ids[base] += 1
        return f"{base}-{used_short_ids[base]}"

    # --- Build entries file ---
    lines: list[str] = []
    lines.append("/*")
    lines.append(" * Auto-generated G4F.space registry entries — 88 working models")
    lines.append(" * Source: scripts/g4f_working_final.json (tested against")
    lines.append(" *         https://g4f.space/v1/chat/completions with NO auth token)")
    lines.append(" *")
    lines.append(" * Each entry uses the gf() helper. The first arg is the clean short")
    lines.append(" * id, the second is the FULL upstream g4f.space id, the 4th arg is")
    lines.append(" * the cleaned owned_by label.")
    lines.append(" *")
    lines.append(" * Models are grouped by owner with comment headers.")
    lines.append(" */")
    lines.append("")
    lines.append("// NOTE: requires the updated gf() helper signature from registry.ts:")
    lines.append("//   gf(providerId, id, upstream, description, ownerLabel, category, contextWindow)")
    lines.append("")

    for owner in sorted_owners:
        meta = OWNER_META.get(owner)
        if not meta:
            continue
        models = grouped[owner]
        models_sorted = sorted(models, key=lambda m: m["model"].lower())
        n = len(models_sorted)
        provider_counts[meta["display_name"]] = n
        total += n

        header = f"  // ─── {meta['clean_label']} ({meta['display_name']}) — {n} models {'─' * max(2, 60 - len(meta['clean_label']) - len(meta['display_name']) - len(str(n)) - 22)}"
        lines.append(header)
        for m in models_sorted:
            pid = meta["provider_id"]
            base_sid = make_short_id(meta["id_prefix"], m["model"])
            sid = reserve_short_id(base_sid)
            desc = make_description(m["model"], meta["display_name"])
            owner_label = meta["clean_label"]
            cat = categorize(m["model"])
            ctx = context_window_for(m["model"])
            # Escape any quotes in description
            desc_esc = desc.replace('"', '\\"')
            lines.append(
                f'  gf("{pid}", "{sid}", "{m["id"]}", '
                f'"{desc_esc}", "{owner_label}", "{cat}", {ctx}),'
            )
        lines.append("")

    ENTRIES_OUT.write_text("\n".join(lines) + "\n")
    print(f"Wrote {ENTRIES_OUT} ({len(lines)} lines, {total} models)")

    # --- Build PROVIDER_INFO file ---
    pinfo_lines: list[str] = []
    pinfo_lines.append("/*")
    pinfo_lines.append(" * Auto-generated PROVIDER_INFO entries for the 11 G4F.space")
    pinfo_lines.append(" * owner-based providers. These should be merged into the")
    pinfo_lines.append(" * PROVIDER_INFO map in src/lib/providers/registry.ts.")
    pinfo_lines.append(" */")
    pinfo_lines.append("")

    # Build a short description listing model family highlights per provider
    for owner in sorted_owners:
        meta = OWNER_META.get(owner)
        if not meta:
            continue
        models = grouped[owner]
        n = len(models)
        # Collect unique family tokens
        families = set()
        for m in models:
            mn = m["model"].lower()
            if "nemotron" in mn: families.add("Nemotron")
            if "llama" in mn: families.add("Llama")
            if "glm" in mn: families.add("GLM")
            if "deepseek" in mn: families.add("DeepSeek")
            if "gemma" in mn: families.add("Gemma")
            if "qwen" in mn: families.add("Qwen")
            if "mistral" in mn or "codestral" in mn: families.add("Mistral")
            if "minimax" in mn: families.add("Minimax")
            if "gpt" in mn: families.add("GPT")
            if "gemini" in mn: families.add("Gemini")
            if "step" in mn and "fun" in mn: families.add("StepFun")
            if "grok" in mn: families.add("Grok")
            if "kilocode" in mn or "kilo" in mn: families.add("Kilo")
            if "nemoguard" in mn or "guard" in mn or "safety" in mn: families.add("Guard")
            if "turbo" in mn: families.add("Turbo")
            if "auto" in mn or "free" in mn: families.add("Auto")
            if "hy3" in mn or "tencent" in mn: families.add("Tencent")
            if "mimo" in mn: families.add("MiMo")
        fam_str = ", ".join(sorted(families)) if families else "various"
        description = f'{n} models ({fam_str}) via {meta["display_name"]}'
        pinfo_lines.append(f'  "{meta["provider_id"]}": {{')
        pinfo_lines.append(f'    name: "{meta["display_name"]}",')
        pinfo_lines.append(f'    description: "{description}",')
        pinfo_lines.append('  },')

    PROVIDER_INFO_OUT.write_text("\n".join(pinfo_lines) + "\n")
    print(f"Wrote {PROVIDER_INFO_OUT} ({len(pinfo_lines)} lines, {len(provider_counts)} providers)")

    # --- Print summary ---
    print()
    print("=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"Total working models: {total}")
    print(f"Unique providers (owners): {len(provider_counts)}")
    print()
    print("Models per provider:")
    for name, count in provider_counts.items():
        print(f"  {name:30s} {count}")
    print()
    print("First 20 lines of g4f_registry_entries.ts:")
    for ln in lines[:20]:
        print(ln)
    print()
    print("Last 20 lines of g4f_registry_entries.ts:")
    for ln in lines[-20:]:
        print(ln)


if __name__ == "__main__":
    main()
