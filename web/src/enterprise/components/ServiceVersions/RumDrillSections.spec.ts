// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import golden from "@/test/unit/fixtures/serviceVersions/stage7.json";
import Drill from "./RumDrillSections.vue";
import { b64DecodeUnicode } from "@/utils/zincutils";
import enUS from "@/locales/languages/en-US.json";
import type { CompareResponse, MetricDelta } from "@/services/service_versions";
const push = vi.hoisted(() => vi.fn());
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/types/i18n", async (original) => ({
  ...(await original<object>()),
  useI18nTyped: () => ({
    t: (key: string, values?: Record<string, unknown>, plural?: number) =>
      values ? `${key}${JSON.stringify(values)}${plural == null ? "" : `#${plural}`}` : key,
  }),
}));
const e2 = () => structuredClone(golden.compare_e2) as unknown as CompareResponse;
// The main-build capture: the same run from an SDK that sends no INP target field.
const main = () =>
  ({
    ...e2(),
    inp_targets: {
      error: null,
      reason: "sdk_no_inp_target",
      rows: [],
      status: "insufficient",
      truncated: false,
    },
  }) as CompareResponse;
const render = (result: CompareResponse, extra: Record<string, unknown> = {}) =>
  mount(Drill, { props: { org: "org", result, ...extra } });
