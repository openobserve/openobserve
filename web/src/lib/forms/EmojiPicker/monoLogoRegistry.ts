// Copyright 2026 OpenObserve Inc.

// Explicit build-time imports only: unplugin-icons ships exactly what is listed, like glyphRegistry.ts.

import type { Component } from "vue";
import type { GlyphName } from "./glyphRegistry";

import ApacheKafka from "~icons/mdi/apache-kafka";
import Kubernetes from "~icons/mdi/kubernetes";
import Docker from "~icons/mdi/docker";
import Terraform from "~icons/mdi/terraform";
import Ansible from "~icons/mdi/ansible";
import Linux from "~icons/mdi/linux";
import Aws from "~icons/mdi/aws";
import MicrosoftAzure from "~icons/mdi/microsoft-azure";
import GoogleCloud from "~icons/mdi/google-cloud";
import LanguageJava from "~icons/mdi/language-java";
import LanguagePython from "~icons/mdi/language-python";
import LanguageRust from "~icons/mdi/language-rust";
import LanguageGo from "~icons/mdi/language-go";
import NodeJs from "~icons/mdi/nodejs";
import DotNet from "~icons/mdi/dot-net";
import LanguageTypescript from "~icons/mdi/language-typescript";
import ReactLogo from "~icons/mdi/react";
import VueJs from "~icons/mdi/vuejs";
import GraphQl from "~icons/mdi/graphql";
import GitHub from "~icons/mdi/github";
import GitLab from "~icons/mdi/gitlab";
import Jira from "~icons/mdi/jira";
import Slack from "~icons/mdi/slack";
import Apple from "~icons/mdi/apple";
import MicrosoftWindows from "~icons/mdi/microsoft-windows";
import MicrosoftOffice from "~icons/mdi/microsoft-office";
import Google from "~icons/mdi/google";

/** Prefix marking a stored icon value as a single-colour brand logo. */
export const MONO_LOGO_PREFIX = "mono:";

export const MONO_LOGO_REGISTRY = {
  kafka: ApacheKafka,
  kubernetes: Kubernetes,
  docker: Docker,
  terraform: Terraform,
  ansible: Ansible,
  linux: Linux,
  aws: Aws,
  azure: MicrosoftAzure,
  gcp: GoogleCloud,
  java: LanguageJava,
  python: LanguagePython,
  rust: LanguageRust,
  go: LanguageGo,
  nodejs: NodeJs,
  dotnet: DotNet,
  typescript: LanguageTypescript,
  react: ReactLogo,
  vue: VueJs,
  graphql: GraphQl,
  github: GitHub,
  gitlab: GitLab,
  jira: Jira,
  slack: Slack,
  macos: Apple,
  windows: MicrosoftWindows,
  office365: MicrosoftOffice,
  googleworkspace: Google,
} as const satisfies Partial<Record<GlyphName, Component>>;

export type MonoLogoName = keyof typeof MONO_LOGO_REGISTRY;

/** Build the stored token for a mono logo, e.g. "mono:docker". */
export function monoLogoToken(name: MonoLogoName): string {
  return `${MONO_LOGO_PREFIX}${name}`;
}

/** True when the token names a mono logo (known or not). */
export function isMonoLogoToken(token: string | null | undefined): boolean {
  return !!token?.startsWith(MONO_LOGO_PREFIX);
}

/** The logo component for a mono token, or null when it isn't a known one. */
export function resolveMonoLogo(token: string | null | undefined): Component | null {
  if (!isMonoLogoToken(token)) return null;
  const name = token!.slice(MONO_LOGO_PREFIX.length);
  return Object.hasOwn(MONO_LOGO_REGISTRY, name) ? MONO_LOGO_REGISTRY[name as MonoLogoName] : null;
}
