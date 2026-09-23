// Shared API fixtures for the IAM specs.
//
// `page.request` shares the browser context's cookies and takes an explicit auth
// header, so it works on cloud (OIDC) and self-hosted (Basic) alike — and, unlike
// a page-side fetch, needs no authenticated navigation first. That matters:
// beforeAll/afterAll run on a raw browser.newPage() which carries none of the
// custom fixture's helpers, so navigateToBase() must NOT be called there.

const { getAuthHeaders, getOrgIdentifier } = require('../utils/cloud-auth.js');

const PREFIX = 'ui_auto';
const uniq = () => `${Date.now()}x${Math.floor(Math.random() * 10000)}`;
const org = () => getOrgIdentifier();
const api = () => `${process.env.ZO_BASE_URL.replace(/\/$/, '')}/api`;

const req = async (page, method, path, data) => {
    const resp = await page.request.fetch(`${api()}/${org()}${path}`, {
        method,
        headers: getAuthHeaders(),
        ...(data ? { data } : {}),
    });
    return { status: resp.status(), body: await resp.json().catch(() => ({})) };
};

const listRoles = async (page) => (await req(page, 'GET', '/roles')).body || [];
const listGroups = async (page) => (await req(page, 'GET', '/groups')).body || [];
const getGroup = async (page, name) => (await req(page, 'GET', `/groups/${name}`)).body || {};
const listUsers = async (page) => (await req(page, 'GET', '/users')).body?.data ?? [];
const getPerms = async (page, role) => (await req(page, 'GET', `/roles/${role}/permissions`)).body || [];

// Role names are underscore-only on purpose: POST /roles normalizes anything
// outside [A-Za-z0-9_] to "_", while a later PUT does NOT normalize — so a
// hyphenated name would make teardown miss the row it created.
const createRole = async (page, name) => {
    const { status } = await req(page, 'POST', '/roles', { role: name });
    // 400 = already there, from an aborted earlier run or a retry.
    if (status >= 400 && status !== 400) throw new Error(`create role ${name}: ${status}`);
};

const setRolePerms = (page, name, add, remove = []) =>
    req(page, 'PUT', `/roles/${name}`, { add, remove, add_users: [], remove_users: [] });

const setGroup = (page, name, patch) =>
    req(page, 'PUT', `/groups/${name}`, {
        add_roles: [], remove_roles: [], add_users: [], remove_users: [], ...patch,
    });

const createGroupApi = async (page, name) => {
    const { status } = await req(page, 'POST', '/groups', { name, users: [], roles: [] });
    if (status >= 400 && status !== 400) throw new Error(`create group ${name}: ${status}`);
};

/** Groups first: a role cannot be cleanly dropped while a group still holds it. */
const sweepRoles = async (page) => {
    const removed = [];
    for (const g of await listGroups(page)) {
        if (typeof g === 'string' && g.startsWith(PREFIX)) await req(page, 'DELETE', `/groups/${g}`);
    }
    for (const r of await listRoles(page)) {
        if (typeof r === 'string' && r.startsWith(PREFIX)) {
            await req(page, 'DELETE', `/roles/${r}`);
            removed.push(r);
        }
    }
    return removed;
};

/**
 * Signs a NON-ROOT user in, in their own browser context.
 *
 * Root bypasses every permission check, so any test asserting that a role
 * *restricts* something is meaningless as root. Mirrors global-setup's flow:
 * OInput puts `data-test` on the wrapper and the real <input> is `<name>-field`.
 * Returns { context, page } — the caller closes the context.
 */
const loginAs = async (browser, email, password) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${process.env.ZO_BASE_URL}/web/?org_identifier=${org()}`);
    await page.waitForLoadState('domcontentloaded');

    const internal = page.locator('[data-test="login-as-internal-user"]');
    if (await internal.first().isVisible({ timeout: 5000 }).catch(() => false)) {
        await internal.first().click();
        await page.waitForLoadState('domcontentloaded');
    }
    await page.locator('[data-test="login-user-id-field"]').waitFor({ state: 'visible', timeout: 20000 });
    await page.locator('[data-test="login-user-id-field"]').fill(email);
    await page.locator('[data-test="login-password-field"]').fill(password);
    await page.locator('[data-test="login-sign-in"]').click();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2500);
    return { context, page };
};

const MEMBER_PASSWORD = 'Complexpass#123';

const createMember = async (page, email, role = 'admin') => {
    const { status } = await req(page, 'POST', '/users', {
        email, password: MEMBER_PASSWORD, first_name: 'IAM', last_name: 'Automation', role,
    });
    if (status >= 400 && status !== 400) throw new Error(`create member ${email}: ${status}`);
    return email;
};

const sweepUsers = async (page) => {
    const removed = [];
    for (const u of await listUsers(page)) {
        if (typeof u?.email === 'string' && u.email.startsWith(PREFIX)) {
            await req(page, 'DELETE', `/users/${u.email}`);
            removed.push(u.email);
        }
    }
    return removed;
};

/**
 * Is RBAC on for this build? Asked of the API, deliberately — NOT by waiting for a
 * tab to appear.
 *
 * A UI probe conflates "this build has no RBAC" with "the page was slow just now",
 * and since the answer gates `test.skip`, a slow render silently turns a real test
 * into a skip and the run still reports green. That cost us G-08 in a full run: it
 * skipped on a 10s tab timeout while passing in isolation. The API answer is
 * stable, so a tab that then fails to render is a genuine failure.
 */
const rbacEnabled = async (page) => {
    const { status } = await req(page, 'GET', '/roles');
    return status < 400;
};

module.exports = {
    loginAs, MEMBER_PASSWORD, createMember, sweepUsers, rbacEnabled,
    PREFIX, uniq, org, api, req,
    listRoles, listGroups, getGroup, listUsers, getPerms,
    createRole, setRolePerms, setGroup, createGroupApi, sweepRoles,
};
