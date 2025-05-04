# HTTP/2 Streaming Test for OpenObserve

This document provides instructions on how to test the HTTP/2 streaming endpoint in OpenObserve.

## Overview

The HTTP/2 streaming endpoint allows clients to receive search results in real-time as they become available. This is accomplished using HTTP/2's streaming capabilities, which enable the server to send multiple response messages over a single connection.

The test endpoint we've created (`/_test_http2_stream`) simulates a search operation by sending:
1. Sample search results
2. Progress updates
3. Statistics information
4. End-of-stream notification

## Prerequisites

- OpenObserve server running locally or remotely
- Python 3.7+ with required packages (for Python client)
- curl (for shell client)

## Installation

### Python Client

1. Install required packages:
   ```bash
   pip install requests requests-toolbelt
   ```

2. Make the script executable:
   ```bash
   chmod +x test_http2_stream.py
   ```

### Shell Client

1. Make the script executable:
   ```bash
   chmod +x test_http2_stream.sh
   ```

## Usage

### Python Client

Run the Python client to test the HTTP/2 streaming endpoint:

```bash
./test_http2_stream.py [org_id] [host]
```

Examples:
```bash
# Use default values (org_id=default, host=http://localhost:5080)
./test_http2_stream.py

# Specify org_id
./test_http2_stream.py my_org 

# Specify org_id and host
./test_http2_stream.py my_org http://example.com:5080
```

### Shell Client

Run the shell client to test the HTTP/2 streaming endpoint:

```bash
./test_http2_stream.sh [org_id] [host]
```

Examples:
```bash
# Use default values (org_id=default, host=http://localhost:5080)
./test_http2_stream.sh

# Specify org_id
./test_http2_stream.sh my_org

# Specify org_id and host
./test_http2_stream.sh my_org http://example.com:5080
```

## Expected Output

The client will display:
1. HTTP/2 stream start notification
2. Sample search results (10 records)
3. Progress updates after each record (10%, 20%, etc.)
4. Statistics information at the end
5. End notification

## Troubleshooting

If you encounter issues:

1. Ensure your OpenObserve server is running
2. Check that the server supports HTTP/2
3. Verify authentication token if required
4. For Python client, ensure all required packages are installed

## Implementation Details

### Test Endpoint

The test endpoint is implemented in `src/handler/http/request/search/test_stream.rs` and includes:

- A standalone implementation of HTTP/2 streaming
- Sample data generation
- Progress updates simulation
- Proper ndjson formatting (newline-delimited JSON)

### Client Tools

- Python client: Uses requests library with streaming support
- Shell client: Uses curl with the -N option for streaming

## Notes

This is a test implementation and isn't intended for production use. It demonstrates the HTTP/2 streaming capabilities for real-time search results in OpenObserve. 