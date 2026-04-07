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

import { describe, expect, it, beforeEach, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar({ plugins: [Dialog, Notify] });

import DestinationTestResult from "@/components/alerts/DestinationTestResult.vue";

const makeResult = (overrides: Record<string, any> = {}) => ({
  success: true,
  timestamp: 1700000000000,
  statusCode: 200,
  responseTime: 120,
  error: undefined,
  responseBody: undefined,
  ...overrides,
});

async function mountComp(props: Record<string, any> = {}) {
  return mount(DestinationTestResult, {
    props,
    global: { plugins: [i18n, store] },
  });
}

describe("DestinationTestResult - idle state", () => {
  it("shows idle state when no result and not loading", async () => {
    const w = await mountComp();
    expect(w.find('[data-test="test-result-idle"]').exists()).toBe(true);
  });

  it("does not show success/failure/loading when idle", async () => {
    const w = await mountComp();
    expect(w.find('[data-test="test-result-success"]').exists()).toBe(false);
    expect(w.find('[data-test="test-result-failure"]').exists()).toBe(false);
    expect(w.find('[data-test="test-result-loading"]').exists()).toBe(false);
  });

  it("renders destination-test-result wrapper", async () => {
    const w = await mountComp();
    expect(w.find('[data-test="destination-test-result"]').exists()).toBe(true);
  });
});

describe("DestinationTestResult - loading state", () => {
  it("shows loading state when isLoading=true and no result", async () => {
    const w = await mountComp({ isLoading: true });
    expect(w.find('[data-test="test-result-loading"]').exists()).toBe(true);
  });

  it("does not show idle or success when loading", async () => {
    const w = await mountComp({ isLoading: true });
    expect(w.find('[data-test="test-result-idle"]').exists()).toBe(false);
    expect(w.find('[data-test="test-result-success"]').exists()).toBe(false);
  });
});

describe("DestinationTestResult - success state", () => {
  it("shows success state when result.success=true", async () => {
    const w = await mountComp({ result: makeResult({ success: true }) });
    expect(w.find('[data-test="test-result-success"]').exists()).toBe(true);
  });

  it("shows success message", async () => {
    const w = await mountComp({ result: makeResult({ success: true }) });
    expect(w.find('[data-test="test-success-message"]').exists()).toBe(true);
  });

  it("shows timestamp in success state", async () => {
    const w = await mountComp({ result: makeResult({ success: true, timestamp: 1700000000000 }) });
    expect(w.find('[data-test="test-success-timestamp"]').exists()).toBe(true);
  });

  it("does not show failure or idle when success", async () => {
    const w = await mountComp({ result: makeResult({ success: true }) });
    expect(w.find('[data-test="test-result-failure"]').exists()).toBe(false);
    expect(w.find('[data-test="test-result-idle"]').exists()).toBe(false);
  });
});

describe("DestinationTestResult - failure state", () => {
  it("shows failure state when result.success=false", async () => {
    const w = await mountComp({ result: makeResult({ success: false, error: "Connection failed" }) });
    expect(w.find('[data-test="test-result-failure"]').exists()).toBe(true);
  });

  it("shows failure message", async () => {
    const w = await mountComp({ result: makeResult({ success: false, error: "Connection refused" }) });
    expect(w.find('[data-test="test-failure-message"]').exists()).toBe(true);
  });

  it("shows retry button in failure state", async () => {
    const w = await mountComp({ result: makeResult({ success: false, error: "Timeout" }) });
    expect(w.find('[data-test="test-retry-button"]').exists()).toBe(true);
  });

  it("emits retry event when retry button is clicked", async () => {
    const w = await mountComp({ result: makeResult({ success: false, error: "Timeout" }) });
    await w.find('[data-test="test-retry-button"]').trigger("click");
    expect(w.emitted("retry")).toBeTruthy();
    expect(w.emitted("retry")!.length).toBe(1);
  });

  it("shows failure timestamp when available", async () => {
    const w = await mountComp({ result: makeResult({ success: false, error: "err", timestamp: 1700000000000 }) });
    expect(w.find('[data-test="test-failure-timestamp"]').exists()).toBe(true);
  });

  it("shows expansion item when error detail exists", async () => {
    const w = await mountComp({ result: makeResult({ success: false, error: "detail error", responseBody: undefined }) });
    expect(w.find('[data-test="test-failure-details-expansion"]').exists()).toBe(true);
  });
});

describe("DestinationTestResult - getFailureMessage logic", () => {
  it("handles DNS error in error string", async () => {
    const w = await mountComp({ result: makeResult({ success: false, error: "ENOTFOUND hostname.com" }) });
    const msg = w.find('[data-test="test-failure-message"]').text();
    // Should have some message (dns-related)
    expect(msg.length).toBeGreaterThan(0);
  });

  it("handles connection refused error", async () => {
    const w = await mountComp({ result: makeResult({ success: false, error: "ECONNREFUSED 127.0.0.1" }) });
    const msg = w.find('[data-test="test-failure-message"]').text();
    expect(msg.length).toBeGreaterThan(0);
  });

  it("handles SSL error in error string", async () => {
    const w = await mountComp({ result: makeResult({ success: false, error: "certificate verify failed" }) });
    const msg = w.find('[data-test="test-failure-message"]').text();
    expect(msg.length).toBeGreaterThan(0);
  });

  it("handles generic error message", async () => {
    const w = await mountComp({ result: makeResult({ success: false, error: "Some random error" }) });
    const msg = w.find('[data-test="test-failure-message"]').text();
    expect(msg).toContain("Some random error");
  });

  it("parses JSON responseBody to extract error message", async () => {
    const w = await mountComp({
      result: makeResult({ success: false, responseBody: JSON.stringify({ error: "Invalid token" }) })
    });
    const msg = w.find('[data-test="test-failure-message"]').text();
    expect(msg).toContain("Invalid token");
  });

  it("falls back to status code message for 4xx", async () => {
    const w = await mountComp({ result: makeResult({ success: false, statusCode: 400 }) });
    const msg = w.find('[data-test="test-failure-message"]').text();
    expect(msg.length).toBeGreaterThan(0);
  });

  it("falls back to status code message for 5xx", async () => {
    const w = await mountComp({ result: makeResult({ success: false, statusCode: 500 }) });
    const msg = w.find('[data-test="test-failure-message"]').text();
    expect(msg.length).toBeGreaterThan(0);
  });
});
