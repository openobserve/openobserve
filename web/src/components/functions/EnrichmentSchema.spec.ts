vi.mock('@/utils/zincutils', () => ({
  formatSizeFromMB: vi.fn((size) => `${size} MB`),
  getImageURL: vi.fn(),
  timestampToTimezoneDate: vi.fn(),
  convertDateToTimestamp: vi.fn(),
  useLocalTimezone: vi.fn(() => "UTC"),

}));