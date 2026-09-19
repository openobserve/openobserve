// API seeding for the workflow-folders specs.
//
// The folder assertions are about listing, scoping and moving — not about building a graph
// on the canvas — so every fixture is created through the REST API. That keeps the spec fast
// and, more importantly, keeps it off the canvas paths that need a live destination (which
// the SSRF guard refuses to create on *.common-dev envs).
//
// `page.request` shares the browser context's cookies, so this works on cloud (OIDC session)
// and self-hosted (Basic auth header) alike.

const { getAuthHeaders, getOrgIdentifier } = require('../../playwright-tests/utils/cloud-auth.js');

const api = () => `${process.env.ZO_BASE_URL}/api`;
const SINK_URL = 'http://example.com/sink';

// Maps the trigger registry's per-node kind to the top-level backend enum value.
const TRIGGER_TYPE_BY_KIND = {
  alert_fired: 'AlertFired',
  incident_event: 'IncidentEvent',
};

async function jsonOrThrow(resp, what) {
  if (!resp.ok()) {
    throw new Error(`${what} failed: ${resp.status()} ${(await resp.text()).slice(0, 300)}`);
  }
  return await resp.json();
}

async function createFolder(page, name, description = 'workflow folder automation') {
  const resp = await page.request.post(`${api()}/v2/${getOrgIdentifier()}/folders/workflows`, {
    headers: getAuthHeaders(),
    data: { name, description },
  });
  const body = await jsonOrThrow(resp, `create folder "${name}"`);
  return body.folderId;
}

async function deleteFolder(page, folderId) {
  return await page.request.delete(
    `${api()}/v2/${getOrgIdentifier()}/folders/workflows/${folderId}`,
    { headers: getAuthHeaders() }
  );
}

async function createPipelineDestination(page, name) {
  const resp = await page.request.post(
    `${api()}/${getOrgIdentifier()}/alerts/destinations?module=pipeline`,
    {
      headers: getAuthHeaders(),
      // NOT loopback: the SSRF guard rejects private/localhost URLs at destination-save
      // time. example.com is IANA-reserved and never contacted — no spec fires the workflow.
      data: { name, url: SINK_URL, method: 'post', type: 'http' },
    }
  );
  await jsonOrThrow(resp, `create pipeline destination "${name}"`);
  return name;
}

async function deleteDestination(page, name) {
  return await page.request.delete(
    `${api()}/${getOrgIdentifier()}/alerts/destinations/${name}`,
    { headers: getAuthHeaders() }
  );
}

function workflowPayload(
  name,
  destName,
  description = 'folder automation workflow',
  triggerKind = 'alert_fired',
) {
  const triggerType = TRIGGER_TYPE_BY_KIND[triggerKind];
  if (!triggerType) {
    throw new Error(`workflowPayload: unmapped triggerKind "${triggerKind}"`);
  }
  return {
    workflow: {
      id: '',
      org_id: '',
      created_at: 0,
      updated_at: 0,
      created_by: '',
      name,
      description,
      enabled: true,
      nodes: [
        {
          id: 'trigger-1',
          data: { node_type: 'workflow_trigger' },
          // NodeData::WorkflowTrigger is a backend unit variant, so the kind
          // survives only in meta (strings) — the same field the editor serializes.
          meta: { trigger_kind: triggerKind },
          position: { x: 100, y: 100 },
          io_type: 'input',
        },
        {
          id: 'dest-1',
          data: { node_type: 'destination', destination_id: destName, template_override: null },
          position: { x: 400, y: 100 },
          io_type: 'output',
        },
      ],
      edges: [{ id: 'etrigger-1-dest-1', source: 'trigger-1', target: 'dest-1' }],
    },
    trigger_type: triggerType,
  };
}

// The backend lowercases and trims the name on save, so the caller's name is not
// necessarily the one the row (and therefore the row's data-test) carries.
async function createWorkflow(
  page,
  { name, destName, folderId, draft = false, triggerKind = 'alert_fired' },
) {
  const params = new URLSearchParams();
  if (folderId) params.set('folder', folderId);
  if (draft) params.set('draft', 'true');
  const qs = params.toString() ? `?${params}` : '';
  const resp = await page.request.post(`${api()}/${getOrgIdentifier()}/workflows${qs}`, {
    headers: getAuthHeaders(),
    data: workflowPayload(name, destName, 'folder automation workflow', triggerKind),
  });
  const body = await jsonOrThrow(resp, `create workflow "${name}"`);
  return { id: body.id, name: name.trim().toLowerCase() };
}

async function deleteWorkflow(page, workflowId) {
  return await page.request.delete(
    `${api()}/${getOrgIdentifier()}/workflows/${workflowId}`,
    { headers: getAuthHeaders() }
  );
}

async function listWorkflows(page, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const resp = await page.request.get(
    `${api()}/${getOrgIdentifier()}/workflows${qs ? `?${qs}` : ''}`,
    { headers: getAuthHeaders() }
  );
  const body = await jsonOrThrow(resp, 'list workflows');
  return Array.isArray(body) ? body : (body.list ?? body.data ?? []);
}

// Empty a folder before deleting it — a folder holding a workflow OR a draft refuses
// to delete, so a failed test would otherwise leak the folder permanently.
async function purgeFolder(page, folderId) {
  for (const row of await listWorkflows(page, { folder: folderId })) {
    await deleteWorkflow(page, row.id);
  }
  await deleteFolder(page, folderId);
}

module.exports = {
  createFolder,
  deleteFolder,
  purgeFolder,
  createPipelineDestination,
  deleteDestination,
  createWorkflow,
  deleteWorkflow,
  listWorkflows,
};
