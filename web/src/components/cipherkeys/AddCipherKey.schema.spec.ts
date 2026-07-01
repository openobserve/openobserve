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

import { describe, it, expect } from "vitest";
import {
  addCipherKeySchema,
  addCipherKeyDefaults,
  type AddCipherKeyForm,
} from "./AddCipherKey.schema";

// Deep clone the defaults and apply a mutator so each case starts from a known
// shape. The schema rules (incl. the conditional requireds in superRefine) are
// exactly the ones the old per-field `:rules` + child `validate()` enforced — the
// Quasar BEFORE baseline — so these tests double as the dropped-validation guard.
const build = (mutate: (v: AddCipherKeyForm) => void): AddCipherKeyForm => {
  const v = JSON.parse(JSON.stringify(addCipherKeyDefaults())) as AddCipherKeyForm;
  mutate(v);
  return v;
};

// A fully valid OpenObserve (local) key.
const validLocal = () =>
  build((v) => {
    v.name = "my-cipher-key";
    v.key.store.type = "local";
    v.key.store.local = "super-secret-value";
  });

// A fully valid Akeyless key (access_key auth + static_secret store).
const validAkeyless = () =>
  build((v) => {
    v.name = "my-akeyless-key";
    v.key.store.type = "akeyless";
    v.key.store.akeyless.base_url = "https://api.akeyless.io";
    v.key.store.akeyless.access_id = "p-abc123";
    v.key.store.akeyless.auth.type = "access_key";
    v.key.store.akeyless.auth.access_key = "the-access-key";
    v.key.store.akeyless.store.type = "static_secret";
    v.key.store.akeyless.store.static_secret = "my-secret-name";
  });

const messageFor = (value: AddCipherKeyForm, path: string): string | undefined => {
  const result = addCipherKeySchema.safeParse(value);
  if (result.success) return undefined;
  return result.error.issues.find((i) => i.path.join(".") === path)?.message;
};

const isValid = (value: AddCipherKeyForm) =>
  addCipherKeySchema.safeParse(value).success;

