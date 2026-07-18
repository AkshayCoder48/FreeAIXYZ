#!/usr/bin/env bash
# Test all 16 uncensored models via curl, one-by-one, 2s gaps.
# Records: http_status, ok, latency_ms, response (first 100 chars), error.
set -uo pipefail

ENDPOINT="http://localhost:3000/api/v1/chat/completions"
OUT="/home/z/my-project/scripts/uncensored_test_results.json"
NDJSON="/tmp/uncensored_results.ndjson"
LOG="/tmp/uncensored_test_run.log"

: > "$NDJSON"
: > "$LOG"

PROMPT="Write a one-sentence dark fantasy story about a warrior."

# id|provider pairs in the requested test order
MODELS=(
  "nsfw-llama3-8b|helper"
  "nsfw-jollygen|helper"
  "nsfw-lustre-reasoning|helper"
  "nsfw-lustre-search|helper"
  "ollama-swarm-hermes-pwn|ollama-swarm"
  "ollama-swarm-nemesis-ia|ollama-swarm"
  "ollama-swarm-nemesis-ia-v3|ollama-swarm"
  "ollama-swarm-huihui-ai-gpt-oss-abliterated|ollama-swarm"
  "ollama-swarm-huihui-ai-gemma-4-abliterated-26b|ollama-swarm"
  "ollama-swarm-huihui-ai-gemma-4-abliterated-12b|ollama-swarm"
  "ollama-swarm-huihui-ai-qwen3-5-abliterated-27b|ollama-swarm"
  "ollama-swarm-huihui-ai-qwen3-6-abliterated-27b|ollama-swarm"
  "ollama-swarm-huihui-ai-glm-4-7-flash-abliterated|ollama-swarm"
  "kobold-qwen3-5-35b-a3b-uncensored-hauhaucs-aggressiv|kobold-llamacpp-swarm"
  "kobold-qwen3-6-35b-a3b-uncensored-hauhaucs-aggressiv|kobold-llamacpp-swarm"
  "api-unmoderated-gpt|api-airforce"
)

TOTAL=${#MODELS[@]}
echo "Testing $TOTAL uncensored models via curl (one-by-one, 2s gaps)..." | tee -a "$LOG"
echo "Endpoint: $ENDPOINT" | tee -a "$LOG"
echo "" | tee -a "$LOG"

i=0
for entry in "${MODELS[@]}"; do
  i=$((i+1))
  mid="${entry%%|*}"
  prov="${entry##*|}"

  echo "[$(date +%T)] [$i/$TOTAL] $mid" | tee -a "$LOG"

  # Build JSON payload with jq (safe escaping)
  payload=$(jq -n --arg m "$mid" --arg p "$PROMPT" \
    '{model:$m, messages:[{role:"user", content:$p}], stream:false}')

  body_file=$(mktemp)
  # curl: capture "http_code|time_total" via -w, body to file
  meta=$(curl -s --max-time 45 -o "$body_file" -w "%{http_code}|%{time_total}" \
    -X POST "$ENDPOINT" \
    -H "Content-Type: application/json" \
    -d "$payload" 2>/dev/null) || meta="000|0.000"

  # latency: derive from curl's time_total (seconds with ms precision) -> ms
  curl_time_s="${meta##*|}"
  status="${meta%%|*}"
  latency_ms=$(awk -v t="$curl_time_s" 'BEGIN{ printf "%d", (t+0)*1000 }')
  # Fallback to 0 if parse failed
  [[ -z "$latency_ms" ]] && latency_ms=0

  body=$(cat "$body_file" 2>/dev/null || echo "")
  rm -f "$body_file"

  ok=false
  response=""
  error=""

  if [[ "$status" == "200" ]]; then
    content=$(echo "$body" | jq -r '.choices[0].message.content // ""' 2>/dev/null)
    if [[ -n "$content" && "$content" != "null" ]]; then
      ok=true
      # strip newlines, take first 100 chars
      response=$(echo "$content" | tr '\n' ' ' | sed 's/  */ /g' | cut -c1-100)
    else
      ok=false
      error="HTTP 200 but empty content (body: ${body:0:150})"
    fi
  elif [[ "$status" == "000" ]]; then
    ok=false
    error="curl failed / timeout (--max-time 45 reached)"
  else
    ok=false
    # Body may be JSON error or plain text; take first 150 chars
    error="HTTP $status: ${body:0:150}"
  fi

  # Build JSON entry via jq (safe escaping)
  entry_json=$(jq -n \
    --arg id "$mid" \
    --arg prov "$prov" \
    --argjson ok "$ok" \
    --argjson latency "$latency_ms" \
    --arg status "$status" \
    --arg resp "$response" \
    --arg err "$error" \
    '{id:$id, provider:$prov, ok:$ok, latency_ms:$latency, http_status:$status, response:$resp, error:$err}')

  echo "$entry_json" >> "$NDJSON"

  if [[ "$ok" == "true" ]]; then
    echo "  -> OK   [${latency_ms}ms, HTTP ${status}] ${response:0:70}" | tee -a "$LOG"
  else
    echo "  -> FAIL [${latency_ms}ms, HTTP ${status}] ${error:0:120}" | tee -a "$LOG"
  fi
  echo "" | tee -a "$LOG"

  # 2-second delay between tests (skip after the last one)
  if [[ $i -lt $TOTAL ]]; then
    sleep 2
  fi
done

# Assemble final JSON array from NDJSON
jq -s '.' "$NDJSON" > "$OUT"

echo "" | tee -a "$LOG"
echo "Results saved to $OUT" | tee -a "$LOG"
