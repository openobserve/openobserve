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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";

import type { AssistantUsage } from "@/services/assistant";

import { CREDIT_NOTICE_PREFIX, useCreditNotice } from "./useAssistantCredits";

const track = vi.hoisted(() => vi.fn());
vi.mock("@/services/assistantAnalytics", () => ({ trackAssistant: track }));

const usage = (mode: AssistantUsage["mode"], used: number, limit = 1000): AssistantUsage => ({
  mode,
  credits_used: used,
  credits_limit: limit,
});

function setup(initial: AssistantUsage | null, key = "u1") {
  const value = ref<AssistantUsage | null>(initial);
  const visible = ref(true);
  const scope = effectScope();
  const notice = scope.run(() =>
    useCreditNotice(
      () => key,
      () => value.value,
      () => visible.value,
    ),
  )!;
  return { value, visible, notice, stop: () => scope.stop() };
}

describe("useCreditNotice", () => {
  beforeEach(() => {
    localStorage.clear();
    track.mockClear();
  });
  afterEach(() => localStorage.clear());

  it("shows once at 70 % in free mode and never below it", () => {
    const below = setup(usage("free", 699));
    expect(below.notice.threshold.value).toBeNull();
    below.stop();
    const at = setup(usage("free", 700));
    expect(at.notice.threshold.value).toBe(70);
    expect(track).toHaveBeenCalledWith(
      "ai_credit_notice",
      expect.objectContaining({ action: "shown", threshold: 70 }),
    );
    at.stop();
  });

  it("stays dismissed for the threshold and comes back once at 90 %", async () => {
    const first = setup(usage("free", 712));
    first.notice.dismiss();
    expect(first.notice.threshold.value).toBeNull();
    expect(localStorage.getItem(`${CREDIT_NOTICE_PREFIX}u1:70`)).not.toBeNull();
    first.value.value = usage("free", 905);
    await nextTick();
    expect(first.notice.threshold.value).toBe(90);
    first.stop();
    const reload = setup(usage("free", 712));
    expect(reload.notice.threshold.value).toBeNull();
    reload.stop();
  });

  it("warns again in the next credit period", () => {
    const march = setup({ ...usage("free", 712), resetsAt: 1000 });
    march.notice.dismiss();
    march.stop();
    expect(setup({ ...usage("free", 712), resetsAt: 1000 }).notice.threshold.value).toBeNull();
    expect(setup({ ...usage("free", 712), resetsAt: 2000 }).notice.threshold.value).toBe(70);
  });

  it("closes in this tab when another tab dismisses first", async () => {
    const tab = setup(usage("free", 712));
    expect(tab.notice.threshold.value).toBe(70);
    localStorage.setItem(`${CREDIT_NOTICE_PREFIX}u1:70`, "1");
    window.dispatchEvent(new StorageEvent("storage", { key: `${CREDIT_NOTICE_PREFIX}u1:70` }));
    await nextTick();
    expect(tab.notice.threshold.value).toBeNull();
    tab.stop();
  });

  it("never shows outside free mode, with no included credits, or while hidden", async () => {
    for (const mode of ["pay_as_you_go", "consent_required", "exhausted"] as const) {
      const other = setup(usage(mode, 800));
      expect(other.notice.threshold.value).toBeNull();
      other.stop();
    }
    const none = setup(usage("free", 0, 0));
    expect(none.notice.threshold.value).toBeNull();
    none.stop();
    const live = setup(usage("free", 712));
    live.value.value = usage("pay_as_you_go", 1200);
    await nextTick();
    expect(live.notice.threshold.value).toBeNull();
    live.visible.value = false;
    live.value.value = usage("free", 712);
    await nextTick();
    expect(live.notice.threshold.value).toBeNull();
    live.stop();
  });

  it("reports shown once per notice, not on every panel reopen", async () => {
    const tab = setup(usage("free", 712));
    tab.visible.value = false;
    await nextTick();
    tab.visible.value = true;
    await nextTick();
    expect(tab.notice.threshold.value).toBe(70);
    const shown = track.mock.calls.filter(([, event]) => event.action === "shown");
    expect(shown).toHaveLength(1);
    tab.stop();
  });

  it("still closes for this page when storage throws", () => {
    const tab = setup(usage("free", 712));
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("private mode");
    });
    tab.notice.dismiss();
    expect(tab.notice.threshold.value).toBeNull();
    spy.mockRestore();
    tab.stop();
  });
});
