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
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import { queryClient } from "@/composables/query/queryClient";
import { toast } from "@/lib/feedback/Toast/useToast";
import slack from "@/services/slack";
import autoobserve from "@/services/autoobserve";
import destinationService from "@/services/alert_destination";
import type { InstallationView, SlackInsightsSettings } from "@/types/slack";
import { axiosError, installationView, makeSlackStore, ok } from "@/test/unit/helpers/slack";
import fixture from "./__fixtures__/slackInsightsSettings.json";
import SlackInsightsSection from "./SlackInsightsSection.vue";

// JSDOM has no layout, so the real virtualizer renders no rows; render them all.
vi.mock("@tanstack/vue-virtual", async () => {
  const { computed, unref } = await import("vue");
  return {
    useVirtualizer: (options: any) =>
      computed(() => {
        const count = unref(options).count;
        return {
          getVirtualItems: () =>
            Array.from({ length: count }, (_, index) => ({
              index,
              key: index,
              start: index * 28,
              size: 28,
              end: (index + 1) * 28,
              lane: 0,
            })),
          getTotalSize: () => count * 28,
          scrollToIndex: () => {},
          measureElement: () => {},
        };
      }),
  };
});
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));
vi.mock("@/services/alert_destination", () => ({ default: { list: vi.fn() } }));
vi.mock("@/services/autoobserve", () => ({
  default: { incidents: vi.fn(), suggestions: vi.fn() },
}));
vi.mock("@/services/slack", () => ({
  default: {
    getInsightsSettings: vi.fn(),
    putInsightsSettings: vi.fn(),
    listChannels: vi.fn(),
  },
}));

const settings = (name: "adminOneChannel" | "noChannel" | "member") =>
  structuredClone(fixture[name]) as SlackInsightsSettings;

const failure = (name: "staleRevision" | "notInChannel") => {
  const { status, body } = fixture[name];
  return Object.assign(new Error(body.message), { response: { status, data: body } });
};

// 2026-11-09 16:00 UTC is 11:00 in New York, the same local day as the fixture's 09:00 digest.
const NOW = Date.UTC(2026, 10, 9, 16, 0);

let wrapper: VueWrapper | null = null;

const mountSection = async (
  data: SlackInsightsSettings,
  installations: InstallationView[] = [installationView({ team_name: "demo-workspace" })],
) => {
  queryClient.clear();
  vi.mocked(slack.getInsightsSettings).mockReturnValue(ok(data) as any);
  wrapper = mount(SlackInsightsSection, {
    props: { installations },
    attachTo: document.body,
    global: { plugins: [i18n, makeSlackStore()] },
  });
  await flushPromises();
  return wrapper;
};

const find = (w: VueWrapper, id: string) => w.find(`[data-test="${id}"]`);
const toggle = async (w: VueWrapper, id: string) => {
  await find(w, id).find('button[role="switch"]').trigger("click");
  await flushPromises();
};
const save = async (w: VueWrapper) => {
  await w.find("form").trigger("submit");
  // The schema validates asynchronously before the save starts.
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await flushPromises();
  }
};
const switchOn = (w: VueWrapper, id: string) =>
  find(w, id).find('button[role="switch"]').attributes("aria-checked") === "true";
const channel = (id: string, name: string) => ({
  id,
  name,
  is_private: false,
  is_member: true,
  is_shared: false,
});
const openPicker = async (w: VueWrapper) => {
  await find(w, "slack-insights-channel-select").find("button").trigger("click");
  await flushPromises();
};
const optionRows = () =>
  Array.from(document.body.querySelectorAll("[data-vrow]")).map((row) =>
    (row.textContent ?? "").trim(),
  );
