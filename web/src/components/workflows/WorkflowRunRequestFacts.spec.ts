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
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import WorkflowRunRequestFacts from "./WorkflowRunRequestFacts.vue";

const facts = (over: Record<string, unknown> = {}) => ({
  credential_prefix: "o2wh_4fK9…oI4k",
  caller_ip: "203.0.113.24",
  idempotency_key: "deploy-d-4821",
  content_type: "application/json",
  body_bytes: 68,
  status: "failed" as const,
  error: null,
  ...over,
});
const headers = {
  "content-type": "application/json",
  "user-agent": "deploy-bot/2.4",
  "idempotency-key": "deploy-d-4821",
  "x-request-id": "5c1e9a0b",
};

const TableStub = {
  name: "OTable",
  props: ["data", "columns", "rowKey", "pagination", "showGlobalFilter", "dense", "frame"],
  template: `<div class="o-table"><div v-for="r in data" :key="r.name" class="o-row">{{ r.name }}={{ r.value }}</div></div>`,
};

const mountFacts = (props: Record<string, unknown> = {}) =>
  mount(WorkflowRunRequestFacts, {
    props: { facts: facts(), receivedAt: 1_792_575_542_418_000, headers, ...props },
    global: {
      plugins: [i18n, store],
      stubs: {
        OTable: TableStub,
        OTimeCell: {
          name: "OTimeCell",
          props: ["value", "unit", "mode", "format"],
          template: "<time />",
        },
      },
    },
  });

describe("WorkflowRunRequestFacts", () => {
  it("shows the request facts from http_request", () => {
    const w = mountFacts();
    const req = w.find('[data-test="workflow-run-request"]');
    expect(req.exists()).toBe(true);
    const text = req.text();
    for (const label of [
      "Received",
      "Token",
      "Caller IP",
      "Idempotency key",
      "Content type",
      "Body size",
    ])
      expect(text).toContain(label);
    expect(text).toContain("o2wh_4fK9…oI4k");
    expect(text).toContain("203.0.113.24");
    expect(text).toContain("deploy-d-4821");
    expect(text).toContain("application/json");
    expect(text).toContain("68 B");
    expect(w.findComponent({ name: "OTimeCell" }).props("value")).toBe(1_792_575_542_418_000);
    expect(w.findComponent({ name: "OTimeCell" }).props("format")).toBe("MMM d, yyyy HH:mm");
  });

  it("shows — for a fact the ledger does not hold", () => {
    const w = mountFacts({ facts: facts({ idempotency_key: null, content_type: null }) });
    const items = w.findAll('[data-test="o2-description-item"]').map((i) => i.text());
    expect(items.find((t) => t.startsWith("Idempotency key"))).toContain("—");
    expect(items.find((t) => t.startsWith("Content type"))).toContain("—");
  });

  it("lists the kept headers and says what is never stored", () => {
    const w = mountFacts();
    const box = w.find('[data-test="workflow-run-headers"]');
    expect(box.text()).toContain("Headers");
    expect(box.text()).toContain("4 kept · Authorization, cookies and signatures are never stored");
    const rows = w.findAll(".o-row").map((r) => r.text());
    expect(rows).toEqual([
      "content-type=application/json",
      "user-agent=deploy-bot/2.4",
      "idempotency-key=deploy-d-4821",
      "x-request-id=5c1e9a0b",
    ]);
  });

  it("formats a larger body in KiB", () => {
    const w = mountFacts({ facts: facts({ body_bytes: 1536 }) });
    expect(w.find('[data-test="workflow-run-request"]').text()).toContain("1.5 KiB");
  });
});
