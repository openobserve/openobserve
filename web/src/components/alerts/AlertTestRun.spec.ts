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

import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import grouped from "@/test/fixtures/alerts/evaluate-grouped-fired.json";
import { ALERT_TEST_RUN_KEY, createAlertTestRun } from "@/composables/alerts/useAlertTestRun";
import { testRunKey } from "@/utils/alerts/alertTestRun";
import AlertTestRun from "./AlertTestRun.vue";

const evaluate = vi.fn();
const testSend = vi.fn();
vi.mock("@/services/alerts", () => ({
  default: { evaluate: (...a: unknown[]) => evaluate(...a) },
}));
vi.mock("@/services/alert_destination", () => ({
  default: { testSend: (...a: unknown[]) => testSend(...a) },
}));

const BODY = {
  stream_type: "logs",
  stream_name: "app_logs",
  is_real_time: false,
  query_condition: { type: "custom" },
  trigger_condition: { period: 10, operator: ">=", threshold: 1, frequency: 10, silence: 30 },
} as any;

const blocked = { response: { status: 403, data: { code: 403, message: "Writes are disabled" } } };

const mountRun = (props: Record<string, unknown> = {}) => {
  const run = createAlertTestRun();
  run.currentKey.value = testRunKey(BODY);
  const wrapper = mount(AlertTestRun, {
    props: { body: BODY, folder: "f1", destinations: [], ...props },
    global: { plugins: [i18n, store], provide: { [ALERT_TEST_RUN_KEY]: run } },
  });
  return { wrapper, run };
};
const text = (w: ReturnType<typeof mountRun>["wrapper"], id: string) =>
  w.find(`[data-test="alert-test-run-${id}"]`).text();

afterEach(() => vi.clearAllMocks());

describe("AlertTestRun", () => {
  it("tests the unsaved alert on open and lists the groups that fired", async () => {
    evaluate.mockResolvedValue({ data: grouped });
    const { wrapper } = mountRun();
    await nextTick();
    expect(text(wrapper, "running")).toContain("Testing the last 24 hours");
    await flushPromises();

    expect(evaluate).toHaveBeenCalledWith("default", { alert: BODY }, "f1", expect.anything());
    expect(text(wrapper, "summary")).toContain("would have fired 2 times");
    expect(text(wrapper, "groups")).toContain("checkout");
    expect(text(wrapper, "groups")).toContain("above the threshold in 2 checks");

    await wrapper.find('[data-test="alert-test-run-rerun"]').trigger("click");
    expect(evaluate).toHaveBeenCalledTimes(2);
  });

  it("says in red what stopped the test", async () => {
    evaluate.mockRejectedValue(blocked);
    const { wrapper } = mountRun();
    await flushPromises();

    const failed = wrapper.find('[data-test="alert-test-run-failed"]');
    expect(failed.attributes("role")).toBe("alert");
    expect(failed.classes()).toContain("text-status-error-text");
    expect(failed.text()).toBe("Couldn't test the alert: Writes are disabled");
  });

  it("marks the answer as old once the alert changes", async () => {
    evaluate.mockResolvedValue({ data: grouped });
    const { wrapper, run } = mountRun();
    await flushPromises();
    expect(wrapper.find('[data-test="alert-test-run-stale"]').exists()).toBe(false);

    run.currentKey.value = "another alert";
    await flushPromises();
    expect(run.fresh.value).toBeNull();
    expect(wrapper.find('[data-test="alert-test-run-stale"]').exists()).toBe(true);
  });

  it("keeps only the latest of two runs", async () => {
    let answerFirst: (v: unknown) => void = () => {};
    evaluate
      .mockReturnValueOnce(new Promise((resolve) => (answerFirst = resolve)))
      .mockResolvedValueOnce({ data: grouped });
    const { run } = mountRun();
    void run.run("default", BODY, i18n.global.t as any, "f1");
    await flushPromises();
    answerFirst({ data: { ...grouped, summary: { ...grouped.summary, notifications: 0 } } });
    await flushPromises();
    expect(run.result.value).toEqual(grouped);
  });

  it("closes when a first test is cancelled", async () => {
    evaluate.mockReturnValue(new Promise(() => {}));
    const { wrapper } = mountRun();
    await nextTick();
    await wrapper.find('[data-test="alert-test-run-cancel"]').trigger("click");
    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  it("asks for a destination before it can send a test message", async () => {
    evaluate.mockResolvedValue({ data: grouped });
    const { wrapper } = mountRun();
    await flushPromises();
    expect(wrapper.find('[data-test="alert-test-run-send"]').exists()).toBe(false);
    expect(text(wrapper, "no-destination")).toBe("Pick a destination to send a test message");
  });

  it("sends to every destination after the confirm and says what each answered, once per reason", async () => {
    evaluate.mockResolvedValue({ data: grouped });
    testSend.mockImplementation(({ destination_name }: { destination_name: string }) =>
      destination_name === "slack" ? Promise.resolve({ data: {} }) : Promise.reject(blocked),
    );
    const { wrapper } = mountRun({ destinations: ["slack", "pager", "mail"] });
    await flushPromises();

    await wrapper.find('[data-test="alert-test-run-send"]').trigger("click");
    expect(testSend).not.toHaveBeenCalled();
    wrapper.findComponent({ name: "ConfirmDialog" }).vm.$emit("update:ok");
    await flushPromises();

    expect(testSend).toHaveBeenCalledTimes(3);
    expect(testSend.mock.calls[0][0]).toMatchObject({ org_identifier: "default" });
    expect(testSend.mock.calls[0][0].data.definition).toBeTruthy();
    expect(testSend.mock.calls[0][1]).toEqual({ silentForbidden: true });
    const lines = wrapper.findAll('[data-test="alert-test-run-send-result"]').map((l) => l.text());
    expect(lines).toEqual([
      "Test message sent to slack",
      "Couldn't send the test message to pager and mail: Writes are disabled",
    ]);
  });
});
