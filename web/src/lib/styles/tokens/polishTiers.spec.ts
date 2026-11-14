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

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";

import { composite, contrastRatio, resolveColor, resolveTokens, type Rgba } from "./colorMath";
import { applyThemeColors, type SemanticColors } from "@/utils/theme";
import { PREDEFINED_THEMES } from "@/constants/themes";
import OStatCard from "@/lib/data/StatStrip/OStatCard.vue";
import OButton from "@/lib/core/Button/OButton.vue";
import type { ButtonVariant } from "@/lib/core/Button/OButton.types";
import OTime from "@/lib/forms/Time/OTime.vue";
import ODateTimeRange from "@/lib/forms/DateTimeRange/ODateTimeRange.vue";
import { raw } from "@/types/i18n";

const here = dirname(fileURLToPath(import.meta.url));
const SHEETS = ["base.css", "semantic.css", "component.css", "dark.css"].map((file) =>
  readFileSync(join(here, file), "utf8"),
);
const THEMES = resolveTokens(SHEETS);
const BOTH = ["light", "dark"] as const;
type Theme = (typeof BOTH)[number];

const TEXT_MIN = 4.5;
const NON_TEXT_MIN = 3;

function color(name: string, theme: Theme): Rgba {
  const resolved = resolveColor(name, THEMES[theme]);
  if (!resolved) throw new Error(`${name} does not resolve in ${theme}`);
  return resolved;
}

/** Contrast of `fg` painted on `bg`, with `bg` itself painted on the page. */
function ratio(fg: string, bg: string, theme: Theme): number {
  const page = color("--color-surface-base", theme);
  const backdrop = composite(color(bg, theme), page);
  return contrastRatio(composite(color(fg, theme), backdrop), backdrop);
}

/** Tokens as theme.ts leaves them once a predefined theme colour (and its semantic colours) is applied. */
function themed(themeColor: string, theme: Theme, semantic?: SemanticColors): Map<string, string> {
  applyThemeColors(themeColor, theme, false, semantic);
  const scope = new Map(THEMES[theme]);
  // Dark semantic overrides land on body, which every component sits under, so they win over html's.
  for (const inline of [document.documentElement.style, document.body.style]) {
    for (let i = 0; i < inline.length; i++) {
      const name = inline.item(i);
      if (name.startsWith("--color-")) scope.set(name, inline.getPropertyValue(name).trim());
    }
  }
  document.documentElement.removeAttribute("style");
  document.documentElement.classList.remove("dark");
  document.body.removeAttribute("style");
  return scope;
}

function same(a: string, b: string, theme: Theme): boolean {
  const x = color(a, theme);
  const y = color(b, theme);
  return (
    Math.round(x.r) === Math.round(y.r) &&
    Math.round(x.g) === Math.round(y.g) &&
    Math.round(x.b) === Math.round(y.b) &&
    Math.abs(x.a - y.a) < 0.001
  );
}

describe("visible neutral hover (item 1)", () => {
  it("lifts the light accent hover to the table-row hover look", () => {
    expect(
      ratio("--color-surface-accent-hover", "--color-surface-base", "light"),
    ).toBeGreaterThanOrEqual(1.15);
    expect(same("--color-table-row-hover-bg", "--color-surface-accent-hover", "light")).toBe(true);
  });

  it("keeps the table rows' own selected fill from main in light", () => {
    const selected = ratio("--color-table-row-selected-bg", "--color-surface-base", "light");
    expect(selected).toBeCloseTo(1.28, 1);
  });

  it("leaves the dark hover, active and table-row hover as on main", () => {
    expect(THEMES.dark.get("--color-surface-accent-hover")).toBe("var(--color-primary-900)");
    expect(THEMES.dark.get("--color-surface-accent-active")).toBe("var(--color-primary-800)");
    expect(THEMES.dark.get("--color-table-row-hover-bg")).toBe("var(--d-hover)");
  });

  it.each(BOTH)("keeps a hovered and the selected select option apart in %s", (theme) => {
    expect(
      ratio("--color-select-item-selected-bg", "--color-select-item-hover-bg", theme),
    ).toBeGreaterThanOrEqual(1.13);
  });

  it("keeps main's 1.42:1 between a hovered and the selected select option in dark", () => {
    expect(
      ratio("--color-select-item-selected-bg", "--color-select-item-hover-bg", "dark"),
    ).toBeGreaterThanOrEqual(1.42);
  });

  it("steps a ghost hover up one tier inside a hovered table row", () => {
    // The step is capped by keeping semantic button labels at 4.5:1 on the action fill.
    expect(
      ratio("--color-table-row-action-hover-bg", "--color-table-row-hover-bg", "light"),
    ).toBeGreaterThanOrEqual(1.09);
    expect(same("--color-table-row-action-hover-bg", "--color-surface-accent-hover", "dark")).toBe(
      true,
    );
  });
});

