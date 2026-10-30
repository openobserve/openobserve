// REST client for /llm/models so the model-pricing specs keep raw HTTP out of the spec (POM rule).
const http = require('http');
const https = require('https');
const nodeFetch = require('node-fetch');
const { getAuthHeaders, getOrgIdentifier } = require('./cloud-auth.js');

// No keep-alive/gzip (node-fetch v2 "Premature close" flake); the agent follows the protocol because http.Agent rejects https.
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

/** Lists models; returns [] on any failure. */
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

/** Creates a model from `{ name, match_pattern, enabled, tiers: [{ name, condition, prices, rules?: [{ keys, op, values }] }] }`; returns null when the API rejects it. */
async function apiCreateModel(body) {
    const res = await fetch(apiBase(), {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return res.json();
}

/** Deletes a model by id; returns false on any failure. */
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
