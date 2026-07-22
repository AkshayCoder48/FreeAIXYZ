#!/usr/bin/env python3
"""Test a batch of G4F.space models. Usage: python3 test_batch.py <start> <count>"""
import requests
import json
import sys
import time

ENDPOINT = "https://g4f.space/v1/chat/completions"
HEADERS = {"Content-Type": "application/json", "User-Agent": "Mozilla/5.0"}

def extract_content(data):
    if isinstance(data, list) and len(data) > 0:
        first = data[0]
        if isinstance(first, dict) and "error" in first:
            err = first["error"]
            return None, (err.get("message","") if isinstance(err, dict) else str(err))[:120]
        data = first
    if not isinstance(data, dict):
        return None, f"Bad type: {type(data).__name__}"
    if "error" in data:
        err = data["error"]
        return None, (err.get("message","") if isinstance(err, dict) else str(err))[:120]
    c = data.get("choices",[{}])[0].get("message",{}).get("content","")
    if not c or not c.strip():
        return None, "Empty content"
    return c.strip()[:80], ""

def test(model_id):
    payload = {"model": model_id, "messages": [{"role":"user","content":"What is 7+5? Reply with just the number."}], "stream": False, "max_tokens": 30}
    t0 = time.time()
    try:
        r = requests.post(ENDPOINT, headers=HEADERS, json=payload, timeout=20)
        lat = int((time.time()-t0)*1000)
        if r.status_code != 200:
            return False, lat, "", f"HTTP {r.status_code}: {r.text[:100]}"
        try:
            data = r.json()
        except:
            return False, lat, "", f"Bad JSON: {r.text[:100]}"
        c, err = extract_content(data)
        if c is None:
            return False, lat, "", err
        return True, lat, c, ""
    except requests.Timeout:
        return False, int((time.time()-t0)*1000), "", "Timeout"
    except Exception as e:
        return False, int((time.time()-t0)*1000), "", f"{type(e).__name__}: {str(e)[:100]}"

def main():
    start = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    count = int(sys.argv[2]) if len(sys.argv) > 2 else 15

    with open("/tmp/g4f_models_clean.json") as f:
        all_models = json.load(f)
    testable = [m for m in all_models if isinstance(m.get("id"), str) and m["id"] != "auto"]
    chunk = testable[start:start+count]

    results = []
    for i, m in enumerate(chunk):
        gidx = start + i
        mid = m["id"]
        owner = m.get("owned_by", "unknown")
        ok, lat, content, err = test(mid)
        results.append({"id": mid, "owned_by": owner, "model": m.get("model",""), "label": m.get("label",""), "requests": m.get("requests",0), "ok": ok, "latency": lat, "content": content, "error": err})
        status = "OK" if ok else "FAIL"
        print(f"[{gidx+1}] {status} {mid[:55]} [{owner}] {content[:30] if ok else err[:40]}", flush=True)
        time.sleep(1.0)

    # Append to cumulative results file
    import os
    outfile = "/home/z/my-project/scripts/g4f_all_results.json"
    existing = []
    if os.path.exists(outfile):
        try:
            with open(outfile) as f:
                existing = json.load(f)
        except:
            existing = []
    # Remove any old results for the same model IDs
    new_ids = {r["id"] for r in results}
    existing = [r for r in existing if r["id"] not in new_ids]
    existing.extend(results)
    with open(outfile, "w") as f:
        json.dump(existing, f, indent=2)

    ok_count = sum(1 for r in results if r["ok"])
    print(f"\nBatch done: {len(results)} tested, {ok_count} working. Total saved: {len(existing)}", flush=True)

if __name__ == "__main__":
    main()
