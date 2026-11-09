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

// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { computed } from "vue";
import { flushPromises, mount, shallowMount } from "@vue/test-utils";
import i18n from "@/locales";
import { raw, type TranslateFn } from "@/types/i18n";
import type { ProtocolCheck } from "@/types/synthetics";
import {
  blankHttpCheck,
  internalPrefill,
  prefillLocations,
  publicPrefill,
} from "@/test/unit/mockData/syntheticPrefill";
import type { SyntheticPrefillInput } from "./syntheticPrefillContract";
import {
  SYNTHETIC_PREFILL_VIEW,
  applySyntheticPrefill,
  buildSyntheticPrefillView,
  pickPrefillLocations,
  type PreSaveRun,
} from "./useSyntheticPrefill";
import CheckDetails from "@/components/synthetics/configure/CheckDetails.vue";
import CheckLocations from "@/components/synthetics/configure/CheckLocations.vue";
import CheckSchedule from "@/components/synthetics/configure/CheckSchedule.vue";
import CheckAlerts from "@/components/synthetics/configure/CheckAlerts.vue";

const t = i18n.global.t as unknown as TranslateFn;
const DESCRIPTION = raw("Created from an AutoObserve suggestion for svc-c on Nov 6.");

function setup(prefill: SyntheticPrefillInput, preSaveRun: PreSaveRun | null = null) {
  const ids = pickPrefillLocations(prefill.locations, prefillLocations, prefill.url);
  const check: ProtocolCheck = {
    ...applySyntheticPrefill(blankHttpCheck(), prefill, DESCRIPTION),
    locations: ids,
  };
  const view = buildSyntheticPrefillView(prefill, check, {
    t,
    locale: "en-us",
    locations: prefillLocations,
    chosenLocations: new Set(ids),
    description: DESCRIPTION,
    preSaveRun,
    confirmed: new Set(["locations", "destinations"] as const),
  });
  return {
    check,
    global: { provide: { [SYNTHETIC_PREFILL_VIEW as symbol]: computed(() => view) } },
  };
}

const unstubbed = { stubs: { PrefillNote: false, SuggestedChip: false, OBadge: false } };

const chips = (w: { findAll: (s: string) => unknown[] }) =>
  w.findAll('[data-test="synthetics-prefill-suggested-chip"]').length;

describe("CheckDetails with an AutoObserve prefill", () => {
  it("marks folder, URL and tags as Suggested and explains every filled field", () => {
    const { check, global } = setup(internalPrefill);
    const w = shallowMount(CheckDetails, {
      props: { check, folders: [{ folderId: "ops", name: "ops" }] as never },
      global: { ...global, ...unstubbed },
    });
    expect(chips(w)).toBe(3);
    expect(w.find('[data-test="synthetics-prefill-note-folder"]').text()).toContain(
      "Where svc-c's 3 alerts live.",
    );
    expect(w.find('[data-test="synthetics-prefill-note-url"]').text()).toContain(
      "in-cluster address, port 8080 and the health route /healthz.",
    );
    const description = w.find('[data-test="synthetics-prefill-note-description"]');
    expect(description.text()).toBe(
      "Kept with the check, so reviewers can see where it came from.",
    );
    expect(description.find('[data-test="synthetics-prefill-suggested-chip"]').exists()).toBe(
      false,
    );
    expect(w.find('[data-test="synthetics-prefill-note-tags"]').text()).toContain(
      "Links this check to svc-c in AutoObserve",
    );
  });

  it("asks for the URL without marking it when AutoObserve found none", () => {
    const { check, global } = setup({ ...internalPrefill, url: "" });
    const w = shallowMount(CheckDetails, { props: { check }, global: { ...global, ...unstubbed } });
    const note = w.find('[data-test="synthetics-prefill-note-url"]');
    expect(note.text()).toBe(
      "svc-c's URL isn't in its traces or logs, so you enter it; location, folder and destination are filled in.",
    );
    expect(note.find('[data-test="synthetics-prefill-suggested-chip"]').exists()).toBe(false);
    expect(chips(w)).toBe(2);
  });

  it("offers Test now only when the server can run a check before saving", async () => {
    const plain = setup(internalPrefill);
    const without = shallowMount(CheckDetails, {
      props: { check: plain.check },
      global: { ...plain.global, ...unstubbed },
    });
    expect(without.find('[data-test="synthetics-prefill-test-now"]').exists()).toBe(false);

    const run = async () => ({ ok: true, location: "cluster-k agents", status: "200 OK", ms: 38 });
    const served = setup(internalPrefill, { quorum: 2, run });
    const w = mount(CheckDetails, {
      props: { check: served.check },
      global: { ...served.global, stubs: { OTemplateInput: true, OSelect: true } },
    });
    await w.find('[data-test="synthetics-prefill-test-now"]').trigger("click");
    await flushPromises();
    expect(w.find('[data-test="synthetics-prefill-test-result"]').text()).toBe(
      "Tested from cluster-k agents just now: 200 OK in 38 ms.",
    );
  });
});

