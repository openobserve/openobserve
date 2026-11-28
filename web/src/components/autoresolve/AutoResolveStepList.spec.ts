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
import { autoresolveStep } from "@/test/unit/fixtures/autoresolveRun";
import AutoResolveStepList from "./AutoResolveStepList.vue";

const CARD = '[data-test="autoresolve-step-card"]';

describe("AutoResolveStepList", () => {
  // A worked run folds its steps in the same snapshot that marks them done.
  it("a folded list keeps no step card in the DOM", async () => {
    const w = mount(AutoResolveStepList, {
      props: {
        steps: [autoresolveStep({ state: "approved" })],
        title: raw("Revert"),
        approvedLine: null,
        open: true,
      },
      global: { plugins: [i18n] },
      attachTo: document.body,
    });
    expect(w.findAll(CARD)).toHaveLength(1);

    await w.setProps({ steps: [autoresolveStep({ state: "done" })], open: false });
    expect(w.findAll(CARD)).toHaveLength(0);
    w.unmount();
  });
});
