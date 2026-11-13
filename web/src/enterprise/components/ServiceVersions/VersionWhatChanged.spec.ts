// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import Changed from "./VersionWhatChanged.vue";
import golden from "@/test/unit/fixtures/serviceVersions/stage7.json";
import producer from "@/test/unit/fixtures/serviceVersions/producer.json";
import { b64DecodeUnicode } from "@/utils/zincutils";
import type { CompareResponse } from "@/services/service_versions";
const push = vi.hoisted(() => vi.fn());
const translate = vi.hoisted(() => vi.fn((key: string) => key));
vi.mock("vue-router", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/types/i18n", async (original) => ({
  ...(await original<object>()),
  useI18nTyped: () => ({ t: translate }),
}));
function data(): CompareResponse {
  return {
    service: "svc",
    where_key: "env:prod",
    env: "prod",
    mode: "sequential",
    aliases_applied: [],
    notes: [],
    baseline_rule: "previous",
    arms: {
      a: { version: "v2", start_time: 300, end_time: 400 },
      b: { version: "v1", start_time: 100, end_time: 200 },
    },
    rum: {
      status: "ok",
      error_types: {
        early: true,
        introduced: [
          {
            fingerprint: "new",
            count: 7,
            error_message: "message",
            sample_error_id: "id",
            sample_ts: 350,
          },
        ],
        fixed: [{ fingerprint: "gone", count: 3, error_type: "TypeError", error_message: "gone" }],
        shared: [],
      },
    },
    traces: {
      status: "ok",
      endpoints: [
        {
          operation: "GET /a",
          source_stream: "one",
          requests_a: 1,
          requests_b: 0,
          errors_a: 1,
          errors_b: 0,
          introduced: true,
          early: true,
        },
        {
          operation: "GET /a",
          source_stream: "two",
          errors_a: 2,
          errors_b: 0,
          requests_a: 2,
          requests_b: 0,
          introduced: true,
          early: true,
        },
      ],
    },
  };
}
function render(result: CompareResponse) {
  return mount(Changed, {
    props: { org: "org", result },
    global: {
      stubs: {
        OButton: {
          emits: ["click"],
          template: "<button @click=\"$emit('click')\"><slot/></button>",
        },
      },
    },
  });
}
beforeEach(() => vi.clearAllMocks());
describe("evidence details", () => {
  it("shows errors from the first occurrence with a neutral early message", () => {
    const wrapper = render(data());
    expect(wrapper.text()).toContain("compare.tooEarlyCount");
    expect(wrapper.find('[data-test="svcver-error-introduced-one-GET /a"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="svcver-evidence-allErrors-one-GET /a"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="svcver-evidence-allErrors-two-GET /a"]').exists()).toBe(true);
  });
  it("omits Sessions without error_type while keeping coherent Error details", () => {
    const wrapper = render(data());
    expect(wrapper.find('[data-test="svcver-evidence-sessions-new"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="svcver-evidence-errorDetails-new"]').exists()).toBe(true);
  });
  it("uses the baseline bounds for gone errors", async () => {
    const wrapper = render(data());
    await wrapper.find('[data-test="svcver-evidence-sessions-gone"]').trigger("click");
    const url = new URL(push.mock.calls[0][0], "http://localhost");
    expect(url.searchParams.get("from")).toBe("100");
    expect(url.searchParams.get("to")).toBe("200");
  });
  it("renders an explicit empty state and hides evidence when restricted", () => {
    const empty = data();
    empty.rum = undefined;
    empty.traces = undefined;
    expect(render(empty).find('[data-test="svcver-evidence-empty"]').exists()).toBe(true);
    const restricted = data();
    restricted.stored_verdict = { restricted: true } as CompareResponse["stored_verdict"];
    expect(render(restricted).find("button").exists()).toBe(false);
  });
});
describe("coarse detail", () => {
  function coarse() {
    const result = data();
    result.traces!.endpoint_detail = { status: "insufficient", reason: "detail_coarse" };
    result.traces!.endpoints!.push({
      operation: "GET /b",
      source_stream: "one",
      requests_a: 5,
      requests_b: 5,
      errors_a: 1,
      errors_b: 2,
    });
    result.rum!.error_detail = { status: "insufficient", reason: "detail_coarse" };
    result.rum!.error_types!.shared = [{ fingerprint: "both", count_a: 1, count_b: 1, delta: 0 }];
    return result;
  }
  it("shows each section's insufficient state and never labels a row New or Gone", () => {
    const wrapper = render(coarse());
    expect(wrapper.find('[data-test="svcver-detail-insufficient-traces"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="svcver-detail-insufficient-rum"]').exists()).toBe(true);
    expect(wrapper.get('[data-test="svcver-detail-insufficient-traces"]').text()).toBe(
      "serviceVersions.compare.detailGap",
    );
    expect(translate).toHaveBeenCalledWith("serviceVersions.compare.detailGapSubject.endpoint");
    expect(translate).toHaveBeenCalledWith("serviceVersions.compare.detailGapSubject.error");
    expect(translate).toHaveBeenCalledWith("serviceVersions.compare.detailGapSpan.both");
    expect(wrapper.get('[data-test="svcver-detail-insufficient-traces"]').text()).not.toContain(
      "verdict.insufficient",
    );
    expect(wrapper.findAll('[data-test^="svcver-error-introduced-"]')).toHaveLength(0);
    expect(wrapper.findAll('[data-test^="svcver-error-fixed-"]')).toHaveLength(0);
    expect(wrapper.find('[data-test="svcver-error-shared-one-GET /b"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="svcver-error-shared-both"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="svcver-endpoint-one-GET /a"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="svcver-evidence-empty"]').exists()).toBe(false);
  });
  it("keeps the traces state in All endpoints and drops the RUM one there", () => {
    const wrapper = mount(Changed, { props: { org: "org", result: coarse(), all: true } });
    expect(wrapper.find('[data-test="svcver-detail-insufficient-traces"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="svcver-detail-insufficient-rum"]').exists()).toBe(false);
  });
  it("labels New and Gone when the detail covers both arms", () => {
    const result = coarse();
    result.traces!.endpoint_detail = { status: "ok", reason: null };
    result.rum!.error_detail = { status: "ok", reason: null };
    const wrapper = render(result);
    expect(wrapper.find('[data-test^="svcver-detail-insufficient-"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="svcver-error-introduced-one-GET /a"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="svcver-error-fixed-gone"]').exists()).toBe(true);
  });
});
describe("endpoint table", () => {
  const endpoint = (operation: string, a: number, b: number) => ({
    operation,
    source_stream: "s",
    requests_a: 10,
    requests_b: 10,
    p95: {
      a,
      b,
      delta: a - b,
      lo: a - b - 1,
      hi: a - b + 1,
      ci_kind: "variance",
      insufficient: false,
    },
  });
  it("orders by worst regression and keeps five in What changed, all in All endpoints", () => {
    const result = data();
    result.rum = undefined;
    result.traces = {
      status: "ok",
      endpoints: [1, 2, 3, 4, 5, 6].map((n) => endpoint(`op${n}`, 100 + n * 10, 100)),
    };
    const rows = (all: boolean) =>
      mount(Changed, { props: { org: "org", result, all } })
        .findAll('[data-test^="svcver-endpoint-s-"]')
        .map((row) => row.text());
    expect(rows(false)).toEqual(["op6", "op5", "op4", "op3", "op2"]);
    expect(rows(true)).toHaveLength(6);
  });
});
describe("backend-shaped error counts", () => {
  it("reads introduced and fixed counts from count, shared from count_b → count_a", () => {
    const result = data();
    result.rum!.error_types!.shared = [
      { fingerprint: "both", count_a: 9, count_b: 4, delta: 5, error_message: "both" },
    ];
    const wrapper = render(result);
    expect(wrapper.find('[data-test="svcver-error-counts-new"]').text()).toBe("7");
    expect(wrapper.find('[data-test="svcver-error-before-new"]').text()).toBe("0");
    expect(wrapper.find('[data-test="svcver-error-counts-gone"]').text()).toBe("0");
    expect(wrapper.find('[data-test="svcver-error-before-gone"]').text()).toBe("3");
    expect(wrapper.find('[data-test="svcver-error-counts-both"]').text()).toBe("9");
    expect(wrapper.find('[data-test="svcver-error-before-both"]').text()).toBe("4");
  });
});
describe("sample floors and early colours", () => {
  const tagStub = {
    props: ["variant", "label"],
    template: '<span :data-variant="variant">{{ label }}</span>',
  };
  function judged() {
    const result = data();
    result.rum!.views = { a: 5000, b: 5000 };
    result.rum!.error_types!.early = false;
    return result;
  }
  function tags(result: CompareResponse) {
    return mount(Changed, { props: { org: "org", result }, global: { stubs: { OTag: tagStub } } });
  }
  it("colours New red and Gone green only once the floors are met", () => {
    const wrapper = tags(judged());
    expect(
      wrapper.find('[data-test="svcver-error-introduced-new"]').attributes("data-variant"),
    ).toBe("error-soft");
    expect(wrapper.find('[data-test="svcver-error-fixed-gone"]').attributes("data-variant")).toBe(
      "success-soft",
    );
  });
  it("keeps RUM rows neutral below 100 views per arm", () => {
    const result = judged();
    result.rum!.views = { a: 60, b: 5000 };
    const wrapper = tags(result);
    expect(wrapper.find('[data-test="svcver-error-fixed-gone"]').attributes("data-variant")).toBe(
      "default-outline",
    );
    expect(
      wrapper.find('[data-test="svcver-error-introduced-new"]').attributes("data-variant"),
    ).toBe("default-outline");
  });
  const significant = (a: number, b: number) => ({
    a,
    b,
    delta: a - b,
    lo: (a - b) / 2,
    hi: (a - b) * 2,
    ci_kind: "variance",
    insufficient: false,
  });
  function endpointAt(requests: number) {
    const result = data();
    result.rum = undefined;
    result.traces = {
      status: "ok",
      endpoints: [
        {
          operation: "GET /x",
          source_stream: "s",
          requests_a: requests,
          requests_b: requests + 100,
          p95: significant(300000, 100000),
          error_rate: significant(0.2, 0.01),
        },
      ],
    };
    const wrapper = mount(Changed, { props: { org: "org", result } });
    const cells = wrapper.findAll('[data-test="svcver-endpoint-table"] td span.tabular-nums');
    return cells.map((cell) => cell.classes());
  }
  it("colours both once each floor is met", () => {
    const [p95, errors] = endpointAt(500);
    expect(p95).toContain("text-error-600");
    expect(errors).toContain("text-error-600");
  });
});
describe("where-scoped evidence links", () => {
  function query(url: string) {
    return b64DecodeUnicode(new URL(url, "http://localhost").searchParams.get("query")!);
  }
  function linked() {
    const result = data();
    result.baseline_rule = "env_fallback";
    result.arms.b.where_key = "k8s:c2/web";
    result.traces!.endpoints!.push({
      operation: "GET /gone",
      source_stream: "one",
      requests_a: 500,
      requests_b: 500,
      errors_a: 0,
      errors_b: 4,
      baseline_p95_us: 10,
    });
    return result;
  }
  it("filters arm A links by comparison.where_key and B links by arms.b.where_key", async () => {
    const wrapper = render(linked());
    await wrapper.find('[data-test="svcver-evidence-allErrors-one-GET /a"]').trigger("click");
    await wrapper.find('[data-test="svcver-evidence-allErrors-one-GET /gone"]').trigger("click");
    await wrapper.find('[data-test="svcver-evidence-allErrors-service"]').trigger("click");
    const [introduced, fixed, all] = push.mock.calls.map(([url]) => query(url));
    expect(introduced).toContain("o2_service_where = 'env:prod'");
    expect(fixed).toContain("o2_service_where = 'k8s:c2/web'");
    expect(fixed).not.toContain("env:prod");
    expect(all).toContain("o2_service_where = 'env:prod'");
  });
  it("omits a baseline link when an env_fallback arm has no where", () => {
    const result = linked();
    delete result.arms.b.where_key;
    const wrapper = render(result);
    expect(wrapper.find('[data-test="svcver-evidence-allErrors-one-GET /gone"]').exists()).toBe(
      false,
    );
    expect(wrapper.find('[data-test="svcver-evidence-allErrors-one-GET /a"]').exists()).toBe(true);
  });
});
describe("an arm read in whole hours", () => {
  function hourly() {
    const result = data();
    result.arms.b.basis = "hourly";
    result.traces!.endpoints!.push({
      operation: "GET /both",
      source_stream: "one",
      requests_a: 900,
      requests_b: 900,
      errors_a: 2,
      errors_b: 3,
    });
    return result;
  }
  it("says once that the old side is read in whole hours and keeps New and Gone", () => {
    const wrapper = render(hourly());
    const notes = wrapper.findAll('[data-test="svcver-arm-hourly"]');
    expect(notes).toHaveLength(1);
    expect(notes[0].text()).toContain("compare.armHourly");
    expect(wrapper.find('[data-test="svcver-error-introduced-one-GET /a"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="svcver-error-fixed-gone"]').exists()).toBe(true);
  });
  it("shows null per-endpoint deltas as not compared", () => {
    const wrapper = render(hourly());
    const row = wrapper
      .findAll('[data-test="svcver-endpoint-table"] tr')
      .find((tr) => tr.text().includes("GET /both"))!;
    expect(row.text()).toContain("compare.notCompared");
  });
  describe("baseline evidence links", () => {
    function gone() {
      const result = hourly();
      result.traces!.endpoints!.push({
        operation: "GET /gone",
        source_stream: "one",
        requests_a: 500,
        requests_b: 500,
        errors_a: 0,
        errors_b: 4,
      });
      return result;
    }
    async function bounds(result: CompareResponse, testId: string) {
      push.mockClear();
      await render(result).find(`[data-test="${testId}"]`).trigger("click");
      const params = new URL(push.mock.calls[0][0], "http://localhost").searchParams;
      return [Number(params.get("from")), Number(params.get("to"))];
    }
    it("spans arm B for Gone rows and arm A for New rows and the service link", async () => {
      const result = gone();
      expect(await bounds(result, "svcver-evidence-allErrors-one-GET /gone")).toEqual([100, 200]);
      expect(await bounds(result, "svcver-evidence-sessions-gone")).toEqual([100, 200]);
      expect(await bounds(result, "svcver-evidence-allErrors-one-GET /a")).toEqual([300, 400]);
      expect(await bounds(result, "svcver-evidence-allErrors-service")).toEqual([300, 400]);
    });
  });
});
describe("RUM-only service", () => {
  it("drops the Source column, which would say RUM on every row", () => {
    const rumOnly = structuredClone(golden.compare_e2) as unknown as CompareResponse;
    expect(render(rumOnly).text()).not.toContain("serviceVersions.compare.column.source");
    expect(render(data()).text()).toContain("serviceVersions.compare.column.source");
  });
});
describe("endpoints on one side only", () => {
  // A real producer's a_only row: the existing side carries its own rate, the delta stays insufficient.
  const promo = () => structuredClone(producer.promo_endpoint);
  function judged(endpoints: NonNullable<CompareResponse["traces"]>["endpoints"]) {
    const result = data();
    result.rum = undefined;
    result.traces = { status: "ok", requests: { a: 9000, b: 9000 }, endpoints } as never;
    return result;
  }
  const notCompared = "—serviceVersions.compare.notCompared";
  const cells = (result: CompareResponse) =>
    mount(Changed, { props: { org: "org", result } })
      .findAll('[data-test="svcver-endpoint-table"] td span.tabular-nums')
      .map((cell) => cell.text());
  it("states a new endpoint's error change in pts beside the red New chip", () => {
    const wrapper = mount(Changed, {
      props: { org: "org", result: judged([promo()]) },
      global: {
        stubs: { OTag: { props: ["variant"], template: '<span :data-variant="variant" />' } },
      },
    });
    const chip = wrapper.get(
      '[data-test="svcver-endpoint-introduced-default-POST /api/checkout/promo"]',
    );
    expect(chip.attributes("data-variant")).toBe("error-soft");
    expect(
      wrapper
        .get('[data-test="svcver-error-introduced-default-POST /api/checkout/promo"]')
        .attributes("data-variant"),
    ).toBe(chip.attributes("data-variant"));
    expect(translate).toHaveBeenCalledWith("serviceVersions.compare.changeKind.introduced");
    expect(translate).not.toHaveBeenCalledWith("serviceVersions.compare.endpointNew", {
      rate: expect.anything(),
    });
    expect(translate).toHaveBeenCalledWith("serviceVersions.compare.pointsShort", {
      value: "+24.6",
    });
    expect(translate).not.toHaveBeenCalledWith("serviceVersions.compare.unit.percent", {
      value: "25.90",
    });
  });
  it("offers Slow traces only on a row the compared version served", () => {
    // The producer's new row mirrored into a gone one: calls before only, with a baseline p95.
    const gone = {
      ...promo(),
      operation: "GET /legacy",
      status: "b_only",
      requests_a: 0,
      errors_a: 0,
      requests_b: promo().requests_a,
      errors_b: promo().errors_a,
      baseline_p95_us: 250000,
    };
    const shared = { ...gone, operation: "GET /cart", status: "both", requests_a: 3000 };
    const wrapper = mount(Changed, {
      props: { org: "org", result: judged([gone, shared] as never) },
    });
    expect(
      wrapper.find('[data-test="svcver-evidence-slowTraces-default-GET /legacy"]').exists(),
    ).toBe(false);
    expect(
      wrapper.find('[data-test="svcver-evidence-slowTraces-default-GET /cart"]').exists(),
    ).toBe(true);
  });
  it("judges too early on the side that exists", () => {
    const wrapper = mount(Changed, {
      props: { org: "org", result: judged([promo()]) },
      global: {
        stubs: { OTag: { props: ["variant"], template: '<span :data-variant="variant" />' } },
      },
    });
    expect(wrapper.find('[data-test="svcver-too-early"]').exists()).toBe(false);
    expect(
      wrapper
        .find('[data-test="svcver-error-introduced-default-POST /api/checkout/promo"]')
        .attributes("data-variant"),
    ).toBe("error-soft");
  });
  it("never prints a delta for an insufficient metric", () => {
    const shared = {
      ...promo(),
      status: "both",
      requests_b: 3000,
      errors_b: 30,
      p95: { a: 5, b: 4, delta: 1, lo: 0.5, hi: 1.5, ci_kind: "sketch", insufficient: true },
      error_rate: {
        a: 0.2,
        b: 0.01,
        delta: 0.19,
        lo: 0.1,
        hi: 0.2,
        ci_kind: "",
        insufficient: true,
      },
    };
    expect(cells(judged([shared]))).toEqual([notCompared, notCompared, "3,976"]);
  });
  it("does not call a one-sided row new when the detail is coarse", () => {
    const result = judged([promo()]);
    result.traces!.endpoint_detail = { status: "insufficient", reason: "detail_coarse" };
    expect(cells(result)[1]).toBe(notCompared);
  });
});

