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
import store from "@/test/unit/helpers/store";
import { raw, type TranslateFn } from "@/types/i18n";

import { buildChoices, type OnboardingRow } from "./onboardingChoices";
import OnboardingStepWhich from "./OnboardingStepWhich.vue";

const choices = buildChoices(i18n.global.t as unknown as TranslateFn);

const mountWhich = (choiceId: string, rowId: string) => {
  const choice = choices.find((c) => c.id === choiceId)!;
  const row = choice.rows.find((r) => r.id === rowId)!;
  return mount(OnboardingStepWhich, {
    props: { choices, choice, row },
    global: { plugins: [store] },
  });
};

type W = ReturnType<typeof mountWhich>;
const tiles = (w: W) => w.findAll('[data-test^="onboarding-step-which-guide-"]');
// A tile's name, without the short line under it.
const tileName = (t: ReturnType<W["find"]>) => t.find("span.grid > span").text();
const search = (w: W, value: string) =>
  w.find('[data-test="onboarding-step-which-search"] input').setValue(value);

describe("OnboardingStepWhich", () => {
  it("caps long groups at 8 tiles with Show more", () => {
    const w = mountWhich("llm", "something-else");
    const row = choices.find((c) => c.id === "llm")!.rows.find((r) => r.id === "something-else")!;
    const size = row.groups![0].guides.length;
    const firstGroup = w.findAll('[data-test="onboarding-step-which-group"]')[0];
    expect(firstGroup.findAll('[data-test^="onboarding-step-which-guide-"]')).toHaveLength(8);
    expect(firstGroup.find('[data-test="onboarding-step-which-show-more"]').text()).toBe(
      `Show ${size - 8} more`,
    );
  });

  it("shows the title and the tiles, with the choice's example screen beside them", () => {
    const w = mountWhich("infrastructure", "databases");
    expect(w.find("h1").text()).toBe("Which database do you want to monitor?");
    expect(w.text()).not.toContain("Each opens its setup guide");
    expect(w.find('[data-test="onboarding-preview-title"]').text()).toBe("Databases");
    expect(w.find('[data-test="onboarding-example"]').attributes("data-kind")).toBe(
      "infrastructure",
    );
  });

  it("filters tiles as the user types", async () => {
    const w = mountWhich("infrastructure", "databases");
    await search(w, "redis");
    expect(tiles(w)).toHaveLength(1);
    expect(tileName(tiles(w)[0])).toBe("Redis");
    expect(tiles(w)[0].text()).toContain("Memory, command and keyspace metrics.");
  });

  it("offers matches from other choices", async () => {
    const w = mountWhich("logs", "something-else");
    await search(w, "kafka");
    expect(w.text()).toContain('No guide matches "kafka" here.');
    const hit = w.find('[data-test="onboarding-step-which-hit"]');
    expect(hit.text()).toBe("Kafka");
    expect(w.find('[data-test="onboarding-step-which-hit-where"]').text()).toBe(
      "in Infrastructure",
    );
  });

  it("emits open with the guide", async () => {
    const w = mountWhich("infrastructure", "databases");
    const tile = tiles(w).find((t) => tileName(t) === "PostgreSQL")!;
    await tile.trigger("click");
    const payload = w.emitted("open")![0][0] as { guide: { route: string } };
    expect(payload.guide.route).toBe("postgres");
  });

  it("Show more expands its own group when an earlier group is empty", async () => {
    const choice = choices[0];
    const guides = Array.from({ length: 14 }, (_, i) => ({
      id: `g${i}`,
      name: raw(`Guide ${i}`),
      route: "home",
    }));
    const row: OnboardingRow = {
      ...choice.rows[0],
      route: undefined,
      groups: [
        { heading: raw("Empty"), guides: [] },
        { heading: raw("Full"), guides },
      ],
    };
    const w = mount(OnboardingStepWhich, {
      props: { choices, choice, row },
      global: { plugins: [store] },
    });
    expect(tiles(w)).toHaveLength(8);
    await w.find('[data-test="onboarding-step-which-show-more"]').trigger("click");
    expect(tiles(w)).toHaveLength(14);
  });
});
