import { describe, it, expect } from "vitest";
import {
  renderTemplate,
  buildPreviewContext,
  type PreviewContext,
} from "@/composables/alerts/useTemplatePreview";

const ctx: PreviewContext = {
  live: { alert_name: "High CPU", stream_name: "k8s_logs" },
  sample: { alert_count: "42", org_name: "acme" },
};

describe("renderTemplate", () => {
  it("substitutes live scalars as live segments", () => {
    const segs = renderTemplate("Alert {alert_name} fired", ctx);
    expect(segs).toEqual([
      { kind: "text", text: "Alert " },
      { kind: "live", text: "High CPU" },
      { kind: "text", text: " fired" },
    ]);
  });

  it("substitutes mock values as sample segments", () => {
    const segs = renderTemplate("count={alert_count}", ctx);
    expect(segs).toEqual([
      { kind: "text", text: "count=" },
      { kind: "sample", text: "42" },
    ]);
  });

  it("renders {rows} and {rows:N} as opaque chips, never faked", () => {
    expect(renderTemplate("{rows}", ctx)).toEqual([
      { kind: "opaque", text: "{rows}" },
    ]);
    expect(renderTemplate("{rows:5}", ctx)).toEqual([
      { kind: "opaque", text: "{rows:5}" },
    ]);
  });

  it("renders {var:N} and spread {...rows} as opaque chips", () => {
    expect(renderTemplate("{var:10}", ctx)[0]).toEqual({
      kind: "opaque",
      text: "{var:10}",
    });
    expect(renderTemplate("{...rows}", ctx)[0]).toEqual({
      kind: "opaque",
      text: "{...rows}",
    });
    expect(renderTemplate("{...rows:3}", ctx)[0]).toEqual({
      kind: "opaque",
      text: "{...rows:3}",
    });
  });

  it("renders unknown tokens (stream fields, user vars) as opaque chips", () => {
    expect(renderTemplate("{k8s_pod_name}", ctx)[0]).toEqual({
      kind: "opaque",
      text: "{k8s_pod_name}",
    });
  });

  it("opaque row patterns win over a same-named live/sample key", () => {
    const ctx2: PreviewContext = { live: { rows: "SHOULD_NOT_USE" }, sample: {} };
    expect(renderTemplate("{rows}", ctx2)[0]).toEqual({
      kind: "opaque",
      text: "{rows}",
    });
  });

  it("returns a single text segment when there are no tokens", () => {
    expect(renderTemplate("plain text", ctx)).toEqual([
      { kind: "text", text: "plain text" },
    ]);
  });

  it("handles empty input", () => {
    expect(renderTemplate("", ctx)).toEqual([]);
  });
});

describe("buildPreviewContext", () => {
  it("puts provided form facts in `live`", () => {
    const ctx = buildPreviewContext({
      alert_name: "High CPU",
      stream_name: "k8s_logs",
      alert_threshold: 5,
    });
    expect(ctx.live.alert_name).toBe("High CPU");
    expect(ctx.live.stream_name).toBe("k8s_logs");
    expect(ctx.live.alert_threshold).toBe("5"); // coerced to string
  });

  it("omits absent facts from `live`", () => {
    const ctx = buildPreviewContext({ alert_name: "X" });
    expect("stream_name" in ctx.live).toBe(false);
  });

  it("provides deterministic mock runtime values in `sample`", () => {
    const ctx = buildPreviewContext({});
    expect(ctx.sample.alert_count).toBe("42");
    expect(ctx.sample.org_name).toBe("acme-corp");
    expect(ctx.sample.alert_trigger_time).toBe("2026-06-28T10:30:00Z");
  });

  it("renders a mixed template end to end", () => {
    const ctx = buildPreviewContext({ alert_name: "High CPU" });
    const segs = renderTemplate(
      "{alert_name} count {alert_count} rows {rows}",
      ctx,
    );
    expect(segs.map((s) => s.kind)).toEqual([
      "live", // alert_name
      "text",
      "sample", // alert_count
      "text",
      "opaque", // {rows}
    ]);
  });

  it("treats the user's context variables as live data", () => {
    const ctx = buildPreviewContext(
      {},
      { contextVariables: { service_name: "checkout", env: "prod" } },
    );
    expect(ctx.live.service_name).toBe("checkout");
    const segs = renderTemplate("svc {service_name} in {env}", ctx);
    expect(segs).toEqual([
      { kind: "text", text: "svc " },
      { kind: "live", text: "checkout" },
      { kind: "text", text: " in " },
      { kind: "live", text: "prod" },
    ]);
  });

  it("omits empty/blank context variables from live", () => {
    const ctx = buildPreviewContext(
      {},
      { contextVariables: { good: "x", blank: "", "": "noKey" } },
    );
    expect(ctx.live.good).toBe("x");
    expect("blank" in ctx.live).toBe(false);
    expect("" in ctx.live).toBe(false);
  });

  it("does NOT fake stream field values — they stay opaque", () => {
    // We know the field NAME but not its runtime value, so it must chip,
    // not render a fabricated value.
    const ctx = buildPreviewContext(
      {},
      { streamFields: ["k8s_pod_name", "host"] },
    );
    expect("k8s_pod_name" in ctx.live).toBe(false);
    expect("host" in ctx.live).toBe(false);
    const segs = renderTemplate("pod {k8s_pod_name}", ctx);
    expect(segs[1]).toEqual({ kind: "opaque", text: "{k8s_pod_name}" });
  });

  it("context variable wins over the same-named fact (user's typed value)", () => {
    const ctx = buildPreviewContext(
      { alert_name: "fact-name" },
      { contextVariables: { alert_name: "user-typed" } },
    );
    expect(ctx.live.alert_name).toBe("user-typed");
  });
});
