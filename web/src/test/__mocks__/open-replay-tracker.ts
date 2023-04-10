import { vi } from "vitest";

class Tracker {
  start() {}
  setUserID() {}
}

vi.mock("@openreplay/tracker", () => Tracker);
