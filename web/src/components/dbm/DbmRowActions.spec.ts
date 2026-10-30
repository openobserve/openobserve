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

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import { raw } from "@/types/i18n";
import DbmRowActions from "./DbmRowActions.vue";

const mountActions = () =>
  mount(DbmRowActions, {
    props: {
      dataTest: "t",
      actions: [
        { id: "copy", icon: "content-copy", label: raw("Copy") },
        {
          id: "ai",
          icon: "brain-circuit",
          label: raw("Suggest fix"),
          lockedReason: raw("Locked: needs AI assistant"),
        },
      ],
    },
    global: { plugins: [i18n] },
  });

describe("DbmRowActions", () => {
  it("emits an unlocked action on click", async () => {
    const wrapper = mountActions();
    await wrapper.find('[data-test="t-copy"]').trigger("click");
    expect(wrapper.emitted("action")?.[0]).toEqual(["copy"]);
  });

  it("renders a license-locked action as a disabled button that emits nothing", async () => {
    const wrapper = mountActions();
    const locked = wrapper.find('[data-test="t-ai"]');
    expect(locked.attributes("disabled")).toBeDefined();
    expect(locked.attributes("aria-label")).toBe("Suggest fix");
    await locked.trigger("click");
    expect(wrapper.emitted("action")).toBeUndefined();
  });
});
