#!/usr/bin/env python3
"""
g4f provider wrapper — one-shot mode.
Reads ONE JSON request from stdin, writes ONE JSON response, exits.
This prevents any long-running process that could crash the parent.

Request:  {"model":"...","messages":[...],"stream":true}
Response: {"ok":true,"sse":"..."} or {"ok":false,"error":"..."}
"""

import sys
import json
import os

sys.path.insert(0, os.path.expanduser("~/.local/lib/python3.13/site-packages"))

import g4f
from g4f.client import Client

def main():
    # Read one line from stdin
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

    print(json.dumps(result))
    sys.stdout.flush()


if __name__ == "__main__":
    main()