describe("addCipherKeySchema", () => {
  describe("baselines", () => {
    it("accepts a valid OpenObserve (local) key", () => {
      expect(isValid(validLocal())).toBe(true);
    });

    it("accepts a valid Akeyless key", () => {
      expect(isValid(validAkeyless())).toBe(true);
    });
  });

  describe("name", () => {
    it("is required", () => {
      const v = build((x) => {
        x.name = "";
        x.key.store.local = "secret";
      });
      expect(messageFor(v, "name")).toBe("Name is required");
    });

    it("rejects > 50 characters", () => {
      const v = validLocal();
      v.name = "a".repeat(51);
      expect(messageFor(v, "name")).toBe("Name must be 50 characters or less.");
    });

    it("rejects characters outside [a-zA-Z0-9_-]", () => {
      const v = validLocal();
      v.name = "has space";
      // regex fires before the resource-name refine.
      expect(messageFor(v, "name")).toBe(
        "Only alphanumeric characters, underscores, and hyphens are allowed",
      );
    });

    it("accepts underscores and hyphens", () => {
      const v = validLocal();
      v.name = "my_cipher-key_123";
      expect(isValid(v)).toBe(true);
    });
  });

  describe("key.store.type", () => {
    it("is required", () => {
      const v = validLocal();
      v.key.store.type = "";
      expect(messageFor(v, "key.store.type")).toBe("Type is required");
    });
  });

  describe("OpenObserve (local) secret", () => {
    it("is required when store.type === local", () => {
      const v = build((x) => {
        x.name = "k";
        x.key.store.type = "local";
        x.key.store.local = "";
      });
      expect(messageFor(v, "key.store.local")).toBe("Secret is required");
    });

    it("is NOT required when store.type !== local", () => {
      const v = validAkeyless();
      v.key.store.local = "";
      expect(isValid(v)).toBe(true);
    });
  });

  describe("Akeyless base_url", () => {
    it("is required", () => {
      const v = validAkeyless();
      v.key.store.akeyless.base_url = "";
      expect(messageFor(v, "key.store.akeyless.base_url")).toBe(
        "Base URL is required",
      );
    });

    it("must be a valid http(s) URL", () => {
      const v = validAkeyless();
      v.key.store.akeyless.base_url = "not-a-url";
      expect(messageFor(v, "key.store.akeyless.base_url")).toBe(
        "Please provide correct URL.",
      );
    });

    it("rejects HTML tags", () => {
      const v = validAkeyless();
      // A parseable URL that still contains an HTML tag.
      v.key.store.akeyless.base_url = "https://x.io/<script>";
      expect(messageFor(v, "key.store.akeyless.base_url")).toBe(
        "HTML tags are not allowed",
      );
    });
  });

  describe("Akeyless access_id", () => {
    it("is required", () => {
      const v = validAkeyless();
      v.key.store.akeyless.access_id = "";
      expect(messageFor(v, "key.store.akeyless.access_id")).toBe(
        "Access ID is required",
      );
    });

    it("must be alphanumeric/hyphen", () => {
      const v = validAkeyless();
      v.key.store.akeyless.access_id = "bad@id";
      expect(messageFor(v, "key.store.akeyless.access_id")).toBe(
        "Access ID should be alphanumeric",
      );
    });
  });

  describe("Akeyless auth", () => {
    it("auth.type is required", () => {
      const v = validAkeyless();
      v.key.store.akeyless.auth.type = "";
      expect(messageFor(v, "key.store.akeyless.auth.type")).toBe(
        "Authentication type is required",
      );
    });

    it("access_key is required when auth.type === access_key", () => {
      const v = validAkeyless();
      v.key.store.akeyless.auth.type = "access_key";
      v.key.store.akeyless.auth.access_key = "";
      expect(messageFor(v, "key.store.akeyless.auth.access_key")).toBe(
        "Access Key is required",
      );
    });

    it("ldap username + password are required when auth.type === ldap", () => {
      const v = validAkeyless();
      v.key.store.akeyless.auth.type = "ldap";
      v.key.store.akeyless.auth.access_key = "";
      v.key.store.akeyless.auth.ldap.username = "";
      v.key.store.akeyless.auth.ldap.password = "";
      expect(messageFor(v, "key.store.akeyless.auth.ldap.username")).toBe(
        "LDAP Username is required",
      );
      expect(messageFor(v, "key.store.akeyless.auth.ldap.password")).toBe(
        "LDAP Password is required",
      );
    });

    it("ldap username must match the allowed character set", () => {
      const v = validAkeyless();
      v.key.store.akeyless.auth.type = "ldap";
      v.key.store.akeyless.auth.access_key = "";
      v.key.store.akeyless.auth.ldap.username = "bad user!";
      v.key.store.akeyless.auth.ldap.password = "pw";
      expect(messageFor(v, "key.store.akeyless.auth.ldap.username")).toBe(
        "Username can only contain alphanumeric characters, dots, underscores, and hyphens",
      );
    });

    it("does NOT require access_key when auth.type === ldap", () => {
      const v = validAkeyless();
      v.key.store.akeyless.auth.type = "ldap";
      v.key.store.akeyless.auth.access_key = "";
      v.key.store.akeyless.auth.ldap.username = "svc_user";
      v.key.store.akeyless.auth.ldap.password = "pw";
      expect(isValid(v)).toBe(true);
    });
  });

  describe("Akeyless secret store", () => {
    it("store.type is required", () => {
      const v = validAkeyless();
      v.key.store.akeyless.store.type = "";
      expect(messageFor(v, "key.store.akeyless.store.type")).toBe(
        "Secret type is required",
      );
    });

    it("static_secret is required when store.type === static_secret", () => {
      const v = validAkeyless();
      v.key.store.akeyless.store.type = "static_secret";
      v.key.store.akeyless.store.static_secret = "";
      expect(messageFor(v, "key.store.akeyless.store.static_secret")).toBe(
        "Static Secret Name is required",
      );
    });

    it("dfc.name + dfc.encrypted_data are required when store.type === dfc", () => {
      const v = validAkeyless();
      v.key.store.akeyless.store.type = "dfc";
      v.key.store.akeyless.store.static_secret = "";
      v.key.store.akeyless.store.dfc.name = "";
      v.key.store.akeyless.store.dfc.encrypted_data = "";
      expect(messageFor(v, "key.store.akeyless.store.dfc.name")).toBe(
        "DFC Name is required",
      );
      expect(messageFor(v, "key.store.akeyless.store.dfc.encrypted_data")).toBe(
        "DFC Encrypted Data is required",
      );
    });

    it("dfc.iv is NEVER required", () => {
      const v = validAkeyless();
      v.key.store.akeyless.store.type = "dfc";
      v.key.store.akeyless.store.static_secret = "";
      v.key.store.akeyless.store.dfc.name = "dfc-key";
      v.key.store.akeyless.store.dfc.encrypted_data = "ZW5jcnlwdGVk";
      v.key.store.akeyless.store.dfc.iv = "";
      expect(isValid(v)).toBe(true);
    });
  });

  describe("encryption mechanism", () => {
    it("mechanism.type is required", () => {
      const v = validLocal();
      v.key.mechanism.type = "";
      expect(messageFor(v, "key.mechanism.type")).toBe(
        "Provider type is required",
      );
    });

    it("simple_algorithm is required when mechanism.type === simple", () => {
      const v = validLocal();
      v.key.mechanism.type = "simple";
      v.key.mechanism.simple_algorithm = "";
      expect(messageFor(v, "key.mechanism.simple_algorithm")).toBe(
        "Algorithm is required",
      );
    });

    it("simple_algorithm is NOT required for a non-simple mechanism", () => {
      const v = validLocal();
      v.key.mechanism.type = "tink_keyset";
      v.key.mechanism.simple_algorithm = "";
      expect(isValid(v)).toBe(true);
    });
  });

  describe("akeyless rules are inert for a local key", () => {
    it("ignores empty akeyless fields when store.type === local", () => {
      const v = validLocal();
      v.key.store.akeyless.base_url = "";
      v.key.store.akeyless.access_id = "";
      v.key.store.akeyless.auth.type = "";
      v.key.store.akeyless.store.type = "";
      expect(isValid(v)).toBe(true);
    });
  });

  describe("addCipherKeyDefaults", () => {
    it("produces the create-mode default shape (blank, local store)", () => {
      const d = addCipherKeyDefaults();
      expect(d.name).toBe("");
      expect(d.key.store.type).toBe("local");
      expect(d.key.mechanism.type).toBe("simple");
      expect(d.key.mechanism.simple_algorithm).toBe("aes-256-siv");
    });
  });
});
