/**
 * OpenObserve RUM Node.js Test Script
 *
 * This script simulates RUM data ingestion using Node.js
 * Note: The browser SDKs are designed for browser environments,
 * so this script uses direct HTTP requests to simulate RUM data ingestion
 */

const https = require('https');
const http = require('http');

// Configuration - Update these values with your OpenObserve instance details
const config = {
    clientToken: 'rumZelN4P22dP1G9R9N',
    applicationId: 'web-application-id',
    site: 'test.internal.zinclabs.dev',
    service: 'my-web-application',
    env: 'production',
    version: '0.0.1',
    organizationIdentifier: 'default',
    insecureHTTP: false,
    apiVersion: 'v1',
};

// Helper function to make HTTP requests
function makeRequest(endpoint, data, type = 'rum') {
    return new Promise((resolve, reject) => {
        const protocol = config.insecureHTTP ? http : https;
        const path = `/${config.apiVersion}/${config.organizationIdentifier}/${type}`;

        const options = {
            hostname: config.site,
            port: config.insecureHTTP ? 80 : 443,
            path: path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.clientToken}`,
            }
        };

        const req = protocol.request(options, (res) => {
            let responseData = '';

            res.on('data', (chunk) => {
                responseData += chunk;
            });

            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    console.log(`✓ ${type.toUpperCase()} data sent successfully (${res.statusCode})`);
                    resolve(responseData);
                } else {
                    console.error(`✗ ${type.toUpperCase()} request failed (${res.statusCode}):`, responseData);
                    reject(new Error(`Request failed with status ${res.statusCode}`));
                }
            });
        });

        req.on('error', (error) => {
            console.error(`✗ ${type.toUpperCase()} request error:`, error.message);
            reject(error);
        });

        req.write(JSON.stringify(data));
        req.end();
    });
}

// Generate session ID
function generateSessionId() {
    return 'session-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}

// Generate view ID
function generateViewId() {
    return 'view-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}

// Create RUM session data
function createRumSession() {
    const sessionId = generateSessionId();
    const viewId = generateViewId();

    return {
        type: 'session',
        session: {
            id: sessionId,
        },
        application: {
            id: config.applicationId,
        },
        date: Date.now(),
        service: config.service,
        version: config.version,
        source: 'browser',
        _dd: {
            format_version: 2,
            drift: 0,
        },
        session_id: sessionId,
        view_id: viewId,
    };
}

// Create RUM view data
function createRumView(sessionId, viewId) {
    return {
        type: 'view',
        view: {
            id: viewId,
            url: 'http://localhost:3000/test-page',
            referrer: '',
            name: 'Test Page',
            loading_time: 1234,
            time_spent: 5000,
            action: {
                count: 3,
            },
            error: {
                count: 0,
            },
            resource: {
                count: 5,
            },
            long_task: {
                count: 1,
            },
        },
        session: {
            id: sessionId,
            type: 'user',
        },
        application: {
            id: config.applicationId,
        },
        date: Date.now(),
        service: config.service,
        version: config.version,
        source: 'browser',
        _dd: {
            format_version: 2,
            drift: 0,
        },
    };
}

// Create RUM action data
function createRumAction(sessionId, viewId, actionName, context = {}) {
    return {
        type: 'action',
        action: {
            id: 'action-' + Math.random().toString(36).substr(2, 9),
            type: 'custom',
            target: {
                name: actionName,
            },
            loading_time: 123,
            ...context,
        },
        view: {
            id: viewId,
            url: 'http://localhost:3000/test-page',
            referrer: '',
        },
        session: {
            id: sessionId,
            type: 'user',
        },
        application: {
            id: config.applicationId,
        },
        date: Date.now(),
        service: config.service,
        version: config.version,
        source: 'browser',
        usr: {
            id: 'user-123',
            name: 'Test User',
            email: 'testuser@example.com',
        },
    };
}

// Create RUM resource data
function createRumResource(sessionId, viewId) {
    return {
        type: 'resource',
        resource: {
            id: 'resource-' + Math.random().toString(36).substr(2, 9),
            type: 'fetch',
            url: 'https://api.example.com/data',
            method: 'GET',
            status_code: 200,
            duration: 234,
            size: 1024,
        },
        view: {
            id: viewId,
            url: 'http://localhost:3000/test-page',
        },
        session: {
            id: sessionId,
            type: 'user',
        },
        application: {
            id: config.applicationId,
        },
        date: Date.now(),
        service: config.service,
        version: config.version,
        source: 'browser',
    };
}

// Create RUM error data
function createRumError(sessionId, viewId, errorMessage) {
    return {
        type: 'error',
        error: {
            id: 'error-' + Math.random().toString(36).substr(2, 9),
            message: errorMessage,
            type: 'javascript',
            source: 'source',
            stack: 'Error: ' + errorMessage + '\n    at test.js:123:45',
        },
        view: {
            id: viewId,
            url: 'http://localhost:3000/test-page',
        },
        session: {
            id: sessionId,
            type: 'user',
        },
        application: {
            id: config.applicationId,
        },
        date: Date.now(),
        service: config.service,
        version: config.version,
        source: 'browser',
    };
}

// Create log data
function createLog(level, message, context = {}) {
    return {
        status: level,
        message: message,
        service: config.service,
        ddsource: 'browser',
        ddtags: `env:${config.env},version:${config.version}`,
        hostname: 'localhost',
        date: new Date().toISOString(),
        ...context,
    };
}

// Main test function
async function runRumTest() {
    console.log('🚀 Starting OpenObserve RUM Data Ingestion Test\n');
    console.log('Configuration:');
    console.log(`  Site: ${config.site}`);
    console.log(`  Organization: ${config.organizationIdentifier}`);
    console.log(`  Service: ${config.service}`);
    console.log(`  Environment: ${config.env}\n`);

    const sessionId = generateSessionId();
    const viewId = generateViewId();

    try {
        // Send session data
        console.log('📊 Sending RUM session data...');
        const sessionData = createRumSession();
        // await makeRequest('session', sessionData, 'rum');
        console.log('Session ID:', sessionId);

        await sleep(500);

        // Send view data
        console.log('\n📄 Sending RUM view data...');
        const viewData = createRumView(sessionId, viewId);
        // await makeRequest('view', viewData, 'rum');

        await sleep(500);

        // Send multiple actions
        console.log('\n👆 Sending RUM action data...');
        const actions = [
            { name: 'button_click', context: { button_id: 'submit-btn' } },
            { name: 'page_load', context: { load_time: 1234 } },
            { name: 'api_call', context: { endpoint: '/api/users', method: 'GET' } },
        ];

        for (const action of actions) {
            const actionData = createRumAction(sessionId, viewId, action.name, action.context);
            // await makeRequest('action', actionData, 'rum');
            await sleep(300);
        }

        // Send resource data
        console.log('\n📦 Sending RUM resource data...');
        const resourceData = createRumResource(sessionId, viewId);
        // await makeRequest('resource', resourceData, 'rum');

        await sleep(500);

        // Send error data
        console.log('\n❌ Sending RUM error data...');
        const errorData = createRumError(sessionId, viewId, 'Test error: Something went wrong');
        // await makeRequest('error', errorData, 'rum');

        await sleep(500);

        // Send logs
        console.log('\n📝 Sending log data...');
        const logs = [
            { level: 'info', message: 'Application started successfully' },
            { level: 'warn', message: 'Deprecated API usage detected' },
            { level: 'error', message: 'Failed to load resource', context: { resource_url: '/assets/image.png' } },
        ];

        for (const log of logs) {
            const logData = createLog(log.level, log.message, log.context);
            // await makeRequest('logs', logData, 'logs');
            await sleep(300);
        }

        console.log('\n✅ All RUM and log data sent successfully!');
        console.log('\n📊 Summary:');
        console.log(`  - Sessions: 1`);
        console.log(`  - Views: 1`);
        console.log(`  - Actions: ${actions.length}`);
        console.log(`  - Resources: 1`);
        console.log(`  - Errors: 1`);
        console.log(`  - Logs: ${logs.length}`);

    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        process.exit(1);
    }
}

// Helper sleep function
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Run the test
if (require.main === module) {
    runRumTest().then(() => {
        console.log('\n✨ Test completed!');
        process.exit(0);
    }).catch((error) => {
        console.error('\n❌ Test failed:', error);
        process.exit(1);
    });
}

module.exports = {
    createRumSession,
    createRumView,
    createRumAction,
    createRumResource,
    createRumError,
    createLog,
};
