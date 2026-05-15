import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Quasar's useQuasar before importing the composable
const mockScreen = {
  lt: { sm: false, md: false },
  gt: { xs: true, sm: true },
  width: 1440,
};

const mockPlatform = {
  is: { mobile: false },
};

vi.mock("quasar", () => ({
  useQuasar: () => ({
    screen: mockScreen,
    platform: mockPlatform,
  }),
}));

import { useScreen } from "./useScreen";

describe("useScreen", () => {
  beforeEach(() => {
    // Reset to desktop defaults
    mockScreen.lt.sm = false;
    mockScreen.lt.md = false;
    mockScreen.gt.xs = true;
    mockScreen.gt.sm = true;
    mockScreen.width = 1440;
    mockPlatform.is.mobile = false;
  });

  it("should report desktop for wide screens", () => {
    const { isMobile, isTablet, isDesktop, screenSize } = useScreen();

    expect(isMobile.value).toBe(false);
    expect(isTablet.value).toBe(false);
    expect(isDesktop.value).toBe(true);
    expect(screenSize.value).toBe("desktop");
  });

  it("should report mobile for narrow screens", () => {
    mockScreen.lt.sm = true;
    mockScreen.gt.xs = false;
    mockScreen.gt.sm = false;
    mockScreen.width = 375;

    const { isMobile, isTablet, isDesktop, screenSize } = useScreen();

    expect(isMobile.value).toBe(true);
    expect(isTablet.value).toBe(false);
    expect(isDesktop.value).toBe(false);
    expect(screenSize.value).toBe("mobile");
  });

  it("should report tablet for mid-range screens", () => {
    mockScreen.lt.sm = false;
    mockScreen.lt.md = true;
    mockScreen.gt.xs = true;
    mockScreen.gt.sm = false;
    mockScreen.width = 768;

    const { isMobile, isTablet, isDesktop, screenSize } = useScreen();

    expect(isMobile.value).toBe(false);
    expect(isTablet.value).toBe(true);
    expect(isDesktop.value).toBe(false);
    expect(screenSize.value).toBe("tablet");
  });

  it("should detect touch capability from platform", () => {
    mockPlatform.is.mobile = true;

    const { isTouch } = useScreen();

    expect(isTouch.value).toBe(true);
  });

  it("should expose screen width", () => {
    mockScreen.width = 1024;

    const { screenWidth } = useScreen();

    expect(screenWidth.value).toBe(1024);
  });
});
