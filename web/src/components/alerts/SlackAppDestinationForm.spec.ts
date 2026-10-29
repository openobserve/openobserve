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
import slack from "@/services/slack";
import destinationService from "@/services/alert_destination";
import oncallService from "@/services/oncall";
import {
  fakePopup,
  installationView,
  makeSlackStore,
  ok,
  postCallback,
} from "@/test/unit/helpers/slack";
import SlackAppDestinationForm from "./SlackAppDestinationForm.vue";
import type { SlackAppDestination } from "@/utils/slackAppDestination";

const edition = vi.hoisted(() => ({ isCloud: "false", isEnterprise: "true" }));
vi.mock("@/aws-exports", () => ({ default: edition }));
vi.mock("@/services/slack", () => ({
  default: {
    listInstallations: vi.fn(),
    listChannels: vi.fn(),
    listChannelDefaults: vi.fn(),
    installStart: vi.fn(),
    installExchange: vi.fn(),
    connectInstallation: vi.fn(),
  },
}));
vi.mock("@/services/alert_destination", () => ({
  default: { list: vi.fn(), create: vi.fn(), update: vi.fn(), test: vi.fn() },
}));
vi.mock("@/services/oncall", () => ({
  default: { listTeams: vi.fn(), getTeamChannel: vi.fn() },
}));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));
vi.mock("vue-router", () => ({
  useRouter: () => ({ resolve: () => ({ href: "/web/settings/slack" }) }),
}));

const HOOK = "https://hooks.slack.com/services/T0SAMPLE01/B000/xyz";

const channels = [
  { id: "C9", name: "sre-prod", is_private: false, is_member: true, is_shared: false },
  { id: "C3", name: "platform-alerts", is_private: false, is_member: true, is_shared: false },
  {
    id: "C5",
    name: "partners-alerts",
    is_private: false,
    is_member: true,
    is_shared: true,
    is_ext_shared: true,
  },
  { id: "C7", name: "payments-oncall", is_private: false, is_member: true, is_shared: false },
];

const oncallWebhook = {
  name: "payments-oncall-slack",
  type: "http",
  url: HOOK,
  method: "post",
  template: "prebuilt_slack",
  metadata: { prebuilt_type: "slack", slack_team_id: "T0SAMPLE01", slack_channel_id: "C7" },
};

let wrapper: VueWrapper<any>;

const body = () => document.body;
const byTest = (test: string) => body().querySelector<HTMLElement>(`[data-test="${test}"]`);

const component = (name: string, test: string) =>
  wrapper
    .findAllComponents({ name })
    .find((c) => (c.attributes("data-test") ?? c.vm.$attrs?.["data-test"]) === test);

const settle = async () => {
  await flushPromises();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await flushPromises();
};

const pick = async (test: string, value: unknown) => {
  const select = component("OSelect", test);
  expect(select, `select ${test}`).toBeDefined();
  select!.vm.$emit("update:modelValue", value);
  await settle();
};

const tick = async (test: string) => {
  const box = component("OCheckbox", test);
  expect(box, `checkbox ${test}`).toBeDefined();
  box!.vm.$emit("update:modelValue", true);
  await settle();
};

const save = async () => {
  byTest("slack-app-dest-save")!.click();
  await settle();
};

const mountForm = async (
  destination: SlackAppDestination | null = null,
  confirmation?: { code: string; team?: string; destination?: string },
) => {
  wrapper = mount(SlackAppDestinationForm, {
    props: { destination, templates: [], confirmation },
    global: { plugins: [i18n, makeSlackStore()] },
    attachTo: document.body,
  });
  await settle();
  return wrapper;
};

const created = () => vi.mocked(destinationService.create).mock.calls[0]?.[0]?.data;

const existing = (over: Partial<SlackAppDestination> = {}): SlackAppDestination => ({
  name: "payments-alerts-slack",
  type: "slack_app",
  template: "prebuilt_slack",
  installation_id: "inst-1",
  channel_id: "C7",
  channel_name: "payments-oncall",
  buttons: true,
  mention: "default",
  refire_reuse_minutes: 30,
  auto_investigate: "off",
  shared_channel_confirmed: false,
  oncall_room_confirmed: true,
  ...over,
});