describe("primary ink on the accent fills (item 1)", () => {
  const PRIMARY_INK: ButtonVariant[] = [
    "ghost-primary",
    "ghost-muted",
    "panel-collapse",
    "outline-primary",
    "pricing-chip",
  ];
  const HOVER_FILLS = [
    "enabled:hover:bg-",
    "enabled:active:bg-",
    "group-hover/row:enabled:hover:not-active:bg-",
  ];

  const isColor = (token: string) => resolveColor(token, THEMES.light) !== null;
  const tokensAfter = (classes: string[], prefix: string) =>
    classes
      .filter((c) => c.startsWith(prefix))
      .map((c) => `--color-${c.slice(prefix.length)}`)
      .filter(isColor);

  /** Every label/fill pair a variant paints at rest and under the pointer. */
  const buttonPairs = (variant: ButtonVariant): [string, string][] => {
    const wrapper = mount(OButton, { props: { variant }, slots: { default: "Run" } });
    const classes = wrapper.get("button").classes();
    wrapper.unmount();
    const restInk = tokensAfter(classes, "text-")[0];
    const hoverInk = tokensAfter(classes, "enabled:hover:text-")[0] ?? restInk;
    if (!hoverInk) throw new Error(`${variant} has no label colour`);
    const pairs: [string, string][] = [];
    for (const bg of tokensAfter(classes, "bg-")) pairs.push([restInk ?? hoverInk, bg]);
    for (const prefix of HOVER_FILLS) {
      for (const bg of tokensAfter(classes, prefix)) pairs.push([hoverInk, bg]);
    }
    return pairs;
  };

  const ratioIn = (scope: Map<string, string>, fg: string, bg: string) => {
    const page = resolveColor("--color-surface-base", scope)!;
    const fill = composite(resolveColor(bg, scope)!, page);
    return contrastRatio(composite(resolveColor(fg, scope)!, fill), fill);
  };

  it.each(PRIMARY_INK)("paints %s on at least one accent hover fill", (variant) => {
    expect(buttonPairs(variant).length).toBeGreaterThan(0);
  });

  it.each(PREDEFINED_THEMES.flatMap((t) => BOTH.map((mode) => [t.name, mode, t[mode].themeColor])))(
    "keeps hovered primary button labels at 4.5:1 under %s %s",
    (_name, mode, themeColor) => {
      const scope = themed(themeColor as string, mode as Theme);
      const offenders = PRIMARY_INK.flatMap((variant) =>
        buttonPairs(variant)
          .map(([fg, bg]) => [fg, bg, ratioIn(scope, fg, bg)] as const)
          .filter(([, , measured]) => measured < TEXT_MIN)
          .map(([fg, bg, measured]) => `${variant}: ${fg} on ${bg} ${measured.toFixed(2)}:1`),
      );
      expect(offenders).toEqual([]);
    },
  );

  it.each(PREDEFINED_THEMES.flatMap((t) => BOTH.map((mode) => [t.name, mode, t[mode].themeColor])))(
    "keeps a selected select option's label at 4.5:1 under %s %s",
    (_name, mode, themeColor) => {
      const scope = themed(themeColor as string, mode as Theme);
      for (const bg of ["--color-select-item-selected-bg", "--color-select-item-hover-bg"]) {
        expect(ratioIn(scope, "--color-select-item-selected-text", bg), bg).toBeGreaterThanOrEqual(
          TEXT_MIN,
        );
      }
    },
  );
});

