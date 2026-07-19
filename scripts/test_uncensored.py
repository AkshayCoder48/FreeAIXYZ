#!/usr/bin/env python3
"""Test all uncensored models — see which ones actually work."""
import requests
import json
import time
import sys

ENDPOINT = "http://localhost:3000/api/v1/chat/completions"

with open("/tmp/uncensored_models.json") as f:
    models = json.load(f)

print(f"Testing {len(models)} uncensored models...\n")

results = []
for i, m in enumerate(models, 1):
    mid = m['id']
    print(f"[{i}/{len(models)}] {mid}", flush=True)
    
    payload = {
        "model": mid,
        "messages": [
            {"role": "user", "content": "Write a one-sentence dark fantasy story about a warrior."}
        ],
        "stream": False,
        "max_tokens": 100,
    }
    
    t0 = time.time()
    try:
        resp = requests.post(ENDPOINT, json=payload, timeout=45)
        latency = int((time.time() - t0) * 1000)
        
        if resp.status_code != 200:
            err = resp.text[:150]
            results.append({**m, 'ok': False, 'latency': latency, 'error': f"HTTP {resp.status_code}: {err}", 'response': ''})
            print(f"  -> FAIL ({latency}ms) HTTP {resp.status_code}", flush=True)
        else:
            try:
                data = resp.json()
                content = data.get('choices', [{}])[0].get('message', {}).get('content', '')
                if content and content.strip():
                    results.append({**m, 'ok': True, 'latency': latency, 'error': '', 'response': content.strip()[:100]})
                    print(f"  -> OK ({latency}ms) {content.strip()[:70]}", flush=True)
                else:
                    results.append({**m, 'ok': False, 'latency': latency, 'error': 'Empty content', 'response': ''})
                    print(f"  -> FAIL ({latency}ms) Empty content", flush=True)
            except Exception as e:
                results.append({**m, 'ok': False, 'latency': latency, 'error': f'JSON parse: {e}', 'response': ''})
                print(f"  -> FAIL ({latency}ms) Parse error", flush=True)
    except requests.Timeout:
        latency = int((time.time() - t0) * 1000)
        results.append({**m, 'ok': False, 'latency': latency, 'error': 'Timeout', 'response': ''})
        print(f"  -> FAIL ({latency}ms) Timeout", flush=True)
    except Exception as e:
        latency = int((time.time() - t0) * 1000)
        results.append({**m, 'ok': False, 'latency': latency, 'error': str(e)[:100], 'response': ''})
        print(f"  -> FAIL ({latency}ms) {e}", flush=True)
    
    time.sleep(1.5)

# Summary
working = [r for r in results if r['ok']]
failed = [r for r in results if not r['ok']]

print(f"\n{'='*60}")
print(f"SUMMARY: {len(working)}/{len(results)} uncensored models working")
print(f"{'='*60}\n")

print("WORKING:")
for r in working:
    print(f"  [OK] {r['id']} ({r['latency']}ms)")
    print(f"       Provider: {r['provider']}")
    print(f"       Response: {r['response'][:80]}")
    print()

print("\nFAILED:")
for r in failed:
    print(f"  [FAIL] {r['id']}")
    print(f"        Error: {r['error'][:100]}")
    print()

# Save results
with open("/home/z/my-project/scripts/uncensored_test_results.json", "w") as f:
    json.dump(results, f, indent=2)
print(f"\nResults saved to scripts/uncensored_test_results.json")
