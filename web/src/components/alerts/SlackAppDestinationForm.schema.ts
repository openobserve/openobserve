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

import { z } from "zod";
import { isValidResourceName } from "@/utils/zincutils";
import {
  REFIRE_REUSE_MAX_MINUTES,
  SLACK_APP_DEFAULTS,
  type SlackAppDestination,
  type SlackAppFormValues,
} from "@/utils/slackAppDestination";

type Translate = (key: string, params?: Record<string, unknown>) => string;

/** Read at validation time: whether the picked channel needs either tick. */
export interface SlackAppTickChecks {
  needsShared: () => boolean;
  needsOncall: () => boolean;
}

export const DEFAULT_SLACK_TEMPLATE = "prebuilt_slack";

const validRefire = (value: number | string): boolean => {
  if (value === "" || value === null) return false;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= REFIRE_REUSE_MAX_MINUTES;
};

export const makeSlackAppDestinationSchema = (t: Translate, checks: SlackAppTickChecks) =>
  z
    .object({
      name: z.string(),
      installation_id: z.string(),
      channel_id: z.string(),
      channel_name: z.string(),
      mention: z.enum(["default", "here", "channel", "none", "subteam"]),
      refire_reuse_minutes: z.union([z.number(), z.string()]),
      buttons: z.boolean(),
      auto_investigate: z.boolean(),
      template: z.string(),
      shared_channel_confirmed: z.boolean(),
      oncall_room_confirmed: z.boolean(),
    })
    .superRefine((v, ctx) => {
      const issue = (path: keyof SlackAppFormValues, message: string) =>
        ctx.addIssue({ code: "custom", path: [path], message });
      if (!v.name.trim()) issue("name", t("common.nameRequired"));
      else if (!isValidResourceName(v.name)) issue("name", t("alerts.validation.nameInvalidChars"));
      if (!v.installation_id) issue("installation_id", t("slackApp.destination.workspaceRequired"));
      if (!v.channel_id) issue("channel_id", t("slackApp.channels.channelRequired"));
      if (!validRefire(v.refire_reuse_minutes)) {
        issue(
          "refire_reuse_minutes",
          t("slackApp.destination.refireRange", { max: REFIRE_REUSE_MAX_MINUTES }),
        );
      }
      if (checks.needsShared() && !v.shared_channel_confirmed) {
        issue("shared_channel_confirmed", t("slackApp.destination.sharedRequired"));
      }
      if (checks.needsOncall() && !v.oncall_room_confirmed) {
        issue("oncall_room_confirmed", t("slackApp.destination.oncallRequired"));
      }
    });

export function slackAppFormDefaults(
  destination: SlackAppDestination | null,
  installationId = "",
): SlackAppFormValues {
  if (!destination) {
    return {
      name: "",
      installation_id: installationId,
      channel_id: "",
      channel_name: "",
      mention: "default",
      refire_reuse_minutes: SLACK_APP_DEFAULTS.refire_reuse_minutes,
      buttons: SLACK_APP_DEFAULTS.buttons,
      auto_investigate: false,
      template: DEFAULT_SLACK_TEMPLATE,
      shared_channel_confirmed: false,
      oncall_room_confirmed: false,
    };
  }
  const mention = destination.mention ?? "default";
  return {
    name: destination.name,
    installation_id: destination.installation_id,
    channel_id: destination.channel_id,
    channel_name: destination.channel_name,
    mention: typeof mention === "string" ? mention : "subteam",
    refire_reuse_minutes:
      destination.refire_reuse_minutes ?? SLACK_APP_DEFAULTS.refire_reuse_minutes,
    buttons: destination.buttons ?? true,
    auto_investigate: destination.auto_investigate === "critical",
    template: destination.template ?? DEFAULT_SLACK_TEMPLATE,
    shared_channel_confirmed: !!destination.shared_channel_confirmed,
    oncall_room_confirmed: !!destination.oncall_room_confirmed,
  };
}
