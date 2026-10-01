// Shared API fixtures for the IAM specs.
//
// `page.request` shares the browser context's cookies and takes an explicit auth
// header, so it works on cloud (OIDC) and self-hosted (Basic) alike — and, unlike
// a page-side fetch, needs no authenticated navigation first. That matters:
// beforeAll/afterAll run on a raw browser.newPage() which carries none of the
// custom fixture's helpers, so navigateToBase() must NOT be called there.

const { getAuthHeaders, getOrgIdentifier } = require('../utils/cloud-auth.js');

const PREFIX = 'ui_auto';

/**
 * Per-file namespace. EVERY spec must own one, and name every artifact under it.
 *
 * The sweeps below delete by prefix, and `fullyParallel: true` with workers: 5 races
 * spec FILES. While all eleven IAM specs shared `ui_auto`, each one's beforeAll
 * deleted every other one's fixtures mid-test — a user vanishing under a live session
 * answers 401, a vanished grant path answers 403, which is how this was finally
 * pinned down. The IAM shard works around it with workers: 1; the ENT crosscheck gate
 * interleaves these files among ~44 others, spreading the sweeps across a 13-minute
 * window so they land mid-test instead.
 *
 * Tokens are exactly three characters and mutually distinct, so no namespace can be a
 * prefix of another — `scp` vs `scl` was a live collision when scope owned
 * `ui_auto_sc_` and scale created `ui_auto_sc_s*`.
 */
const ns = (token) => {
    if (!/^[a-z]{3}$/.test(token)) {
        throw new Error(`namespace token must be three lowercase letters, got "${token}"`);
    }
    return `${PREFIX}_${token}`;
};

/** Guards a sweep against being handed nothing and deleting every spec's fixtures. */
const ownPrefix = (prefix, who) => {
    if (typeof prefix !== 'string' || !prefix.startsWith(`${PREFIX}_`) || prefix.length <= PREFIX.length + 1) {
        throw new Error(`${who} needs the caller's own namespace from ns(), got "${prefix}"`);
    }
    return prefix;
};
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

/**
 * A request made AS the user signed in to `page` — NOT as root.
 *
 * `req()` above attaches getAuthHeaders(), which on self-hosted is Basic auth for
 * ZO_ROOT_USER_EMAIL (set in CI). Root bypasses every permission check, so an
 * enforcement assertion sent that way proves nothing about the role under test.
 * The A-0x tests get away with it only because the browser context's session cookie
 * currently wins over that header — an undocumented precedence this suite must not
 * depend on. If it ever flipped, every "user X is denied" test would quietly start
 * passing as root: green, and worthless.
 *
 * So send NO Authorization header at all. Identity then comes solely from the
 * session cookie `page.request` inherits from loginAs(), which is the same thing the
 * ENT api-tests do (rbac/utils.py logs in via POST auth/login and carries the
 * session). Use this for every "can this user do X" assertion.
 */
