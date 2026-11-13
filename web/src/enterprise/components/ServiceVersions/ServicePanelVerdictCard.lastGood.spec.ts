// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { ref, toValue } from "vue";
import Card from "./ServicePanelVerdictCard.vue";
const mocks = vi.hoisted(() => ({ lastGoodImage: "" }));
// The real useLastGood runs here, so every query answers by its key kind.
vi.mock("@tanstack/vue-query", () => ({
  queryOptions: (options: unknown) => options,
  useQuery: (options: unknown) => {
    const key = (toValue(options) as { queryKey: unknown[] }).queryKey;
    const data = key.includes("services")
      ? {
          services: [
            {
              service: "cart",
              where_key: "env:prod",
              last_good_version: "2.4.0",
              last_good_image: mocks.lastGoodImage,
            },
          ],
        }
      : key.includes("versions")
        ? { versions: [] }
        : {
            stored_verdict: { verdict_key: "v", version: "2.4.0", verdict: "regressed" },
            env: "prod",
            baseline_rule: "previous",
            arms: {
              a: { version: "2.4.0", image: "f167103" },
              b: { version: "2.4.0", image: "1f08369" },
            },
          };
    return {
      data: ref(data),
      isPending: ref(false),
      isError: ref(false),
      error: ref(null),
      refetch: vi.fn(),
    };
  },
}));
vi.mock("@/services/service_versions", () => ({ default: { openIncident: vi.fn() } }));
vi.mock("vue-router", () => ({
  useRouter: () => ({ currentRoute: ref({ query: {} }), resolve: () => ({ href: "/" }) }),
}));
vi.mock("@/enterprise/composables/useVersionCompareDrawer", async (original) => ({
  ...(await original<object>()),
  useVersionCompareDrawer: () => ({ open: vi.fn() }),
}));
vi.mock("@/types/i18n", async (original) => ({
  ...(await original<object>()),
  useI18nTyped: () => ({ t: (key: string) => key }),
}));
function baseline(lastGoodImage: string) {
  mocks.lastGoodImage = lastGoodImage;
  const wrapper = mount(Card, {
    props: {
      org: "org",
      user: "reader",
      service: "cart",
      where: "env:prod",
      version: "2.4.0",
      identity: { image: "f167103" },
    },
    global: {
      stubs: {
        OButton: true,
        OSkeleton: true,
        VersionVerdictBanner: true,
        VersionSummaryTiles: true,
        ServiceEnvChip: true,
        ODimensionChip: true,
        OTag: true,
      },
    },
  });
  return wrapper.emitted("baseline")?.at(-1)?.[0];
}
describe("the panel baseline with the real last good read", () => {
  it("names the baseline last good when it is the last good build of the compared version text", () => {
    expect(baseline("1f08369")).toEqual({
      version: "2.4.0",
      image: "1f08369",
      source: "last_good",
    });
  });
  it("calls the baseline automatic when the last good build is the compared build itself", () => {
    expect(baseline("f167103")).toEqual({
      version: "2.4.0",
      image: "1f08369",
      source: "automatic",
    });
  });
});
