// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import { isUnnamedIconOnly } from "./iconOnlyName";

const el = (html: string) => {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host.firstElementChild as Element;
};

describe("isUnnamedIconOnly", () => {
  it("flags a button holding only an icon", () => {
    expect(isUnnamedIconOnly(el('<button><svg aria-hidden="true"></svg></button>'))).toBe(true);
  });

  it("accepts visible text, aria-label and aria-labelledby", () => {
    expect(isUnnamedIconOnly(el("<button>Save</button>"))).toBe(false);
    expect(isUnnamedIconOnly(el('<button aria-label="Save"></button>'))).toBe(false);
    expect(isUnnamedIconOnly(el('<button aria-labelledby="x"></button>'))).toBe(false);
  });
});
