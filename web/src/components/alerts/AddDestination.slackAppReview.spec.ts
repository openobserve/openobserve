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
import { installationView, makeSlackStore, ok } from "@/test/unit/helpers/slack";
import AddDestination from "./AddDestination.vue";
import { withoutSlackAppReview } from "@/utils/slackAppDestination";
import type { DestinationPayload } from "@/ts/interfaces";

const edition = vi.hoisted(() => ({ isCloud: "false", isEnterprise: "true" }));
const route = vi.hoisted(() => ({ query: {} as Record<string, string> }));
vi.mock("@/aws-exports", () => ({ default: edition }));
vi.mock("vue-router", () => ({
  useRouter: () => ({
    push: vi.fn(),
    resolve: () => ({ href: "/web/settings/slack" }),
    currentRoute: { value: route },
  }),
  useRoute: () => ({ params: {}, query: {} }),
}));
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
vi.mock("@/services/users", () => ({ default: { orgUsers: vi.fn(), getRoles: vi.fn() } }));
vi.mock("@/services/reodotdev_analytics", () => ({ useReo: () => ({ track: vi.fn() }) }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

const channels = [
  { id: "C9", name: "sre-prod", is_private: false, is_member: true, is_shared: false },
  { id: "C3", name: "platform-alerts", is_private: false, is_member: true, is_shared: false },
];

const webhook = (name: string, channel: string): DestinationPayload => ({
  name,
  type: "http",
  url: "https://hooks.slack.com/services/T0SAMPLE01/B000/xyz",
  method: "post",
  template: "prebuilt_slack",
  metadata: { prebuilt_type: "slack", slack_team_id: "T0SAMPLE01", slack_channel_id: channel },
});

const review = (name: string) => {
  for (const key of Object.keys(route.query)) delete route.query[key];
  Object.assign(route.query, {
    action: "update",
    name,
    slack_app_installation: "inst-1",
    slack_app_refusal: "shared_channel_unconfirmed",
  });
};

let wrapper: VueWrapper | null = null;

const settle = async () => {
  await flushPromises();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await flushPromises();
};

const confirmShared = async () => {
  const box = wrapper!
    .findAllComponents({ name: "OCheckbox" })
    .find(
      (c) =>
        (c.attributes("data-test") ?? c.vm.$attrs?.["data-test"]) ===
        "slack-app-dest-shared-confirm",
    );
  expect(box, "shared confirm checkbox").toBeDefined();
  box!.vm.$emit("update:modelValue", true);
  await settle();
};

beforeEach(() => {
  queryClient.clear();
  vi.clearAllMocks();
  vi.mocked(slack.listInstallations).mockReturnValue(
    ok({ installations: [installationView()] }) as ReturnType<typeof slack.listInstallations>,
  );
  vi.mocked(slack.listChannels).mockReturnValue(
    ok({ channels, next_cursor: null }) as ReturnType<typeof slack.listChannels>,
  );
  vi.mocked(slack.listChannelDefaults).mockReturnValue(
    ok({ defaults: [] }) as ReturnType<typeof slack.listChannelDefaults>,
  );
  vi.mocked(destinationService.list).mockReturnValue(
    ok([]) as ReturnType<typeof destinationService.list>,
  );
  vi.mocked(destinationService.update).mockReturnValue(
    ok({}) as ReturnType<typeof destinationService.update>,
  );
  vi.mocked(oncallService.listTeams).mockReturnValue(
    ok([]) as ReturnType<typeof oncallService.listTeams>,
  );
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  review("");
  document.body.innerHTML = "";
});

describe("successive Reviews of refused switches", () => {
  it("saves the second destination's values, not the first's", async () => {
    review("alerts-a");
    wrapper = mount(AddDestination, {
      props: { templates: [], destination: webhook("alerts-a", "C9"), isAlerts: true },
      global: {
        plugins: [i18n, makeSlackStore()],
        stubs: { SlackAppSwitchBanner: true, AddUser: true, DestinationPreview: true },
      },
      attachTo: document.body,
    });
    await settle();
    await confirmShared();

    review("alerts-b");
    await wrapper.setProps({ destination: webhook("alerts-b", "C3") });
    await settle();
    await confirmShared();
    document.body.querySelector<HTMLElement>('[data-test="slack-app-dest-save"]')!.click();
    await settle();

    expect(destinationService.update).toHaveBeenCalledTimes(1);
    const call = vi.mocked(destinationService.update).mock.calls[0][0];
    expect(call.destination_name).toBe("alerts-b");
    expect(call.data).toMatchObject({
      name: "alerts-b",
      channel_id: "C3",
      shared_channel_confirmed: true,
    });
  });
});

describe("a saved Review", () => {
  it("closes the editor, and a later plain Edit opens the normal webhook form", async () => {
    const mountEditor = () =>
      mount(AddDestination, {
        props: { templates: [], destination: webhook("alerts-a", "C9"), isAlerts: true },
        global: {
          plugins: [i18n, makeSlackStore()],
          stubs: { SlackAppSwitchBanner: true, AddUser: true, DestinationPreview: true },
        },
        attachTo: document.body,
      });
    review("alerts-a");
    wrapper = mountEditor();
    await settle();
    await confirmShared();
    document.body.querySelector<HTMLElement>('[data-test="slack-app-dest-save"]')!.click();
    await settle();
    expect(destinationService.update).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted("get:destinations")).toHaveLength(1);
    expect(wrapper.emitted("cancel:hideform")).toHaveLength(1);
    wrapper.unmount();
    document.body.innerHTML = "";

    const plainEdit = withoutSlackAppReview({ ...route.query });
    for (const key of Object.keys(route.query)) delete route.query[key];
    Object.assign(route.query, plainEdit);
    expect(route.query).toEqual({ action: "update", name: "alerts-a" });
    wrapper = mountEditor();
    await settle();
    expect(document.body.querySelector('[data-test="slack-app-dest-save"]')).toBeNull();
    expect(document.body.querySelector("#add-destination-form")).not.toBeNull();
  });
});
