import { orgKey } from "@/composables/query/keys";
import type { CompareRequest, ListParams } from "./service_versions";
export const serviceVersionKeys = {
  all: (org: string) => orgKey(org, "serviceVersions"),
  reader: (org: string, user: string) => [...serviceVersionKeys.all(org), user] as const,
  list: (org: string, user: string, kind: string, params: ListParams) =>
    [...serviceVersionKeys.reader(org, user), kind, params] as const,
  compare: (org: string, user: string, body: CompareRequest) =>
    [...serviceVersionKeys.reader(org, user), "compare", body] as const,
};
