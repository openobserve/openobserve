import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";

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

import { useResponsiveDialog } from "./useResponsiveDialog";

describe("useResponsiveDialog", () => {
  beforeEach(() => {
    mockScreen.lt.sm = false;
    mockScreen.gt.xs = true;
    mockScreen.gt.sm = true;
    mockScreen.width = 1440;
  });

  describe("desktop", () => {
    it("returns empty dialogProps on desktop", () => {
      const { dialogProps } = useResponsiveDialog({ desktopWidth: 600 });
      expect(dialogProps.value).toEqual({});
    });

    it("returns cardStyle with width and max-width", () => {
      const { cardStyle } = useResponsiveDialog({ desktopWidth: 600 });
      expect(cardStyle.value).toBe("width: 600px; max-width: 95vw");
    });

    it("returns only max-width when no desktopWidth specified", () => {
      const { cardStyle } = useResponsiveDialog();
      expect(cardStyle.value).toBe("max-width: 95vw");
    });
  });

  describe("mobile - constrained mode (default)", () => {
    beforeEach(() => {
      mockScreen.lt.sm = true;
      mockScreen.gt.xs = false;
      mockScreen.gt.sm = false;
      mockScreen.width = 375;
    });

    it("returns empty dialogProps in constrained mode", () => {
      const { dialogProps } = useResponsiveDialog({ desktopWidth: 600 });
      expect(dialogProps.value).toEqual({});
    });

    it("cardStyle still includes max-width: 95vw", () => {
      const { cardStyle } = useResponsiveDialog({ desktopWidth: 600 });
      expect(cardStyle.value).toContain("max-width: 95vw");
    });
  });

  describe("mobile - maximized mode", () => {
    beforeEach(() => {
      mockScreen.lt.sm = true;
      mockScreen.gt.xs = false;
      mockScreen.gt.sm = false;
    });

    it("returns maximized dialogProps", () => {
      const { dialogProps } = useResponsiveDialog({
        mobileMode: "maximized",
      });
      expect(dialogProps.value).toEqual({ maximized: true });
    });
  });

  describe("mobile - bottom-sheet mode", () => {
    beforeEach(() => {
      mockScreen.lt.sm = true;
      mockScreen.gt.xs = false;
      mockScreen.gt.sm = false;
    });

    it("returns bottom position dialogProps", () => {
      const { dialogProps } = useResponsiveDialog({
        mobileMode: "bottom-sheet",
      });
      expect(dialogProps.value).toEqual({
        position: "bottom",
        fullWidth: true,
      });
    });
  });

  describe("mobile - slide-left mode", () => {
    beforeEach(() => {
      mockScreen.lt.sm = true;
      mockScreen.gt.xs = false;
      mockScreen.gt.sm = false;
    });

    it("returns left position with slide transitions", () => {
      const { dialogProps } = useResponsiveDialog({
        mobileMode: "slide-left",
      });
      expect(dialogProps.value).toEqual({
        position: "left",
        transitionShow: "slide-right",
        transitionHide: "slide-left",
      });
    });

    it("returns empty dialogProps on desktop even when slide-left requested", () => {
      mockScreen.lt.sm = false;
      mockScreen.gt.xs = true;
      mockScreen.gt.sm = true;
      const { dialogProps } = useResponsiveDialog({
        mobileMode: "slide-left",
      });
      expect(dialogProps.value).toEqual({});
    });
  });

  describe("safe-area-inset on mobile cardStyle", () => {
    beforeEach(() => {
      mockScreen.lt.sm = true;
      mockScreen.gt.xs = false;
      mockScreen.gt.sm = false;
    });

    it("adds safe-area-inset-bottom padding in bottom-sheet mode", () => {
      const { cardStyle } = useResponsiveDialog({
        mobileMode: "bottom-sheet",
      });
      expect(cardStyle.value).toContain(
        "padding-bottom: env(safe-area-inset-bottom)",
      );
    });

    it("adds safe-area-inset-bottom padding in maximized mode", () => {
      const { cardStyle } = useResponsiveDialog({ mobileMode: "maximized" });
      expect(cardStyle.value).toContain(
        "padding-bottom: env(safe-area-inset-bottom)",
      );
    });

    it("adds both bottom and left insets in slide-left mode", () => {
      const { cardStyle } = useResponsiveDialog({ mobileMode: "slide-left" });
      expect(cardStyle.value).toContain(
        "padding-bottom: env(safe-area-inset-bottom)",
      );
      expect(cardStyle.value).toContain(
        "padding-left: env(safe-area-inset-left)",
      );
    });

    it("does not add inset padding in constrained mode", () => {
      const { cardStyle } = useResponsiveDialog({ mobileMode: "constrained" });
      expect(cardStyle.value).not.toContain("safe-area-inset");
    });

    it("does not add inset padding on desktop regardless of mode", () => {
      mockScreen.lt.sm = false;
      mockScreen.gt.xs = true;
      mockScreen.gt.sm = true;
      const { cardStyle } = useResponsiveDialog({
        mobileMode: "bottom-sheet",
      });
      expect(cardStyle.value).not.toContain("safe-area-inset");
    });
  });

  describe("isMobile passthrough", () => {
    it("exposes isMobile from useScreen", () => {
      mockScreen.lt.sm = true;
      mockScreen.gt.xs = false;
      mockScreen.gt.sm = false;

      const { isMobile } = useResponsiveDialog();
      expect(isMobile.value).toBe(true);
    });
  });
});