const inMenu = (id: string) => document.body.querySelector<HTMLElement>(`[data-test="${id}"]`);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.mocked(destinationService.list).mockReturnValue(ok([]) as any);
  vi.mocked(slack.listChannels).mockReturnValue(ok({ channels: [], next_cursor: null }) as any);
  vi.mocked(autoobserve.incidents).mockReturnValue(
    ok({
      paging: false,
      has_more: false,
      items: [
        { incident: { status: "open" } },
        { incident: { status: "acknowledged" } },
        { incident: { status: "resolved" } },
      ],
    }) as any,
  );
  vi.mocked(autoobserve.suggestions).mockReturnValue(
    ok({ suggestions: [], total: 30, limit: 1, offset: 0 }) as any,
  );
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("SlackInsightsSection: load (S7a)", () => {
  it("shows the four settings with the saved channel and the last digest line", async () => {
    const w = await mountSection(settings("adminOneChannel"));
    const text = w.text();
    expect(text).toContain("Channel");
    expect(text).toContain("Daily digest time");
    expect(text).toContain("Post trial findings as they happen");
    expect(text).toContain("Allow changes from Slack");
    expect(find(w, "slack-insights-channel-select").text()).toContain("#ops-insights");
    expect(find(w, "slack-insights-channel-line").text()).toContain(
      "Last digest today 09:00: 2 need attention, 30 suggestions, 1 calibration run.",
    );
    expect(find(w, "slack-insights-open-digest").attributes("href")).toBe(
      fixture.adminOneChannel.last_digest.link,
    );
    expect(text).toContain("America/New_York");
    expect(find(w, "slack-insights-status").text()).toBe("");
  });

  it("says nothing is saved yet only once something changed", async () => {
    const w = await mountSection(settings("adminOneChannel"));
    expect(find(w, "slack-insights-status").text()).not.toContain("Nothing is saved");
    await toggle(w, "slack-insights-trial");
    expect(find(w, "slack-insights-status").text()).toBe("Nothing is saved until you save.");
  });

  it("promises no link when the last digest has none", async () => {
    const data = settings("adminOneChannel");
    data.last_digest!.link = "";
    const w = await mountSection(data);
    expect(find(w, "slack-insights-channel-line").text()).not.toContain("See what");
    expect(find(w, "slack-insights-open-digest").exists()).toBe(false);
  });

  it("names the digest time field for screen readers on the field itself", async () => {
    const w = await mountSection(settings("adminOneChannel"));
    const input = find(w, "slack-insights-time").find("input");
    expect(input.attributes("aria-label")).toBe("Digest time");
  });

  it("keeps Save off until a value differs from the saved one", async () => {
    const w = await mountSection(settings("adminOneChannel"));
    expect(find(w, "slack-insights-save").attributes("disabled")).toBeDefined();
    await toggle(w, "slack-insights-trial");
    expect(find(w, "slack-insights-save").attributes("disabled")).toBeUndefined();
    await toggle(w, "slack-insights-trial");
    expect(find(w, "slack-insights-save").attributes("disabled")).toBeDefined();
  });

  it("hides Open last digest when the server has no last digest (D1)", async () => {
    const data = settings("adminOneChannel");
    delete data.last_digest;
    const w = await mountSection(data);
    expect(find(w, "slack-insights-open-digest").exists()).toBe(false);
  });
});

describe("SlackInsightsSection: save", () => {
  it("sends all four settings with the revision and toasts success", async () => {
    vi.mocked(slack.putInsightsSettings).mockReturnValue(
      ok({ ...settings("adminOneChannel"), post_trial_findings: true, revision: 8 }) as any,
    );
    const w = await mountSection(settings("adminOneChannel"));
    await toggle(w, "slack-insights-trial");
    await save(w);
    expect(slack.putInsightsSettings).toHaveBeenCalledWith("acme", {
      channel: { installation_id: "inst-1", channel_id: "C100", channel_name: "ops-insights" },
      digest_time: "09:00",
      digest_time_zone: "America/New_York",
      post_trial_findings: true,
      allow_changes_from_slack: false,
      revision: 7,
    });
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "success", message: "AutoObserve settings saved" }),
    );
    expect(find(w, "slack-insights-save").attributes("disabled")).toBeDefined();
  });

  it("starts a first save in the browser's zone at 09:00 (D5)", async () => {
    vi.mocked(slack.putInsightsSettings).mockReturnValue(ok(settings("noChannel")) as any);
    const w = await mountSection(settings("noChannel"));
    await toggle(w, "slack-insights-allow");
    await save(w);
    expect(slack.putInsightsSettings).toHaveBeenCalledWith(
      "acme",
      expect.objectContaining({
        channel: null,
        digest_time: "09:00",
        digest_time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        allow_changes_from_slack: true,
        revision: 0,
      }),
    );
  });
});

