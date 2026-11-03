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

import { orgKey } from "@/composables/query/keys";
import type { SlackManifestParams } from "@/types/slack";

/** `all` is the invalidation scope; `installation(id)` scopes one workspace. */
export const slackKeys = {
  all: (org: string) => orgKey(org, "slack"),
  installations: (org: string) => orgKey(org, "slack", "installations"),
  prerequisites: (org: string) => orgKey(org, "slack", "prerequisites"),
  manifest: (org: string, params: SlackManifestParams) =>
    orgKey(
      org,
      "slack",
      "manifest",
      params.mode,
      params.name ?? "",
      params.channel_history ?? true,
    ),
  installation: (org: string, id: string) => orgKey(org, "slack", "installation", id),
  linking: (org: string, id: string) => orgKey(org, "slack", "installation", id, "linking"),
  channels: (org: string, id: string, q: string) =>
    orgKey(org, "slack", "installation", id, "channels", q),
  channelDefaults: (org: string, id: string) =>
    orgKey(org, "slack", "installation", id, "channelDefaults"),
  oncallUnlinked: (org: string, id: string) =>
    orgKey(org, "slack", "installation", id, "oncallUnlinked"),
  helpContact: (org: string, id: string) => orgKey(org, "slack", "installation", id, "helpContact"),
  orgAccess: (org: string, id: string) => orgKey(org, "slack", "installation", id, "orgAccess"),
  linkLists: (org: string) => orgKey(org, "slack", "links", "list"),
  links: (org: string, installationId?: string) =>
    orgKey(org, "slack", "links", "list", installationId ?? "all"),
  linksMe: (org: string) => orgKey(org, "slack", "links", "me"),
};
