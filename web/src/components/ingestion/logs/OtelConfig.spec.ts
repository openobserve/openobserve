vi.mock("@/utils/zincutils", () => ({
  b64EncodeStandard: vi.fn((str: string) => btoa(str)),
  getEndPoint: vi.fn((url: string) => ({
    url: "http://localhost:5080",
    host: "localhost",
    port: "5080",
    protocol: "http",
    tls: "Off",
  })),
  getIngestionURL: vi.fn(() => "http://localhost:5080"),
  useLocalTimezone: vi.fn(() => "UTC"),

}));