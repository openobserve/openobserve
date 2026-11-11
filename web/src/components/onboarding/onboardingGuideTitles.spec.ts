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

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";

import i18n from "@/locales";
import useIngestionRoutes from "@/composables/shared/useIngestionRoutes";
import store from "@/test/unit/helpers/store";
import type { TranslateFn } from "@/types/i18n";

import { buildChoices, type OnboardingGuide } from "./onboardingChoices";
import OnboardingStepGuide from "./OnboardingStepGuide.vue";

// Every guide renders for real; only the first-event poll is replaced.
vi.mock("@/composables/firstEvent/useFirstEventWatch", async () => {
  const { ref } = await import("vue");
  return {
    useFirstEventWatch: () => ({
      state: ref("waiting"),
      result: ref(),
      diagnosis: ref(),
      startedAtMs: ref(Date.now()),
      scope: ref("new-data"),
      troubleshooting: ref(false),
      sinceUs: ref(),
      start: vi.fn(),
      stop: vi.fn(),
      probeNow: vi.fn(),
      troubleshoot: vi.fn(),
    }),
  };
});
vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));
// The credential state each case sets stays as set.
vi.mock("@/composables/useOrgCredential", () => ({
  useOrgCredential: () => ({
    ready: { value: true },
    pickedName: { value: "" },
    pickToken: vi.fn(),
  }),
}));

const empty = { render: () => null };
const choices = buildChoices(i18n.global.t as unknown as TranslateFn);

// One case per page: language tiles share one setup card.
const cases = new Map<string, Parameters<typeof mountGuide>[0]>();
for (const choice of choices) {
  for (const row of choice.rows) {
    const guides: OnboardingGuide[] = row.route
      ? [{ id: row.id, name: row.name, route: row.route, cardSlug: row.cardSlug }]
      : (row.groups ?? []).flatMap((g) => g.guides);
    for (const guide of guides) {
      const key = guide.cardSlug ? `card ${guide.cardSlug}` : guide.route;
      if (!cases.has(key)) cases.set(key, { choice, row, guide });
    }
  }
}

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: "/", component: empty, children: useIngestionRoutes() },
    { path: "/onboarding/:path*", name: "onboarding", component: empty },
    // Pages link here; it lives in another route file.
    { path: "/tokens", name: "ingestionTokens", component: empty },
  ],
});

async function mountGuide(at: {
  choice: (typeof choices)[number];
  row: (typeof choices)[number]["rows"][number];
  guide: OnboardingGuide;
}) {
  const w = mount(OnboardingStepGuide, { props: at, global: { plugins: [store, router] } });
  await flushPromises();
  await vi.dynamicImportSettled();
  await flushPromises();
  return w;
}

// With a passcode, and with one the user may not read: AI pages then show a banner, not their card.
describe.each([
  ["with the org passcode", false],
  ["with a forbidden passcode", true],
])("every onboarding guide, %s,", (_, forbidden) => {
  beforeAll(async () => {
    // The RUM page shows its setup card, and its title, once the org has a RUM token.
    store.state.organizationData.rumToken = { rum_token: "rum-key" };
    store.state.organizationData.organizationPasscode = forbidden ? "" : "pass";
    store.state.organizationData.organizationPasscodeForbidden = forbidden;
    await router.push("/onboarding");
  });
  afterAll(() => {
    store.state.organizationData.rumToken = { rum_token: "" };
    store.state.organizationData.organizationPasscode = "";
    store.state.organizationData.organizationPasscodeForbidden = false;
  });

  it.each([...cases.keys()])("%s renders exactly one title", async (key) => {
    const w = await mountGuide(cases.get(key)!);
    const guideColumn = w.find('[data-test="onboarding-step-guide"] > section');
    const titles = guideColumn
      .findAll('h1, [data-test$="-page-title"]')
      .map((t) => t.text().trim());
    expect(titles).toHaveLength(1);
    w.unmount();
  });
});
