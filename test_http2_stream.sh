#!/bin/bash

# Set variables
ORG_ID="${1:-default}" # Use the first argument as org_id or default to "default"
HOST="${2:-http://localhost:5080}"
ENDPOINT="$HOST/api/$ORG_ID/_test_http2_stream"
TOKEN="your_auth_token_here" # Replace with your actual auth token if needed

echo "🚀 Testing HTTP/2 streaming endpoint: $ENDPOINT"

# Create a simple request payload
cat > request.json << EOL
{
  "sql": "select * from logs limit 10",
  "start_time": $(date +%s)000000,
  "end_time": $(date +%s)000000
}
EOL

echo "📝 Request payload:"
cat request.json

echo -e "\n🔍 Sending request and streaming response:"

# Use curl to send the request and stream the response
# The -N option is important for streaming
# The --http2 option forces HTTP/2 (though most servers will auto-negotiate)
curl -N --http2 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d @request.json \
  "$ENDPOINT"

echo -e "\n✅ Test completed"

# Clean up
rm request.json 