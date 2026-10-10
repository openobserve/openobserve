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

const crypto = require("crypto");
const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
const { getAuthHeaders } = require("../utils/cloud-auth.js");

const ORG = `jktraces${Date.now()}`;
const STREAM = "jk_traces";
const LIST_TRACES = 30;

const list = '[data-test="traces-search-result-list"]';
const listRow = (n) => `${list} [data-test="o2-table-row-${n}"]`;
const spanRow = (id) => `[data-test="trace-tree-span-container-${id}"]`;
const pager = '[data-test="traces-search-result-pagination"]';

const hex = (bytes) => crypto.randomBytes(bytes).toString("hex");
const apiBase = () =>
  (process.env.INGESTION_URL || process.env.ZO_BASE_URL).replace(/\/$/, "");

const tree = {
  traceId: hex(16),
  R: hex(8),
  A: hex(8),
  A1: hex(8),
  A2: hex(8),
  B: hex(8),
};
const nowNs = BigInt(Date.now()) * 1000000n;
const windowUs = {
  from: Number(nowNs / 1000n) - 30 * 60e6,
  to: Number(nowNs / 1000n) + 5 * 60e6,
};

function span(
  traceId,
  spanId,
  parentSpanId,
  name,
  offsetMs,
  durationMs,
  service = "jk-svc",
) {
  const start = nowNs - 10n * 60n * 1000000000n + BigInt(offsetMs) * 1000000n;
  return {
    service,
    span: {
      traceId,
      spanId,
      ...(parentSpanId ? { parentSpanId } : {}),
      name,
      kind: 2,
      startTimeUnixNano: String(start),
      endTimeUnixNano: String(start + BigInt(durationMs) * 1000000n),
      attributes: [],
      status: { code: 1 },
    },
  };
}

async function ingestSpans(request, spans) {
  const response = await request.post(`${apiBase()}/api/${ORG}/v1/traces`, {
    headers: {
      ...getAuthHeaders(),
      "stream-name": STREAM,
      "Content-Type": "application/json",
    },
    data: {
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: "jk-svc" } },
            ],
          },
          scopeSpans: [
            { scope: { name: "e2e-jk" }, spans: spans.map((s) => s.span) },
          ],
        },
      ],
    },
  });
  if (!response.ok())
    throw new Error(
      `trace ingest failed: ${response.status()} ${await response.text()}`,
    );
}

async function spanCount(request) {
  const now = Date.now() * 1000;
  const response = await request.post(
    `${process.env.ZO_BASE_URL}/api/${ORG}/_search?type=traces`,
    {
      headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
      data: {
        query: {
          sql: `SELECT * FROM "${STREAM}"`,
          start_time: now - 3600e6,
          end_time: now + 600e6,
          from: 0,
          size: 0,
          track_total_hits: true,
        },
      },
    },
  );
  if (!response.ok()) return -1;
  return (await response.json()).total;
}

async function openList(page) {
  await navigateToBase(page);
  await page.goto(
    `/web/traces?org_identifier=${ORG}&stream=${STREAM}&period=1h`,
  );
  await expect(page.locator(listRow(24))).toBeAttached({ timeout: 60000 });
  await page.evaluate(
    () =>
      document.activeElement instanceof HTMLElement &&
      document.activeElement.blur(),
  );
}

const activeListRows = (page) =>
  page.locator(`${list} [data-active-row="true"]`);

async function openTree(page) {
  await navigateToBase(page);
  await page.goto(
    `/web/traces/trace-details?stream=${STREAM}&trace_id=${tree.traceId}` +
      `&from=${windowUs.from}&to=${windowUs.to}&org_identifier=${ORG}`,
  );
  await expect(page.locator(spanRow(tree.B))).toBeAttached({ timeout: 60000 });
  await page.evaluate(
    () =>
      document.activeElement instanceof HTMLElement &&
      document.activeElement.blur(),
  );
}

async function selectSpan(page, id) {
  await page
    .locator(`[data-test="trace-tree-span-operation-name-container-${id}"]`)
    .click();
  await expect(page.locator(spanRow(id))).toHaveAttribute(
    "aria-current",
    "true",
  );
  await page.evaluate(
    () =>
      document.activeElement instanceof HTMLElement &&
      document.activeElement.blur(),
  );
}

async function toggle(page, id) {
  await page
    .locator(`[data-test="trace-tree-span-badge-collapse-btn-${id}"]`)
    .click();
  await page.evaluate(
    () =>
      document.activeElement instanceof HTMLElement &&
      document.activeElement.blur(),
  );
}

const current = (page, id) =>
  expect(page.locator(spanRow(id))).toHaveAttribute("aria-current", "true");

test.describe.configure({ mode: "serial" });

