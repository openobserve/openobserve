#!/bin/bash

# Script to extract environment variables from .github/workflows/api-testing.yml
# and export them to the local environment
#
# Usage:
#   source env.sh          # Source to export to current shell
#   ./env.sh               # Execute to see what would be exported

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKFLOW_FILE="${SCRIPT_DIR}/../../.github/workflows/playwright.yml"

if [ ! -f "$WORKFLOW_FILE" ]; then
    echo "Error: Workflow file not found at $WORKFLOW_FILE" >&2
    return 2>/dev/null || exit 1
fi

# Check if yq is available (preferred method)
if command -v yq &> /dev/null; then
    echo "Using yq to parse environment variables..."
    # Extract env section and convert to export statements
    # Use process substitution to avoid subshell issues
    while IFS= read -r line; do
        if [ -n "$line" ]; then
            eval "$line"
            echo "$line"
        fi
    done < <(yq eval '.env | to_entries | .[] | "export \(.key)=\"\(.value)\""' "$WORKFLOW_FILE" 2>/dev/null)
else
    echo "yq not found, using manual parsing..."
    # Manual parsing of YAML env section
    # Find the env: section and extract key-value pairs
    in_env=false
    while IFS= read -r line || [ -n "$line" ]; do
        # Check if we're entering the env section
        if [[ "$line" =~ ^env: ]]; then
            in_env=true
            continue
        fi
        
        # Check if we're leaving the env section (next top-level key)
        if [[ "$in_env" == true ]] && [[ "$line" =~ ^[a-zA-Z_]+: ]]; then
            break
        fi
        
        # Extract environment variables from the env section
        if [[ "$in_env" == true ]] && [[ "$line" =~ ^[[:space:]]+([A-Z_][A-Z0-9_]*):[[:space:]]*(.+)$ ]]; then
            key="${BASH_REMATCH[1]}"
            value="${BASH_REMATCH[2]}"
            # Remove quotes if present
            value=$(echo "$value" | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")
            export "$key=$value"
            echo "export $key=\"$value\""
        fi
    done < "$WORKFLOW_FILE"
fi

echo ""
echo "Environment variables exported successfully!"
echo "You can now run your tests with these variables set."
