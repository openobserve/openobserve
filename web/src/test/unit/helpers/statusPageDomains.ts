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

// Full C7 views of the three shapes a custom domain can have, for the specs that read them.
import type { DomainInstallation, StatusPageDomain } from "@/services/status_pages";

export const CREATED_AT = 1_700_000_000_000_000; // 2023-11-14 22:13 UTC

const EVIDENCE = {
  proof_checked_at: null,
  proof_failed_since: null,
  dns_checked_at: null,
  probe_checked_at: null,
  ca_validated_at: null,
  probe_mode: null,
};

// Custom domains off: neither record is set.
export function offView(overrides: Partial<StatusPageDomain> = {}): StatusPageDomain {
  return {
    id: "dom-1",
    domain: "status.brandname.com",
    verification_state: 0,
    verification_failure_reason: null,
    verified_at: null,
    last_checked_at: null,
    created_at: CREATED_AT,
    txt_name: null,
    verification_token: null,
    cname_target: null,
    app_host: null,
    is_holder: false,
    serving_state: "pending",
    reason: null,
    warning: null,
    warning_at: null,
    expires_at: 1_700_600_000_000_000, // 2023-11-21 20:53 UTC
    released_at: null,
    certificate_expires_at: null,
    next_action_at: null,
    state_computed_at: null,
    evidence: { ...EVIDENCE },
    can_check_again: false,
    acts: null,
    ...overrides,
  };
}

// Built-in TLS: the record is `<domain> CNAME <cname_target>`.
export function builtInView(overrides: Partial<StatusPageDomain> = {}): StatusPageDomain {
  return offView({
    cname_target: "k7f3q9x2m4p8w6tz.domains.example.com",
    app_host: "app.example.com",
    ...overrides,
  });
}

// Proxy mode: the record is `<txt_name> TXT <verification_token>`.
export function proxyView(overrides: Partial<StatusPageDomain> = {}): StatusPageDomain {
  return offView({
    txt_name: "_o2-verify.status.brandname.com",
    verification_token: "o2v_abc123",
    ...overrides,
  });
}

// The installation body always has every key; `enabled` and `tls` are never null.
export function installationBody(overrides: Partial<DomainInstallation> = {}): DomainInstallation {
  return {
    enabled: true,
    tls: "proxy",
    target: null,
    not_ready_reason: null,
    target_resolves: null,
    wildcard_resolves: null,
    target_certificate_expires_at: null,
    key_check: null,
    epoch: null,
    listeners: [],
    lease: null,
    last_validation_at: null,
    last_ca_error: null,
    visitor_addresses_visible: null,
    probe_mode: null,
    next_check_at: null,
    ...overrides,
  };
}

export function builtInInstallation(
  overrides: Partial<DomainInstallation> = {},
): DomainInstallation {
  return installationBody({
    tls: "built_in",
    target: "domains.example.com",
    not_ready_reason: null,
    target_resolves: true,
    wildcard_resolves: true,
    target_certificate_expires_at: 1_710_000_000_000_000,
    key_check: "ok",
    epoch: { configured: 1, stored: 1 },
    listeners: [
      {
        node: "router-0",
        address: "10.0.0.7:5443",
        last_seen_at: 1_700_000_000_000_000,
        certs_loaded: 3,
        last_sync_at: 1_700_000_100_000_000,
        private_peers_only: false,
      },
    ],
    lease: { owner: "node-a", expires_at: 1_700_000_200_000_000 },
    last_validation_at: 1_700_000_300_000_000,
    last_ca_error: { at: 1_700_000_400_000_000, message: "rate limited" },
    visitor_addresses_visible: true,
    probe_mode: "listener",
    next_check_at: 1_700_000_500_000_000,
    ...overrides,
  });
}