beforeEach(() => {
  queryClient.clear();
  vi.clearAllMocks();
  edition.isCloud = "false";
  vi.mocked(slack.listInstallations).mockReturnValue(
    ok({ installations: [installationView()] }) as any,
  );
  vi.mocked(slack.listChannels).mockReturnValue(ok({ channels, next_cursor: null }) as any);
  vi.mocked(slack.listChannelDefaults).mockReturnValue(
    ok({
      defaults: [
        {
          channel_id: "C3",
          channel_name: "platform-alerts",
          answer_mode: "thread",
          set_from: "settings",
          set_by_this_org: false,
          org_name: "staging",
        },
      ],
    }) as any,
  );
  vi.mocked(destinationService.list).mockReturnValue(ok([oncallWebhook]) as any);
  vi.mocked(destinationService.create).mockReturnValue(ok({}) as any);
  vi.mocked(destinationService.update).mockReturnValue(ok({}) as any);
  vi.mocked(destinationService.test).mockReturnValue(ok({ success: true }) as any);
  vi.mocked(oncallService.listTeams).mockReturnValue(
    ok([{ id: "t1", name: "payments-oncall" }]) as any,
  );
  vi.mocked(oncallService.getTeamChannel).mockReturnValue(
    ok({ team_id: "t1", destinations: ["payments-oncall-slack"], source: "team" }) as any,
  );
});

afterEach(() => {
  wrapper?.unmount();
  document.body.innerHTML = "";
});

describe("Slack app destination form (MK-7)", () => {
  it("saves the spec defaults for a new channel and names it after the channel", async () => {
    await mountForm();
    expect(component("OSelect", "slack-app-dest-workspace")!.props("modelValue")).toBe("inst-1");
    await pick("slack-app-dest-channel", "C9");
    expect(byTest("slack-app-dest-default-hint")?.textContent).toContain(
      "Sets #sre-prod's default org to acme",
    );
    expect(byTest("slack-app-dest-oncall-room")).toBeNull();
    expect(byTest("slack-app-dest-shared")).toBeNull();
    await save();
    expect(destinationService.create).toHaveBeenCalledTimes(1);
    expect(created()).toEqual({
      name: "slack-sre-prod",
      type: "slack_app",
      template: "prebuilt_slack",
      installation_id: "inst-1",
      channel_id: "C9",
      channel_name: "sre-prod",
      buttons: true,
      mention: "default",
      refire_reuse_minutes: 30,
      auto_investigate: "off",
      shared_channel_confirmed: false,
      oncall_room_confirmed: false,
    });
    expect(wrapper.emitted("saved")).toHaveLength(1);
  });

  it("says another org answers in a channel it owns, instead of setting the default", async () => {
    await mountForm();
    await pick("slack-app-dest-channel", "C3");
    const hint = byTest("slack-app-dest-default-hint")?.textContent ?? "";
    expect(hint).toContain("#platform-alerts answers questions for org staging");
    expect(hint).not.toContain("Sets #");
  });

  it("asks for the shared-channel tick on Save, with Save left enabled (7.8)", async () => {
    await mountForm();
    await pick("slack-app-dest-channel", "C5");
    expect(byTest("slack-app-dest-channel-tag")?.textContent).toContain("Shared · Slack Connect");
    const box = byTest("slack-app-dest-shared");
    expect(box?.textContent).toContain("#partners-alerts is shared with people outside Acme Corp.");
    expect((byTest("slack-app-dest-save") as HTMLButtonElement).disabled).toBe(false);
    await save();
    expect(destinationService.create).not.toHaveBeenCalled();
    expect(byTest("slack-app-dest-shared")?.getAttribute("data-error")).toBe("true");
    expect(byTest("slack-app-dest-shared")?.textContent).toContain(
      "Confirm that alerts may post to this shared channel",
    );
    await tick("slack-app-dest-shared-confirm");
    await save();
    expect(created()).toMatchObject({ channel_id: "C5", shared_channel_confirmed: true });
  });
});