describe("SlackInsightsSection: edits while a save is in flight (F1)", () => {
  it("keeps an edit made during the PUT once the save succeeds", async () => {
    let answer: (value: unknown) => void = () => {};
    vi.mocked(slack.putInsightsSettings).mockReturnValue(
      new Promise((resolve) => (answer = resolve)) as any,
    );
    const w = await mountSection(settings("adminOneChannel"));
    await toggle(w, "slack-insights-trial");
    await save(w);
    await toggle(w, "slack-insights-allow");
    answer({ data: { ...settings("adminOneChannel"), post_trial_findings: true, revision: 8 } });
    await flushPromises();
    expect(switchOn(w, "slack-insights-trial")).toBe(true);
    expect(switchOn(w, "slack-insights-allow")).toBe(true);
    expect(find(w, "slack-insights-save").attributes("disabled")).toBeUndefined();
    vi.mocked(slack.putInsightsSettings).mockReturnValue(
      ok({ ...settings("adminOneChannel"), post_trial_findings: true, revision: 9 }) as any,
    );
    await save(w);
    expect(slack.putInsightsSettings).toHaveBeenLastCalledWith(
      "acme",
      expect.objectContaining({ allow_changes_from_slack: true, revision: 8 }),
    );
  });
});

describe("SlackInsightsSection: destination edits while a save is in flight (F1)", () => {
  it("keeps a channel picked in the second workspace during a save that cleared the channel", async () => {
    let answer: (value: unknown) => void = () => {};
    vi.mocked(slack.putInsightsSettings).mockReturnValue(
      new Promise((resolve) => (answer = resolve)) as any,
    );
    const data = settings("adminOneChannel");
    data.channel = { installation_id: "inst-2", channel_id: "C100", channel_name: "ops-insights" };
    const w = await mountSection(data, [
      installationView({ team_name: "demo-workspace" }),
      installationView({ id: "inst-2", team_name: "demo-workspace-eu" }),
    ]);
    const channelSelect = () =>
      find(w, "slack-insights-channel-select").findComponent({ name: "OSelect" });
    channelSelect().vm.$emit("update:modelValue", null);
    await flushPromises();
    await save(w);
    channelSelect().vm.$emit("update:modelValue", "C300");
    await flushPromises();
    answer({ data: { ...data, channel: null, revision: 8 } });
    await flushPromises();
    vi.mocked(slack.putInsightsSettings).mockReturnValue(ok({ ...data, revision: 9 }) as any);
    await save(w);
    expect(slack.putInsightsSettings).toHaveBeenLastCalledWith(
      "acme",
      expect.objectContaining({
        channel: expect.objectContaining({ installation_id: "inst-2", channel_id: "C300" }),
        revision: 8,
      }),
    );
  });
});