test.describe("Traces J/K navigation (item 4a)", () => {
  test.beforeAll(async ({ request }) => {
    const spans = [];
    for (let i = 0; i < LIST_TRACES; i++)
      spans.push(span(hex(16), hex(8), null, `list-op-${i}`, i * 1000, 5));
    spans.push(span(tree.traceId, tree.R, null, "R root", 40000, 900));
    spans.push(span(tree.traceId, tree.A, tree.R, "A child", 40100, 400));
    spans.push(
      span(tree.traceId, tree.A1, tree.A, "A1 grandchild", 40150, 100),
    );
    spans.push(
      span(tree.traceId, tree.A2, tree.A, "A2 grandchild", 40300, 100),
    );
    spans.push(span(tree.traceId, tree.B, tree.R, "B child", 40600, 200));
    await ingestSpans(request, spans);
    await expect
      .poll(() => spanCount(request), { timeout: 120000 })
      .toBe(LIST_TRACES + 5);
  });

  test(
    "J selects and focuses a row without opening it; J J J K then Enter opens row 2 (J6, AC6.1, AC6.2)",
    {
      tag: ["@jkNavigation", "@traces"],
    },
    async ({ page }) => {
      await openList(page);
      const listUrl = page.url();
      await page.keyboard.press("j");
      await expect(page.locator(listRow(0))).toHaveAttribute(
        "aria-current",
        "true",
      );
      await expect(page.locator(listRow(0))).toBeFocused();
      expect(page.url()).toBe(listUrl);
      await expect(
        page.locator('[data-test="traces-row-nav-live"]'),
      ).toHaveText(/^(Trace|Span) 1 of 25, page 1$/);

      for (const key of ["j", "j", "j", "k"]) await page.keyboard.press(key);
      await expect(page.locator(listRow(2))).toBeFocused();
      await expect(activeListRows(page)).toHaveCount(1);
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/trace-details/);
      const viaKeys = new URL(page.url()).searchParams.get("trace_id");
      expect(viaKeys).toBeTruthy();

      await openList(page);
      await page.locator(listRow(2)).click();
      await expect(page).toHaveURL(/trace-details/);
      expect(new URL(page.url()).searchParams.get("trace_id")).toBe(viaKeys);
    },
  );

  test(
    "J on the last row of page 1 loads page 2 and selects its row 0 (AC6.3)",
    {
      tag: ["@jkNavigation", "@traces"],
    },
    async ({ page }) => {
      await openList(page);
      await page.locator(listRow(24)).focus();
      await page.keyboard.press("j");
      await expect(page.locator(`${pager} [aria-current="page"]`)).toHaveText(
        "2",
        { timeout: 30000 },
      );
      await expect(page.locator(listRow(0))).toHaveAttribute(
        "aria-current",
        "true",
        { timeout: 30000 },
      );
      await expect(page.locator(listRow(0))).toBeFocused();
    },
  );

  test(
    "a paginator click clears the selection; the next J selects page 2 row 0 (AC6.4)",
    {
      tag: ["@jkNavigation", "@traces"],
    },
    async ({ page }) => {
      await openList(page);
      await page.locator(listRow(6)).focus();
      await page.keyboard.press("j");
      await expect(page.locator(listRow(7))).toHaveAttribute(
        "aria-current",
        "true",
      );
      await page.locator(`${pager} button`, { hasText: /^2$/ }).click();
      await expect(page.locator(`${pager} [aria-current="page"]`)).toHaveText(
        "2",
        { timeout: 30000 },
      );
      await expect(activeListRows(page)).toHaveCount(0);
      await page.evaluate(
        () =>
          document.activeElement instanceof HTMLElement &&
          document.activeElement.blur(),
      );
      await page.keyboard.press("j");
      await expect(page.locator(listRow(0))).toHaveAttribute(
        "aria-current",
        "true",
      );
    },
  );

  test(
    "trace detail J/K follow the visible tree and skip a collapsed subtree (J7)",
    {
      tag: ["@jkNavigation", "@traces"],
    },
    async ({ page }) => {
      await openTree(page);

      for (const id of [tree.R, tree.A, tree.A1, tree.A2, tree.B]) {
        await page.keyboard.press("j");
        await current(page, id);
      }

      await toggle(page, tree.A);
      await expect(page.locator(spanRow(tree.A1))).toHaveCount(0);
      await selectSpan(page, tree.A);
      await page.keyboard.press("j");
      await current(page, tree.B);
      await expect(
        page.locator('[data-test="trace-details-span-nav-live"]'),
      ).toHaveText("Span 3 of 3: B child");

      await toggle(page, tree.A);
      await selectSpan(page, tree.A1);
      await toggle(page, tree.A);
      await page.keyboard.press("j");
      await current(page, tree.B);

      await toggle(page, tree.A);
      await selectSpan(page, tree.A1);
      await toggle(page, tree.A);
      await page.keyboard.press("k");
      await current(page, tree.A);
    },
  );
});
