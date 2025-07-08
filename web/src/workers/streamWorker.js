// Worker to handle stream processing
// This offloads decoding and parsing from the main thread
let activeBuffers = {};

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
      break;

    case 'cancelStream':
      delete activeBuffers[traceId];
      break;

    case 'closeAll':
      activeBuffers = {};
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