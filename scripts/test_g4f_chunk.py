#!/usr/bin/env python3
"""Run G4F.space test for a chunk of models (by index range)."""
import requests
import json
import time
import sys
import os

ENDPOINT = "https://g4f.space/v1/chat/completions"
HEADERS = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
}
TIMEOUT = 25


def extract_content(data):
    if isinstance(data, list) and len(data) > 0:
        first = data[0]
        if isinstance(first, dict) and "error" in first:
            err = first["error"]
            msg = err.get("message", "") if isinstance(err, dict) else str(err)
            return None, f"API error: {msg[:200]}"
        data = first
    if not isinstance(data, dict):
        return None, f"Unexpected type: {type(data).__name__}"
    if "error" in data:
        err = data["error"]
        msg = err.get("message", "") if isinstance(err, dict) else str(err)
        return None, f"API error: {msg[:200]}"
    content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
    if not content or not content.strip():
        return None, "Empty content"
    return content.strip(), ""


def test_basic(model_id):
    payload = {
        "model": model_id,
        "messages": [{"role": "user", "content": "What is 7+5? Reply with just the number."}],
        "stream": False,
        "max_tokens": 30,
    }
    t0 = time.time()
    try:
        resp = requests.post(ENDPOINT, headers=HEADERS, json=payload, timeout=TIMEOUT)
        latency = int((time.time() - t0) * 1000)
        if resp.status_code != 200:
            return False, latency, "", f"HTTP {resp.status_code}: {resp.text[:150]}"
        try:
            data = resp.json()
        except Exception:
            return False, latency, "", f"Invalid JSON: {resp.text[:150]}"
        content, err = extract_content(data)
        if content is None:
            return False, latency, "", err
        return True, latency, content[:80], ""
    except requests.Timeout:
        return False, int((time.time() - t0) * 1000), "", "Timeout"
    except Exception as e:
        return False, int((time.time() - t0) * 1000), "", f"{type(e).__name__}: {str(e)[:150]}"


def main():
    start_idx = int(sys.argv[1])
    end_idx = int(sys.argv[2])

    with open("/tmp/g4f_models_clean.json") as f:
        all_models = json.load(f)
    testable = [m for m in all_models if isinstance(m.get("id"), str) and m["id"] != "auto"]

    chunk = testable[start_idx:end_idx]
    print(f"=== Testing models {start_idx+1}-{end_idx} ({len(chunk)} models) ===", flush=True)

    results = []
    for i, m in enumerate(chunk):
        global_idx = start_idx + i + 1
        model_id = m["id"]
        owned_by = m.get("owned_by", "unknown")
        short = model_id if len(model_id) <= 60 else model_id[:57] + "..."
        print(f"[{global_idx}/{len(testable)}] {short} [{owned_by}]", flush=True)

        ok, latency, content, err = test_basic(model_id)
        result = {
            "id": model_id,
            "owned_by": owned_by,
            "model": m.get("model", ""),
            "label": m.get("label", ""),
            "requests": m.get("requests", 0),
            "basic_ok": ok,
            "basic_latency_ms": latency,
            "basic_content": content,
            "basic_error": err,
        }
        status = "OK" if ok else "FAIL"
        extra = content[:50] if ok else err[:70]
        print(f"    -> {status} ({latency}ms) {extra}", flush=True)
        results.append(result)
        time.sleep(1.2)

    out_file = f"/home/z/my-project/scripts/g4f_chunk_{start_idx:03d}_{end_idx:03d}.json"
    with open(out_file, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nSaved {len(results)} results to {out_file}", flush=True)
    print(f"Working in this chunk: {sum(1 for r in results if r['basic_ok'])}", flush=True)


if __name__ == "__main__":
    main()
