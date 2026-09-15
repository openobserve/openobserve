// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePasswordReset } from "./usePasswordReset";

const confirmMock = vi.fn();
vi.mock("@/composables/useConfirmDialog", () => ({
  useConfirmDialog: () => ({ confirm: confirmMock }),
}));

const { open, close, isOpen, reason, dismissible, promptRestricted } = usePasswordReset();

describe("usePasswordReset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    close();
  });

  it("opens once however many rejections arrive", () => {
    open("policy_tightened");
    open("rotation_expired");
    open("rotation_expired");

    expect(isOpen.value).toBe(true);
    // The first reason wins: six parallel requests must not rewrite the banner under the user.
    expect(usePasswordReset().reason.value).toBe("policy_tightened");
  });

  it("falls back to policy_tightened for an unrecognised reason", () => {
    open("something-else");

    expect(usePasswordReset().reason.value).toBe("policy_tightened");
  });

  describe("promptRestricted", () => {
    it("asks through the standard confirm dialog", async () => {
      confirmMock.mockResolvedValue(false);

      await promptRestricted("rotation_expired");

      expect(confirmMock).toHaveBeenCalledTimes(1);
      expect(confirmMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Password update required",
          message: expect.stringContaining("changes are blocked"),
          confirmLabel: "Update password",
          cancelLabel: "Not now",
          persistent: false,
        }),
      );
    });

    it("opens the reset dialog, with a way out, when the user confirms", async () => {
      confirmMock.mockResolvedValue(true);

      await promptRestricted("rotation_expired");

      expect(isOpen.value).toBe(true);
      expect(dismissible.value).toBe(true);
      expect(reason.value).toBe("rotation_expired");
    });

    it("does not open the reset dialog when the user cancels", async () => {
      confirmMock.mockResolvedValue(false);

      await promptRestricted("policy_tightened");

      expect(confirmMock).toHaveBeenCalledTimes(1);
      expect(isOpen.value).toBe(false);
    });

    it("prompts once while a prompt is pending, however many writes are refused", async () => {
      let resolveConfirm: (value: boolean) => void = () => {};
      confirmMock.mockImplementation(
        () => new Promise<boolean>((resolve) => (resolveConfirm = resolve)),
      );

      const first = promptRestricted("rotation_expired");
      const second = promptRestricted("policy_tightened");
      expect(confirmMock).toHaveBeenCalledTimes(1);
      expect(isOpen.value).toBe(false);

      resolveConfirm(true);
      await Promise.all([first, second]);
      expect(isOpen.value).toBe(true);
      expect(reason.value).toBe("rotation_expired");
    });

    it("prompts again once the previous prompt has settled", async () => {
      confirmMock.mockResolvedValue(false);

      await promptRestricted("rotation_expired");
      await promptRestricted("rotation_expired");

      expect(confirmMock).toHaveBeenCalledTimes(2);
    });
  });
});
