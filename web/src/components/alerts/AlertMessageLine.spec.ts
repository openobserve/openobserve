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
import AlertMessageLine from "./AlertMessageLine.vue";

const note = { text: raw("Use 0.85"), warning: true, dataTest: "note" };

describe("AlertMessageLine", () => {
  it.each([
    [{ error: "Required", note, help: raw("Range") }, "Required"],
    [{ note, help: raw("Range") }, "Use 0.85"],
    [{ help: raw("Range") }, "Range"],
    [{}, ""],
  ])("shows one message, the most severe: %o", (props, shown) => {
    const line = mount(AlertMessageLine, {
      props: { ...props, dataTest: "line" },
      global: { plugins: [i18n] },
    });
    expect(line.text()).toBe(shown);
  });
});
