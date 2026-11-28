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

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import { raw, type TranslateFn } from "@/types/i18n";
import SecretErrorCard from "./SecretErrorCard.vue";
import {
  createErrorText,
  parseSecretError,
  secretErrorText,
  secretErrorUsage,
} from "./secretErrors";

const t = i18n.global.t as unknown as TranslateFn;

describe("secret errors", () => {
  it("parses the consumer error string", () => {
    expect(parseSecretError("secret_error:secret_deleted:PAGERDUTY_ROUTING_KEY")).toEqual({
      code: "secret_deleted",
      name: "PAGERDUTY_ROUTING_KEY",
    });
    expect(parseSecretError("http_4xx")).toBeNull();
  });

  it("has copy for a live-secret purge and a variable that feeds consumers", () => {
    const err = (code: string) => ({ response: { data: { code, message: code } } });
    expect(secretErrorText(t, err("secret_not_deleted"), "fb" as any)).not.toBe(
      "secret_not_deleted",
    );
    expect(secretErrorText(t, err("variable_feeds_secret_consumer"), "fb" as any)).not.toBe(
      "variable_feeds_secret_consumer",
    );
  });

  it("explains store_disabled without exposing the raw error code", () => {
    const error = { response: { data: { code: "store_disabled", message: "store_disabled" } } };
    expect(secretErrorText(t, error, raw("Could not save"))).toBe(
      "The secret store is not available on this cluster. Ask an org admin for help.",
    );
  });

  it("explains allowed_consumers_empty with a consumer selection action", () => {
    const error = {
      response: {
        status: 400,
        data: { code: "allowed_consumers_empty", message: "allowed_consumers_empty" },
      },
    };
    expect(secretErrorText(t, error, raw("Could not save"))).toBe(
      "Choose at least one consumer type that may use this secret.",
    );
  });

  it("says a refused create needs a create grant, whatever the 403 body", () => {
    const plain = { response: { status: 403, data: "Unauthorized Access" } };
    const store = {
      response: { status: 403, data: { code: "secret_access_required", message: "x" } },
    };
    for (const e of [plain, store]) {
      expect(createErrorText(t, e, "fb" as any)).toBe(
        "You can't create secrets or variables here. Ask an org admin for a create grant.",
      );
    }
    const taken = { response: { status: 409, data: { code: "secret_name_taken" } } };
    expect(createErrorText(t, taken, "fb" as any)).toBe(secretErrorText(t, taken, "fb" as any));
  });

  it("reads the usage list a 409 carries", () => {
    const usage = [{ path: [], field: "f", status: "bound", token_name: "" }];
    expect(secretErrorUsage({ response: { data: { code: "secret_in_use", usage } } })).toEqual(
      usage,
    );
    expect(secretErrorUsage({ response: { data: { code: "x" } } })).toEqual([]);
  });

  it("prefers our copy for a known code, then the server message", () => {
    const known = { response: { data: { code: "pin_override_reason_required", message: "x" } } };
    expect(secretErrorText(t, known, "fb" as any)).toBe("Allowing any host needs a reason.");
    const unknown = { response: { data: { code: "brand_new", message: "server says" } } };
    expect(secretErrorText(t, unknown, "fb" as any)).toBe("server says");
    expect(secretErrorText(t, {}, "fb" as any)).toBe("fb");
  });

  it("names the secret when a send was refused (L10)", () => {
    const w = mount(SecretErrorCard, {
      props: { error: "secret_error:secret_deleted:PAGERDUTY_ROUTING_KEY" },
      global: { plugins: [i18n] },
    });
    expect(w.text()).toContain("Not sent: secret PAGERDUTY_ROUTING_KEY: It was deleted.");
  });
});