describe("labels on the accent fills under every preset and its semantic colours", () => {
  const FILLS = [
    "--color-surface-accent-hover",
    "--color-surface-accent-active",
    "--color-table-row-action-hover-bg",
  ];
  // Status inks are left out: they sit on their own status tints, never on these fills.
  const INKS = [
    "--color-button-ghost-text",
    "--color-button-outline-text",
    "--color-button-secondary-foreground",
    "--color-button-ghost-primary-hover-text",
    "--color-button-ghost-muted-hover-text",
    "--color-select-item-selected-text",
    "--color-accent-on-tint",
    "--color-text-heading",
  ];
  const NEUTRAL: ButtonVariant[] = ["secondary", "outline", "ghost", "sidebar-toggle"];
  const PRESETS = PREDEFINED_THEMES.flatMap((t) =>
    BOTH.map((mode) => [t.name, mode, t[mode].themeColor, t[mode].semanticColors] as const),
  );

  const ratioIn = (scope: Map<string, string>, fg: string, bg: string) => {
    const page = resolveColor("--color-surface-base", scope)!;
    const fill = composite(resolveColor(bg, scope)!, page);
    return contrastRatio(composite(resolveColor(fg, scope)!, fill), fill);
  };

  /** Label/fill pairs a variant paints while hovered, pressed or hovered inside a hovered row. */
  const pointerPairs = (variant: ButtonVariant): [string, string][] => {
    const wrapper = mount(OButton, { props: { variant }, slots: { default: "Run" } });
    const classes = wrapper.get("button").classes();
    wrapper.unmount();
    const token = (prefix: string) =>
      classes
        .filter((c) => c.startsWith(prefix))
        .map((c) => `--color-${c.slice(prefix.length)}`)
        .filter((t) => resolveColor(t, THEMES.light) !== null);
    const ink = token("enabled:hover:text-")[0] ?? token("text-")[0];
    if (!ink) throw new Error(`${variant} has no label colour`);
    return [
      "enabled:hover:bg-",
      "enabled:active:bg-",
      "group-hover/row:enabled:hover:not-active:bg-",
    ].flatMap((prefix) => token(prefix).map((bg) => [ink, bg] as [string, string]));
  };

  it.each(NEUTRAL)("finds the hover and pressed fills of the %s button", (variant) => {
    expect(pointerPairs(variant).length).toBeGreaterThanOrEqual(2);
  });

  it.each(PRESETS)(
    "keeps every button and option label at 4.5:1 on the hover, active and row-action fills under %s %s",
    (_name, mode, themeColor, semantic) => {
      const scope = themed(themeColor, mode, semantic);
      const offenders = FILLS.flatMap((bg) =>
        INKS.map((fg) => [fg, bg, ratioIn(scope, fg, bg)] as const),
      )
        .filter(([, , measured]) => measured < TEXT_MIN)
        .map(([fg, bg, measured]) => `${fg} on ${bg} ${measured.toFixed(2)}:1`);
      expect(offenders).toEqual([]);
    },
  );

  it.each(PRESETS)(
    "keeps neutral button labels at 4.5:1 while hovered and pressed under %s %s",
    (_name, mode, themeColor, semantic) => {
      const scope = themed(themeColor, mode, semantic);
      const offenders = NEUTRAL.flatMap((variant) =>
        pointerPairs(variant)
          .map(([fg, bg]) => [fg, bg, ratioIn(scope, fg, bg)] as const)
          .filter(([, , measured]) => measured < TEXT_MIN)
          .map(([fg, bg, measured]) => `${variant}: ${fg} on ${bg} ${measured.toFixed(2)}:1`),
      );
      expect(offenders).toEqual([]);
    },
  );

  it.each(PRESETS)(
    "keeps hovered and selected select options apart under %s %s",
    (_name, mode, themeColor, semantic) => {
      const scope = themed(themeColor, mode, semantic);
      const apart = ratioIn(
        scope,
        "--color-select-item-selected-bg",
        "--color-select-item-hover-bg",
      );
      expect(apart).toBeGreaterThanOrEqual(mode === "light" ? 1.13 : 1.42);
    },
  );
});

describe("tab inks (item 2)", () => {
  it.each(BOTH)("leaves the nav rail and nav group labels in heading ink in %s", (theme) => {
    expect(THEMES.light.get("--color-tabs-inactive-text")).toBe("var(--color-text-heading)");
    expect(same("--color-tabs-inactive-text", "--color-text-heading", theme)).toBe(true);
  });
});

