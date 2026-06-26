import fs from 'fs';
import path from 'path';
import http from 'http';

// Cache cloud config to avoid re-reading on every call
let _cachedCloudConfig = null;

// node-fetch v2 keep-alive pooling + gzip decompression is the root cause of
// "Premature close" / ECONNRESET flakiness in CI. A fresh connection per
// request (keepAlive: false) + skipping the Gunzip stream (compress: false)
// eliminates both failure modes.
const noKeepAliveAgent = new http.Agent({ keepAlive: false });

export const getHeaders = () => {
  // On cloud, use email:passcode from cloud-config.json (written by global-setup-alpha1.js)
  if (process.env.IS_CLOUD === 'true') {
    try {
      if (!_cachedCloudConfig) {
        const configPath = path.join(process.cwd(), 'playwright-tests', 'utils', 'auth', 'cloud-config.json');
        _cachedCloudConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      }
      if (_cachedCloudConfig.passcode) {
        const basicAuth = Buffer.from(
          `${_cachedCloudConfig.userEmail}:${_cachedCloudConfig.passcode}`
        ).toString('base64');
        return {
          Authorization: `Basic ${basicAuth}`,
          "Content-Type": "application/json",
        };
      }
    } catch (e) {
      console.warn('[apiUtils] Failed to read cloud-config.json, falling back to password auth:', e.message);
    }
  }

  const basicAuthCredentials = Buffer.from(
    `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
  ).toString("base64");

  return {
    Authorization: `Basic ${basicAuthCredentials}`,
    "Content-Type": "application/json",
  };
};

export const getIngestionUrl = (orgId, streamName) => {
  return `${process.env.INGESTION_URL}/api/${orgId}/${streamName}/_json`;
};

export const sendRequest = async (page, url, payload, headers) => {
  // Use Node.js fetch instead of browser fetch to avoid CORS issues with deployed environments
  const fetch = (await import('node-fetch')).default;

  const response = await fetch(url, {
    method: "POST",
    headers: headers,
    body: JSON.stringify(payload),
    compress: false,
    agent: noKeepAliveAgent,
  });

  return await response.json();
}; 