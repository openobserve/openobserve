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
import { mount } from "@vue/test-utils";

import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import type { TranslateFn } from "@/types/i18n";
import { FIRST_SOURCE_PREFILL_KEY } from "@/components/login/firstSourceOptions";
import OIcon from "@/lib/core/Icon/OIcon.vue";

import { buildChoices } from "./onboardingChoices";
import OnboardingStepChoose from "./OnboardingStepChoose.vue";

const choices = buildChoices(i18n.global.t as unknown as TranslateFn);

const mountChoose = (canInvite = true, attachTo?: HTMLElement) =>
  mount(OnboardingStepChoose, {
    props: { choices, canInvite },
    global: { plugins: [store] },
    attachTo,
  });

const choiceButtons = (w: ReturnType<typeof mountChoose>) =>
  w.findAll('[data-test^="onboarding-step-choose-choice-"]');

const panelTitle = (w: ReturnType<typeof mountChoose>) =>
  w.find('[data-test="onboarding-preview-title"]').text();

// The visible panel text; the hidden copies under it only hold the height.
const panelText = (w: ReturnType<typeof mountChoose>) =>
  w.find('[data-test="onboarding-preview"] .row-start-1 p:nth-of-type(2)').text();

const panelChips = (w: ReturnType<typeof mountChoose>) =>
  w.findAll('[data-test^="onboarding-preview-signal-"]').map((c) => c.text());

// The brand fill the previewed row takes from the tablet width up.
const filled = (el: { classes: () => string[] }) =>
  el.classes().includes("md:bg-onboarding-choice-active-bg");

