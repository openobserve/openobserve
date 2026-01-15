# OpenObserve RUM Data Ingestion Test Scripts

This directory contains test scripts for ingesting RUM (Real User Monitoring) and logs data into OpenObserve.

## Files

1. **rum-test.html** - Browser-based interactive test page
2. **rum-node-test.js** - Node.js script for automated testing
3. **RUM_TEST_README.md** - This documentation file

## Prerequisites

### For Browser Testing (rum-test.html)

No installation required! The HTML file loads the OpenObserve SDKs directly from CDN.

### For Node.js Testing (rum-node-test.js)

- Node.js (v14 or higher)

## Configuration

Before running the tests, update the configuration in both files with your OpenObserve instance details:

```javascript
const config = {
    clientToken: 'YOUR_CLIENT_TOKEN',
    applicationId: 'YOUR_APPLICATION_ID',
    site: 'YOUR_OPENOBSERVE_SITE',
    service: 'YOUR_SERVICE_NAME',
    env: 'production',
    version: '0.0.1',
    organizationIdentifier: 'YOUR_ORG',
    insecureHTTP: false,
    apiVersion: 'v1',
};
```

## Usage

### Browser Testing

1. Update the configuration in [rum-test.html](rum-test.html)
2. Open the file in a web browser:
   ```bash
   open rum-test.html
   # or
   firefox rum-test.html
   # or
   chrome rum-test.html
   ```
3. Use the interactive buttons to:
   - Track user interactions
   - Send logs at different levels
   - Generate custom actions
   - Update user context
   - Simulate API calls and long tasks

### Node.js Testing

1. Update the configuration in [rum-node-test.js](rum-node-test.js)
2. Run the script:
   ```bash
   node rum-node-test.js
   ```

The script will automatically:
- Create a session
- Send view data
- Track multiple actions
- Report resources
- Log errors
- Send various log levels

## What Gets Tested

### RUM Data Types

1. **Sessions** - User session tracking
2. **Views** - Page view events
3. **Actions** - User interactions (clicks, navigation, custom actions)
4. **Resources** - Network requests (API calls, asset loading)
5. **Errors** - JavaScript errors and exceptions
6. **Long Tasks** - Performance monitoring for slow operations

### Log Levels

1. **Debug** - Detailed debugging information
2. **Info** - Informational messages
3. **Warn** - Warning messages
4. **Error** - Error messages with stack traces

## Features of the Browser Test Page

- 🎯 **User Interaction Tracking** - Track button clicks, navigation, and custom actions
- 📊 **Resource Monitoring** - Automatic tracking of API calls and resource loading
- 🐛 **Error Tracking** - Capture and report JavaScript errors
- 📝 **Custom Logging** - Send logs with custom messages and context
- 👤 **User Context** - Set and update user information
- 🎬 **Session Replay** - Record user sessions for playback
- 📈 **Performance Monitoring** - Track long tasks and page load times
- 🌐 **Global Context** - Add custom context data to all events

## Verifying Data Ingestion

After running the tests, verify data in your OpenObserve instance:

1. Log in to your OpenObserve dashboard
2. Navigate to the RUM section
3. Check for:
   - Sessions from `my-web-application` service
   - View events
   - User actions
   - Resource timings
   - Error reports
4. Navigate to the Logs section
5. Filter by service: `my-web-application`
6. Verify log entries at different levels

## Troubleshooting

### Data Not Appearing

1. **Check Configuration**
   - Verify `clientToken` is correct
   - Ensure `site` URL is accessible
   - Confirm `organizationIdentifier` matches your OpenObserve org

2. **Network Issues**
   - Check browser/node console for errors
   - Verify firewall isn't blocking requests
   - Ensure DNS resolution works for your site

3. **CORS Issues** (Browser only)
   - Ensure OpenObserve CORS settings allow your origin
   - Check browser console for CORS errors

### Browser Console Debugging

Open browser DevTools (F12) and check:
- Console for SDK initialization messages
- Network tab for outgoing requests to OpenObserve
- Any error messages or failed requests

### Node.js Debugging

The script includes detailed console output:
- ✓ Success indicators
- ✗ Error messages with details
- Summary of sent data

## NPM Package Installation (Alternative)

If you want to create your own application using npm packages:

```bash
npm install @openobserve/browser-rum @openobserve/browser-logs
```

Then import and initialize in your application:

```javascript
import { openobserveRum } from '@openobserve/browser-rum';
import { openobserveLogs } from '@openobserve/browser-logs';

// Initialize as shown in the configuration section
```

## Advanced Configuration

### Session Replay

Session replay is enabled by default in the test page:

```javascript
openobserveRum.startSessionReplayRecording();
```

To configure replay settings:

```javascript
openobserveRum.init({
    // ... other options
    sessionReplaySampleRate: 100, // Record 100% of sessions
    defaultPrivacyLevel: 'mask-user-input', // Mask sensitive inputs
});
```

### Privacy Levels

- `allow` - Record everything
- `mask-user-input` - Mask user input fields
- `mask` - Mask all text content

### Sampling

Control what percentage of sessions to track:

```javascript
openobserveRum.init({
    // ... other options
    sessionSampleRate: 100, // Track 100% of sessions
    sessionReplaySampleRate: 20, // Record 20% of sessions
});
```

## Support

For issues or questions:
- Check OpenObserve documentation
- Review browser console for error messages
- Verify network connectivity to OpenObserve instance

## License

These test scripts are provided as examples for testing OpenObserve RUM functionality.
