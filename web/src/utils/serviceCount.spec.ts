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

import { describe, expect, it } from "vitest";
import { bySignalOrder, serviceNameCount, serviceValueCount } from "./serviceCount";

describe("serviceNameCount", () => {
  it("counts one service per display name, falling back to the key", () => {
    expect(
      serviceNameCount([
        { service_name: "payments-api", display_name: "PaymentService" },
        { service_name: "paymentservice", display_name: "PaymentService" },
        { service_name: "nats" },
        { service_name: "nats", display_name: null },
      ]),
    ).toBe(2);
    expect(serviceNameCount([])).toBe(0);
  });
});

describe("serviceValueCount", () => {
  // A logs-only org: billing-worker runs in namespace jobs, mailer has no namespace.
  const records = [
    { service_name: "billing-worker", all_dimensions: { "k8s-namespace": "jobs" } },
    { service_name: "mailer", all_dimensions: {} },
    { service_name: "payments-api", display_name: "PaymentService", disambiguation: {} },
    { service_name: "paymentservice", display_name: "PaymentService" },
  ];
  it("counts the services carrying the value within the same list the total counts", () => {
    expect(serviceValueCount(records, "k8s-namespace", "jobs")).toBe(1);
    expect(serviceNameCount(records)).toBe(3);
  });
  it("counts a service value by its key, once per display name", () => {
    expect(serviceValueCount(records, "service", "payments-api")).toBe(1);
    expect(serviceValueCount(records, "service", "nope")).toBe(0);
  });
  it("reads the configured disambiguation when a record has no full dimension set", () => {
    expect(
      serviceValueCount(
        [{ service_name: "a", disambiguation: { "k8s-cluster": "walk" } }],
        "k8s-cluster",
        "walk",
      ),
    ).toBe(1);
  });
});

describe("bySignalOrder", () => {
  it("orders Logs, Metrics, Traces, then other signals by name, whatever order came in", () => {
    const signals = ["traces", "rum", "metrics", "alerts", "logs"].map((signal) => ({ signal }));
    expect(bySignalOrder(signals, (item) => item.signal).map((item) => item.signal)).toEqual([
      "logs",
      "metrics",
      "traces",
      "alerts",
      "rum",
    ]);
  });
});