describe("first version endpoints (real producer compare with no baseline)", () => {
  it("heads the error column Error rate and shows each endpoint's rate, not a change", () => {
    const result = { ...data(), ...structuredClone(producer.first_version) } as CompareResponse;
    const wrapper = render(result);
    const headers = wrapper
      .findAll('[data-test="svcver-endpoint-table"] th')
      .map((th) => th.text());
    expect(headers).toContain("serviceVersions.compare.tile.error_rate");
    expect(headers).not.toContain("serviceVersions.compare.column.errorChange");
    expect(translate).not.toHaveBeenCalledWith("serviceVersions.compare.pointsShort", {
      value: expect.anything(),
    });
  });
  it("titles the table by the version, not by a regression it cannot have", () => {
    const result = { ...data(), ...structuredClone(producer.first_version) } as CompareResponse;
    const wrapper = render(result);
    expect(wrapper.get('[data-test="svcver-endpoints-title"]').text()).toBe(
      "serviceVersions.compare.endpointsIn",
    );
    expect(translate).toHaveBeenCalledWith("serviceVersions.compare.endpointsIn", {
      version: "2.2.0",
    });
  });
});
describe("endpoint and error rows", () => {
  const promo = () => structuredClone(producer.promo_endpoint);
  function judged(endpoints: unknown[]) {
    const result = data();
    result.rum = undefined;
    result.traces = { status: "ok", requests: { a: 9000, b: 9000 }, endpoints } as never;
    return result;
  }
  const tagStub = {
    global: {
      stubs: { OTag: { props: ["variant"], template: '<span :data-variant="variant" />' } },
    },
  };
  it("states an error-rate change in pts, rounded like a percent change", () => {
    const shared = {
      ...promo(),
      status: "both",
      requests_b: 3000,
      errors_b: 30,
      error_rate: {
        a: 0.029,
        b: 0.01,
        delta: 0.019,
        lo: 0.012,
        hi: 0.026,
        ci_kind: "variance",
        insufficient: false,
        straddles_zero: false,
      },
    };
    mount(Changed, { props: { org: "org", result: judged([shared]) } });
    expect(translate).toHaveBeenCalledWith("serviceVersions.compare.pointsShort", {
      value: "+1.9",
    });
  });
  it("labels an endpoint the compared version no longer serves Gone, with no numbers", () => {
    const gone = {
      ...promo(),
      operation: "GET /legacy",
      status: "b_only",
      requests_a: 0,
      errors_a: 0,
      requests_b: 1200,
      errors_b: 30,
    };
    const wrapper = mount(Changed, { props: { org: "org", result: judged([gone]) }, ...tagStub });
    const chip = wrapper.get('[data-test="svcver-endpoint-fixed-default-GET /legacy"]');
    expect(chip.attributes("data-variant")).toBe("success-soft");
    expect(wrapper.get('[data-test="svcver-endpoint-errors-default-GET /legacy"]').text()).toBe("");
  });
  it("offers Slow traces on a new endpoint, against the service's p95", () => {
    const row = promo();
    expect(row.baseline_p95_us).toBeNull();
    const result = judged([row]);
    result.traces!.p95 = structuredClone(producer.first_version.traces.p95);
    const wrapper = mount(Changed, { props: { org: "org", result } });
    expect(
      wrapper
        .find('[data-test="svcver-evidence-slowTraces-default-POST /api/checkout/promo"]')
        .exists(),
    ).toBe(true);
  });
  it("drops the too-early chip once a verdict exists and uses a neutral chip before", () => {
    const early = mount(Changed, { props: { org: "org", result: data() }, ...tagStub });
    expect(early.get('[data-test="svcver-too-early"]').attributes("data-variant")).toBe(
      "default-soft",
    );
    const result = data();
    result.live_verdict = structuredClone(producer.regressed.live_verdict) as never;
    const decided = mount(Changed, { props: { org: "org", result }, ...tagStub });
    expect(decided.find('[data-test="svcver-too-early"]').exists()).toBe(false);
    expect(decided.text()).not.toContain("newErrorsEarly");
    expect(
      decided.get('[data-test="svcver-error-introduced-new"]').attributes("data-variant"),
    ).toBe("error-soft");
  });
});
describe("detail gap span", () => {
  it("says this window when the compare has no baseline window", () => {
    const result = data();
    result.arms.b = { ...result.arms.b, version: "" };
    result.traces!.endpoint_detail = { status: "insufficient", reason: "detail_coarse" };
    render(result);
    expect(translate).toHaveBeenCalledWith("serviceVersions.compare.detailGapSpan.this");
    expect(translate).not.toHaveBeenCalledWith("serviceVersions.compare.detailGapSpan.both");
  });
});
