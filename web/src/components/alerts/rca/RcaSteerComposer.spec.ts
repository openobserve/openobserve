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
import { CHIP_HIT_AREA_CLASS } from "@/components/ai-assistant/composer/composerUi";
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

  const openSees = async (wrapper: VueWrapper) => {
    await byTest(wrapper, "rca-steer-sees").trigger("click");
    await flushPromises();
    return (id: string) => document.body.querySelector(`[data-test="${id}"]`);
  };

  it("K6: the same composer frame, steer placeholder and Investigator pill, no helper lines", () => {
    wrapper = mountComposer();

    expect(byTest(wrapper, "assistant-composer-frame").exists()).toBe(true);
    expect(byTest(wrapper, "assistant-composer-strip").exists()).toBe(true);
    expect(textarea(wrapper).attributes("placeholder")).toBe(
      "Steer this run · read after the current step",
    );
    expect(textarea(wrapper).attributes("aria-label")).toBe("Steer this run");
    expect(byTest(wrapper, "assistant-agent-pill").attributes("data-agent")).toBe("sre");
    expect(byTest(wrapper, "assistant-agent-pill").text()).toBe("Investigator");
    const right = byTest(wrapper, "assistant-composer-bar-right");
    expect(right.findAll("button").map((b) => b.attributes("data-test"))).toEqual([
      "rca-steer-send-btn",
    ]);
    expect(byTest(wrapper, "rca-steer-sending-as").exists()).toBe(false);
    expect(
      ["check", "ignore", "focus", "changed"].map((id) =>
        byTest(wrapper, `rca-steer-chip-${id}`).text(),
      ),
    ).toEqual(["Check …", "Ignore …", "Focus on service …", "We changed …"]);
  });

  it("draws the suggestion chips at full strength, never the dimmed ghost-subtle look of a disabled control", () => {
    wrapper = mountComposer();
    const chip = byTest(wrapper, "rca-steer-chip-check");

    expect(chip.classes()).not.toContain("opacity-60");
    expect(chip.classes()).toEqual(
      expect.arrayContaining(["bg-surface-subtle!", "text-text-heading!"]),
    );
  });

  it("B-composer-9: a chip that does not fit on the one row is hidden whole, never cut under ⓘ", async () => {
    const top = vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.dataset.chip === "changed" ? 32 : 0;
    });
    const height = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(24);
    wrapper = mountComposer();
    await flushPromises();

    const row = byTest(wrapper, "rca-steer-chips");
    expect(row.classes()).toEqual(expect.arrayContaining(["flex-wrap", "h-6", "overflow-hidden"]));
    expect(byTest(wrapper, "rca-steer-chip-changed").classes()).toContain("invisible");
    expect(byTest(wrapper, "rca-steer-chip-focus").classes()).not.toContain("invisible");
    top.mockRestore();
    height.mockRestore();
  });

  it("B-composer-16: on touch each chip takes the composer chips' 44 px hit area, inside the row's clip", async () => {
    const top = vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.dataset.chip === "changed" ? 50 : 10;
    });
    const height = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(24);
    wrapper = mountComposer();
    await flushPromises();

    for (const part of CHIP_HIT_AREA_CLASS.split(" "))
      expect(byTest(wrapper, "rca-steer-chip-ignore").classes()).toContain(part);
    expect(byTest(wrapper, "rca-steer-chips").classes()).toEqual(
      expect.arrayContaining(["max-md:h-11", "max-md:py-2.5", "pointer-coarse:py-2.5"]),
    );
    expect(byTest(wrapper, "rca-steer-chip-ignore").classes()).not.toContain("invisible");
    expect(byTest(wrapper, "rca-steer-chip-changed").classes()).toContain("invisible");
    top.mockRestore();
    height.mockRestore();
  });

  it("puts 'Sending as … visible to everyone' in the ⓘ popover, not under the field", async () => {
    wrapper = mountComposer();
    const find = await openSees(wrapper);

    expect(find("rca-steer-sending-as")?.textContent?.trim()).toBe(
      "Sending as a.rao@acme.io · visible to everyone on this incident",
    );
    expect(find("rca-steer-answer-note")).toBeNull();
  });

  it("paused: the strip says the agent asks, with the full question in title=, and ⓘ keeps the answer note", async () => {
    const question = rcaSteeringPaused().open_question;
    wrapper = mountComposer({ waitingInput: true, openQuestion: question });

    const notice = byTest(wrapper, "assistant-composer-notice");
    expect(notice.attributes("title")).toBe(question?.question);
    expect(byTest(wrapper, "assistant-composer-notice-title").text()).toBe("Agent asks");
    expect(byTest(wrapper, "rca-steer-chip-check").exists()).toBe(false);
    const find = await openSees(wrapper);
    expect(find("rca-steer-answer-note")?.textContent?.trim()).toBe(
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

  it("the chips are disabled while a message is sending", () => {
    wrapper = mountComposer({ sending: true });

    for (const id of ["check", "ignore", "focus", "changed"]) {
      expect(byTest(wrapper, `rca-steer-chip-${id}`).attributes("disabled")).toBeDefined();
    }
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

  it("a plain Enter sends like every composer, and Shift+Enter does not", async () => {
    const send = okSend();
    wrapper = mountComposer({ send });
    await textarea(wrapper).setValue("Ignore the canary");

    await textarea(wrapper).trigger("keydown", { key: "Enter", shiftKey: true });
    await flushPromises();
    expect(send).not.toHaveBeenCalled();

    await textarea(wrapper).trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(send).toHaveBeenCalledWith("Ignore the canary");
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
    expect(byTest(wrapper, "assistant-composer-notice").attributes("title")).toBe(
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
