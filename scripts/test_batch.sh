#!/bin/bash
# Test a batch of G4F.space models using curl (no auth)
# Usage: bash test_batch.sh <start> <count>
# Outputs JSON results to stdout

START="${1:-0}"
COUNT="${2:-15}"
MODELS_FILE="/tmp/g4f_models_clean.json"

# Extract model IDs for this batch using python
MAPFILE -t MODEL_IDS < <(python3 -c "
import json
with open('$MODELS_FILE') as f:
    models = json.load(f)
testable = [m['id'] for m in models if isinstance(m.get('id'), str) and m['id'] != 'auto']
start = $START
count = $COUNT
for mid in testable[start:start+count]:
    print(mid)
")

echo "["
FIRST=1
for MID in "${MODEL_IDS[@]}"; do
    # Test basic completion
    RESP=$(curl -s -X POST "https://g4f.space/v1/chat/completions" \
        -H "Content-Type: application/json" \
        -H "User-Agent: Mozilla/5.0" \
        --max-time 20 \
        -d "{\"model\":\"$MID\",\"messages\":[{\"role\":\"user\",\"content\":\"What is 7+5? Reply with just the number.\"}],\"stream\":false,\"max_tokens\":30}" 2>/dev/null)
    
    HTTP_OK="false"
    CONTENT=""
    ERROR=""
    
    if [ -z "$RESP" ]; then
        ERROR="Empty response / timeout"
    else
        # Try to extract content
        CONTENT=$(echo "$RESP" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    if isinstance(data, list) and len(data) > 0:
        first = data[0]
        if isinstance(first, dict) and 'error' in first:
            print('ERROR:' + (first['error'].get('message','')[:100] if isinstance(first['error'], dict) else str(first['error'])[:100]))
            sys.exit(0)
        data = first
    if isinstance(data, dict):
        if 'error' in data:
            err = data['error']
            print('ERROR:' + (err.get('message','')[:100] if isinstance(err, dict) else str(err)[:100]))
        else:
            c = data.get('choices',[{}])[0].get('message',{}).get('content','')
            print(c.strip()[:80] if c else 'ERROR:Empty content')
    else:
        print('ERROR:Bad response type')
except Exception as e:
    print('ERROR:Parse fail: ' + str(e)[:80])
" 2>/dev/null)
        
        if [[ "$CONTENT" == ERROR:* ]]; then
            ERROR="${CONTENT#ERROR:}"
            CONTENT=""
        elif [ -n "$CONTENT" ]; then
            HTTP_OK="true"
        else
            ERROR="Empty content"
        fi
    fi
    
    # Get owned_by
    OWNER=$(python3 -c "
import json
with open('$MODELS_FILE') as f:
    models = json.load(f)
for m in models:
    if m.get('id') == '$MID':
        print(m.get('owned_by','unknown'))
        break
" 2>/dev/null)
    
    if [ $FIRST -eq 1 ]; then
        FIRST=0
    else
        echo ","
    fi
    
    # Escape content and error for JSON
    CONTENT_ESC=$(echo "$CONTENT" | python3 -c "import json,sys; print(json.dumps(sys.stdin.read().strip()))" 2>/dev/null)
    ERROR_ESC=$(echo "$ERROR" | python3 -c "import json,sys; print(json.dumps(sys.stdin.read().strip()))" 2>/dev/null)
    MID_ESC=$(python3 -c "import json; print(json.dumps('$MID'))" 2>/dev/null)
    OWNER_ESC=$(python3 -c "import json; print(json.dumps('$OWNER'))" 2>/dev/null)
    
    echo "  {\"id\": $MID_ESC, \"owned_by\": $OWNER_ESC, \"ok\": $HTTP_OK, \"content\": $CONTENT_ESC, \"error\": $ERROR_ESC}"
    
    sleep 1
done
echo "]"
