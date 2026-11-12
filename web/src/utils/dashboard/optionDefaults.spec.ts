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
import { createI18n } from "vue-i18n";
import en from "@/locales/languages/en-US.json";
import { raw, type TranslateFn } from "@/types/i18n";
import {
  defaultChoice,
  defaultFromData,
  defaultHint,
  defaultPlaceholder,
  withDefaultChoice,
} from "./optionDefaults";

const i18n = createI18n({ legacy: false, locale: "en", messages: { en } });
const t = i18n.global.t as unknown as TranslateFn;

const choices = [
  { label: raw("Solid"), value: "solid" },
  { label: raw("Dashed"), value: "dashed" },
];

describe("optionDefaults", () => {
  it("names the fallback option inside the Default entry", () => {
    expect(defaultChoice(t, "__auto__", choices, "solid")).toEqual({
      label: "Default (Solid)",
      value: "__auto__",
    });
  });

  it("falls back to a bare Default when the fallback is not one of the options", () => {
    expect(defaultChoice(t, "__auto__", choices, "wavy").label).toBe("Default");
  });

  it("puts the Default entry first and keeps every option", () => {
    const options = withDefaultChoice(t, "__auto__", choices, "dashed");
    expect(options.map((option) => option.label)).toEqual(["Default (Dashed)", "Solid", "Dashed"]);
    expect(options[0].value).toBe("__auto__");
  });

  it("formats numeric and text placeholders and the data-dependent default", () => {
    expect(defaultPlaceholder(t, 4)).toBe("Default: 4");
    expect(defaultPlaceholder(t, raw("No limit"))).toBe("Default: No limit");
    expect(defaultHint(t, raw("Percent"))).toBe("Default (Percent)");
    expect(defaultFromData(t)).toBe("Default (auto from data)");
  });
});
