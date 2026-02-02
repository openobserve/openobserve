export const getHeaders = () => {
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
  });

  return await response.json();
}; 