describe("on-call room confirm (MK-20, option b)", () => {
  it("warns that the team's pages post to the same channel and asks for the tick", async () => {
    await mountForm();
    await pick("slack-app-dest-channel", "C7");
    expect(byTest("slack-app-dest-channel-tag")?.textContent).toContain("On-call room");
    expect(byTest("slack-app-dest-oncall-room")?.textContent).toContain(
      "On-call pages for team payments-oncall also post to #payments-oncall through payments-oncall-slack. Alerts here post separately.",
    );
    expect((byTest("slack-app-dest-save") as HTMLButtonElement).disabled).toBe(false);
    await save();
    expect(destinationService.create).not.toHaveBeenCalled();
    expect(byTest("slack-app-dest-oncall-room")?.getAttribute("data-error")).toBe("true");
    expect(byTest("slack-app-dest-oncall-room")?.textContent).toContain(
      "Confirm that alerts may post to this on-call room",
    );
    await tick("slack-app-dest-oncall-confirm");
    expect(byTest("slack-app-dest-oncall-room")?.getAttribute("data-error")).toBe("false");
    await save();
    expect(created()).toMatchObject({ channel_id: "C7", oncall_room_confirmed: true });
  });

  it("does not ask again on Edit while the channel stays the same", async () => {
    await mountForm(existing());
    expect(byTest("slack-app-dest-oncall-room")).toBeNull();
    await save();
    expect(destinationService.update).toHaveBeenCalledTimes(1);
    expect(vi.mocked(destinationService.update).mock.calls[0][0]).toMatchObject({
      destination_name: "payments-alerts-slack",
      data: { channel_id: "C7", oncall_room_confirmed: true },
    });
  });

  it("asks again on Edit once the channel changes to an on-call room", async () => {
    await mountForm(existing({ channel_id: "C9", channel_name: "sre-prod" }));
    await pick("slack-app-dest-channel", "C7");
    expect(byTest("slack-app-dest-oncall-room")).not.toBeNull();
    await save();
    expect(destinationService.update).not.toHaveBeenCalled();
  });

  it("shows the server's on-call refusal in the same box", async () => {
    vi.mocked(oncallService.listTeams).mockReturnValue(ok([]) as any);
    vi.mocked(destinationService.create).mockRejectedValueOnce({
      response: {
        status: 400,
        data: { code: "oncall_room_unconfirmed", team: "search", destination: "search-slack" },
      },
    });
    await mountForm();
    await pick("slack-app-dest-channel", "C7");
    await save();
    expect(byTest("slack-app-dest-oncall-room")?.textContent).toContain(
      "On-call pages for team search also post to #payments-oncall through search-slack.",
    );
  });
});

describe("refusals and test send", () => {
  it("renders the mixed-version refusal from the API error (Q8)", async () => {
    vi.mocked(destinationService.create).mockRejectedValueOnce({
      response: { status: 409, data: { code: "version_mismatch", message: "versions differ" } },
    });
    await mountForm();
    await pick("slack-app-dest-channel", "C9");
    await save();
    expect(byTest("slack-app-dest-refusal")?.textContent).toContain(
      "Nodes run different versions. Upgrade every node first.",
    );
    expect(wrapper.emitted("saved")).toBeUndefined();
  });

  it("sends a test through the test route as the slack_app type", async () => {
    await mountForm();
    await pick("slack-app-dest-channel", "C9");
    byTest("slack-app-dest-test")!.click();
    await settle();
    expect(destinationService.test).toHaveBeenCalledWith({
      org_identifier: "acme",
      data: expect.objectContaining({
        type: "slack_app",
        slackApp: expect.objectContaining({ installation_id: "inst-1", channel_id: "C9" }),
      }),
    });
    expect(byTest("test-result-success")).not.toBeNull();
  });
});

