vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn((path) => `mocked-${path}`),
  useLocalTimezone: vi.fn(() => "UTC"),

}));