describe("segmented control (item 3)", () => {
  const MAIN: Record<Theme, [string, string][]> = {
    light: [
      ["--color-toggle-item-text", "--color-text-body"],
      ["--color-toggle-item-active-bg", "--color-surface-accent-active"],
      ["--color-toggle-item-active-text", "--color-primary-700"],
      ["--color-toggle-item-active-border", "--color-primary-600"],
      ["--color-toggle-item-hover-bg", "--color-grey-150"],
    ],
    dark: [
      ["--color-toggle-item-active-bg", "--color-primary-900"],
      ["--color-toggle-item-active-text", "--color-white"],
      ["--color-toggle-item-active-border", "--color-primary-400"],
    ],
  };

  it.each(BOTH)("keeps main's segment text, fill, edge and hover in %s", (theme) => {
    for (const [token, main] of MAIN[theme]) expect(same(token, main, theme), token).toBe(true);
  });

  it.each(BOTH)("keeps the selected-segment edge at 3:1 on its fill in %s", (theme) => {
    expect(
      ratio("--color-toggle-item-active-border", "--color-toggle-item-active-bg", theme),
    ).toBeGreaterThanOrEqual(NON_TEXT_MIN);
  });

  it.each(BOTH)("keeps inactive text readable on the track and the hover in %s", (theme) => {
    for (const bg of ["--color-toggle-track-bg", "--color-toggle-item-hover-bg"]) {
      expect(ratio("--color-toggle-item-text", bg, theme), bg).toBeGreaterThanOrEqual(TEXT_MIN);
    }
    expect(
      ratio("--color-toggle-item-active-bg", "--color-toggle-item-hover-bg", theme),
    ).toBeGreaterThanOrEqual(1.1);
  });
});

describe("stat strip filter chips", () => {
  const badgeFill = (tone: "error" | "neutral", value: number) =>
    tone === "error" && value > 0 ? "--color-badge-error-soft-bg" : "--color-surface-subtle";

  const tileToken = (part: "value" | "label", tone: "error" | "neutral", value: number) => {
    const wrapper = mount(OStatCard, {
      props: {
        variant: "chip",
        clickable: true,
        selected: false,
        tone,
        label: raw("Failed"),
        value,
      },
    });
    const text = wrapper
      .get(`[data-test="o-stat-card-${part}"]`)
      .classes()
      .find((c) => c.startsWith("text-") && c !== "text-2xs");
    wrapper.unmount();
    if (!text) throw new Error(`no text colour on the ${tone} ${part}`);
    return `--color-${text.slice("text-".length)}`;
  };

  it.each(
    BOTH.flatMap((theme) =>
      [
        ["error count", "value", "error", 1],
        ["neutral count", "value", "neutral", 1],
        ["zero count", "value", "error", 0],
        ["label", "label", "neutral", 1],
      ].map(([what, part, tone, value]) => [theme, what, part, tone, value] as const),
    ),
  )(
    "keeps an unselected %s filter chip's %s readable on its fill",
    (theme, _what, part, tone, value) => {
      const token = tileToken(
        part as "value" | "label",
        tone as "error" | "neutral",
        value as number,
      );
      const fill =
        part === "value"
          ? badgeFill(tone as "error" | "neutral", value as number)
          : "--color-surface-base";
      expect(ratio(token, fill, theme)).toBeGreaterThanOrEqual(TEXT_MIN);
    },
  );
});

describe("one off look (item 4)", () => {
  it.each(BOTH)("paints the unselected radio edge with the control border in %s", (theme) => {
    expect(same("--color-radio-border", "--color-border-control", theme)).toBe(true);
  });

  it.each(BOTH)("keeps the brand outline and thumb on an off switch in %s", (theme) => {
    for (const token of ["--color-switch-border-off", "--color-switch-thumb-off"]) {
      expect(same(token, "--color-primary-500", theme), token).toBe(true);
    }
  });

  it.each(BOTH)("keeps main's unchecked checkbox edge in %s", (theme) => {
    expect(same("--color-checkbox-border", "--color-border-strong", theme)).toBe(true);
  });

  it.each(BOTH)("clears 3:1 on the surfaces the off controls sit on in %s", (theme) => {
    const surfaces = [
      "--color-surface-base",
      "--color-surface-panel",
      "--color-surface-overlay",
      "--color-checkbox-bg",
      "--color-radio-bg",
    ];
    for (const bg of surfaces) {
      expect(ratio("--color-border-control", bg, theme), bg).toBeGreaterThanOrEqual(NON_TEXT_MIN);
    }
  });
});

describe("dark overlays lift (item 5)", () => {
  it("gives dark dialogs and drawers a stronger shadow and no outer ring", () => {
    const dark = THEMES.dark.get("--shadow-dialog") ?? "";
    expect(dark).toContain("1.5rem 3rem");
    expect(dark).not.toContain("ring");
    for (const theme of BOTH) expect(THEMES[theme].has("--color-dialog-hairline")).toBe(false);
  });
});