describe("SlackInsightsSection: channel picker", () => {
  it("shows Load more channels in the menu and appends the next page (F2)", async () => {
    vi.mocked(slack.listChannels).mockImplementation(((
      _org: string,
      _id: string,
      params: { cursor?: string } = {},
    ) =>
      ok(
        params.cursor
          ? { channels: [channel("C900", "ops-zeta")], next_cursor: null }
          : { channels: [channel("C200", "ops-alerts")], next_cursor: "page-2" },
      )) as any);
    const w = await mountSection(settings("adminOneChannel"));
    await openPicker(w);
    const more = inMenu("slack-insights-channel-more");
    expect(more?.textContent).toContain("Load more channels");
    more!.click();
    await flushPromises();
    expect(slack.listChannels).toHaveBeenLastCalledWith(
      "acme",
      "inst-1",
      expect.objectContaining({ cursor: "page-2" }),
    );
    expect(optionRows().some((row) => row.includes("#ops-zeta"))).toBe(true);
    expect(inMenu("slack-insights-channel-more")).toBeNull();
  });

  it("sets a saved channel back to No channel and saves channel null (F5)", async () => {
    vi.mocked(slack.listChannels).mockReturnValue(
      ok({ channels: [channel("C100", "ops-insights")], next_cursor: null }) as any,
    );
    vi.mocked(slack.putInsightsSettings).mockReturnValue(
      ok({ ...settings("noChannel"), revision: 8 }) as any,
    );
    const w = await mountSection(settings("adminOneChannel"));
    await openPicker(w);
    const rows = Array.from(document.body.querySelectorAll<HTMLElement>("[data-vrow]"));
    expect((rows[0]?.textContent ?? "").trim()).toBe("No channel");
    w.findComponent({ name: "OSelect" }).vm.$emit("update:modelValue", null);
    await flushPromises();
    expect(find(w, "slack-insights-channel-select").text()).toContain("No channel");
    await save(w);
    expect(slack.putInsightsSettings).toHaveBeenCalledWith(
      "acme",
      expect.objectContaining({ channel: null, revision: 7 }),
    );
  });
});

