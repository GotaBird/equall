#!/bin/bash
# Hook: PreToolUse guard for src/types.ts
# This is the public API contract — changes break consumers.

set -euo pipefail

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name')
FILE_PATH=""

if [ "$TOOL_NAME" = "Edit" ]; then
  FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')
elif [ "$TOOL_NAME" = "Write" ]; then
  FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')
fi

if echo "$FILE_PATH" | grep -q "src/types\.ts"; then
  cat <<'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "ask",
    "permissionDecisionReason": "types.ts is the public API contract (EquallIssue, ScanResult, ScannerAdapter). Changes here break consumers of @equall/cli.",
    "additionalContext": "API GUARD: src/types.ts defines the public interfaces. Modifications must be backward-compatible or versioned as a breaking change (major bump). If Kevin has not explicitly approved this change, abort."
  }
}
EOF
else
  echo '{}'
fi
