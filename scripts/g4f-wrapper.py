#!/usr/bin/env python3
"""
g4f provider wrapper — one-shot mode with timeout.
Reads ONE JSON request from stdin, writes ONE JSON response, exits.

Request:  {"model":"...","messages":[...],"stream":true}
Response: {"ok":true,"sse":"..."} or {"ok":false,"error":"..."}
"""

import sys
import json
import os
import signal

sys.path.insert(0, os.path.expanduser("~/.local/lib/python3/site-packages"))
sys.path.insert(0, os.path.expanduser("~/.local/lib/python3.13/site-packages"))

import g4f
from g4f.client import Client

# Timeout handler — kill the process if it takes too long
def timeout_handler(signum, frame):
    print(json.dumps({"ok": False, "error": "Request timed out (30s). The model may be unavailable — try a different one."}))
    sys.stdout.flush()
    sys.exit(1)

signal.signal(signal.SIGALRM, timeout_handler)
signal.alarm(30)  # 30 second timeout

def main():
    line = sys.stdin.readline().strip()
    if not line:
        print(json.dumps({"ok": False, "error": "No input"}))
        sys.stdout.flush()
        return

    try:
        req = json.loads(line)
    except:
        print(json.dumps({"ok": False, "error": "Invalid JSON"}))
        sys.stdout.flush()
        return

    model = req.get("model", "gpt-4o-mini")
    messages = req.get("messages", [])
    want_stream = req.get("stream", True)

    client = Client()

    try:
        if want_stream:
            response = client.chat.completions.create(
                model=model,
                messages=messages,
                stream=True,
                timeout=25,
            )
            sse_parts = []
            for chunk in response:
                content = ""
                if chunk.choices and chunk.choices[0].delta.content:
                    content = chunk.choices[0].delta.content
                sse_parts.append(
                    "data: " + json.dumps({
                        "choices": [{"index": 0, "delta": {"content": content}, "finish_reason": None}]
                    }) + "\n\n"
                )
            sse_parts.append(
                "data: " + json.dumps({"choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]}) + "\n\n"
            )
            sse_parts.append("data: [DONE]\n")
            result = {"ok": True, "sse": "".join(sse_parts)}
        else:
            response = client.chat.completions.create(
                model=model,
                messages=messages,
                timeout=25,
            )
            content = response.choices[0].message.content or ""
            sse = (
                "data: " + json.dumps({"choices": [{"index": 0, "delta": {"content": content}, "finish_reason": None}]}) + "\n\n"
                "data: " + json.dumps({"choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]}) + "\n\n"
                "data: [DONE]\n"
            )
            result = {"ok": True, "sse": sse}
    except Exception as e:
        result = {"ok": False, "error": str(e)[:300]}

    signal.alarm(0)  # cancel timeout
    print(json.dumps(result))
    sys.stdout.flush()


if __name__ == "__main__":
    main()