describe("SlackInsightsSection: save failed (S7f)", () => {
  it("names a stale revision in red with the reader's edit and a Refresh", async () => {
    vi.mocked(slack.putInsightsSettings).mockRejectedValue(failure("staleRevision"));
    const w = await mountSection(settings("adminOneChannel"));
    await toggle(w, "slack-insights-trial");
    await save(w);
    const error = find(w, "slack-insights-save-error");
    expect(error.attributes("role")).toBe("alert");
    expect(error.text()).toContain("AutoObserve settings weren't saved:");
    expect(error.text()).toContain("someone else changed these settings. Refresh and try again.");
    expect(error.text()).toContain("Your edit: Post trial findings → On.");
    expect(find(w, "slack-insights-status").text()).not.toContain("Nothing is saved");
    await find(w, "slack-insights-refresh").trigger("click");
    await flushPromises();
    expect(slack.getInsightsSettings).toHaveBeenCalledTimes(2);
    expect(find(w, "slack-insights-save-error").exists()).toBe(false);
  });

  it("keeps the reader's edits on top of the fresh settings after Refresh", async () => {
    vi.mocked(slack.putInsightsSettings).mockRejectedValue(failure("staleRevision"));
    const w = await mountSection(settings("adminOneChannel"));
    const before = switchOn(w, "slack-insights-trial");
    await toggle(w, "slack-insights-trial");
    await save(w);
    const fresh = settings("adminOneChannel");
    fresh.revision = (fresh.revision ?? 0) + 1;
    vi.mocked(slack.getInsightsSettings).mockReturnValue(ok(fresh) as any);
    await find(w, "slack-insights-refresh").trigger("click");
    await flushPromises();
    expect(switchOn(w, "slack-insights-trial")).toBe(!before);
    expect(find(w, "slack-insights-save").attributes("disabled")).toBeUndefined();
  });

  it("a_cleared_digest_time_is_caught_on_the_field_and_never_sent", async () => {
    const w = await mountSection(settings("adminOneChannel"));
    const input = find(w, "slack-insights-time").find("input");
    await input.setValue("");
    await input.trigger("blur");
    await toggle(w, "slack-insights-trial");
    await save(w);
    expect(slack.putInsightsSettings).not.toHaveBeenCalled();
    expect(w.text()).toContain("Choose a digest time as HH:MM.");
  });

  it("an_unreadable_typed_time_never_saves_the_previous_time_V_N3", async () => {
    const w = await mountSection(settings("adminOneChannel"));
    const input = find(w, "slack-insights-time").find("input");
    await input.setValue("0930x");
    await input.trigger("change");
    await flushPromises();
    await toggle(w, "slack-insights-trial");
    await save(w);
    expect(slack.putInsightsSettings).not.toHaveBeenCalled();
    expect(find(w, "slack-insights-time").get('[role="alert"]').text()).toBe(
      "Enter a time as HH:MM.",
    );
  });

  it("joins the server's reason and the next sentence as two sentences", async () => {
    vi.mocked(slack.putInsightsSettings).mockRejectedValue(
      Object.assign(new Error("bad"), {
        response: { status: 400, data: { code: 400, message: "T5 simulated failure" } },
      }),
    );
    const w = await mountSection(settings("adminOneChannel"));
    await toggle(w, "slack-insights-trial");
    await save(w);
    expect(find(w, "slack-insights-save-error").text()).toContain(
      "OpenObserve refused them: T5 simulated failure. Your changes are still here.",
    );
  });

  it("keeps the red error, and says so, when Refresh after a 409 fails (F4)", async () => {
    vi.mocked(slack.putInsightsSettings).mockRejectedValue(failure("staleRevision"));
    const w = await mountSection(settings("adminOneChannel"));
    await toggle(w, "slack-insights-trial");
    await save(w);
    vi.mocked(slack.getInsightsSettings).mockRejectedValue(axiosError(500));
    await find(w, "slack-insights-refresh").trigger("click");
    await flushPromises();
    const error = find(w, "slack-insights-save-error");
    expect(error.exists()).toBe(true);
    expect(error.text()).toContain("someone else changed these settings.");
    expect(error.text()).toContain(
      "Post trial findings → On. Refresh didn't work either. Try again.",
    );
    expect(find(w, "slack-insights-refresh").exists()).toBe(true);
  });

  it("says OpenObserve didn't answer when no response came back", async () => {
    vi.mocked(slack.putInsightsSettings).mockRejectedValue(new Error("Network Error"));
    const w = await mountSection(settings("adminOneChannel"));
    await toggle(w, "slack-insights-allow");
    await save(w);
    expect(find(w, "slack-insights-save-error").text()).toContain(
      "OpenObserve didn't answer. Your changes are still here; save again.",
    );
    expect(find(w, "slack-insights-refresh").exists()).toBe(false);
  });

  it("refuses a channel OpenObserve is not in, with the invite step (D6)", async () => {
    vi.mocked(slack.putInsightsSettings).mockRejectedValue(failure("notInChannel"));
    const w = await mountSection(settings("adminOneChannel"));
    await toggle(w, "slack-insights-allow");
    await save(w);
    expect(find(w, "slack-insights-save-error").text()).toContain(
      "OpenObserve isn't in #ops-insights, so it can't post there. In Slack, type /invite @OpenObserve in #ops-insights, then save again.",
    );
  });
});

describe("SlackInsightsSection: read-only member (S7e)", () => {
  it("shows the lock line, keeps the channel name and the digest link, and has no Save", async () => {
    const w = await mountSection(settings("member"));
    const lock = find(w, "slack-insights-lock");
    expect(lock.text()).toContain("You can't change these settings.");
    expect(lock.text()).toContain("They need the Manage Slack permission.");
    expect(lock.text()).toContain("Ask an admin of this organization.");
    expect(find(w, "slack-insights-channel-select").text()).toContain("#ops-insights");
    expect(find(w, "slack-insights-open-digest").exists()).toBe(true);
    expect(find(w, "slack-insights-save").exists()).toBe(false);
    expect(
      find(w, "slack-insights-trial").find('button[role="switch"]').attributes("disabled"),
    ).toBeDefined();
    expect(w.text()).toContain("Off: what checks in their 28-day trial find waits for the digest.");
    expect(lock.classes().join(" ")).not.toMatch(/error/);
  });
});

