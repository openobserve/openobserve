// @vitest-environment jsdom
// Tests for useOnlineEvalsData — the shared data loader for the Online Evals
// page. The key behavior is that one list failing must not blank the other
// three (Promise.allSettled, not Promise.all).

import { vi } from "vitest";

const {
  mockProvidersList,
  mockScoreConfigsList,
  mockScoreConfigsVersions,
  mockScorersList,
  mockJobsList,
  mockShowError,
} = vi.hoisted(() => ({
  mockProvidersList: vi.fn(),
  mockScoreConfigsList: vi.fn(),
  mockScoreConfigsVersions: vi.fn(),
  mockScorersList: vi.fn(),
  mockJobsList: vi.fn(),
  mockShowError: vi.fn(),
}));

vi.mock("@/services/online-evals.service", () => ({
  default: {
    providers: { list: mockProvidersList },
    scoreConfigs: { list: mockScoreConfigsList, versions: mockScoreConfigsVersions },
    scorers: { list: mockScorersList },
    jobs: { list: mockJobsList },
  },
}));

vi.mock("../utils/evalFormat", () => ({
  showError: mockShowError,
}));

vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

import { describe, it, expect, beforeEach } from "vitest";
import { useOnlineEvalsData } from "./useOnlineEvalsData";

beforeEach(() => {
  mockProvidersList.mockReset();
  mockScoreConfigsList.mockReset();
  mockScoreConfigsVersions.mockReset();
  mockScorersList.mockReset();
  mockJobsList.mockReset();
  mockShowError.mockReset();
});

describe("useOnlineEvalsData — loadAll", () => {
  it("returns early when orgId is empty", async () => {
    const { loadAll, isLoading } = useOnlineEvalsData();
    await loadAll("");
    expect(mockProvidersList).not.toHaveBeenCalled();
    expect(isLoading.value).toBe(false);
  });

  it("populates all four lists when every request fulfills", async () => {
    mockProvidersList.mockResolvedValue([{ id: "p1", name: "OpenAI" }]);
    mockScoreConfigsList.mockResolvedValue([{ id: "sc1", name: "Faithfulness" }]);
    mockScorersList.mockResolvedValue([{ id: "s1", name: "Judge" }]);
    mockJobsList.mockResolvedValue([{ id: "j1", name: "Job One" }]);

    const data = useOnlineEvalsData();
    await data.loadAll("org-1");

    expect(data.providers.value).toEqual([{ id: "p1", name: "OpenAI" }]);
    expect(data.scoreConfigs.value).toEqual([{ id: "sc1", name: "Faithfulness" }]);
    expect(data.scorers.value).toEqual([{ id: "s1", name: "Judge" }]);
    expect(data.jobs.value).toEqual([{ id: "j1", name: "Job One" }]);
    expect(data.isLoading.value).toBe(false);
    expect(mockShowError).not.toHaveBeenCalled();
  });

  it("seeds scoreConfigVersions with a single-version map per config", async () => {
    mockProvidersList.mockResolvedValue([]);
    mockScoreConfigsList.mockResolvedValue([
      { id: "sc1", name: "A" },
      { id: "sc2", name: "B" },
    ]);
    mockScorersList.mockResolvedValue([]);
    mockJobsList.mockResolvedValue([]);

    const data = useOnlineEvalsData();
    await data.loadAll("org-1");

    expect(data.scoreConfigVersions.value).toEqual({
      sc1: [{ id: "sc1", name: "A" }],
      sc2: [{ id: "sc2", name: "B" }],
    });
  });

  it("populates the three successful lists when ONE list rejects (Promise.allSettled)", async () => {
    mockProvidersList.mockRejectedValue(new Error("providers boom"));
    mockScoreConfigsList.mockResolvedValue([{ id: "sc1", name: "A" }]);
    mockScorersList.mockResolvedValue([{ id: "s1", name: "Judge" }]);
    mockJobsList.mockResolvedValue([{ id: "j1", name: "Job One" }]);

    const data = useOnlineEvalsData();
    await data.loadAll("org-1");

    expect(data.providers.value).toEqual([]);
    expect(data.scoreConfigs.value).toEqual([{ id: "sc1", name: "A" }]);
    expect(data.scorers.value).toEqual([{ id: "s1", name: "Judge" }]);
    expect(data.jobs.value).toEqual([{ id: "j1", name: "Job One" }]);

    expect(mockShowError).toHaveBeenCalledTimes(1);
    expect(mockShowError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "providers boom" }),
      "onlineEvals.loadError",
    );
  });

  it("reports each rejected request independently when multiple fail", async () => {
    mockProvidersList.mockRejectedValue(new Error("providers boom"));
    mockScoreConfigsList.mockResolvedValue([]);
    mockScorersList.mockRejectedValue(new Error("scorers boom"));
    mockJobsList.mockResolvedValue([{ id: "j1" }]);

    const data = useOnlineEvalsData();
    await data.loadAll("org-1");

    expect(data.jobs.value).toEqual([{ id: "j1" }]);
    expect(mockShowError).toHaveBeenCalledTimes(2);
  });

  it("toggles isLoading true during the request and false at the end", async () => {
    let resolveProviders: (v: any) => void = () => {};
    mockProvidersList.mockImplementation(() => new Promise((res) => (resolveProviders = res)));
    mockScoreConfigsList.mockResolvedValue([]);
    mockScorersList.mockResolvedValue([]);
    mockJobsList.mockResolvedValue([]);

    const data = useOnlineEvalsData();
    const inFlight = data.loadAll("org-1");
    expect(data.isLoading.value).toBe(true);

    resolveProviders([]);
    await inFlight;
    expect(data.isLoading.value).toBe(false);
  });
});

