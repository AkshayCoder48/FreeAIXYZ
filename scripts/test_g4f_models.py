#!/usr/bin/env python3
"""
G4F.space model tester — FAST NO-AUTH version.

Strategy:
  - 25s timeout per request, NO retries on basic (fail fast, move on)
  - 1.2s delay between requests to respect rate limit
  - Test ALL models for basic completion first
  - Test tools + websearch only for working models (separate pass)
"""

import requests
import json
import time
import sys
from collections import defaultdict

ENDPOINT = "https://g4f.space/v1/chat/completions"
HEADERS = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
}

TIMEOUT = 25
DELAY = 1.2


def extract_content(data):
    """Extract content from response (handles both dict and list responses)."""
    if isinstance(data, list) and len(data) > 0:
        first = data[0]
        if isinstance(first, dict) and "error" in first:
            err = first["error"]
            msg = err.get("message", "") if isinstance(err, dict) else str(err)
            return None, f"API error: {msg[:200]}"
        data = first
    if not isinstance(data, dict):
        return None, f"Unexpected response type: {type(data).__name__}"
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
        "messages": [
            {"role": "user", "content": "What is 7+5? Reply with just the number."},
        ],
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


def test_tools(model_id):
    payload = {
        "model": model_id,
        "messages": [
            {"role": "user", "content": "What's the weather in Tokyo? Use the get_weather tool."},
        ],
        "tools": [
            {
                "type": "function",
                "function": {
                    "name": "get_weather",
                    "description": "Get current weather for a location",
                    "parameters": {
                        "type": "object",
                        "properties": {"location": {"type": "string"}},
                        "required": ["location"],
                    },
                },
            }
        ],
        "stream": False,
        "max_tokens": 200,
    }
    try:
        resp = requests.post(ENDPOINT, headers=HEADERS, json=payload, timeout=TIMEOUT)
        if resp.status_code != 200:
            return False, f"HTTP {resp.status_code}"
        data = resp.json()
        if isinstance(data, list) and len(data) > 0:
            data = data[0]
        msg = data.get("choices", [{}])[0].get("message", {})
        tool_calls = msg.get("tool_calls", [])
        content = msg.get("content", "") or ""
        if tool_calls:
            return True, f"tool_calls: {json.dumps(tool_calls)[:80]}"
        if "tokyo" in content.lower() or "weather" in content.lower() or "get_weather" in content.lower():
            return True, f"mentions tool: {content[:60]}"
        return False, f"No tool call. Content: {content[:80]}"
    except Exception as e:
        return False, f"{type(e).__name__}"


def test_websearch(model_id):
    payload = {
        "model": model_id,
        "messages": [{"role": "user", "content": "What is today's date?"}],
        "stream": False,
        "max_tokens": 80,
        "web_search": True,
    }
    try:
        resp = requests.post(ENDPOINT, headers=HEADERS, json=payload, timeout=TIMEOUT)
        if resp.status_code != 200:
            return False, f"HTTP {resp.status_code}"
        data = resp.json()
        content, err = extract_content(data)
        if content is None:
            return False, err[:80]
        return True, content[:60]
    except Exception as e:
        return False, f"{type(e).__name__}"


def main():
    with open("/tmp/g4f_models_clean.json") as f:
        all_models = json.load(f)

    testable = [m for m in all_models if isinstance(m.get("id"), str) and m["id"] != "auto"]
    print(f"=== Testing {len(testable)} models (NO AUTH, fast) ===\n", flush=True)

    results = []
    for i, m in enumerate(testable, 1):
        model_id = m["id"]
        owned_by = m.get("owned_by", "unknown")
        short = model_id if len(model_id) <= 65 else model_id[:62] + "..."
        print(f"[{i}/{len(testable)}] {short} [{owned_by}]", flush=True)

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

        # Save progress every model
        with open("/home/z/my-project/scripts/g4f_test_report.json", "w") as f:
            json.dump(results, f, indent=2)

        time.sleep(DELAY)

    # Final save
    working = [r for r in results if r["basic_ok"]]
    with open("/home/z/my-project/scripts/g4f_working_models.json", "w") as f:
        json.dump(working, f, indent=2)

    by_owner = defaultdict(lambda: {"total": 0, "working": 0})
    for r in results:
        o = r["owned_by"]
        by_owner[o]["total"] += 1
        if r["basic_ok"]:
            by_owner[o]["working"] += 1

    print(f"\n=== SUMMARY ===")
    print(f"Total tested: {len(results)}")
    print(f"Working: {len(working)}")
    print(f"Failed: {len(results) - len(working)}")
    print(f"\nBy owner (working / total):")
    for o in sorted(by_owner.keys()):
        v = by_owner[o]
        marker = "OK" if v["working"] > 0 else "--"
        print(f"  [{marker}] {o}: {v['working']}/{v['total']}")

    print(f"\nWorking models:")
    for r in working:
        print(f"  [{r['owned_by']}] {r['id']} | {r['basic_content'][:40]}")


if __name__ == "__main__":
    main()
