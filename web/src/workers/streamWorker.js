// Worker to handle stream processing
// This offloads decoding and parsing from the main thread

let activeStreams = {};
let activeBuffers = {};
// Handle messages from main thread
self.onmessage = async (event) => {
  const { action, traceId, readableStream, chunk } = event.data;

  switch (action) {
    case 'startStream':
      // Convert transferable stream back to a reader
      const reader = readableStream.getReader();
      activeStreams[traceId] = reader;
      activeBuffers[traceId] = '';
      processStream(traceId, reader);
      break;

    case 'cancelStream':
      if (activeStreams[traceId]) {
        activeStreams[traceId].cancel();
        delete activeStreams[traceId];
        delete activeBuffers[traceId];
      }
      break;

    case 'closeAll':
      Object.keys(activeStreams).forEach(id => {
        if (activeStreams[id]) {
          activeStreams[id].cancel();
        }
      });
      activeStreams = {};
      activeBuffers = {};
      break;
  }
};

// Process the stream for a given traceId
async function processStream(traceId, reader) {
  const decoder = new TextDecoder();
  let buffer = activeBuffers[traceId] || '';

  try {
    while (activeStreams[traceId]) {
      const { done, value, cancelled } = await reader.read();

      if (done) {
        // Stream ended, send end notification
        self.postMessage({
          type: 'end',
          traceId,
        });
        
        delete activeStreams[traceId];
        delete activeBuffers[traceId];
        break;
      }
      
      // Decode chunk and add to buffer
      const chunk = decoder.decode(value, { stream: true });
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
              const data = msgLines[1]?.startsWith('data:') ? msgLines[1]?.slice(6) : msgLines[1]?.slice(5);

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
            const data = msgLines[0]?.startsWith('data:') ? msgLines[0]?.slice(6) : msgLines[0]?.slice(5);
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
    }
  } catch (error) {
    // Send error to main thread
    self.postMessage({
      type: 'error',
      traceId,
      data: { message: 'Stream processing error', error },
    });
    
    delete activeStreams[traceId];
    delete activeBuffers[traceId];
  }
} 