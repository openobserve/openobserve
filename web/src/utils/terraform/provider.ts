// Copyright 2026 OpenObserve Inc.
//
// provider.ts — where the OpenObserve Terraform provider is published, and at
// which version. Everything that names the provider reads it from here: the
// header an export writes into a `.tf` file, and the registry links in the UI.
// One namespace change moves all of them together.

const PROVIDER_NAMESPACE = "openobserve";
const PROVIDER_NAME = "openobserve";

/** The `source` an exported configuration pins. */
export const PROVIDER_SOURCE = `${PROVIDER_NAMESPACE}/${PROVIDER_NAME}`;

/**
 * The `version` constraint an exported configuration pins.
 *
 * Checked against what is actually published: the registry lists 1.0.0, 0.0.4
 * and 0.0.3, so `~> 1.0` resolves to 1.0.0 and `terraform init` succeeds. Raise
 * it only once a matching release is out, or every exported file will pin a
 * version nobody can fetch.
 * https://registry.terraform.io/v1/providers/openobserve/openobserve/versions
 */
export const PROVIDER_VERSION = "~> 1.0";

/** Both registries serve the same provider, so both links are derived from it. */
export const TERRAFORM_REGISTRY_URL = `https://registry.terraform.io/providers/${PROVIDER_SOURCE}/latest`;
export const OPENTOFU_REGISTRY_URL = `https://search.opentofu.org/provider/${PROVIDER_SOURCE}/latest`;
