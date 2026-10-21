// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach, vi } from "vitest";
import { isUnnamedIconOnly, warnIfUnnamedIconOnly } from "./iconOnlyName";

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
    expect(isUnnamedIconOnly(el('<button><span class="sr-only">Save</span></button>'))).toBe(false);
  });

  it("accepts a named image or a named child, but not an empty alt", () => {
    expect(isUnnamedIconOnly(el('<button><img alt="Logo" /></button>'))).toBe(false);
    expect(isUnnamedIconOnly(el('<button><span aria-label="Save"></span></button>'))).toBe(false);
    expect(isUnnamedIconOnly(el('<button><img alt="" /></button>'))).toBe(true);
  });
});

describe("warnIfUnnamedIconOnly", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("warns in development for an icon-only button and not for a named one", () => {
    vi.stubEnv("MODE", "development");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnIfUnnamedIconOnly(el('<button><svg aria-hidden="true"></svg></button>'));
    expect(warn).toHaveBeenCalledTimes(1);
    warnIfUnnamedIconOnly(el('<button aria-label="Save"></button>'));
    warnIfUnnamedIconOnly(null);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("stays quiet under test", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnIfUnnamedIconOnly(el("<button></button>"));
    expect(warn).not.toHaveBeenCalled();
  });
});
