// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// Org Secrets & Variables store: API seeding, cleanup, non-root sign-in and light/dark captures.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { request, expect } = require('@playwright/test');
const testLogger = require('./test-logger.js');

const ORG = process.env.ORGNAME || 'default';
const E2E_PREFIX = 'u61';
const MEMBER_PASSWORD = 'U61-Member#2026pass';

function baseUrl() {
  return (process.env.ZO_BASE_URL || '').replace(/\/+$/, '');
}

function basicAuth(email, password) {
  return `Basic ${Buffer.from(`${email}:${password}`).toString('base64')}`;
}

function uid() {
  return crypto.randomBytes(3).toString('hex');
}

function secretName(kind) {
  return `${E2E_PREFIX}_${kind}_${uid()}`.toUpperCase();
}

function plainName(kind) {
  return `${E2E_PREFIX}_${kind}_${uid()}`;
}

// Random per run so no value lives in the repo and a leak check cannot match by chance.
function canaryValue() {
  return `U61CANARY-${crypto.randomBytes(8).toString('hex')}`;
}

async function apiAs(email, password) {
  return request.newContext({
    baseURL: baseUrl(),
    extraHTTPHeaders: { Authorization: basicAuth(email, password) },
  });
}

async function rootApi() {
  return apiAs(process.env.ZO_ROOT_USER_EMAIL, process.env.ZO_ROOT_USER_PASSWORD);
}

async function call(ctx, method, route, data, params) {
  const res = await ctx.fetch(`/api/${ORG}${route}`, { method, data, params });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  testLogger.apiCall(method, route, res.status(), 0);
  return { status: res.status(), body };
}

async function mustCall(ctx, method, route, data, params) {
  const out = await call(ctx, method, route, data, params);
  if (out.status >= 300) {
    throw new Error(`${method} ${route} -> ${out.status} ${JSON.stringify(out.body)}`);
  }
  return out.body;
}

async function createSecret(ctx, { name, kind = 'secret', value, types, hosts, description = 'u61 e2e' }) {
  const body = {
    name,
    kind,
    description,
    value,
    allowed_consumers: types.map((type) => ({ type })),
  };
  if (hosts) body.allowed_hosts = hosts;
  return (await mustCall(ctx, 'POST', '/secrets', body)).id;
}

async function getSecret(ctx, id) {
  return call(ctx, 'GET', `/secrets/${id}`);
}

async function listSecretsNamed(ctx, name) {
  const { body } = await call(ctx, 'GET', '/secrets');
  return (body?.items ?? []).filter((s) => s.name === name);
}

async function putGrants(ctx, id, grants) {
  return mustCall(ctx, 'PUT', `/secrets/${id}/grants`, {
    see: [],
    use: [],
    manage: [],
    manage_access: [],
    ...grants,
  });
}

// Soft delete first, because purge refuses a live secret with 409 secret_not_deleted.
async function destroySecret(ctx, id) {
  if (!id) return;
  await call(ctx, 'DELETE', `/secrets/${id}`, undefined, { force: true });
  await call(ctx, 'POST', `/secrets/${id}/purge`, {});
}

async function createRole(ctx, role, users) {
  await mustCall(ctx, 'POST', '/roles', { role });
  await mustCall(ctx, 'PUT', `/roles/${role}`, { add: [], remove: [], add_users: users, remove_users: [] });
}

async function deleteRole(ctx, role) {
  if (role) await call(ctx, 'DELETE', `/roles/${role}`);
}

async function createMember(ctx, email, role = 'editor') {
  await mustCall(ctx, 'POST', '/users', {
    email,
    password: MEMBER_PASSWORD,
    first_name: 'U61',
    last_name: 'Editor',
    role,
  });
  return { email, password: MEMBER_PASSWORD };
}

async function deleteMember(ctx, email) {
  if (email) await call(ctx, 'DELETE', `/users/${email}`);
}

async function createDestination(ctx, body) {
  return mustCall(ctx, 'POST', '/alerts/destinations', {
    method: 'post',
    template: 'prebuilt_default',
    type: 'http',
    ...body,
  });
}

async function getDestination(ctx, name) {
  return call(ctx, 'GET', `/alerts/destinations/${name}`);
}

async function deleteDestination(ctx, name) {
  if (name) await call(ctx, 'DELETE', `/alerts/destinations/${name}`);
}

async function deleteCheck(ctx, id) {
  if (id) await call(ctx, 'DELETE', `/synthetics/${id}`);
}

async function deleteToolset(ctx, id) {
  if (id) await call(ctx, 'DELETE', `/ai/toolsets/${id}`);
}

async function deleteLocation(ctx, id) {
  if (id) await call(ctx, 'DELETE', `/synthetics/locations/${id}`);
}

// Signs a non-root user in, in their own browser context; the caller closes it.
async function loginAs(browser, { email, password }) {
  const context = await browser.newContext({ viewport: { width: 1500, height: 1024 } });
  const page = await context.newPage();
  await page.goto(`${baseUrl()}/web/?org_identifier=${ORG}`);
  const internal = page.locator('[data-test="login-as-internal-user"]');
  const userField = page.locator('[data-test="login-user-id-field"]');
  await expect(internal.or(userField).first()).toBeVisible({ timeout: 30000 });
  if (await internal.isVisible()) await internal.click();
  await expect(userField).toBeVisible({ timeout: 20000 });
  await userField.fill(email);
  await page.locator('[data-test="login-password-field"]').fill(password);
  await page.locator('[data-test="login-sign-in"]').click();
  await expect(page.locator('[data-test="navbar-main-nav"]')).toBeVisible({ timeout: 30000 });
  return { context, page };
}

async function applyTheme(page, theme) {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.evaluate((t) => {
    try {
      localStorage.setItem('theme', t);
    } catch {
      // Storage can be blocked; the store dispatch below still switches the theme.
    }
    document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('appTheme', t);
  }, theme);
  const html = page.locator('html');
  if (theme === 'dark') await expect(html).toHaveClass(/(^|\s)dark(\s|$)/);
  else await expect(html).not.toHaveClass(/(^|\s)dark(\s|$)/);
  await expect(html).not.toHaveClass(/theme-switching/);
}

// Captures the current screen in light and dark, attaches both and copies them to SECRETS_SHOT_DIR.
async function shootThemes(page, testInfo, name) {
  const dir = process.env.SECRETS_SHOT_DIR;
  for (const theme of ['light', 'dark']) {
    await applyTheme(page, theme);
    const file = testInfo.outputPath(`${name}-${theme}.png`);
    await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
    await testInfo.attach(`${name}-${theme}`, { path: file, contentType: 'image/png' });
    if (dir) {
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(file, path.join(dir, `${name}-${theme}.png`));
    }
  }
  await applyTheme(page, 'light');
}

async function expectNoValueInDom(page, value) {
  expect(await page.content()).not.toContain(value);
}

module.exports = {
  ORG,
  uid,
  secretName,
  plainName,
  canaryValue,
  apiAs,
  rootApi,
  call,
  mustCall,
  createSecret,
  getSecret,
  listSecretsNamed,
  putGrants,
  destroySecret,
  createRole,
  deleteRole,
  createMember,
  deleteMember,
  createDestination,
  getDestination,
  deleteDestination,
  deleteCheck,
  deleteToolset,
  deleteLocation,
  loginAs,
  applyTheme,
  shootThemes,
  expectNoValueInDom,
};
