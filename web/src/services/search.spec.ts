vi.mock("@/utils/zincutils", () => ({
  generateTraceContext: vi.fn(() => ({
    traceparent: "00-test-trace-parent-01",
  })),
  getWebSocketUrl: vi.fn(() => "ws://localhost:3000"),
  useLocalTimezone: vi.fn(() => "UTC"),

}));