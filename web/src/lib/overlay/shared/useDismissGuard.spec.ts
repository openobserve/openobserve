import { describe, it, expect } from "vitest";
import { outsideInteraction, useDismissGuard } from "./useDismissGuard";

const outside = (type: string, target: EventTarget | null) =>
  new CustomEvent(type, { detail: { originalEvent: { target } } });

describe("outsideInteraction", () => {
  it("dismisses on a press outside the overlay", () => {
    expect(outsideInteraction(outside("dismissableLayer.pointerDownOutside", document.body))).toBe(
      "dismiss",
    );
  });

  it("takes focus back, never dismisses, when code moves focus outside", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    expect(outsideInteraction(outside("dismissableLayer.focusOutside", trigger))).toBe("refocus");
    trigger.remove();
  });

  it("ignores a press inside a popup the overlay opened", () => {
    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-reka-popper-content-wrapper", "");
    const option = document.createElement("div");
    wrapper.appendChild(option);
    document.body.appendChild(wrapper);
    expect(outsideInteraction(outside("dismissableLayer.pointerDownOutside", option))).toBe(
      "ignore",
    );
    wrapper.remove();
  });
});

describe("useDismissGuard", () => {
  const setup = (dirty: boolean) => {
    let closed = 0;
    const guard = useDismissGuard({
      dirty: () => dirty,
      locked: () => false,
      close: () => closed++,
    });
    return { guard, closed: () => closed };
  };

  it("closes at once when nothing changed", () => {
    const { guard, closed } = setup(false);
    guard.requestDismiss();
    expect(guard.asking.value).toBe(false);
    expect(closed()).toBe(1);
  });

  it("asks before closing when something changed", () => {
    const { guard, closed } = setup(true);
    guard.requestDismiss();
    expect(guard.asking.value).toBe(true);
    expect(closed()).toBe(0);
    guard.discard();
    expect(closed()).toBe(1);
  });
});
