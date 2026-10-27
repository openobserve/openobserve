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

import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";

import { raw } from "@/types/i18n";

import AssistantEnvValue from "./AssistantEnvValue.vue";

let wrapper: ReturnType<typeof mount> | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
});

describe("AssistantEnvValue", () => {
  it("renders label and value with an info button named by the variable", () => {
    wrapper = mount(AssistantEnvValue, {
      props: {
        label: raw("Server history"),
        value: raw("false"),
        envName: "O2_AI_CHAT_PERSISTENCE_ENABLED",
      },
    });
    const row = wrapper.find('[data-test="settings-assistant-env-O2_AI_CHAT_PERSISTENCE_ENABLED"]');
    expect(row.text()).toContain("Server history");
    expect(
      row.find('[data-test="settings-assistant-env-O2_AI_CHAT_PERSISTENCE_ENABLED-value"]').text(),
    ).toBe("false");
    expect(
      wrapper
        .find('[data-test="settings-assistant-env-O2_AI_CHAT_PERSISTENCE_ENABLED-info"]')
        .attributes("aria-label"),
    ).toBe("Set by O2_AI_CHAT_PERSISTENCE_ENABLED");
  });

  it("reads a missing value as a dash and says it is not reported", () => {
    wrapper = mount(AssistantEnvValue, {
      props: { label: raw("Longest answer"), value: null, envName: "O2_AI_CHAT_MAX_TURN_SECS" },
    });
    expect(
      wrapper.find('[data-test="settings-assistant-env-O2_AI_CHAT_MAX_TURN_SECS-value"]').text(),
    ).toBe("—");
    expect(wrapper.text()).toContain("Not reported by this server version");
  });

  it("opens a popover naming the variable and the help line", async () => {
    wrapper = mount(AssistantEnvValue, {
      props: {
        label: raw("Retention"),
        value: raw("30 days"),
        envName: "O2_AI_CHAT_RETENTION_DAYS",
      },
      attachTo: document.body,
    });
    await wrapper
      .find('[data-test="settings-assistant-env-O2_AI_CHAT_RETENTION_DAYS-info"]')
      .trigger("click");
    await flushPromises();
    expect(document.body.textContent).toContain("Set by the deployment, read-only here");
    expect(document.body.textContent).toContain("O2_AI_CHAT_RETENTION_DAYS");
  });
});
