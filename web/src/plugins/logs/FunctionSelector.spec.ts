vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn((path: string) => `http://localhost:8080/${path}`),
  useLocalWrapContent: vi.fn(() => false),
  useLocalTimezone: vi.fn(() => "UTC"),

}));