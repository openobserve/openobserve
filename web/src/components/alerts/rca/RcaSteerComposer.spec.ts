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
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import { raw } from "@/types/i18n";
import RcaSteerComposer from "./RcaSteerComposer.vue";
import type { RcaSteerSendResult } from "@/composables/useRcaSteering";
import { rcaSteeringPaused } from "@/test/unit/fixtures/rcaThread";

const okSend = () =>
  vi.fn<(text: string) => Promise<RcaSteerSendResult>>(async () => ({ ok: true }));

const mountComposer = (props: Record<string, unknown> = {}) =>
  mount(RcaSteerComposer, {
    props: {
      waitingInput: false,
      authorEmail: "a.rao@acme.io",
      send: okSend(),
      runId: "run-2",
      ...props,
    },
    global: { plugins: [i18n] },
    attachTo: document.body,
  });

const byTest = (wrapper: VueWrapper, id: string) => wrapper.find(`[data-test="${id}"]`);
const textarea = (wrapper: VueWrapper) => wrapper.find("textarea");

describe("RcaSteerComposer (04 SG37, §3 frames F and D)", () => {
  let wrapper: VueWrapper;
  afterEach(() => wrapper?.unmount());

  it("frame F: title, chips, 'Sending as …' and no question", () => {
    wrapper = mountComposer();

    expect(wrapper.text()).toContain("Steer this run");
    expect(byTest(wrapper, "rca-steer-sending-as").text()).toBe(
      "Sending as a.rao@acme.io · visible to everyone on this incident",
    );
    expect(
      ["check", "ignore", "focus", "changed"].map((id) =>
        byTest(wrapper, `rca-steer-chip-${id}`).text(),
      ),
    ).toEqual(["Check …", "Ignore …", "Focus on service …", "We changed …"]);
    expect(byTest(wrapper, "rca-steer-question").exists()).toBe(false);
    expect(byTest(wrapper, "rca-steer-answer-note").exists()).toBe(false);
  });

  it("frame D: 'Agent asks …' with the open question and the answer note", () => {
    const question = rcaSteeringPaused().open_question;
    wrapper = mountComposer({ waitingInput: true, openQuestion: question });

    expect(wrapper.text()).toContain("Answer the agent");
    expect(byTest(wrapper, "rca-steer-question").text().replace(/\s+/g, " ")).toBe(
      `Agent asks: ${question?.question}`,
    );
    expect(byTest(wrapper, "rca-steer-answer-note").text()).toBe(
      "Your answer is a lead, not evidence. It can move the hypothesis to Likely. Root cause needs a tool result.",
    );
  });

  it("a chip prefills its text and focuses the box", async () => {
    wrapper = mountComposer();

    await byTest(wrapper, "rca-steer-chip-focus").trigger("click");
    await flushPromises();

    const box = textarea(wrapper).element as HTMLTextAreaElement;
    expect(box.value).toBe("Focus on service ");
    expect(document.activeElement).toBe(box);
  });

  it("caps the message at 2,000 characters", () => {
    wrapper = mountComposer();
    expect(textarea(wrapper).attributes("maxlength")).toBe("2000");
  });

  it("Send is disabled for an empty or blank message", async () => {
    wrapper = mountComposer();
    const send = byTest(wrapper, "rca-steer-send-btn");
    expect(send.attributes("disabled")).toBeDefined();
    await textarea(wrapper).setValue("   ");
    expect(send.attributes("disabled")).toBeDefined();
  });

  it("Send posts the trimmed text and clears the box on success", async () => {
    const send = okSend();
    wrapper = mountComposer({ send });
    await textarea(wrapper).setValue("  Check the orders pool  ");

    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(send).toHaveBeenCalledWith("Check the orders pool");
    expect((textarea(wrapper).element as HTMLTextAreaElement).value).toBe("");
  });

  it.each([
    ["Ctrl", { ctrlKey: true }],
    ["Cmd", { metaKey: true }],
  ])("%s+Enter sends", async (_name, modifier) => {
    const send = okSend();
    wrapper = mountComposer({ send });
    await textarea(wrapper).setValue("Ignore the canary");

    await textarea(wrapper).trigger("keydown", { key: "Enter", ...modifier });
    await flushPromises();

    expect(send).toHaveBeenCalledWith("Ignore the canary");
  });

  it("a plain Enter does not send", async () => {
    const send = okSend();
    wrapper = mountComposer({ send });
    await textarea(wrapper).setValue("Ignore the canary");

    await textarea(wrapper).trigger("keydown", { key: "Enter" });
    await flushPromises();

    expect(send).not.toHaveBeenCalled();
  });

  it("a 429 shows its retry time and keeps the text", async () => {
    const send = vi.fn(async (): Promise<RcaSteerSendResult> => ({
      ok: false,
      code: "rate_limited",
      message: raw("Too many messages. You can send again at 12:00:45."),
    }));
    wrapper = mountComposer({ send });
    await textarea(wrapper).setValue("Check the pool");

    await wrapper.find("form").trigger("submit");
    await flushPromises();

    expect(byTest(wrapper, "rca-steer-error").text()).toContain(
      "Too many messages. You can send again at 12:00:45.",
    );
    expect((textarea(wrapper).element as HTMLTextAreaElement).value).toBe("Check the pool");
  });

  it.each(["run_closing", "run_not_steerable"])(
    "a 409 %s shows no inline error and keeps the text; the column that owns send reports it (SG40)",
    async (code) => {
      const send = vi.fn(async (): Promise<RcaSteerSendResult> => ({
        ok: false,
        code,
        message: raw("refused"),
      }));
      wrapper = mountComposer({ send });
      await textarea(wrapper).setValue("PR #812 went out at 14:02");

      await wrapper.find("form").trigger("submit");
      await flushPromises();

      expect(send).toHaveBeenCalledWith("PR #812 went out at 14:02");
      expect(byTest(wrapper, "rca-steer-error").exists()).toBe(false);
      expect((textarea(wrapper).element as HTMLTextAreaElement).value).toBe(
        "PR #812 went out at 14:02",
      );
    },
  );
});
