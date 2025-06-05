import { vi } from "vitest";

vi.mock("rudder-sdk-js", () => {
  return {
    ready: vi.fn(),
    load: vi.fn(),
    track: vi.fn(),
  };
});
