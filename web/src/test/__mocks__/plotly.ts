import { vi } from "vitest";

vi.mock("plotly.js", () => {
  return {
    default: {
      newPlot: vi.fn((ref) => {
        ref.on = vi.fn();
      }),
      addTraces: vi.fn(),
      restyle: vi.fn(),
      relayout: vi.fn(),
      redraw: vi.fn(),
    },
  };
});
