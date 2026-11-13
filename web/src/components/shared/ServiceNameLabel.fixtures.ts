import type { ServiceRefRow } from "@/types/serviceRef";

// Display fields, trimmed and anonymised, of the Stage 8 run's service_streams_after_collision rows.
export const labelRows = {
  sameName: {
    service_name: "checkoutservice",
    display_name: "CheckoutService",
    display_source: "trace",
  },
  differs: {
    service_name: "payments-api",
    display_name: "PaymentService",
    display_source: "alias:k8s_workload",
  },
  ambiguous: {
    service_name: "openobserve",
    display_name: "openobserve",
    display_source: "detection_ambiguous",
    display_candidates: ["compactor", "ingester", "querier"],
  },
  detectedOnly: { service_name: "nats", display_name: "nats", display_source: "detection" },
  qualified: {
    service_name: "pentest-openobserve-alertquerier",
    display_name: "querier",
    display_source: "alias:k8s_workload",
    display_qualifier: "pentest",
  },
  placeholder: {
    service_name: "unknown_service:node",
    display_name: "unknown_service:node",
    display_source: "trace",
  },
  rename: {
    service_name: "legacy-cart",
    display_name: "CartService",
    display_source: "alias:rename",
  },
  // A golden row as an OSS build or a region without the display index sends it: key only.
  noDisplay: { service_name: "stock-svc" },
} satisfies Record<string, ServiceRefRow>;

// first_event of the golden traces_latest_hit, which carries the span version.
export const goldenTraceFirstEvent = {
  o2_service_version: "v1.0.0",
  operation_name: "GET /",
  service_name: "CheckoutService",
};