describe("CheckLocations with an AutoObserve prefill", () => {
  function mountLocations(prefill: SyntheticPrefillInput) {
    const { check, global } = setup(prefill);
    return mount(CheckLocations, {
      props: { check, locations: prefillLocations, allowPrivate: true },
      global: { ...global, stubs: { OTooltip: { template: "<span><slot /></span>" } } },
    });
  }

  it("marks the ready private location and says why the other kinds are not used", () => {
    const w = mountLocations(internalPrefill);
    expect(w.find('[data-test="synthetics-prefill-location-chip-cluster-k-agents"]').exists()).toBe(
      true,
    );
    expect(w.findAll('[data-test^="synthetics-prefill-location-chip-"]')).toHaveLength(1);
    expect(w.find('[data-test="synthetics-check-locations-warning-dc-east"]').text()).toBe(
      "No agent has connected yet, so it can't run checks",
    );
    const dcEast = w.find(
      '[data-test="synthetics-check-locations-option-dc-east"] [role="checkbox"]',
    );
    expect(dcEast.attributes("aria-checked")).toBe("false");
    expect(w.find('[data-test="synthetics-prefill-location-note-public"]').text()).toContain(
      "Not selected: svc-c isn't reachable from the internet",
    );
    expect(w.find('[data-test="synthetics-prefill-location-note-private"]').text()).toContain(
      "A private location is an agent inside your network that runs checks.",
    );
  });

  it("marks the three public regions for a public address", () => {
    const w = mountLocations(publicPrefill);
    expect(w.findAll('[data-test^="synthetics-prefill-location-chip-"]')).toHaveLength(3);
    expect(w.find('[data-test="synthetics-prefill-location-note-private"]').text()).toContain(
      "Not selected: the address is public, so no agent inside your network is needed.",
    );
    expect(w.find('[data-test="synthetics-prefill-location-note-public"]').exists()).toBe(false);
  });
});

describe("schedule and alerts with an AutoObserve prefill", () => {
  it("shows runs a day under the schedule", () => {
    const { check, global } = setup(publicPrefill);
    const w = shallowMount(CheckSchedule, { props: { check }, global });
    expect(w.find('[data-test="synthetics-prefill-runs-per-day"]').text()).toBe(
      "864 runs a day across 3 regions",
    );
  });

  it("states the alert rule and why the destination was picked", () => {
    const { check, global } = setup(internalPrefill);
    const w = shallowMount(CheckAlerts, {
      props: { check, destinations: ["ops-webhook"] },
      global: { ...global, ...unstubbed },
    });
    expect(w.find('[data-test="synthetics-prefill-alert-line"]').text()).toBe(
      "Alert after 2 failed runs in a row.",
    );
    const note = w.find('[data-test="synthetics-prefill-note-destinations"]');
    expect(note.text()).toContain("svc-c's 3 alerts notify ops-webhook.");
    expect(note.find('[data-test="synthetics-prefill-suggested-chip"]').exists()).toBe(true);
  });

  it("names the location quorum only when the server offers one", () => {
    const run = async () => ({ ok: true, location: "US East" });
    const { check, global } = setup(publicPrefill, { quorum: 2, run });
    const w = shallowMount(CheckAlerts, { props: { check, destinations: [] }, global });
    expect(w.find('[data-test="synthetics-prefill-alert-line"]').text()).toBe(
      "Alert after 2 failed runs in a row from 2 of 3 locations.",
    );
  });
});

describe("configure sections when the org's lists fail to load", () => {
  function unconfirmedView() {
    const check = applySyntheticPrefill(blankHttpCheck(), internalPrefill, DESCRIPTION);
    const view = buildSyntheticPrefillView(internalPrefill, check, {
      t,
      locale: "en-us",
      locations: [],
      chosenLocations: new Set(),
      description: DESCRIPTION,
      preSaveRun: null,
      confirmed: new Set(),
      unconfirmed: new Set(["locations", "destinations"]),
    });
    return {
      check,
      global: { provide: { [SYNTHETIC_PREFILL_VIEW as symbol]: computed(() => view) } },
    };
  }

  it("warns under the locations that the suggested ones are not confirmed", () => {
    const { check, global } = unconfirmedView();
    const w = mount(CheckLocations, {
      props: { check, locations: [], allowPrivate: true },
      global: { ...global, stubs: { OTooltip: { template: "<span><slot /></span>" } } },
    });
    const note = w.find('[data-test="synthetics-prefill-unconfirmed-locations"]');
    expect(note.text()).toBe(
      "Locations didn't load, so the suggested ones aren't confirmed. Refresh the list before you save.",
    );
    expect(note.classes()).toContain("text-status-warning-text");
  });

  it("warns under the destinations instead of saying why they were picked", () => {
    const { check, global } = unconfirmedView();
    const w = shallowMount(CheckAlerts, {
      props: { check, destinations: [] },
      global: { ...global, ...unstubbed },
    });
    const note = w.find('[data-test="synthetics-prefill-unconfirmed-destinations"]');
    expect(note.text()).toBe(
      "Destinations didn't load, so the suggested ones aren't confirmed. Refresh the list before you save.",
    );
    expect(note.classes()).toContain("text-status-warning-text");
    expect(w.find('[data-test="synthetics-prefill-note-destinations"]').exists()).toBe(false);
  });
});
