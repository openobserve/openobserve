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

// MainLayout mounts ConnectDataSourcePopup and CommunitySlackInvite together.
// ConnectDataSourcePopup's per-session decision crosses an await (the
// organization-summary call), while CommunitySlackInvite's day-2 check used to
// run synchronously on mount — on a returning session where the day-2 clock had
// already elapsed, both dialogs could end up open at once. These tests mount
// both components side by side, the way MainLayout does, to guard against that.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { http, HttpResponse } from "msw";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

const mockConfig = vi.hoisted(() => ({
  isCloud: "true" as string,
  isEnterprise: "false" as string,
}));

vi.mock("@/aws-exports", () => ({
  default: mockConfig,
}));

vi.mock("@/services/segment_analytics", () => ({ default: { track: vi.fn() } }));

import ConnectDataSourcePopup from "./ConnectDataSourcePopup.vue";
import CommunitySlackInvite from "./CommunitySlackInvite.vue";

const USER_EMAIL = "example@gmail.com"; // matches store.ts userInfo.email
const SLACK_STATE_KEY = `slackCommunityInvite:${USER_EMAIL}`;
const SUMMARY_URL = `${store.state.API_ENDPOINT}/api/:org/summary`;
const DAY2_DELAY_MS = 24 * 60 * 60 * 1000;

const ODialogStub = {
  name: "ODialog",
  inheritAttrs: false,
  props: ["open", "size", "showClose"],
  emits: ["update:open"],
  template: `<div :data-open="String(open)"><slot /></div>`,
};

// A `pending_day2` record whose day-2 clock has already elapsed — the scenario
// where the standalone Slack popup is "due" on the same mount that
// ConnectDataSourcePopup also decides to open.
function setDueDay2Record() {
  localStorage.setItem(
    SLACK_STATE_KEY,
    JSON.stringify({ status: "pending_day2", shownAt: Date.now() - DAY2_DELAY_MS - 1000 }),
  );
}

function mockSummary(numStreams: number) {
  global.server.use(
    http.get(SUMMARY_URL, () => HttpResponse.json({ streams: { num_streams: numStreams } })),
  );
}

function buildWrappers() {
  const globalOpts = {
    plugins: [store, router, i18n],
    stubs: { ODialog: ODialogStub },
  };
  return {
    connectDataPopup: mount(ConnectDataSourcePopup, { global: globalOpts }),
    slackInvite: mount(CommunitySlackInvite, { global: globalOpts }),
  };
}

describe("ConnectDataSourcePopup + CommunitySlackInvite coordination", () => {
  let connectDataPopup: VueWrapper;
  let slackInvite: VueWrapper;

  beforeEach(() => {
    mockConfig.isCloud = "true";

    store.commit("setUserInfo", { email: USER_EMAIL });
    store.commit("setSelectedOrganization", {
      label: "default Organization",
      id: 159,
      identifier: "default",
      user_email: USER_EMAIL,
      subscription_type: "",
    });
    store.dispatch("setIsDataIngested", false);

    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    connectDataPopup?.unmount();
    slackInvite?.unmount();
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("never has both dialogs open at once on a returning session with a due day-2 invite and no ingested data", async () => {
    setDueDay2Record();
    mockSummary(0); // no data ingested

    ({ connectDataPopup, slackInvite } = buildWrappers());
    await flushPromises();

    const connectOpen = connectDataPopup.find("[data-open]").attributes("data-open");
    const slackOpen = slackInvite.find("[data-open]").attributes("data-open");
    expect(connectOpen === "true" && slackOpen === "true").toBe(false);
    // ConnectDataSourcePopup takes priority — it should be the one that opened.
    expect(connectOpen).toBe("true");
    expect(slackOpen).toBe("false");
  });

  it("still shows the due day-2 invite once ConnectDataSourcePopup settles without opening (data already ingested)", async () => {
    setDueDay2Record();
    store.dispatch("setIsDataIngested", true);

    ({ connectDataPopup, slackInvite } = buildWrappers());
    await flushPromises();

    expect(connectDataPopup.find("[data-open]").attributes("data-open")).toBe("false");
    expect(slackInvite.find("[data-open]").attributes("data-open")).toBe("true");
  });
});