describe("Connect Slack from the form (7.2, MK-20)", () => {
  const exchange = (over: Record<string, unknown> = {}) => ({
    webhookUrl: HOOK,
    channel: "#payments-oncall",
    channelId: "C7",
    teamId: "T0SAMPLE01",
    teamName: "Acme Corp",
    installation: {
      id: "inst-1",
      team_name: "Acme Corp",
      status: "healthy",
      linking: { enabled: false, source: "manual", domains: [] },
    },
    destination: null,
    channel_default_set: true,
    ...over,
  });
  let popup: Window;

  beforeEach(() => {
    edition.isCloud = "true";
    popup = fakePopup();
    vi.spyOn(window, "open").mockReturnValue(popup);
    vi.mocked(slack.listInstallations)
      .mockReturnValueOnce(ok({ installations: [] }) as any)
      .mockReturnValue(ok({ installations: [installationView()] }) as any);
    vi.mocked(slack.installStart).mockReturnValue(
      ok({ authorization_url: "https://slack.com/oauth/v2/authorize?client_id=1" }) as any,
    );
  });

  const connect = async () => {
    byTest("slack-app-dest-connect")!.click();
    await settle();
    postCallback(popup);
    await settle();
  };

  it("asks the exchange for the destination and turns its on-call refusal into the MK-20 tick that Save sends", async () => {
    vi.mocked(oncallService.listTeams).mockReturnValue(ok([]) as any);
    vi.mocked(destinationService.list).mockReturnValue(ok([]) as any);
    vi.mocked(slack.installExchange).mockReturnValue(
      ok(
        exchange({
          destination_refusal: {
            code: "oncall_room_unconfirmed",
            message: "On-call pages for team payments also post to #payments-oncall",
            team: "payments",
            destination: "payments-oncall-slack",
            channel: "#payments-oncall",
            channel_id: "C7",
          },
        }),
      ) as any,
    );
    await mountForm();
    await connect();
    expect(slack.installStart).toHaveBeenCalledWith(
      "acme",
      { source: "destination_form", create_destination: true },
      { silentForbidden: true },
    );
    expect(byTest("slack-app-dest-channel")?.textContent).toContain("#payments-oncall");
    expect(byTest("slack-app-dest-oncall-room")?.textContent).toContain(
      "On-call pages for team payments also post to #payments-oncall through payments-oncall-slack.",
    );
    await save();
    expect(destinationService.create).not.toHaveBeenCalled();
    expect(byTest("slack-app-dest-oncall-room")?.dataset.error).toBe("true");
    await tick("slack-app-dest-oncall-confirm");
    await save();
    expect(created()).toMatchObject({
      name: "slack-payments-oncall",
      installation_id: "inst-1",
      channel_id: "C7",
      channel_name: "payments-oncall",
      oncall_room_confirmed: true,
    });
    expect(wrapper.emitted("saved")).toHaveLength(1);
  });

  it("edits the destination the exchange created instead of saving a copy", async () => {
    const made = existing({
      name: "slack-sre-prod",
      channel_id: "C9",
      channel_name: "sre-prod",
      oncall_room_confirmed: false,
    });
    vi.mocked(destinationService.list).mockReturnValue(ok([made]) as any);
    vi.mocked(slack.installExchange).mockReturnValue(
      ok(
        exchange({
          destination: { id: "d1", name: "slack-sre-prod", channel: "#sre-prod", channel_id: "C9" },
        }),
      ) as any,
    );
    await mountForm();
    await connect();
    expect(byTest("slack-app-dest-name")?.querySelector("input")?.value).toBe("slack-sre-prod");
    await save();
    expect(destinationService.create).not.toHaveBeenCalled();
    expect(destinationService.update).toHaveBeenCalledWith(
      expect.objectContaining({ destination_name: "slack-sre-prod" }),
    );
  });
});

describe("no workspace yet (7.2)", () => {
  it("offers Connect Slack on Cloud", async () => {
    edition.isCloud = "true";
    vi.mocked(slack.listInstallations).mockReturnValue(ok({ installations: [] }) as any);
    await mountForm();
    expect(byTest("slack-app-dest-connect")).not.toBeNull();
    expect(byTest("slack-app-dest-channel")).toBeNull();
  });

  it("points self-hosted to Settings › Slack", async () => {
    vi.mocked(slack.listInstallations).mockReturnValue(ok({ installations: [] }) as any);
    await mountForm();
    expect(byTest("slack-app-dest-connect")).toBeNull();
    expect(byTest("slack-app-dest-settings-link")).not.toBeNull();
  });
});

describe("refused shortcut confirmation", () => {
  it.each(["shared_channel_unconfirmed", "oncall_room_unconfirmed"])(
    "shows %s checkbox even when channel lookup missed it",
    async (code) => {
      await mountForm(existing({ channel_id: "C9", channel_name: "sre-prod" }), {
        code,
        team: "Test team",
        destination: "oncall-test",
      });
      const test =
        code === "shared_channel_unconfirmed"
          ? "slack-app-dest-shared-confirm"
          : "slack-app-dest-oncall-confirm";
      expect(wrapper.find(`[data-test="${test}"]`).exists()).toBe(true);
    },
  );
});
