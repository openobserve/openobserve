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
      const { done, value } = await reader.read();
      
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
      for (const line of lines) {
        try {
          let processedLine = line;
          
          // Handle SSE format
          if (processedLine.startsWith('data: ')) {
            processedLine = processedLine.slice(6);
          }
          
          // Parse JSON
          const json = JSON.parse(processedLine);
          
          // Handle different response types
          if (json.code > 200) {
            // Send error to main thread
            self.postMessage({
              type: 'error',
              traceId,
              data: json,
            });
          } else if (json.Progress) {
            // Send progress to main thread
            self.postMessage({
              type: 'progress',
              traceId,
              data: json,
            });
          } else {
            // Send search response to main thread
            self.postMessage({
              type: 'data',
              traceId,
              data: json,
            });
          }
        } catch (e) {
          // If parsing failed, check if it's SSE
          if (line.startsWith('data: ')) {
            try {
              const data = line.slice(6);
              self.postMessage({
                type: 'data',
                traceId,
                data: data,
              });
            } catch (err) {
              self.postMessage({
                type: 'error',
                traceId,
                data: { message: 'Error parsing SSE message', error: err },
              });
            }
          } else {
            self.postMessage({
              type: 'error',
              traceId,
              data: { message: 'Error parsing message', error: e },
            });
          }
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