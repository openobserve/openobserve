/**
 * Shared REST client for the /llm/models endpoints, used by the model-pricing
 * suites to seed and verify what the UI persists. Keeping the raw HTTP here —
 * and out of the specs — satisfies the Page Object Model rule that a spec only
 * describes the flow.
 */
const http = require('http');
const https = require('https');
const nodeFetch = require('node-fetch');
const { getAuthHeaders, getOrgIdentifier } = require('./cloud-auth.js');

// node-fetch v2 keep-alive pooling + gzip decompression is the root cause of
// "Premature close" / ECONNRESET flakiness in CI. Pick the agent by protocol so
// both local (http://localhost) and cloud/alpha (https://) URLs work — an
// http.Agent rejects https:// URLs.
const noKeepAliveHttpAgent = new http.Agent({ keepAlive: false });
const noKeepAliveHttpsAgent = new https.Agent({ keepAlive: false });
const selectAgent = (parsedURL) =>
    parsedURL.protocol === 'https:' ? noKeepAliveHttpsAgent : noKeepAliveHttpAgent;
const fetch = (url, opts = {}) => nodeFetch(url, { ...opts, compress: false, agent: selectAgent });

function apiBase() {
    return `${process.env.ZO_BASE_URL}/api/${getOrgIdentifier()}/llm/models`;
}

function apiHeaders() {
    return getAuthHeaders();
}

async function apiListModels() {
    try {
        const res = await fetch(apiBase(), { headers: apiHeaders() });
        if (!res.ok) return [];
        const data = await res.json();
        return data.list || data || [];
    } catch {
        return [];
    }
}

async function apiCreateModel(body) {
    const res = await fetch(apiBase(), {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return res.json();
}

async function apiDeleteModel(id) {
    try {
        const res = await fetch(`${apiBase()}/${id}`, {
            method: 'DELETE',
            headers: apiHeaders(),
        });
        return res.ok;
    } catch {
        return false;
    }
}

module.exports = { apiListModels, apiCreateModel, apiDeleteModel };