const delta = (extra: Partial<MetricDelta>): MetricDelta => ({
  a: 120,
  b: 100,
  delta: 20,
  lo: 10,
  hi: 30,
  ci_kind: "sketch_band",
  insufficient: false,
  straddles_zero: false,
  ...extra,
});
beforeEach(() => push.mockClear());
it("lists the slowest interactions of the new version with a replay into Sessions by page", async () => {
  const wrapper = render(e2());
  expect(wrapper.find('[data-test="svcver-section-inp-targets-ok"]').exists()).toBe(true);
  expect(wrapper.find('[data-test="svcver-inp-target-1"]').text()).toContain("button#plan-toggle");
  expect(wrapper.find('[data-test="svcver-inp-target-1"]').text()).toContain('"page":"/pricing"');
  expect(wrapper.findAll('[data-test^="svcver-inp-target-replay-"]')).toHaveLength(3);
  await wrapper.find('[data-test="svcver-inp-target-replay-2"]').trigger("click");
  const url = new URL(push.mock.calls[0][0], "http://x");
  expect(url.pathname).toBe("/web/rum/sessions");
  expect(url.searchParams.get("from")).toBe(String(golden.compare_e2.arms.a.start_time));
  const query = b64DecodeUnicode(url.searchParams.get("query") || "") || "";
  expect(query).toContain("service = 'storefront' AND version = '0.0.2'");
  const pattern = query.match(/re_match\(view_url, '(.*)'\)/)?.[1] || "";
  expect(new RegExp(pattern).test("https://o2.example/docs/42?x=1")).toBe(true);
  expect(new RegExp(pattern).test("https://o2.example/docs/42/edit")).toBe(false);
});
it("counts each slowest interaction with its unit, one or many, in the reader's number format", () => {
  const wrapper = render(e2());
  expect(wrapper.find('[data-test="svcver-inp-target-1"]').text()).toContain(
    '"count":"2,000"}#2000',
  );
  const { t } = createI18n({ legacy: false, locale: "en-US", messages: { "en-US": enUS } }).global;
  const key = "serviceVersions.compare.drill.inp.pageCount";
  expect(t(key, { page: "/pricing", count: "2,320" }, 2320)).toBe("/pricing · 2,320 interactions");
  expect(t(key, { page: "/pricing", count: "1" }, 1)).toBe("/pricing · 1 interaction");
});
it("explains an SDK without the INP target field instead of an empty table", () => {
  const wrapper = render(main());
  expect(wrapper.find('[data-test="svcver-section-inp-targets-insufficient"]').exists()).toBe(true);
  expect(wrapper.find('[data-test="svcver-section-inp-targets-reason"]').text()).toBe(
    "serviceVersions.compare.drill.reasons.sdkNoInpTarget",
  );
  expect(wrapper.find('[data-test="svcver-inp-target-1"]').exists()).toBe(false);
});
it("words the missing INP target as an action, without the raw field name", () => {
  const reason = enUS.serviceVersions.compare.drill.reasons.sdkNoInpTarget;
  expect(reason).toMatch(/^Update the RUM SDK/);
  expect(reason).not.toMatch(/[a-z_]+\.[a-z_]+/);
});
it("shows each breakdown value's change for the chosen vital and names an absent dimension", () => {
  const wrapper = render(e2(), { metric: "inp_p75" });
  expect(wrapper.find('[data-test="svcver-section-breakdown-ok"]').exists()).toBe(true);
  const browser = golden.compare_e2.rum_breakdown.dims.browser.values[0].value;
  const slug = browser
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const row = wrapper.find(`[data-test="svcver-breakdown-browser-${slug}"]`);
  expect(row.exists()).toBe(true);
  expect(wrapper.find('[data-test="svcver-breakdown-country-reason"]').text()).toContain(
    "serviceVersions.compare.drill.reasons.fieldAbsent",
  );
  expect(wrapper.text()).toContain('"metric":"serviceVersions.compare.drill.metric.inp_p75"');
  expect(wrapper.text()).toContain("+17.4%");
});
it("reads an interval across zero, under the floor or without bounds as noise", () => {
  const result = e2();
  const values = result.rum_breakdown!.dims!.browser!.values!;
  const base = values[0];
  result.rum_breakdown!.dims!.browser!.values = [
    { ...base, value: "Real", inp_p75: delta({}) },
    { ...base, value: "Straddles", inp_p75: delta({ straddles_zero: true, lo: -5 }) },
    { ...base, value: "Floor", inp_p75: delta({ insufficient: true }) },
    { ...base, value: "Unbounded", inp_p75: delta({ lo: null, hi: null }) },
    { ...base, value: "Better", inp_p75: delta({ delta: -20, lo: -30, hi: -10 }) },
  ];
  const wrapper = render(result);
  const cell = (value: string) =>
    wrapper
      .find(`[data-test="svcver-breakdown-browser-${value.toLowerCase()}"]`)
      .element.closest("tr")!.textContent;
  expect(cell("Real")).toContain("+20.0%");
  expect(cell("Better")).toContain("−20.0%");
  for (const value of ["Straddles", "Floor", "Unbounded"])
    expect(cell(value)).toContain("serviceVersions.compare.drill.noise");
});
it("keys every section reason and status from the wire", () => {
  const result = e2();
  result.inp_targets = { status: "insufficient", reason: "raw_aged_out", error: null, rows: [] };
  result.rum_breakdown = { status: "timeout", reason: "timeout", error: "deadline" };
  result.pages = { status: "insufficient", reason: "detail_coarse", error: null };
  const wrapper = render(result);
  expect(wrapper.find('[data-test="svcver-section-inp-targets-reason"]').text()).toBe(
    "serviceVersions.compare.drill.reasons.rawAgedOut",
  );
  expect(wrapper.find('[data-test="svcver-section-breakdown-timeout"]').exists()).toBe(true);
  expect(wrapper.find('[data-test="svcver-section-breakdown-reason"]').text()).toBe(
    "serviceVersions.compare.drill.reasons.timeout",
  );
  const pages = render(result, { pages: true });
  expect(pages.find('[data-test="svcver-section-pages-insufficient"]').exists()).toBe(true);
  expect(pages.find('[data-test="svcver-section-pages-reason"]').text()).toBe(
    `serviceVersions.compare.detailGap${JSON.stringify({
      subject: "serviceVersions.compare.detailGapSubject.page",
      span: "serviceVersions.compare.detailGapSpan.both",
    })}`,
  );
  result.pages = { status: "error", reason: null, error: "boom" };
  expect(
    render(result, { pages: true }).find('[data-test="svcver-section-pages-reason"]').text(),
  ).toBe("serviceVersions.compare.drill.reasons.error");
  expect(
    render(result, { loading: true })
      .find('[data-test="svcver-section-breakdown-loading"]')
      .exists(),
  ).toBe(true);
});
it("lists pages with views on the new version and the worst vital change", async () => {
  const wrapper = render(e2(), { pages: true });
  expect(wrapper.find('[data-test="svcver-section-pages-ok"]').exists()).toBe(true);
  expect(wrapper.find('[data-test="svcver-page-root"]').text()).toBe("/");
  expect(wrapper.find('[data-test="svcver-page-docs-id"]').exists()).toBe(true);
  const row = wrapper.find('[data-test="svcver-page-root"]').element.closest("tr")!.textContent;
  expect(row).toContain(
    '"metric":"serviceVersions.compare.drill.metric.cls_p75","change":"−0.088"',
  );
  expect(row).toContain("1,992");
  await wrapper.find('[data-test="svcver-page-replays-root"]').trigger("click");
  expect(push).toHaveBeenCalledTimes(1);
});
it("names the worst regressed vital and new error types, and caps What changed at five pages", () => {
  const result = e2();
  const base = result.pages!.rows![0];
  result.pages!.rows = Array.from({ length: 7 }, (_, index) => ({
    ...base,
    page: `/p${index}`,
    new_error_types: index === 0 ? 2 : 0,
    inp_p75: delta({}),
    worst: { metric: "inp_p75", delta: 20 },
  }));
  const top = render(result, { pages: true });
  expect(top.findAll('[data-test^="svcver-page-p"]')).toHaveLength(5);
  const first = top.find('[data-test="svcver-page-p0"]').element.closest("tr")!.textContent;
  expect(first).toContain(
    '"metric":"serviceVersions.compare.drill.metric.inp_p75","change":"+20.0%"',
  );
  expect(first).toContain('serviceVersions.compare.drill.pages.newCount{"count":2}');
  expect(
    render(result, { pages: true, all: true }).findAll('[data-test^="svcver-page-p"]'),
  ).toHaveLength(7);
});
it("colours a real worsening like its tile: red under Regressed, amber under a possible regression", () => {
  const change = (verdict: "regressed" | "watch") => {
    const result = e2();
    for (const value of [result.live_verdict, result.stored_verdict])
      if (value) Object.assign(value, { verdict, reason_code: "regressed_significant" });
    return render(result, { metric: "inp_p75" })
      .findAll("span.tabular-nums")
      .find((cell) => cell.text() === "+17.4%")!;
  };
  expect(change("regressed").classes()).toContain("text-error-600");
  expect(change("watch").classes()).toContain("text-warning-600");
});
it("says both windows for a two-window compare and this window for a single one", () => {
  const result = e2();
  result.pages = { status: "insufficient", reason: "detail_coarse", error: null };
  const span = (value: CompareResponse) =>
    render(value, { pages: true }).find('[data-test="svcver-section-pages-reason"]').text();
  expect(span(result)).toContain("detailGapSpan.both");
  result.arms.b = { ...result.arms.b, version: "" };
  expect(span(result)).toContain("detailGapSpan.this");
});
