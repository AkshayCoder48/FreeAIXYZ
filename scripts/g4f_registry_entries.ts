/*
 * Auto-generated G4F.space registry entries — 88 working models
 * Source: scripts/g4f_working_final.json (tested against
 *         https://g4f.space/v1/chat/completions with NO auth token)
 *
 * Each entry uses the gf() helper. The first arg is the clean short
 * id, the second is the FULL upstream g4f.space id, the 4th arg is
 * the cleaned owned_by label.
 *
 * Models are grouped by owner with comment headers.
 */

// NOTE: requires the updated gf() helper signature from registry.ts:
//   gf(providerId, id, upstream, description, ownerLabel, category, contextWindow)

  // ─── nvidia.com (NVIDIA NIM) — 34 models ────────────────
  gf("nvidia-com", "nvidia-deepseek-v4-flash", "srv_mkombumpae45db46dcb8:deepseek-ai/deepseek-v4-flash", "DeepSeek (deepseek-v4-flash) (via NVIDIA NIM)", "nvidia.com", "professional", 64000),
  gf("nvidia-com", "nvidia-deepseek-v4-pro", "srv_mkombumpae45db46dcb8:deepseek-ai/deepseek-v4-pro", "DeepSeek (deepseek-v4-pro) (via NVIDIA NIM)", "nvidia.com", "professional", 64000),
  gf("nvidia-com", "nvidia-gemma-2-2b", "srv_mkombumpae45db46dcb8:google/gemma-2-2b-it", "Google Gemma 2 (gemma-2-2b-it) (via NVIDIA NIM)", "nvidia.com", "professional", 128000),
  gf("nvidia-com", "nvidia-gemma-3n-e2b", "srv_mkombumpae45db46dcb8:google/gemma-3n-e2b-it", "Google gemma-3n-e2b-it (via NVIDIA NIM)", "nvidia.com", "professional", 128000),
  gf("nvidia-com", "nvidia-gemma-3n-e4b", "srv_mkombumpae45db46dcb8:google/gemma-3n-e4b-it", "Google gemma-3n-e4b-it (via NVIDIA NIM)", "nvidia.com", "professional", 128000),
  gf("nvidia-com", "nvidia-llama-3-1-70b", "srv_mkombumpae45db46dcb8:meta/llama-3.1-70b-instruct", "Meta llama-3.1-70b-instruct (via NVIDIA NIM)", "nvidia.com", "professional", 200000),
  gf("nvidia-com", "nvidia-llama-3-1-8b", "srv_mkombumpae45db46dcb8:meta/llama-3.1-8b-instruct", "Meta llama-3.1-8b-instruct (via NVIDIA NIM)", "nvidia.com", "professional", 8000),
  gf("nvidia-com", "nvidia-llama-3-2-11b-vision", "srv_mkombumpae45db46dcb8:meta/llama-3.2-11b-vision-instruct", "Meta llama-3.2-11b-vision-instruct (via NVIDIA NIM)", "nvidia.com", "professional", 128000),
  gf("nvidia-com", "nvidia-llama-3-2-3b", "srv_mkombumpae45db46dcb8:meta/llama-3.2-3b-instruct", "Meta llama-3.2-3b-instruct (via NVIDIA NIM)", "nvidia.com", "professional", 128000),
  gf("nvidia-com", "nvidia-llama-3-2-90b-vision", "srv_mkombumpae45db46dcb8:meta/llama-3.2-90b-vision-instruct", "Meta llama-3.2-90b-vision-instruct (via NVIDIA NIM)", "nvidia.com", "professional", 128000),
  gf("nvidia-com", "nvidia-llama-guard-4-12b", "srv_mkombumpae45db46dcb8:meta/llama-guard-4-12b", "Safety / moderation model (llama-guard-4-12b) (via NVIDIA NIM)", "nvidia.com", "sfw", 128000),
  gf("nvidia-com", "nvidia-mistral-medium-3-5-128b", "srv_mkombumpae45db46dcb8:mistralai/mistral-medium-3.5-128b", "Mistral (mistral-medium-3.5-128b) (via NVIDIA NIM)", "nvidia.com", "professional", 128000),
  gf("nvidia-com", "nvidia-mistral-nemotron", "srv_mkombumpae45db46dcb8:mistralai/mistral-nemotron", "Mistral (mistral-nemotron) (via NVIDIA NIM)", "nvidia.com", "professional", 128000),
  gf("nvidia-com", "nvidia-mistral-small-4-119b-2603", "srv_mkombumpae45db46dcb8:mistralai/mistral-small-4-119b-2603", "Mistral (mistral-small-4-119b-2603) (via NVIDIA NIM)", "nvidia.com", "professional", 128000),
  gf("nvidia-com", "nvidia-mixtral-8x7b-instruct-v0-1", "srv_mkombumpae45db46dcb8:mistralai/mixtral-8x7b-instruct-v0.1", "mixtral-8x7b-instruct-v0.1 (via NVIDIA NIM)", "nvidia.com", "professional", 128000),
  gf("nvidia-com", "nvidia-gliner-pii", "srv_mkombumpae45db46dcb8:nvidia/gliner-pii", "gliner-pii (via NVIDIA NIM)", "nvidia.com", "professional", 128000),
  gf("nvidia-com", "nvidia-ising-calibration-1-35b-a3b", "srv_mkombumpae45db46dcb8:nvidia/ising-calibration-1-35b-a3b", "ising-calibration-1-35b-a3b (via NVIDIA NIM)", "nvidia.com", "professional", 128000),
  gf("nvidia-com", "nvidia-llama-3-1-nemoguard-8b-content-safety", "srv_mkombumpae45db46dcb8:nvidia/llama-3.1-nemoguard-8b-content-safety", "Meta llama-3.1-nemoguard-8b-content-safety (via NVIDIA NIM)", "nvidia.com", "sfw", 8000),
  gf("nvidia-com", "nvidia-llama-3-1-nemoguard-8b-topic-control", "srv_mkombumpae45db46dcb8:nvidia/llama-3.1-nemoguard-8b-topic-control", "Meta llama-3.1-nemoguard-8b-topic-control (via NVIDIA NIM)", "nvidia.com", "sfw", 8000),
  gf("nvidia-com", "nvidia-llama-3-1-nemotron-nano-8b-v1", "srv_mkombumpae45db46dcb8:nvidia/llama-3.1-nemotron-nano-8b-v1", "Meta llama-3.1-nemotron-nano-8b-v1 (via NVIDIA NIM)", "nvidia.com", "professional", 8000),
  gf("nvidia-com", "nvidia-llama-3-1-nemotron-nano-vl-8b-v1", "srv_mkombumpae45db46dcb8:nvidia/llama-3.1-nemotron-nano-vl-8b-v1", "Meta llama-3.1-nemotron-nano-vl-8b-v1 (via NVIDIA NIM)", "nvidia.com", "professional", 8000),
  gf("nvidia-com", "nvidia-llama-3-1-nemotron-safety-guard-8b-v3", "srv_mkombumpae45db46dcb8:nvidia/llama-3.1-nemotron-safety-guard-8b-v3", "Meta llama-3.1-nemotron-safety-guard-8b-v3 (via NVIDIA NIM)", "nvidia.com", "sfw", 8000),
  gf("nvidia-com", "nvidia-llama-3-3-nemotron-super-49b-v1", "srv_mkombumpae45db46dcb8:nvidia/llama-3.3-nemotron-super-49b-v1", "Meta llama-3.3-nemotron-super-49b-v1 (via NVIDIA NIM)", "nvidia.com", "professional", 128000),
  gf("nvidia-com", "nvidia-nemotron-3-nano-30b-a3b", "srv_mkombumpae45db46dcb8:nvidia/nemotron-3-nano-30b-a3b", "NVIDIA Nemotron 3 Nano (nemotron-3-nano-30b-a3b) (via NVIDIA NIM)", "nvidia.com", "professional", 8000),
  gf("nvidia-com", "nvidia-nemotron-3-nano-omni-30b-a3b-reasoning", "srv_mkombumpae45db46dcb8:nvidia/nemotron-3-nano-omni-30b-a3b-reasoning", "NVIDIA Nemotron 3 Nano (nemotron-3-nano-omni-30b-a3b-reasoning) (via NVIDIA NIM)", "nvidia.com", "reasoning", 8000),
  gf("nvidia-com", "nvidia-nemotron-3-super-120b-a12b", "srv_mkombumpae45db46dcb8:nvidia/nemotron-3-super-120b-a12b", "NVIDIA Nemotron 3 Super (nemotron-3-super-120b-a12b) (via NVIDIA NIM)", "nvidia.com", "professional", 200000),
  gf("nvidia-com", "nvidia-nemotron-3-ultra-550b-a55b", "srv_mkombumpae45db46dcb8:nvidia/nemotron-3-ultra-550b-a55b", "NVIDIA Nemotron 3 Ultra (nemotron-3-ultra-550b-a55b) (via NVIDIA NIM)", "nvidia.com", "reasoning", 200000),
  gf("nvidia-com", "nvidia-nemotron-3-5-content-safety", "srv_mkombumpae45db46dcb8:nvidia/nemotron-3.5-content-safety", "Safety / moderation model (nemotron-3.5-content-safety) (via NVIDIA NIM)", "nvidia.com", "sfw", 128000),
  gf("nvidia-com", "nvidia-nemotron-mini-4b", "srv_mkombumpae45db46dcb8:nvidia/nemotron-mini-4b-instruct", "nemotron-mini-4b-instruct (via NVIDIA NIM)", "nvidia.com", "professional", 128000),
  gf("nvidia-com", "nvidia-nemotron-nano-12b-v2-vl", "srv_mkombumpae45db46dcb8:nvidia/nemotron-nano-12b-v2-vl", "nemotron-nano-12b-v2-vl (via NVIDIA NIM)", "nvidia.com", "professional", 8000),
  gf("nvidia-com", "nvidia-riva-translate-4b-instruct-v1-1", "srv_mkombumpae45db46dcb8:nvidia/riva-translate-4b-instruct-v1.1", "riva-translate-4b-instruct-v1.1 (via NVIDIA NIM)", "nvidia.com", "professional", 128000),
  gf("nvidia-com", "nvidia-laguna-xs-2-1", "srv_mkombumpae45db46dcb8:poolside/laguna-xs-2.1", "laguna-xs-2.1 (via NVIDIA NIM)", "nvidia.com", "professional", 128000),
  gf("nvidia-com", "nvidia-sarvam-m", "srv_mkombumpae45db46dcb8:sarvamai/sarvam-m", "sarvam-m (via NVIDIA NIM)", "nvidia.com", "professional", 128000),
  gf("nvidia-com", "nvidia-solar-10-7b", "srv_mkombumpae45db46dcb8:upstage/solar-10.7b-instruct", "solar-10.7b-instruct (via NVIDIA NIM)", "nvidia.com", "professional", 128000),

  // ─── crowllm.com (CrowLLM) — 20 models ──────────────────
  gf("crowllm-com", "crowllm-deepseek-r1", "srv_mrgynwuz08a167112109:deepseek-r1", "DeepSeek (deepseek-r1) (via CrowLLM)", "crowllm.com", "reasoning", 64000),
  gf("crowllm-com", "crowllm-deepseek-v4-flash", "srv_mrgynwuz08a167112109:deepseek-v4-flash", "DeepSeek (deepseek-v4-flash) (via CrowLLM)", "crowllm.com", "professional", 64000),
  gf("crowllm-com", "crowllm-deepseek-v4-flash-thinking", "srv_mrgynwuz08a167112109:deepseek-v4-flash-thinking", "DeepSeek (deepseek-v4-flash-thinking) (via CrowLLM)", "crowllm.com", "reasoning", 64000),
  gf("crowllm-com", "crowllm-deepseek-v4-pro", "srv_mrgynwuz08a167112109:deepseek-v4-pro", "DeepSeek (deepseek-v4-pro) (via CrowLLM)", "crowllm.com", "professional", 64000),
  gf("crowllm-com", "crowllm-deepseek-v4-pro-thinking", "srv_mrgynwuz08a167112109:deepseek-v4-pro-thinking", "DeepSeek (deepseek-v4-pro-thinking) (via CrowLLM)", "crowllm.com", "reasoning", 64000),
  gf("crowllm-com", "crowllm-gemma-4-31b", "srv_mrgynwuz08a167112109:gemma-4-31b", "Google Gemma 4 (gemma-4-31b) (via CrowLLM)", "crowllm.com", "professional", 128000),
  gf("crowllm-com", "crowllm-glm-4-7-thinking", "srv_mrgynwuz08a167112109:glm-4.7-thinking", "GLM 4 — Zhipu AI (glm-4.7-thinking) (via CrowLLM)", "crowllm.com", "reasoning", 128000),
  gf("crowllm-com", "crowllm-glm-5-1", "srv_mrgynwuz08a167112109:glm-5.1", "GLM 5.1 — Zhipu AI (glm-5.1) (via CrowLLM)", "crowllm.com", "professional", 200000),
  gf("crowllm-com", "crowllm-glm-5-1-thinking", "srv_mrgynwuz08a167112109:glm-5.1-thinking", "GLM 5.1 — Zhipu AI (glm-5.1-thinking) (via CrowLLM)", "crowllm.com", "reasoning", 200000),
  gf("crowllm-com", "crowllm-glm-5-2", "srv_mrgynwuz08a167112109:glm-5.2", "GLM 5.2 — Zhipu AI flagship (glm-5.2) (via CrowLLM)", "crowllm.com", "professional", 200000),
  gf("crowllm-com", "crowllm-glm-5-2-thinking", "srv_mrgynwuz08a167112109:glm-5.2-thinking", "GLM 5.2 — Zhipu AI flagship (glm-5.2-thinking) (via CrowLLM)", "crowllm.com", "reasoning", 200000),
  gf("crowllm-com", "crowllm-grok-4-20-0309-non-reasoning", "srv_mrgynwuz08a167112109:grok-4.20-0309-non-reasoning", "grok-4.20-0309-non-reasoning (via CrowLLM)", "crowllm.com", "professional", 200000),
  gf("crowllm-com", "crowllm-grok-4-20-fast", "srv_mrgynwuz08a167112109:grok-4.20-fast", "grok-4.20-fast (via CrowLLM)", "crowllm.com", "professional", 200000),
  gf("crowllm-com", "crowllm-grok-4-3", "srv_mrgynwuz08a167112109:grok-4.3", "grok-4.3 (via CrowLLM)", "crowllm.com", "professional", 200000),
  gf("crowllm-com", "crowllm-kimi-2-6", "srv_mrgynwuz08a167112109:kimi-2.6", "kimi-2.6 (via CrowLLM)", "crowllm.com", "professional", 128000),
  gf("crowllm-com", "crowllm-kimi-2-6-thinking", "srv_mrgynwuz08a167112109:kimi-2.6-thinking", "kimi-2.6-thinking (via CrowLLM)", "crowllm.com", "reasoning", 128000),
  gf("crowllm-com", "crowllm-llama-3-1-8b-instant", "srv_mrgynwuz08a167112109:llama-3.1-8b-instant", "Meta llama-3.1-8b-instant (via CrowLLM)", "crowllm.com", "professional", 8000),
  gf("crowllm-com", "crowllm-minimax-m3", "srv_mrgynwuz08a167112109:minimax-m3", "Minimax (minimax-m3) (via CrowLLM)", "crowllm.com", "professional", 128000),
  gf("crowllm-com", "crowllm-minimax-m3-mxfp8", "srv_mrgynwuz08a167112109:MiniMaxAI/MiniMax-M3-MXFP8", "Minimax (MiniMax-M3-MXFP8) (via CrowLLM)", "crowllm.com", "professional", 128000),
  gf("crowllm-com", "crowllm-glm-5-1-fp8", "srv_mrgynwuz08a167112109:zai-org/GLM-5.1-FP8", "GLM 5.1 — Zhipu AI (GLM-5.1-FP8) (via CrowLLM)", "crowllm.com", "professional", 200000),

  // ─── Modelscope AI (Modelscope AI) — 8 models ───────────
  gf("modelscope-ai", "modelscope-deepseek-v3-1", "srv_mrhxbotq74ee6330d294:deepseek-ai/DeepSeek-V3.1", "DeepSeek (DeepSeek-V3.1) (via Modelscope AI)", "Modelscope AI", "professional", 64000),
  gf("modelscope-ai", "modelscope-deepseek-v3-2", "srv_mrhxbotq74ee6330d294:deepseek-ai/DeepSeek-V3.2", "DeepSeek (DeepSeek-V3.2) (via Modelscope AI)", "Modelscope AI", "professional", 64000),
  gf("modelscope-ai", "modelscope-deepseek-v3-2-exp", "srv_mrhxbotq74ee6330d294:deepseek-ai/DeepSeek-V3.2-Exp", "DeepSeek (DeepSeek-V3.2-Exp) (via Modelscope AI)", "Modelscope AI", "professional", 64000),
  gf("modelscope-ai", "modelscope-deepseek-v4-flash", "srv_mrhxbotq74ee6330d294:deepseek-ai/DeepSeek-V4-Flash", "DeepSeek (DeepSeek-V4-Flash) (via Modelscope AI)", "Modelscope AI", "professional", 64000),
  gf("modelscope-ai", "modelscope-deepseek-v4-flash-2", "srv_mrhxbotq74ee6330d294:deepseek-ai/deepseek-v4-flash", "DeepSeek (deepseek-v4-flash) (via Modelscope AI)", "Modelscope AI", "professional", 64000),
  gf("modelscope-ai", "modelscope-qwen3-235b-a22b", "srv_mrhxbotq74ee6330d294:Qwen/Qwen3-235B-A22B", "Alibaba Qwen (Qwen3-235B-A22B) (via Modelscope AI)", "Modelscope AI", "professional", 262144),
  gf("modelscope-ai", "modelscope-qwen3-235b-a22b-thinking-2507", "srv_mrhxbotq74ee6330d294:Qwen/Qwen3-235B-A22B-Thinking-2507", "Alibaba Qwen (Qwen3-235B-A22B-Thinking-2507) (via Modelscope AI)", "Modelscope AI", "reasoning", 262144),
  gf("modelscope-ai", "modelscope-qwen3-5-27b", "srv_mrhxbotq74ee6330d294:Qwen/Qwen3.5-27B", "Alibaba Qwen (Qwen3.5-27B) (via Modelscope AI)", "Modelscope AI", "professional", 262144),

  // ─── openrouter.ai (OpenRouter) — 7 models ──────────────
  gf("openrouter-ai", "openrouter-auto", "srv_monk1pkz433a519ff2be:auto", "Auto-router (best available model) (via OpenRouter)", "openrouter.ai", "professional", 128000),
  gf("openrouter-ai", "openrouter-gemma-4-26b-a4b", "srv_monk1pkz433a519ff2be:google/gemma-4-26b-a4b-it:free", "Google Gemma 4 (gemma-4-26b-a4b-it) (via OpenRouter)", "openrouter.ai", "professional", 128000),
  gf("openrouter-ai", "openrouter-nemotron-3-nano-30b-a3b", "srv_monk1pkz433a519ff2be:nvidia/nemotron-3-nano-30b-a3b:free", "NVIDIA Nemotron 3 Nano (nemotron-3-nano-30b-a3b) (via OpenRouter)", "openrouter.ai", "professional", 8000),
  gf("openrouter-ai", "openrouter-nemotron-3-super-120b-a12b", "srv_monk1pkz433a519ff2be:nvidia/nemotron-3-super-120b-a12b:free", "NVIDIA Nemotron 3 Super (nemotron-3-super-120b-a12b) (via OpenRouter)", "openrouter.ai", "professional", 200000),
  gf("openrouter-ai", "openrouter-nemotron-3-ultra-550b-a55b", "srv_monk1pkz433a519ff2be:nvidia/nemotron-3-ultra-550b-a55b:free", "NVIDIA Nemotron 3 Ultra (nemotron-3-ultra-550b-a55b) (via OpenRouter)", "openrouter.ai", "reasoning", 200000),
  gf("openrouter-ai", "openrouter-free", "srv_monk1pkz433a519ff2be:openrouter/free", "Free auto-route (free) (via OpenRouter)", "openrouter.ai", "professional", 128000),
  gf("openrouter-ai", "openrouter-hy3", "srv_monk1pkz433a519ff2be:tencent/hy3:free", "hy3 (via OpenRouter)", "openrouter.ai", "professional", 128000),

  // ─── qwen (Qwen) — 5 models ─────────────────────────────
  gf("qwen", "qwen-qwen3-6-plus", "srv_mrgymq8534d9ea96920d:qwen3.6-plus", "Alibaba Qwen (qwen3.6-plus) (via Qwen)", "qwen", "professional", 262144),
  gf("qwen", "qwen-qwen3-7-max", "srv_mrgymq8534d9ea96920d:qwen3.7-max", "Alibaba Qwen (qwen3.7-max) (via Qwen)", "qwen", "professional", 262144),
  gf("qwen", "qwen-qwen3-7-max-2", "srv_mrgxthn5dfa6e2f0a5b6:qwen3.7-max", "Alibaba Qwen (qwen3.7-max) (via Qwen)", "qwen", "professional", 262144),
  gf("qwen", "qwen-qwen3-7-plus", "srv_mrgxthn5dfa6e2f0a5b6:qwen3.7-plus", "Alibaba Qwen (qwen3.7-plus) (via Qwen)", "qwen", "professional", 262144),
  gf("qwen", "qwen-qwen3-7-plus-2", "srv_mrgymq8534d9ea96920d:qwen3.7-plus", "Alibaba Qwen (qwen3.7-plus) (via Qwen)", "qwen", "professional", 262144),

  // ─── api.airforce (API.AirForce) — 4 models ─────────────
  gf("api-airforce", "airforce-gemini-3-5-pro", "srv_mp3lmkuad07322459f47:gemini-3.5-pro", "gemini-3.5-pro (via API.AirForce)", "api.airforce", "professional", 1000000),
  gf("api-airforce", "airforce-gpt-4o", "srv_mp3lmkuad07322459f47:gpt-4o", "OpenAI gpt-4o (via API.AirForce)", "api.airforce", "professional", 200000),
  gf("api-airforce", "airforce-qwen3-6-plus", "srv_mp3lmkuad07322459f47:qwen3.6-plus", "Alibaba Qwen (qwen3.6-plus) (via API.AirForce)", "api.airforce", "professional", 262144),
  gf("api-airforce", "airforce-unmoderated-gpt", "srv_mp3lmkuad07322459f47:unmoderated-gpt", "OpenAI unmoderated-gpt (via API.AirForce)", "api.airforce", "professional", 128000),

  // ─── community-day-2026 (Community Day 2026) — 4 models ──
  gf("community-day-2026", "cd2026-thinkingcap-qwen3-6-27b", "srv_mrdypihj16e8b1776409:bottlecapai/ThinkingCap-Qwen3.6-27B", "Alibaba Qwen (ThinkingCap-Qwen3.6-27B) (via Community Day 2026)", "community-day-2026", "reasoning", 262144),
  gf("community-day-2026", "cd2026-qwythos-9b-claude-mythos-5-1m", "srv_mrdypihj16e8b1776409:empero-ai/Qwythos-9B-Claude-Mythos-5-1M", "Qwythos-9B-Claude-Mythos-5-1M (via Community Day 2026)", "community-day-2026", "reasoning", 200000),
  gf("community-day-2026", "cd2026-gemma-4-31b", "srv_mrdypihj16e8b1776409:google/gemma-4-31B-it", "Google Gemma 4 (gemma-4-31B-it) (via Community Day 2026)", "community-day-2026", "professional", 128000),
  gf("community-day-2026", "cd2026-kimi-k2-7-code", "srv_mrdypihj16e8b1776409:moonshotai/Kimi-K2.7-Code", "Kimi-K2.7-Code (via Community Day 2026)", "community-day-2026", "professional", 128000),

  // ─── kobold & llama.cpp swarm (Kobold / llama.cpp) — 3 models ──
  gf("kobold-llamacpp-swarm", "kobold-equinox-31b-q4-k-m", "srv_mqjxnj9i4e35281e8d60:koboldcpp/Equinox-31B-Q4_K_M", "Equinox-31B-Q4_K_M (via Kobold / llama.cpp)", "kobold & llama.cpp swarm", "professional", 128000),
  gf("kobold-llamacpp-swarm", "kobold-thedrummer-cydonia-24b-v4-3-q4-k-m", "srv_mqjxnj9i4e35281e8d60:koboldcpp/TheDrummer_Cydonia-24B-v4.3-Q4_K_M", "TheDrummer_Cydonia-24B-v4.3-Q4_K_M (via Kobold / llama.cpp)", "kobold & llama.cpp swarm", "professional", 128000),
  gf("kobold-llamacpp-swarm", "kobold-qwen3-5-9b-q4-k-m-gguf", "srv_mqjxnj9i4e35281e8d60:Qwen3.5-9B-Q4_K_M.gguf", "Alibaba Qwen (Qwen3.5-9B-Q4_K_M.gguf) (via Kobold / llama.cpp)", "kobold & llama.cpp swarm", "professional", 262144),

  // ─── KTAI (KTAI) — 1 models ─────────────────────────────
  gf("ktai", "ktai-mimo-v2-5", "srv_mp1v9cyha31b95fa8c9a:xiaomimimo/mimo-V2.5", "mimo-V2.5 (via KTAI)", "KTAI", "professional", 128000),

  // ─── opencode.ai/zen (OpenCode.ai) — 1 models ───────────
  gf("opencode-ai-zen", "opencode-nemotron-3-ultra-free", "srv_mrgy2d2493c3e1dc3b74:nemotron-3-ultra-free", "NVIDIA Nemotron 3 Ultra (nemotron-3-ultra-free) (via OpenCode.ai)", "opencode.ai/zen", "reasoning", 200000),

  // ─── perplexity (Perplexity) — 1 models ─────────────────
  gf("perplexity", "perplexity-turbo", "srv_mkopv2kp2e0038cdf550:turbo", "Fast search-optimized (turbo) (via Perplexity)", "perplexity", "professional", 128000),