describe("SlackInsightsSection: no channel (S7b)", () => {
  it("says nothing posts yet, with today's counts and Pick a channel (D2)", async () => {
    const w = await mountSection(settings("noChannel"));
    const line = find(w, "slack-insights-channel-line");
    expect(line.text()).toContain("Nothing posts yet: no channel is picked.");
    expect(line.text()).toContain(
      "AutoObserve has 2 things that need attention and 30 suggestions in acme today.",
    );
    expect(line.text()).toContain("Pick the channel your on-call team reads.");
    expect(find(w, "slack-insights-pick-channel").exists()).toBe(true);
  });

  it("drops the counts but keeps Pick a channel when they fail to load (D2)", async () => {
    vi.mocked(autoobserve.incidents).mockRejectedValue(axiosError(500));
    const w = await mountSection(settings("noChannel"));
    const line = find(w, "slack-insights-channel-line");
    expect(line.text()).toContain("Nothing posts yet: no channel is picked.");
    expect(line.text()).not.toContain("AutoObserve has");
    expect(find(w, "slack-insights-pick-channel").exists()).toBe(true);
  });
});

describe("SlackInsightsSection: app removed (S7d)", () => {
  it("disables the section in amber, keeps the choices and offers Go to Reinstall", async () => {
    const w = await mountSection(settings("adminOneChannel"), [
      installationView({ team_name: "demo-workspace", status: "revoked" }),
    ]);
    const line = find(w, "slack-insights-channel-line");
    expect(line.attributes("data-state")).toBe("warning");
    expect(line.text()).toContain(
      "Nothing posts: the Slack app was removed from demo-workspace, so today's digest (2 need attention) wasn't sent.",
    );
    expect(find(w, "slack-insights-status").text()).toBe(
      "Settings can't change while the app is removed.",
    );
    expect(find(w, "slack-insights-save").attributes("disabled")).toBeDefined();
    expect(
      find(w, "slack-insights-allow").find('button[role="switch"]').attributes("disabled"),
    ).toBeDefined();
    await find(w, "slack-insights-go-reinstall").trigger("click");
    expect(w.emitted("reinstall")).toEqual([["inst-1"]]);
  });

  it("keeps the line's text but drops Go to Reinstall for a managed workspace (F3)", async () => {
    const w = await mountSection(settings("adminOneChannel"), [
      installationView({ team_name: "demo-workspace", status: "revoked", managed: true }),
    ]);
    expect(find(w, "slack-insights-channel-line").text()).toContain(
      "the Slack app was removed from demo-workspace",
    );
    expect(find(w, "slack-insights-go-reinstall").exists()).toBe(false);
  });
});

describe("SlackInsightsSection: several workspaces (S7h)", () => {
  it("names the workspace beside the channel and says posts move with the channel (D4)", async () => {
    const w = await mountSection(settings("adminOneChannel"), [
      installationView({ team_name: "demo-workspace" }),
      installationView({ id: "inst-2", team_name: "demo-workspace-eu" }),
    ]);
    expect(find(w, "slack-insights-workspace-select").text()).toContain("demo-workspace");
    expect(find(w, "slack-insights-channel-line").text()).toContain(
      "One organization posts to one channel. Picking a channel in demo-workspace-eu moves the posts there. Last digest today 09:00 in #ops-insights.",
    );
  });

  it("has no workspace select with one workspace", async () => {
    const w = await mountSection(settings("adminOneChannel"));
    expect(find(w, "slack-insights-workspace-select").exists()).toBe(false);
  });
});

describe("SlackInsightsSection: load failed", () => {
  it("shows the load error with Retry instead of the settings", async () => {
    queryClient.clear();
    vi.mocked(slack.getInsightsSettings).mockRejectedValue(axiosError(400));
    wrapper = mount(SlackInsightsSection, {
      props: { installations: [installationView()] },
      global: { plugins: [i18n, makeSlackStore()] },
    });
    await flushPromises();
    expect(wrapper.find('[data-test="slack-insights-load-error"]').exists()).toBe(true);
    expect(wrapper.find("form").exists()).toBe(false);
  });
});
