// Copyright 2026 OpenObserve Inc.
//
// pipelineDestinationTerraform.ts — renders a pipeline destination as an
// `openobserve_pipeline_destination` resource for the OpenObserve Terraform
// provider.
//
// Alert destinations and pipeline destinations are the SAME object on the
// server, told apart by one field: a destination carrying a template is for
// alerts, one without is for pipelines. The provider models them as two
// resources because that field decides what the object is for, and because
// templates, email recipients and SNS are meaningless on a pipeline. This
// exporter therefore refuses anything carrying a template rather than emitting a
// pipeline destination the server would treat as an alert destination.
//
// The import address is the one place this differs from every other resource
// here: a destination is addressed by NAME, `{org_id}/{name}`, not by a
// server-assigned id. Names are what the API path uses and what a pipeline's
// `destination_name` refers to, so there is no id to import by.

import type {
  ImportTarget,
  Node,
  TerraformExport,
  TerraformIdentityOptions,
  TerraformUnsupportedItem,
} from "@/utils/terraform/hcl";
import {
  INDENT,
  attr,
  boolWhen,
  document,
  importTarget,
  map,
  quote,
  resourceBlock,
  resourceLabel,
  str,
} from "@/utils/terraform/hcl";

export type PipelineDestinationTerraformOptions = TerraformIdentityOptions;

/** Whether this destination is an alert destination wearing the same shape. */
export function isAlertDestination(destination: Record<string, unknown>): boolean {
  const template = destination.template;
  if (typeof template === "string" && template !== "") return true;
  // Email and SNS destinations are alert-only too; they have no webhook URL for
  // a pipeline to forward to.
  const type = String(destination.type ?? "").toLowerCase();
  return type === "email" || type === "sns";
}

function destinationResource(destination: Record<string, unknown>, label: string): string {
  const body: Node[] = [
    ...attr("name", quote(String(destination.name ?? ""))),
    ...attr("url", str(destination.url)),
    // `post` is the provider default; the method is worth stating anyway, since
    // a destination that forwards with the wrong verb fails silently at runtime.
    ...attr("method", quote(String(destination.method ?? "post").toLowerCase())),
    ...attr("skip_tls_verify", boolWhen(destination.skip_tls_verify, true)),
    ...attr("headers", map(destination.headers, INDENT)),
    ...attr(
      "destination_type",
      str(destination.destination_type_name ?? destination.destination_type),
    ),
    ...attr("metadata", map(destination.metadata, INDENT)),
  ];

  return resourceBlock("openobserve_pipeline_destination", label, body);
}

/**
 * Converts destination payloads into `openobserve_pipeline_destination`
 * resources. A destination that is really an alert destination, or one with no
 * URL to forward to, is reported rather than rendered.
 */
export function pipelineDestinationsToTerraform(
  destinations: Record<string, unknown>[],
  options: PipelineDestinationTerraformOptions = {},
): TerraformExport {
  const used = new Set<string>();
  const unsupported: TerraformUnsupportedItem[] = [];
  const resources: string[] = [];
  const imports: ImportTarget[] = [];

  destinations.forEach((destination, index) => {
    if (!destination || typeof destination !== "object") return;
    const name = String(destination.name ?? "");

    if (!name || !destination.url || isAlertDestination(destination)) {
      unsupported.push({ name, reason: "incomplete" });
      return;
    }

    const label = resourceLabel(name, used, "destination");
    resources.push(destinationResource(destination, label));
    // Addressed by name — see the note at the top of this file.
    const key = options.ids?.[index] ?? name;
    imports.push(...importTarget("openobserve_pipeline_destination", label, options.orgId, key));
  });

  return {
    hcl: document(resources, imports, options.orgId ?? ""),
    unsupported,
    droppedFields: [],
  };
}
