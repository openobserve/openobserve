import { describe, it, expect } from "vitest";
import { b64DecodeUnicode } from "@/utils/zincutils";
import { armWhere, traceEvidence, rumEvidence, errorDetails, serviceErrors } from "./deepLinks";
import type { CompareArm, CompareResponse, Endpoint } from "@/services/service_versions";
const arm: CompareArm = { version: "v'2", start_time: 1000000, end_time: 2000000 };
const endpoint: Endpoint = {
  operation: "GET /a'b",
  source_stream: "readable traces",
  requests_a: 100,
  requests_b: 100,
  baseline_p95_us: 120,
};
const sql = (url: string | undefined) =>
  b64DecodeUnicode(new URL(url!, "http://localhost").searchParams.get("query")!);
function comparison(rule: string, bWhere?: string): CompareResponse {
  return {
    service: "checkout",
    where_key: "k8s:c1/shop",
    env: "prod",
    mode: "sequential",
    aliases_applied: [],
    notes: [],
    baseline_rule: rule,
    arms: { a: arm, b: { ...arm, version: "v1", where_key: bWhere } },
  };
}
describe("evidence links", () => {
  it("uses actual source and arm bounds", () => {
    const url = new URL(
      traceEvidence("org", "checkout", arm, "env:prod", endpoint, true)!,
      "http://localhost",
    );
    expect(url.searchParams.get("from")).toBe("1000000");
    expect(url.searchParams.get("to")).toBe("2000000");
    expect(url.searchParams.get("stream")).toBe("readable traces");
    const query = b64DecodeUnicode(url.searchParams.get("query")!);
    expect(query).toContain("v''2");
    expect(query).toContain("GET /a''b");
    expect(query).toContain("duration > 120");
  });
  it("omits slow links without a real baseline", () =>
    expect(
      traceEvidence(
        "org",
        "checkout",
        arm,
        "env:prod",
        { ...endpoint, baseline_p95_us: undefined },
        true,
      ),
    ).toBeUndefined());
  it("omits Sessions without original error_type but keeps details", () => {
    const evidence = { error_message: "message", sample_error_id: "id/a", sample_ts: 123 };
    expect(rumEvidence("org", "checkout", arm, evidence)).toBeUndefined();
    expect(errorDetails("org", evidence)).toContain("id%2Fa");
  });
  it("builds Sessions only from coherent evidence", () => {
    const url = rumEvidence("org", "checkout", arm, {
      error_type: "TypeError",
      error_message: "can't",
    });
    expect(sql(url)).toContain("error_message = 'can''t'");
  });
});
describe("where predicate", () => {
  it("adds an escaped o2_service_where to trace and service error links", () => {
    const where = "k8s:c1/o'shop";
    expect(sql(traceEvidence("org", "checkout", arm, where, endpoint))).toContain(
      "o2_service_where = 'k8s:c1/o''shop'",
    );
    expect(sql(serviceErrors("org", "checkout", arm, where, "readable traces"))).toContain(
      "o2_service_where = 'k8s:c1/o''shop'",
    );
  });
  it("never builds a trace link without a where", () => {
    expect(traceEvidence("org", "checkout", arm, undefined, endpoint)).toBeUndefined();
    expect(serviceErrors("org", "checkout", arm, undefined, "s")).toBeUndefined();
  });
  it("takes A from where_key and B from arms.b.where_key, failing closed for env_fallback", () => {
    expect(armWhere(comparison("previous"), "a")).toBe("k8s:c1/shop");
    expect(armWhere(comparison("env_fallback", "k8s:c2/shop"), "b")).toBe("k8s:c2/shop");
    expect(armWhere(comparison("previous"), "b")).toBe("k8s:c1/shop");
    expect(armWhere(comparison("env_fallback"), "b")).toBeUndefined();
  });
});