const reqAs = async (page, method, path, data) => {
    const resp = await page.request.fetch(`${api()}/${org()}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(data ? { data } : {}),
    });
    return { status: resp.status(), body: await resp.json().catch(() => ({})) };
};

/** Did this request succeed? Anything >= 400 counts as denied. */
const allowed = (res) => res.status < 400;

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

/**
 * Clears every grant a role holds, so a test can assume a known starting count.
 *
 * Enforcement tests reuse a role because the role->user binding is set up once in
 * beforeAll. Without this, one test's grant is the next test's starting state and
 * waitForGrantsSettled(0) fails on a role that is not actually empty.
 */
const clearRolePerms = async (page, name) => {
    const held = await getPerms(page, name);
    if (!held.length) return;
    await req(page, 'PUT', `/roles/${name}`, {
        add: [], remove: held, add_users: [], remove_users: [],
    });
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

/**
 * Remembers exactly what a spec created, so teardown deletes THAT and nothing else.
 *
 * The sweeps below delete by PREFIX, which is the bug this replaces: every IAM spec's
 * beforeAll swept the shared `ui_auto` namespace, so one file's setup deleted another
 * file's roles and users mid-test — a vanished user answers 401, a vanished grant path
 * answers 403. Pattern-matching cannot tell "mine" from "yours"; a list can.
 *
 * Leftovers from a CRASHED earlier run are a real problem, but they belong to the one
 * global cleanup.spec.js pass, not to every spec's setup.
 *
 * Order matters on the way out: a group pins the roles it holds, and a folder pins the
 * dashboards inside it, so children go before parents.
 */
const makeTracker = () => {
    const roles = [], groups = [], users = [], folders = [];
    return {
        role: (n) => { if (n) roles.push(n); return n; },
        group: (n) => { if (n) groups.push(n); return n; },
        user: (e) => { if (e) users.push(e); return e; },
        folder: (id) => { if (id) folders.push(id); return id; },

        /** Deletes everything this spec made. Returns what went, for the teardown log. */
        async cleanup(page) {
            const gone = { groups: [], roles: [], users: [], folders: [] };
            for (const g of groups.splice(0)) {
                await req(page, 'DELETE', `/groups/${g}`).catch(() => {});
                gone.groups.push(g);
            }
            for (const r of roles.splice(0)) {
                await req(page, 'DELETE', `/roles/${r}`).catch(() => {});
                gone.roles.push(r);
            }
            for (const u of users.splice(0)) {
                await req(page, 'DELETE', `/users/${u}`).catch(() => {});
                gone.users.push(u);
            }
            for (const f of folders.splice(0)) {
                const listed = (await req(page, 'GET', `/dashboards?folder=${f}`)).body;
                for (const d of (listed?.dashboards ?? listed?.list ?? [])) {
                    const id = dashboardIdOf(d) ?? d?.id;
                    if (id) await req(page, 'DELETE', `/dashboards/${id}?folder=${f}`).catch(() => {});
                }
                await reqV2(page, 'DELETE', `/folders/dashboards/${f}`).catch(() => {});
                gone.folders.push(f);
            }
            return gone;
        },

        /** Which of this spec's artifacts survived teardown — asserted, not assumed. */
        async survivors(page) {
            const liveRoles = new Set(await listRoles(page));
            const liveUsers = new Set((await listUsers(page)).map((u) => u?.email));
            return [
                ...roles.filter((r) => liveRoles.has(r)),
                ...users.filter((u) => liveUsers.has(u)),
            ];
        },
    };
};

/**
 * Prefix sweeps — RECOVERY ONLY. Do NOT call these from a spec's beforeAll.
 *
 * That is what they used to be for, and it is the bug makeTracker() replaces: a sweep
 * cannot tell "mine" from "yours", so every spec's setup deleted every other spec's
 * fixtures mid-test. Teardown now deletes a recorded list instead.
 *
 * They are kept because a CRASHED run still orphans artifacts, and nothing else
 * collects them — cleanup.spec.js sweeps streams, dashboards, alerts and folders but
 * has no `ui_auto` roles/users pass. Wiring that in is the right home for this and is
 * left as a follow-up; until then these are the only way to clear a polluted org, and
 * are meant to be run deliberately, not on every spec start.
 */

/** Groups first: a role cannot be cleanly dropped while a group still holds it. */
const sweepRoles = async (page, prefix) => {
    const own = ownPrefix(prefix, 'sweepRoles');
    const removed = [];
    for (const g of await listGroups(page)) {
        if (typeof g === 'string' && g.startsWith(own)) await req(page, 'DELETE', `/groups/${g}`);
    }
    for (const r of await listRoles(page)) {
        if (typeof r === 'string' && r.startsWith(own)) {
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

    // Plain waits, deliberately. An attempt to be cleverer here — racing the form
    // against the app shell, to handle a context that lands already signed in — made
    // things markedly worse: Promise.race settles on whichever branch finishes FIRST,
    // including the shell branch failing fast, so it resolved before the form existed
    // and defeated the very wait it replaced. Six tests failed where one had been
    // intermittent. If the already-signed-in case needs handling, it needs an explicit
    // check, not a race.
    const userField = page.locator('[data-test="login-user-id-field"]');
    await userField.waitFor({ state: 'visible', timeout: 20000 });
    await userField.fill(email);
    await page.locator('[data-test="login-password-field"]').fill(password);
    // Wait for the button rather than clicking blind: on a shared env the submit button
    // can lag the fields beside it, which is how E-02 timed out on its second sign-in.
    const submit = page.locator('[data-test="login-sign-in"]');
    await submit.waitFor({ state: 'visible', timeout: 30000 });
    await submit.click();
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

const sweepUsers = async (page, prefix) => {
    const own = ownPrefix(prefix, 'sweepUsers');
    const removed = [];
    for (const u of await listUsers(page)) {
        if (typeof u?.email === 'string' && u.email.startsWith(own)) {
            await req(page, 'DELETE', `/users/${u.email}`);
            removed.push(u.email);
        }
    }
    return removed;
};

// ---------- dashboard folders, for the folder-scoped grant shapes ----------
//
// Folders are the only grant shape whose object carries two ids
// (`<type>:<folderId>/<itemId>`), so List-vs-All on a folder and a grant on one
// item inside it cannot be tested with flat resources.

// The v2 folder routes put the version BEFORE the org (`/api/v2/<org>/folders/...`),
// where req() builds `/api/<org>/...`. Going through req() produced a 404 on every
// folder call, so these build the URL themselves.
const v2 = (path) => `${process.env.ZO_BASE_URL.replace(/\/$/, '')}/api/v2/${org()}${path}`;

const reqV2 = async (page, method, path, data) => {
    const resp = await page.request.fetch(v2(path), {
        method,
        headers: getAuthHeaders(),
        ...(data ? { data } : {}),
    });
    return { status: resp.status(), body: await resp.json().catch(() => ({})) };
};

const listDashboardFolders = async (page) =>
    (await reqV2(page, 'GET', '/folders/dashboards')).body?.list ?? [];

/**
 * Returns the generated folderId — grants are keyed on it, never on the name.
 *
 * Idempotent on purpose. A retry re-runs beforeAll, and POST answers 400 for a name
 * that already exists, so a first-attempt folder that outlived its teardown would
 * fail every later attempt with 400 instead of the original error. On 400 the
 * existing folder is looked up and reused.
 */
const createDashboardFolder = async (page, name) => {
    const { status, body } = await reqV2(page, 'POST', '/folders/dashboards', {
        name, description: 'iam automation',
    });
    if (status < 400) return body.folderId;

    const existing = (await listDashboardFolders(page)).find((f) => f?.name === name);
    if (existing?.folderId) return existing.folderId;
    throw new Error(`create dashboard folder ${name}: ${status}`);
};

/** The dashboard id, read the way the app reads it. */
const dashboardIdOf = (body) =>
    body?.[`v${body?.version}`]?.dashboardId
    ?? body?.v5?.dashboardId ?? body?.v3?.dashboardId ?? body?.v1?.dashboardId
    ?? body?.dashboardId;

/**
 * Returns the generated dashboardId.
 *
 * The response is versioned — AddDashboard.vue reads
 * `res.data["v" + res.data.version]` — so the id is NOT at the top level. Guessing
 * v1/v2 returned undefined for a v3 body, which is what tripped the "create response
 * shape changed" guard. The payload mirrors AddDashboard's baseObj for the same
 * reason: a shape the backend does not recognise is not worth asserting against.
 */
const createDashboardIn = async (page, folderId, title) => {
    const resp = await page.request.post(
        `${api()}/${org()}/dashboards?folder=${folderId}`,
        {
            headers: getAuthHeaders(),
            data: {
                title,
                dashboardId: '',
                description: 'iam automation',
                variables: { list: [], showDynamicFilters: true },
                role: '',
                owner: 'iam-automation',
                created: new Date().toISOString(),
                tabs: [{ panels: [], name: 'Default', tabId: 'default' }],
                version: 3,
            },
        },
    );
    const body = await resp.json().catch(() => ({}));
    if (resp.status() >= 400) {
        throw new Error(`create dashboard ${title}: ${resp.status()} ${JSON.stringify(body).slice(0, 200)}`);
    }
    const id = dashboardIdOf(body);
    if (!id) throw new Error(`create dashboard ${title}: no id in ${JSON.stringify(body).slice(0, 300)}`);
    return id;
};

const sweepDashboardFolders = async (page, prefix) => {
    const own = ownPrefix(prefix, 'sweepDashboardFolders');
    const removed = [];
    for (const f of await listDashboardFolders(page)) {
        if (typeof f?.name === 'string' && f.name.startsWith(own)) {
            // Dashboards inside must go first, or the folder delete is refused — which
            // is how a leftover folder then 400s every retry.
            const listed = (await req(page, 'GET', `/dashboards?folder=${f.folderId}`)).body;
            const dashes = listed?.dashboards ?? listed?.list ?? [];
            for (const d of dashes) {
                const id = dashboardIdOf(d) ?? d?.id;
                if (id) await req(page, 'DELETE', `/dashboards/${id}?folder=${f.folderId}`).catch(() => {});
            }
            await reqV2(page, 'DELETE', `/folders/dashboards/${f.folderId}`).catch(() => {});
            removed.push(f.name);
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
    PREFIX, ns, uniq, org, api, req, reqAs, allowed,
    listRoles, listGroups, getGroup, listUsers, getPerms,
    createRole, setRolePerms, clearRolePerms, setGroup, createGroupApi, sweepRoles, makeTracker,
    createDashboardFolder, createDashboardIn, listDashboardFolders, sweepDashboardFolders,
    reqV2, dashboardIdOf,
};
