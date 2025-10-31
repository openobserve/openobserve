vi.mock('@/utils/zincutils', () => ({
  getEndPoint: vi.fn((url) => ({
    url: url || 'http://localhost:5080',
    host: 'localhost',
    port: '5080',
    protocol: 'http',
    tls: false,
  })),
  getImageURL: vi.fn(() => 'http://localhost:5080/web/src/assets/images/logo.png'),
  getIngestionURL: vi.fn(() => 'http://localhost:5080'),
  useLocalTimezone: vi.fn(() => "UTC"),

}));