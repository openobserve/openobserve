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
 * Tracks the oldest release that has EVERY resource type an export can emit:
 * 1.2.0 added `openobserve_composite_alert`, and 1.3.0 added
 * `openobserve_pipeline` and `openobserve_pipeline_destination`. A looser
 * constraint resolves to the same latest release on a fresh `terraform init`,
 * but a configuration with a lock file pinned lower would satisfy it and then
 * fail on an unknown resource type — an error that points at the exported file
 * rather than at the version that produced it.
 *
 * Raise this only once a matching release is published, or every exported file
 * will pin a version nobody can fetch. 1.3.0 is published and verified.
 * https://registry.terraform.io/v1/providers/openobserve/openobserve/versions
 */
export const PROVIDER_VERSION = "~> 1.3";

/** Both registries serve the same provider, so both links are derived from it. */
export const TERRAFORM_REGISTRY_URL = `https://registry.terraform.io/providers/${PROVIDER_SOURCE}/latest`;
export const OPENTOFU_REGISTRY_URL = `https://search.opentofu.org/provider/${PROVIDER_SOURCE}/latest`;