describe("OnboardingStepChoose", () => {
  afterEach(() => {
    sessionStorage.clear();
    store.state.zoConfig = { ...store.state.zoConfig, synthetics_enabled: true };
  });

  it("renders five choices, each a title and one short line, with no guide counts", () => {
    const w = mountChoose();
    const items = choiceButtons(w);
    expect(items).toHaveLength(5);
    expect(items[0].text()).toBe("InfrastructureServers, Kubernetes, cloud accounts and databases");
    expect(w.text()).not.toMatch(/\d+ guides?/);
  });

  it("keeps the step short: no lead, no second Not sure sentence, no reassurance line", () => {
    const w = mountChoose();
    const text = w.text();
    expect(text).toContain("What do you want to monitor first?");
    expect(w.find('[data-test="onboarding-step-choose-greeting"]').exists()).toBe(false);
    expect(text).not.toMatch(/is ready/);
    expect(w.find('[data-test="onboarding-step-choose-not-sure"]').exists()).toBe(false);
    expect(text).not.toContain("Not sure?");
    expect(text).not.toContain("We fill in your endpoint and token");
    expect(text).not.toContain("traces programs with no code changes");
    expect(text).not.toContain("only your starting point");
  });

  it("updates the side panel on focus, not only on hover", async () => {
    const w = mountChoose();
    expect(panelTitle(w)).toBe("Infrastructure");
    await choiceButtons(w)[2].trigger("focus");
    expect(panelTitle(w)).toBe("Frontend and mobile apps");
  });

  it("fills the row the panel describes", async () => {
    const w = mountChoose();
    expect(choiceButtons(w).map(filled)).toEqual([true, false, false, false, false]);
    await choiceButtons(w)[4].trigger("mouseenter");
    expect(choiceButtons(w).map(filled)).toEqual([false, false, false, false, true]);
    await w.find('[data-test="onboarding-step-choose-other-agent"]').trigger("mouseenter");
    expect(filled(w.find('[data-test="onboarding-step-choose-other-agent"]'))).toBe(true);
    expect(choiceButtons(w).some(filled)).toBe(false);
  });

  it("shows the hovered choice's sentence and signal chips, not a tick-mark list", async () => {
    const w = mountChoose();
    expect(panelText(w)).toBe("See every host, pod and cloud service in one place.");
    expect(panelChips(w)).toEqual(["Metrics", "Logs", "Events", "Traces"]);
    await choiceButtons(w)[2].trigger("mouseenter");
    expect(panelText(w)).toBe("See what real users experience in your web and mobile apps.");
    expect(panelChips(w)).toEqual(["Sessions", "Errors", "Web vitals", "Session replays"]);
    await w.find('[data-test="onboarding-step-choose-other-synthetics"]').trigger("mouseenter");
    expect(panelText(w)).toBe("Run checks on a schedule from outside your network.");
    expect(panelChips(w)).toEqual(["Uptime", "Latency", "Certificates"]);
    expect(
      w
        .find(".row-start-1")
        .findAllComponents(OIcon)
        .some((i) => i.props("name") === "check"),
    ).toBe(false);
  });

  it("reserves room for every choice's sentence and chips", () => {
    const cells = mountChoose().findAll('[data-test="onboarding-preview"] .row-start-1');
    // Five choices, then the coding agent and synthetic checks; the invite has no preview.
    expect(cells).toHaveLength(1 + 7);
    expect(cells.slice(1).every((c) => c.findAll("li").length >= 3)).toBe(true);
  });

  it("moves between choices with the arrow keys, wrapping at the ends", async () => {
    const w = mountChoose(true, document.body);
    const items = choiceButtons(w);
    (items[0].element as HTMLElement).focus();
    await items[0].trigger("keydown", { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1].element);
    expect(panelTitle(w)).toBe("Backend applications");
    await items[1].trigger("keydown", { key: "ArrowUp" });
    await items[0].trigger("keydown", { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[4].element);
    expect(panelTitle(w)).toBe("LLM and AI apps");
    w.unmount();
  });

  it("opens the side panel on the prefilled choice", () => {
    sessionStorage.setItem(FIRST_SOURCE_PREFILL_KEY, JSON.stringify({ utm_content: "rum" }));
    expect(panelTitle(mountChoose())).toBe("Frontend and mobile apps");
  });

  it("hides synthetic checks when synthetics is off", () => {
    const selector = '[data-test="onboarding-step-choose-other-synthetics"]';
    store.state.zoConfig = { ...store.state.zoConfig, synthetics_enabled: true };
    expect(mountChoose().find(selector).exists()).toBe(true);
    store.state.zoConfig = { ...store.state.zoConfig, synthetics_enabled: false };
    expect(mountChoose().find(selector).exists()).toBe(false);
  });

  it("emits pick with the choice id", async () => {
    const w = mountChoose();
    await choiceButtons(w)[1].trigger("click");
    expect(w.emitted("pick")).toEqual([["backend"]]);
  });

  it("emits leave for synthetic checks", async () => {
    const w = mountChoose();
    await w.find('[data-test="onboarding-step-choose-other-synthetics"]').trigger("click");
    expect(w.emitted("leave")).toEqual([[{ id: "synthetics", route: "synthetics-add" }]]);
  });

  it("asks the view to open the invite dialog instead of leaving", async () => {
    const w = mountChoose();
    const invite = w.find('[data-test="onboarding-step-choose-other-invite"]');
    expect(invite.text()).not.toContain("same page");
    await invite.trigger("click");
    expect(w.emitted("invite")).toHaveLength(1);
    expect(w.emitted("leave")).toBeUndefined();
  });

  it("offers the invite only to a user who can invite", () => {
    const w = mountChoose(false);
    expect(w.find('[data-test="onboarding-step-choose-other-invite"]').exists()).toBe(false);
  });

  it("puts the coding agent first in the other ways, for every user", async () => {
    store.state.zoConfig = { ...store.state.zoConfig, synthetics_enabled: false };
    const w = mountChoose(false);
    const others = w.findAll('[data-test^="onboarding-step-choose-other-"]');
    expect(others.map((o) => o.attributes("data-test"))).toEqual([
      "onboarding-step-choose-other-agent",
    ]);
    expect(others[0].text()).toContain("Set up with your coding agent");
    expect(others[0].text()).toContain("Give Claude Code, Cursor or Codex one prompt.");
    await others[0].trigger("focus");
    expect(panelTitle(w)).toBe("Set up with your coding agent");
    await others[0].trigger("click");
    expect(w.emitted("agent")).toHaveLength(1);
    expect(w.emitted("leave")).toBeUndefined();
    expect(w.emitted("invite")).toBeUndefined();
    expect(
      mountChoose()
        .findAll('[data-test^="onboarding-step-choose-other-"]')[0]
        .attributes("data-test"),
    ).toBe("onboarding-step-choose-other-agent");
  });

  it("shows the terms notice with both links, and no consent box", () => {
    const w = mountChoose();
    const notice = w.find('[data-test="onboarding-step-choose-terms"]');
    expect(notice.text()).toBe(
      "By using OpenObserve, you agree to the Terms of Service and Privacy Policy.",
    );
    const terms = w.find('[data-test="onboarding-step-choose-terms-link"]');
    const privacy = w.find('[data-test="onboarding-step-choose-privacy-link"]');
    expect(terms.attributes("href")).toBe("https://openobserve.ai/legal/terms-of-service/");
    expect(privacy.attributes("href")).toBe("https://openobserve.ai/legal/privacy-policy/");
    expect(terms.attributes("target")).toBe("_blank");
    expect(w.find('input[type="checkbox"], [role="checkbox"]').exists()).toBe(false);
  });
});
