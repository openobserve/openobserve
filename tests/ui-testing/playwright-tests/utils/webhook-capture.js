/**
 * Webhook capture server — lightweight HTTP receiver for E2E tests.
 *
 * Spins up a local HTTP server that captures incoming POST bodies so tests
 * can assert on outbound alert notification payloads (template rendering,
 * variable substitution, alert_url correctness) without depending on
 * external services like httpbin.org.
 *
 * Only works when the backend can reach localhost (e.g., CI or local dev).
 */
const http = require('http');

class WebhookCapture {
    constructor() {
        this.server = null;
        this.port = 0;
        this.payloads = [];
    }

    /**
     * Start the capture server on a free port.
     * @returns {Promise<number>} The port the server is listening on.
     */
    async start() {
        return new Promise((resolve, reject) => {
            this.payloads = [];
            this.server = http.createServer((req, res) => {
                let body = '';
                req.on('data', chunk => { body += chunk; });
                req.on('end', () => {
                    try {
                        this.payloads.push({
                            method: req.method,
                            url: req.url,
                            headers: req.headers,
                            body: JSON.parse(body || '{}'),
                            rawBody: body,
                            timestamp: Date.now(),
                        });
                    } catch {
                        this.payloads.push({
                            method: req.method,
                            url: req.url,
                            headers: req.headers,
                            rawBody: body,
                            timestamp: Date.now(),
                        });
                    }
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ received: true }));
                });
            });

            this.server.on('error', reject);
            this.server.listen(0, '127.0.0.1', () => {
                this.port = this.server.address().port;
                resolve(this.port);
            });
        });
    }

    /**
     * Stop the capture server.
     */
    async stop() {
        return new Promise((resolve) => {
            if (!this.server) return resolve();
            this.server.close(() => resolve());
            this.server = null;
        });
    }

    /**
     * Get all captured payloads.
     * @returns {Array} Array of captured request objects.
     */
    getPayloads() {
        return this.payloads;
    }

    /**
     * Get the most recent captured payload body.
     * @returns {Object|null}
     */
    getLatestPayload() {
        if (this.payloads.length === 0) return null;
        return this.payloads[this.payloads.length - 1];
    }

    /**
     * Clear all captured payloads (useful between test phases).
     */
    clear() {
        this.payloads = [];
    }
}

module.exports = { WebhookCapture };
