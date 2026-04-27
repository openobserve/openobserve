// Worker to handle stream processing
// This offloads decoding and parsing from the main thread
let activeBuffers = {};

// Per-traceId flag: true only for traces streams where nanosecond start_time/end_time
// fields need exact string copies injected before JSON.parse rounds them.
let patchNsMap = {};

// Regex targets only 19+ digit integers — nanosecond epoch timestamps.
// µs (16-digit) and ms (13-digit) values are safely representable and untouched.
// (?<!\\) skips escaped-quote sequences inside JSON string values.
const NS_FIELDS_RE = /(?<!\\)"(start_time|end_time)"\s*:\s*(\d{19,})/g;

function safeParseJson(text, patchNs) {
  if (!patchNs) return JSON.parse(text);
  NS_FIELDS_RE.lastIndex = 0;
  const patched = text.replace(NS_FIELDS_RE, '"$1":$2,"_$1_ns":"$2"');
  return JSON.parse(patched);
}

// Helper function to extract data from message line
function extractData(line) {
  return line.startsWith('data:') ? line.slice(6) : line.slice(5);
}

// Handle messages from main thread
self.onmessage = async (event) => {
  const { action, traceId, chunk } = event.data;

  switch (action) {
    case 'startStream':
      // For Safari compatibility, we receive chunks instead of streams
      activeBuffers[traceId] = '';
      patchNsMap[traceId] = !!event.data.patchNsFields;
      break;

    case 'processChunk':
      // Process individual chunk (Safari compatibility)
      if (activeBuffers[traceId] !== undefined) {
        processChunk(traceId, chunk);
      }
      break;

    case 'endStream':
      // Stream ended, send end notification
      self.postMessage({
        type: 'end',
        traceId,
      });

      delete activeBuffers[traceId];
      delete patchNsMap[traceId];
      break;

    case 'cancelStream':
      delete activeBuffers[traceId];
      delete patchNsMap[traceId];
      break;

    case 'closeAll':
      activeBuffers = {};
      patchNsMap = {};
      break;
  }
};

// Process a chunk for a given traceId
function processChunk(traceId, chunk) {
  let buffer = activeBuffers[traceId] || '';

  try {
    // Add chunk to buffer
    buffer += chunk;

    // Process complete messages
    const messages = buffer.split('\n\n');
    // Keep the last potentially incomplete message in buffer
    buffer = messages.pop() || '';
    activeBuffers[traceId] = buffer;

    const lines = messages.filter(line => line.trim());

    // Collect all parsed events from this chunk into a batch
    const batch = [];

    // Process each complete line
    for (let i = 0; i < lines.length; i++) {
      try {
        const msgLines = lines[i].split('\n');
        // Check if this is an event line

        if(msgLines.length > 1){
          const eventType = msgLines[0].startsWith('event:') ? msgLines[0].slice(7).trim() : msgLines[0].slice(6).trim();

          //TODO: Logic is duplicated for event:search_response and event:search_response_hits
          // Create method to handle this
          if (msgLines[1]?.startsWith('data:') || msgLines[1]?.startsWith('data: ')) {
            const data = extractData(msgLines[1]);

            try {
              // Try to parse as JSON
              const json = safeParseJson(data, patchNsMap[traceId]);

              batch.push({
                type: eventType,
                traceId,
                data: json,
              });
            } catch (parseErr) {
              // If JSON parsing fails, send raw data
              batch.push({
                type: 'error',
                traceId,
                data: { message: 'Error parsing data', error: parseErr.toString() },
              });
            }
          }
        }

        if (msgLines[0]?.startsWith('data:') || msgLines[0]?.startsWith('data: ')) {
          const data = extractData(msgLines[0]);
          try {
            // Try to parse as JSON
            const json = safeParseJson(data, patchNsMap[traceId]);
            batch.push({
              type: 'data',
              traceId,
              data: json,
            });
          } catch (parseErr) {
            // If JSON parsing fails, send raw data
            batch.push({
              type: 'data',
              traceId,
              data: data,
            });
          }
        }
      } catch (e) {
        batch.push({
          type: 'error',
          traceId,
          data: { message: 'Error processing message', error: e.toString() },
        });
      }
    }

    // Send all events from this chunk as a single batch message
    if (batch.length === 1) {
      // Single event — send directly for backwards compatibility
      self.postMessage(batch[0]);
    } else if (batch.length > 1) {
      // Multiple events — send as batch
      self.postMessage({
        type: 'batch',
        traceId,
        events: batch,
      });
    }
  } catch (error) {
    // Send error to main thread
    self.postMessage({
      type: 'error',
      traceId,
      data: { message: 'Stream processing error', error: error.toString() },
    });
  }
}
