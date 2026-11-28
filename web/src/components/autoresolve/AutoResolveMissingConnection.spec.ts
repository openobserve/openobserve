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

import { afterEach, describe, expect, it } from "vitest";
import { mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import type {
  AutoResolveMissingConnection as Missing,
  AutoResolveRunState,
} from "@/services/autoresolve";
import { autoresolveRun } from "@/test/unit/fixtures/autoresolveRun";
import AutoResolveMissingConnection from "./AutoResolveMissingConnection.vue";

let wrapper: VueWrapper | undefined;

const missing = (overrides: Partial<Missing>): Missing => ({
  name: "postgres",
  connection_id: "c-pg",
  action: "end session 4211 (pg_terminate_backend)",
  can_add: true,
  cannot_add_reason: null,
  ...overrides,
});

afterEach(() => wrapper?.unmount());

describe("AutoResolveMissingConnection", () => {
  // Who may not add the connection sees the button disabled and reads why, beside it.
  it.each<[string, Partial<Missing>, boolean, string | null, AutoResolveRunState]>([
    ["a person who may add it", {}, false, "partial fix", "waiting_approval"],
    [
      "a run that ended with no option, which the outcome card explains",
      {},
      false,
      null,
      "no_change",
    ],
    [
      "a person the server refused",
      { can_add: false, cannot_add_reason: "You can't edit this AutoResolve." },
      true,
      "You can't edit this AutoResolve.",
      "waiting_approval",
    ],
    ["a person refused without a reason", { can_add: false }, true, "postgres", "no_change"],
  ])("names the connection and its fix for %s", (_case, overrides, disabled, help, state) => {
    wrapper = mount(AutoResolveMissingConnection, {
      props: {
        run: autoresolveRun({ state, autoresolve: { id: "af-1", name: "Checkout is slow" } }),
        missing: missing(overrides),
      },
      global: { plugins: [i18n, store, router], provide: { store } },
    });

    expect(wrapper.find('[data-test="autoresolve-missing-connection-title"]').text()).toContain(
      "postgres",
    );
    expect(wrapper.find('[data-test="autoresolve-missing-connection-action"]').text()).toBe(
      "End session 4211 (pg_terminate_backend)",
    );
    const add = wrapper.find('[data-test="autoresolve-missing-connection-add"]');
    expect(add.text()).toContain("postgres");
    expect(add.attributes("disabled") !== undefined).toBe(disabled);
    const shownHelp = wrapper.find('[data-test="autoresolve-missing-connection-help"]');
    if (help === null) expect(shownHelp.exists()).toBe(false);
    else expect(shownHelp.text()).toContain(help);
  });
});
