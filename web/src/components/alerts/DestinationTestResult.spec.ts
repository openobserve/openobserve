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

import { describe, expect, it, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";

import DestinationTestResult from "@/components/alerts/DestinationTestResult.vue";

let wrapper: ReturnType<typeof mount> | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

const makeResult = (overrides: Record<string, any> = {}) => ({
  success: true,
  statusCode: 200,
  responseTime: 120,
  error: undefined,
  ...overrides,
});

async function mountComp(props: Record<string, any> = {}) {
  return mount(DestinationTestResult, {
    props,
    global: {
      plugins: [i18n],
    },
  });
}

describe("DestinationTestResult - idle state", () => {
  it("renders the wrapper element", async () => {
    wrapper = await mountComp();

    expect(wrapper.find('[data-test="destination-test-result"]').exists()).toBe(true);
  });

  it("shows idle state when no result and not loading", async () => {
    wrapper = await mountComp();

    expect(wrapper.find('[data-test="test-result-idle"]').exists()).toBe(true);
  });

  it("does not show success, failure, or loading when idle", async () => {
    wrapper = await mountComp();

    expect(wrapper.find('[data-test="test-result-success"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="test-result-failure"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="test-result-loading"]').exists()).toBe(false);
  });
});

describe("DestinationTestResult - loading state", () => {
  it("shows loading state when isLoading=true and result is null", async () => {
    wrapper = await mountComp({ isLoading: true });

    expect(wrapper.find('[data-test="test-result-loading"]').exists()).toBe(true);
  });

  it("does not show idle or success when loading with no result", async () => {
    wrapper = await mountComp({ isLoading: true });

    expect(wrapper.find('[data-test="test-result-idle"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="test-result-success"]').exists()).toBe(false);
  });
});

describe("DestinationTestResult - success state", () => {
  it("shows success state when result.success=true", async () => {
    wrapper = await mountComp({ result: makeResult({ success: true }) });

    expect(wrapper.find('[data-test="test-result-success"]').exists()).toBe(true);
  });

  it("shows success message element", async () => {
    wrapper = await mountComp({ result: makeResult({ success: true }) });

    expect(wrapper.find('[data-test="test-success-message"]').exists()).toBe(true);
  });

  it("shows the formatted timestamp when provided", async () => {
    wrapper = await mountComp({
      result: makeResult({ success: true, timestamp: Date.now() }),
    });

    expect(wrapper.find('[data-test="test-success-timestamp"]').text()).not.toBe("");
  });

  it("does not show failure or idle when success", async () => {
    wrapper = await mountComp({ result: makeResult({ success: true }) });

    expect(wrapper.find('[data-test="test-result-failure"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="test-result-idle"]').exists()).toBe(false);
  });

  it("shows the status code on success", async () => {
    wrapper = await mountComp({ result: makeResult({ success: true, statusCode: 200 }) });

    expect(wrapper.find('[data-test="test-success-timestamp"]').text()).toContain("200");
  });
});

describe("DestinationTestResult - failure state", () => {
  it("shows failure state when result.success=false", async () => {
    wrapper = await mountComp({
      result: makeResult({ success: false, error: "Connection failed" }),
    });

    expect(wrapper.find('[data-test="test-result-failure"]').exists()).toBe(true);
  });

  it("shows failure message element", async () => {
    wrapper = await mountComp({
      result: makeResult({ success: false, error: "Connection refused" }),
    });

    expect(wrapper.find('[data-test="test-failure-message"]').exists()).toBe(true);
  });

  it("shows retry button in failure state", async () => {
    wrapper = await mountComp({
      result: makeResult({ success: false, error: "Timeout" }),
    });

    expect(wrapper.find('[data-test="test-retry-button"]').exists()).toBe(true);
  });

  it("emits retry event when retry button is clicked", async () => {
    wrapper = await mountComp({
      result: makeResult({ success: false, error: "Timeout" }),
    });

    await wrapper.find('[data-test="test-retry-button"]').trigger("click");

    expect(wrapper.emitted("retry")).toBeTruthy();
    expect(wrapper.emitted("retry")!.length).toBe(1);
  });

  it("does not show success or idle when failure", async () => {
    wrapper = await mountComp({
      result: makeResult({ success: false, error: "fail" }),
    });

    expect(wrapper.find('[data-test="test-result-success"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="test-result-idle"]').exists()).toBe(false);
  });
});

describe("DestinationTestResult - getFailureMessage logic", () => {
  it("handles DNS error keyword in error string", async () => {
    wrapper = await mountComp({
      result: makeResult({ success: false, error: "ENOTFOUND hostname.com" }),
    });

    const msg = wrapper.find('[data-test="test-failure-message"]').text();
    expect(msg.length).toBeGreaterThan(0);
  });

  it("handles connection refused error keyword", async () => {
    wrapper = await mountComp({
      result: makeResult({ success: false, error: "ECONNREFUSED 127.0.0.1" }),
    });

    const msg = wrapper.find('[data-test="test-failure-message"]').text();
    expect(msg.length).toBeGreaterThan(0);
  });

  it("handles SSL certificate error keyword", async () => {
    wrapper = await mountComp({
      result: makeResult({ success: false, error: "certificate verify failed" }),
    });

    const msg = wrapper.find('[data-test="test-failure-message"]').text();
    expect(msg.length).toBeGreaterThan(0);
  });

  it("shows generic error message directly for unrecognised error", async () => {
    wrapper = await mountComp({
      result: makeResult({ success: false, error: "Some random error" }),
    });

    const msg = wrapper.find('[data-test="test-failure-message"]').text();
    expect(msg).toContain("Some random error");
  });

  it.each([
    { statusCode: 400, key: "alerts.testErrorClientError" },
    { statusCode: 500, key: "alerts.testErrorServerError" },
  ])(
    "prefers the translated status message to the error for $statusCode",
    async ({ statusCode, key }) => {
      wrapper = await mountComp({
        result: makeResult({ success: false, statusCode, error: "backend-error" }),
      });

      const msg = wrapper.find('[data-test="test-failure-message"]').text();
      expect(msg).toBe(i18n.global.t(key));
      expect(wrapper.text()).not.toContain("backend-error");
    },
  );
});

describe("DestinationTestResult - getSuggestedFix", () => {
  it("returns null suggestion when there is no error or statusCode", async () => {
    wrapper = await mountComp({ result: makeResult({ success: false }) });

    const fix = (wrapper.vm as any).getSuggestedFix({ success: false });
    expect(fix).toBeNull();
  });

  it("suggests checking credentials for 401 status", async () => {
    wrapper = await mountComp({
      result: makeResult({ success: false, statusCode: 401 }),
    });

    const fix = (wrapper.vm as any).getSuggestedFix({ statusCode: 401 });
    expect(fix).toBeTruthy();
  });
});

describe("DestinationTestResult - generic sample", () => {
  it("says the connection was checked, not the template, after a generic-sample test", async () => {
    wrapper = await mountComp({ result: makeResult({ genericSample: true }) });
    const text = wrapper.get('[data-test="test-success-message"]').text();
    expect(text).toContain("generic sample, not your template");
    expect(text).not.toContain("configured correctly");
  });

  it("keeps the configured text when the test sent the template", async () => {
    wrapper = await mountComp({ result: makeResult() });
    expect(wrapper.get('[data-test="test-success-message"]').text()).toContain(
      "configured correctly",
    );
  });
});