describe("readable text tiers (item 11)", () => {
  it.each(BOTH)("lifts the label tier to 4.5:1 on the page and on panels in %s", (theme) => {
    for (const bg of ["--color-surface-base", "--color-surface-panel"]) {
      expect(ratio("--color-text-label", bg, theme), bg).toBeGreaterThanOrEqual(TEXT_MIN);
    }
  });

  it("lifts the light muted tier to 3:1 on the page", () => {
    expect(ratio("--color-text-muted", "--color-surface-base", "light")).toBeGreaterThanOrEqual(
      NON_TEXT_MIN,
    );
  });
});

/** Text inks the time segments, Close and range tabs paint straight on the picker popup. */
async function pickerAccentInks(): Promise<[string, string][]> {
  const inks = (where: string, el: Element): [string, string][] =>
    [...el.classList]
      .flatMap((c) =>
        ["text-", "hover:text-"].filter((p) => c.startsWith(p)).map((p) => c.slice(p.length)),
      )
      .map((name) => `--color-${name}`)
      .filter((token) => resolveColor(token, THEMES.light) !== null)
      .map((token) => [where, token]);

  const time = mount(OTime, { attachTo: document.body, props: { withSeconds: true } });
  await time.find('[aria-label="Open time picker"]').trigger("click");
  await flushPromises();
  const timePopup = document.body.querySelector('[data-test="otime-popup"]')!;
  const found = [
    ...[...timePopup.querySelectorAll("button.tabular-nums")].flatMap((b) =>
      inks("OTime segment", b),
    ),
    ...inks("OTime Close", timePopup.querySelector('[data-test="otime-close"]')!),
  ];
  time.unmount();

  const range = mount(ODateTimeRange, { attachTo: document.body });
  await range.find('[data-test="datetimerange-trigger"]').trigger("click");
  await flushPromises();
  const tabs = document.body.querySelectorAll('[data-test="datetimerange-tabs"] button');
  found.push(...[...tabs].flatMap((b) => inks("ODateTimeRange tab", b)));
  range.unmount();
  return found;
}

describe("dark selected fills (item 12)", () => {
  const FILLS: [string, string][] = [
    ["--color-checkbox-checked-bg", "--color-checkbox-checked-fg"],
    ["--color-datepicker-day-selected-bg", "--color-datepicker-day-selected-text"],
    ["--color-pagination-item-active-bg", "--color-pagination-item-active-text"],
    ["--color-datepicker-clock-selected-bg", "--color-datepicker-clock-selected-text"],
    [
      "--color-datepicker-relative-btn-selected-bg",
      "--color-datepicker-relative-btn-selected-text",
    ],
  ];

  it.each(FILLS)(
    "paints %s with the primary button fill and its foreground in dark",
    (fill, text) => {
      expect(same(fill, "--color-button-primary", "dark")).toBe(true);
      expect(same(text, "--color-button-primary-foreground", "dark")).toBe(true);
      expect(ratio(text, fill, "dark")).toBeGreaterThanOrEqual(TEXT_MIN);
    },
  );

  it.each(PREDEFINED_THEMES.flatMap((t) => BOTH.map((mode) => [t.name, mode, t[mode].themeColor])))(
    "keeps the picker's accent labels at 4.5:1 on the popup under %s %s",
    async (_name, mode, themeColor) => {
      const inks = await pickerAccentInks();
      expect(inks.length).toBeGreaterThanOrEqual(3);
      const scope = themed(themeColor as string, mode as Theme);
      const page = resolveColor("--color-surface-base", scope)!;
      const popup = composite(resolveColor("--color-datepicker-popup-bg", scope)!, page);
      const offenders = inks
        .map(
          ([where, fg]) =>
            [where, fg, contrastRatio(composite(resolveColor(fg, scope)!, popup), popup)] as const,
        )
        .filter(([, , measured]) => measured < TEXT_MIN)
        .map(([where, fg, measured]) => `${where}: ${fg} ${measured.toFixed(2)}:1`);
      expect(offenders).toEqual([]);
    },
  );

  it.each(FILLS)("keeps %s readable under the O2 Signature dark accent", (fill, text) => {
    const signature = PREDEFINED_THEMES.find((theme) => theme.dark.themeColor === "#8B8DF0");
    expect(signature).toBeDefined();
    const scope = themed(signature!.dark.themeColor, "dark");
    const page = resolveColor("--color-surface-base", scope)!;
    const bg = composite(resolveColor(fill, scope)!, page);
    expect(contrastRatio(composite(resolveColor(text, scope)!, bg), bg)).toBeGreaterThanOrEqual(
      TEXT_MIN,
    );
  });
});
