// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
import { describe, expect, it } from "vitest";
import { generateAlertSummary } from "@/utils/alerts/alertSummaryGenerator";

// Returns the key, so a test asserts which sentence the summary chose.
const t = (key: string) => key;

const scheduledAlert = (type: string) => ({
  stream_name: "default",
  stream_type: "logs",
  is_real_time: "false",
  query_condition: {
    type,
    sql: 'SELECT count(*) FROM "default"',
    multi_time_range: [{ offSet: "1h" }],
  },
  trigger_condition: { period: 10, operator: ">=", threshold: 3, frequency: 10, silence: 10 },
  destinations: [],
});

describe("generateAlertSummary: Compare-with-Past windows", () => {
  it("lists the windows for a SQL alert", () => {
    expect(generateAlertSummary(scheduledAlert("sql"), [], t)).toContain(
      "alerts.summary.timeRangeCount",
    );
  });

  // The payload sends windows only with SQL, so the summary must not promise them.
  it("leaves out windows that a Builder alert does not save", () => {
    expect(generateAlertSummary(scheduledAlert("custom"), [], t)).not.toContain(
      "alerts.summary.timeRangeCount",
    );
  });
});
