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
import { createStore } from "vuex";
import { createMemoryHistory, createRouter } from "vue-router";
import IIS from "./IIS.vue";
import FirstEventStatus from "@/components/ingestion/FirstEventStatus.vue";
import { WEB_SERVER_GUIDES } from "@/composables/useIngestion";

const copyMock = vi.fn();
vi.mock("@/utils/clipboard", () => ({
  copyToClipboard: (...args: unknown[]) => copyMock(...args),
}));
vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));

const SERVER = "iis";
const PASSCODE = "o2tokenSECRETvalue0123456789";
const EMAIL = "you@acme.io";

const makeStore = () =>
  createStore({
    state: {
      API_ENDPOINT: "http://localhost:5080",
      selectedOrganization: { identifier: "acme-prod", name: "acme-prod", id: 1 },
      userInfo: { email: EMAIL },
      zoConfig: { ingestion_url: "https://api.openobserve.ai", timestamp_column: "_timestamp" },
      theme: "light",
      organizationData: {
        organizationPasscode: PASSCODE,
        organizationPasscodeForbidden: false,
        orgTokens: [{ name: "default", token: PASSCODE, enabled: true }],
      },
    },
  });

const mountPage = async () => {
  const store = makeStore();
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/:any(.*)*", name: SERVER, component: { template: "<div />" } }],
  });
  await router.push("/");
  const wrapper = mount(IIS, {
    props: { currOrgIdentifier: "acme-prod", currUserEmail: EMAIL },
    global: {
      plugins: [store, router],
      provide: { store },
      stubs: { FirstEventStatus: true },
    },
  });
  await flushPromises();
  return wrapper;
};

describe("IIS.vue web server guide", () => {
  let wrapper: VueWrapper | undefined;

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    copyMock.mockClear();
  });

  it("shows a runnable Fluent Bit config with the org endpoint and the token masked", async () => {
    wrapper = await mountPage();
    const config = wrapper.find(`[data-test="ingestion-${SERVER}-config-code-block"]`);
    expect(config.exists()).toBe(true);
    const text = config.text();
    expect(text).toContain("[INPUT]");
    expect(text).toContain(WEB_SERVER_GUIDES[SERVER].logPaths);
    expect(text).toContain("Host              api.openobserve.ai");
    expect(text).toContain("Port              443");
    expect(text).toContain("tls               On");
    expect(text).toContain(`URI               /api/acme-prod/${SERVER}/_json`);
    expect(text).toContain(`HTTP_User         ${EMAIL}`);
    expect(text).not.toContain(PASSCODE);
    expect(text).not.toContain("Access Key");
    expect(wrapper.html()).not.toContain(PASSCODE);
  });

  it("copies the real config, token included, on the first click on the block", async () => {
    wrapper = await mountPage();
    await wrapper.find(`[data-test="ingestion-${SERVER}-config-code-block-pre"]`).trigger("click");
    expect(copyMock).toHaveBeenCalledTimes(1);
    const copied = String(copyMock.mock.calls[0][0]);
    expect(copied).toContain(`HTTP_Passwd       ${PASSCODE}`);
    expect(copied).toContain(`URI               /api/acme-prod/${SERVER}/_json`);
  });

  it("names the token in the block toolbar", async () => {
    wrapper = await mountPage();
    expect(
      wrapper.find(`[data-test="ingestion-${SERVER}-config-code-block-token-link"]`).text(),
    ).toContain("default");
  });

  it("mounts one status bar watching logs in the server's stream, with Copy config", async () => {
    wrapper = await mountPage();
    const bars = wrapper.findAllComponents(FirstEventStatus);
    expect(bars).toHaveLength(1);
    expect(bars[0].props()).toMatchObject({
      org: "acme-prod",
      signal: "logs",
      targetStream: SERVER,
      kind: "standard",
      guideName: WEB_SERVER_GUIDES[SERVER].label,
      snippetKind: "config",
    });
    expect(bars[0].props("docUrl")).toMatch(/^https:\/\/short\.openobserve\.ai\/server\//);
  });

  it("puts the bar after the config and the restart hint, above the docs link", async () => {
    wrapper = await mountPage();
    const html = wrapper.html();
    const restart = html.indexOf(`ingestion-${SERVER}-restart-hint`);
    const bar = html.indexOf("first-event-status-stub");
    expect(restart).toBeGreaterThan(-1);
    expect(bar).toBeGreaterThan(restart);
    expect(wrapper.text()).toContain(WEB_SERVER_GUIDES[SERVER].restartCommand);
  });

  it("links the Windows installer instead of a shell command", async () => {
    wrapper = await mountPage();
    expect(wrapper.find(`[data-test="ingestion-${SERVER}-install-code-block"]`).exists()).toBe(
      false,
    );
    const link = wrapper.find(`[data-test="ingestion-${SERVER}-install-link"]`);
    expect(link.attributes("href")).toBe(WEB_SERVER_GUIDES[SERVER].installDocUrl);
    expect(link.attributes("target")).toBe("_blank");
    expect(link.attributes("rel")).toContain("noopener");
  });
});