describe("useOnlineEvalsData — loadProviders", () => {
  it("returns early when orgId is empty", async () => {
    const { loadProviders } = useOnlineEvalsData();
    await loadProviders("");
    expect(mockProvidersList).not.toHaveBeenCalled();
  });

  it("updates providers on success", async () => {
    mockProvidersList.mockResolvedValue([{ id: "p1", name: "OpenAI" }]);
    const data = useOnlineEvalsData();
    await data.loadProviders("org-1");
    expect(data.providers.value).toEqual([{ id: "p1", name: "OpenAI" }]);
    expect(mockShowError).not.toHaveBeenCalled();
  });

  it("surfaces an error on rejection", async () => {
    mockProvidersList.mockRejectedValue(new Error("nope"));
    const data = useOnlineEvalsData();
    await data.loadProviders("org-1");
    expect(mockShowError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "nope" }),
      "onlineEvals.loadError",
    );
  });
});

describe("useOnlineEvalsData — ensureScoreConfigVersions", () => {
  it("returns early when orgId is empty", async () => {
    const { ensureScoreConfigVersions } = useOnlineEvalsData();
    await ensureScoreConfigVersions("", "sc1");
    expect(mockScoreConfigsVersions).not.toHaveBeenCalled();
  });

  it("returns early when versions are already cached (length > 1)", async () => {
    mockProvidersList.mockResolvedValue([]);
    mockScoreConfigsList.mockResolvedValue([{ id: "sc1" }]);
    mockScorersList.mockResolvedValue([]);
    mockJobsList.mockResolvedValue([]);

    const data = useOnlineEvalsData();
    await data.loadAll("org-1");
    // Manually pre-populate with > 1 versions
    data.scoreConfigVersions.value = {
      sc1: [{ id: "sc1", version: 2 } as any, { id: "sc1", version: 1 } as any],
    };

    await data.ensureScoreConfigVersions("org-1", "sc1");
    expect(mockScoreConfigsVersions).not.toHaveBeenCalled();
  });

  it("fetches versions and stores them under the entityId", async () => {
    mockScoreConfigsVersions.mockResolvedValue([
      { id: "sc1", version: 3 },
      { id: "sc1", version: 2 },
      { id: "sc1", version: 1 },
    ]);

    const data = useOnlineEvalsData();
    await data.ensureScoreConfigVersions("org-1", "sc1");

    expect(mockScoreConfigsVersions).toHaveBeenCalledWith("org-1", "sc1");
    expect(data.scoreConfigVersions.value.sc1).toHaveLength(3);
  });

  it("does not overwrite when the response is empty", async () => {
    mockScoreConfigsVersions.mockResolvedValue([]);

    const data = useOnlineEvalsData();
    data.scoreConfigVersions.value = { sc1: [{ id: "sc1" } as any] };
    await data.ensureScoreConfigVersions("org-1", "sc1");

    expect(data.scoreConfigVersions.value.sc1).toEqual([{ id: "sc1" }]);
  });

  it("surfaces an error on rejection", async () => {
    mockScoreConfigsVersions.mockRejectedValue(new Error("versions boom"));
    const data = useOnlineEvalsData();
    await data.ensureScoreConfigVersions("org-1", "sc1");
    expect(mockShowError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "versions boom" }),
      "onlineEvals.scorer.versionsLoadError",
    );
  });
});
