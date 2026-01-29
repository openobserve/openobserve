// Worker to handle stream processing
// This offloads decoding and parsing from the main thread
let activeBuffers = {};
// Track processed messages to prevent duplicate sends
let processedMessages = {};
// Track duplicate count to detect infinite streaming from backend
let duplicateCount = {};

// Helper function to extract data from message line
function extractData(line) {
  return line.startsWith('data:') ? line.slice(6) : line.slice(5);
}

// Generate hash for message deduplication
function generateMessageHash(eventType, data) {
  // For search_response_hits, check if data has hits array
  if (eventType === 'search_response_hits' && data.results && data.results.hits) {
    const hits = data.results.hits;
    if (hits.length > 0) {
      const firstHit = hits[0];
      // Create hash from timestamp and first few fields
      const timestamp = firstHit._timestamp || firstHit.timestamp || '';
      const keys = Object.keys(firstHit).slice(0, 3).join('_');
      return `${eventType}_${timestamp}_${keys}_${hits.length}`;
    }
  }

  // For other types, create basic hash
  const dataStr = typeof data === 'object' ? JSON.stringify(data).substring(0, 100) : String(data);
  return `${eventType}_${dataStr}`;
}

// Handle messages from main thread
self.onmessage = async (event) => {
  const { action, traceId, chunk } = event.data;

  switch (action) {
    case 'startStream':
      // For Safari compatibility, we receive chunks instead of streams
      activeBuffers[traceId] = '';
      processedMessages[traceId] = new Set();
      duplicateCount[traceId] = 0;
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
      delete processedMessages[traceId];
      delete duplicateCount[traceId];
      break;

    case 'cancelStream':
      delete activeBuffers[traceId];
      delete processedMessages[traceId];
      delete duplicateCount[traceId];
      break;

    case 'closeAll':
      activeBuffers = {};
      processedMessages = {};
      duplicateCount = {};
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
              const json = JSON.parse(data);

              // Check for duplicate messages
              const messageHash = generateMessageHash(eventType, json);
              if (processedMessages[traceId] && processedMessages[traceId].has(messageHash)) {
                // Duplicate message from server, skip it silently
                // Uncomment for debugging: console.warn('[Worker] Duplicate message from server, skipping:', eventType, messageHash.substring(0, 80));

                // Increment duplicate count
                duplicateCount[traceId] = (duplicateCount[traceId] || 0) + 1;

                // If we've received 50+ duplicates, backend is streaming infinitely
                // Signal main thread to abort the stream connection
                if (duplicateCount[traceId] >= 50) {
                  console.warn('[Worker] Backend sending excessive duplicates (' + duplicateCount[traceId] + '), requesting stream abort for:', traceId);
                  self.postMessage({
                    type: 'abort_stream',
                    traceId,
                    reason: 'excessive_duplicates'
                  });
                  duplicateCount[traceId] = 0; // Reset to avoid repeated abort messages
                }

                continue;
              }

              // Mark as processed and reset duplicate counter on new unique message
              if (processedMessages[traceId]) {
                processedMessages[traceId].add(messageHash);
                duplicateCount[traceId] = 0; // Reset on new message
              }

              // Send message based on event type
              self.postMessage({
                type: eventType,
                traceId,
                data: json,
              });
            } catch (parseErr) {
              // If JSON parsing fails, send raw data
              self.postMessage({
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
            const json = JSON.parse(data);
            // Send message based on event type
            self.postMessage({
              type: 'data',
              traceId,
              data: json,
            });
          } catch (parseErr) {
            // If JSON parsing fails, send raw data
            self.postMessage({
              type: 'data',
              traceId,
              data: data,
            });
          }
        }
      } catch (e) {
        self.postMessage({
          type: 'error',
          traceId,
          data: { message: 'Error processing message', error: e.toString() },
        });
      }
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