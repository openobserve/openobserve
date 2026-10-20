// Shared reads of a Monaco query editor and its suggest menu, scoped to one editor host.
const { expect } = require('./enhanced-baseFixtures.js');

/** Hosts of the query editors these helpers drive. */
const EDITOR_HOSTS = {
    logs: '[data-test="logs-search-bar-query-editor"]',
    traces: '#traces-query-editor',
    dashboardPanel: '[data-test="dashboard-panel-query-editor"]',
};

/** The effective ZO_EDITOR_SUGGEST_MODE the browser received in zoConfig. */
async function getSuggestMode(page) {
    return await page.evaluate(() => {
        const app = document.querySelector('#app')?.__vue_app__;
        const raw = app?.config?.globalProperties?.$store?.state?.zoConfig?.editor_suggest_mode;
        const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
        return ['automatic', 'typing', 'off'].includes(value) ? value : 'automatic';
    });
}

/** Wait until the Monaco editor inside `host` exists. */
async function waitForEditor(page, host, timeout = 20000) {
    await page.waitForFunction((sel) => {
        const el = document.querySelector(sel);
        return !!el && (window.monaco?.editor?.getEditors?.() || []).some((e) => el.contains(e.getDomNode()));
    }, host, { timeout });
}

/** Put text in the editor without typing it, caret at the end, editor focused. */
async function seedEditor(page, host, text) {
    await waitForEditor(page, host);
    await page.evaluate(({ sel, value }) => {
        const el = document.querySelector(sel);
        const ed = window.monaco.editor.getEditors().find((e) => el.contains(e.getDomNode()));
        ed.focus();
        ed.setValue(value);
        const model = ed.getModel();
        const line = model.getLineCount();
        ed.setPosition({ lineNumber: line, column: model.getLineMaxColumn(line) });
        ed.trigger('e2e', 'hideSuggestWidget', {});
    }, { sel: host, value: text });
}

/** Focus the editor with its caret at the end of the text. */
async function focusEditorAtEnd(page, host) {
    await waitForEditor(page, host);
    await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        const ed = window.monaco.editor.getEditors().find((e) => el.contains(e.getDomNode()));
        ed.focus();
        const model = ed.getModel();
        const line = model.getLineCount();
        ed.setPosition({ lineNumber: line, column: model.getLineMaxColumn(line) });
    }, host);
}

/** The editor's model text (not the rendered view). */
async function editorText(page, host) {
    return await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        const ed = (window.monaco?.editor?.getEditors?.() || []).find((e) => el?.contains(e.getDomNode()));
        return ed?.getValue?.() ?? '';
    }, host).then((text) => text.replace(/\r\n/g, '\n'));
}

/** Visible suggest rows, group headers, and the highlighted row. */
async function menuState(page) {
    const widget = page.locator('.monaco-editor .suggest-widget.visible');
    if (!(await widget.isVisible().catch(() => false))) return { visible: false, rows: [], headers: [], focused: null };
    const all = await widget.locator('.monaco-list-row').evaluateAll((nodes) =>
        nodes
            .map((n) => ({
                index: Number(n.getAttribute('data-index')),
                label: (n.getAttribute('aria-label') || n.textContent || '').split(',')[0].trim(),
                focused: n.classList.contains('focused'),
                header: !!n.querySelector('.codicon-symbol-folder'),
            }))
            .sort((a, b) => a.index - b.index),
    );
    const rows = all.filter((r) => !r.header);
    return {
        visible: true,
        rows: rows.map((r) => r.label),
        headers: all.filter((r) => r.header).map((r) => r.label),
        focused: all.find((r) => r.focused)?.label ?? null,
    };
}

/** Wait until a suggest menu with rows is on screen; returns its state. */
async function waitForMenu(page, timeout = 8000) {
    await page.locator('.monaco-editor .suggest-widget.visible').waitFor({ state: 'visible', timeout });
    await expect.poll(async () => (await menuState(page)).rows.length, { timeout: 3000 }).toBeGreaterThan(0);
    return await menuState(page);
}

/** Wait until the open menu shows a row matching `pattern`; returns the state, or null on timeout. */
async function waitForMenuRow(page, pattern, timeout = 10000) {
    let state = null;
    try {
        await expect.poll(async () => {
            state = await menuState(page);
            return state.rows.some((r) => pattern.test(r));
        }, { timeout, intervals: [200, 400, 800] }).toBe(true);
    } catch (_) {
        return null;
    }
    return state;
}

/** Type an unmatched value after `prefix`, wait until no menu row is highlighted, then press Enter. */
async function enterAfterUnmatchedValue(page, host, prefix, value = 'zzqx') {
    await seedEditor(page, host, prefix);
    await page.keyboard.type(`'${value}`, { delay: 60 });
    await expect.poll(async () => (await menuState(page)).focused, { timeout: 5000 }).toBeNull();
    await page.keyboard.press('Enter');
}

/** Open the Traces page straight on a stream, as a fresh page load, and wait for its editor. */
async function openTracesStream(page, orgName, stream = 'default') {
    const baseUrl = (process.env['ZO_BASE_URL'] || '').replace(/\/+$/, '');
    await page.goto(`${baseUrl}/web/traces?org_identifier=${orgName}&stream=${encodeURIComponent(stream)}`);
    await waitForEditor(page, EDITOR_HOSTS.traces);
}

/** Open Add panel on the current dashboard in custom SQL mode, with an empty editor; returns the suggest mode. */
async function openDashboardCustomSql(page, pm) {
    await pm.dashboardCreate.addPanel();
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await pm.dashboardSqlAutocomplete.switchToSqlCustomQueryMode();
    await seedEditor(page, EDITOR_HOSTS.dashboardPanel, '');
    return await getSuggestMode(page);
}

module.exports = {
    EDITOR_HOSTS,
    enterAfterUnmatchedValue,
    openTracesStream,
    openDashboardCustomSql,
    getSuggestMode,
    waitForEditor,
    seedEditor,
    focusEditorAtEnd,
    editorText,
    menuState,
    waitForMenu,
    waitForMenuRow,
};
