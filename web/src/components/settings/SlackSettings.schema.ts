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
import type { SlackAnswerMode, SlackMode } from "@/types/slack";
import { firstPublicDomain } from "@/utils/slackSettings";

type Translate = (key: string, params?: Record<string, unknown>) => string;

const trimmed = () => z.string().trim();

export const HELP_CONTACT_MAX_LENGTH = 256;

export const makeHelpContactSchema = () =>
  z.object({ help_contact: trimmed().max(HELP_CONTACT_MAX_LENGTH) });
export type HelpContactForm = z.infer<ReturnType<typeof makeHelpContactSchema>>;

// One form for Step 2: the configuration-token path, or Set up manually (which alone asks for app secrets).
export const makeCreateAppSchema = (t: Translate, isManual: () => boolean) =>
  z
    .object({
      mode: z.enum(["socket", "http"]),
      channel_history: z.boolean(),
      config_refresh_token: trimmed(),
      client_id: trimmed(),
      client_secret: trimmed(),
      signing_secret: trimmed(),
      app_token: trimmed(),
    })
    .superRefine((v, ctx) => {
      const require = (path: keyof typeof v, key: string) => {
        if (!String(v[path]).length)
          ctx.addIssue({ code: "custom", path: [path], message: t(key) });
      };
      if (!isManual()) {
        require("config_refresh_token", "slackApp.wizard.create.tokenRequired");
        return;
      }
      require("client_id", "slackApp.wizard.create.clientIdRequired");
      require("client_secret", "slackApp.wizard.create.clientSecretRequired");
      // HTTP mode verifies Slack's requests with the signing secret.
      if (v.mode === "http")
        require("signing_secret", "slackApp.wizard.create.signingSecretRequired");
    });
export type CreateAppForm = {
  mode: SlackMode;
  channel_history: boolean;
  config_refresh_token: string;
  client_id: string;
  client_secret: string;
  signing_secret: string;
  app_token: string;
};
export const createAppDefaults = (): CreateAppForm => ({
  mode: "socket",
  channel_history: true,
  config_refresh_token: "",
  client_id: "",
  client_secret: "",
  signing_secret: "",
  app_token: "",
});

export const makeAppTokenSchema = (t: Translate) =>
  z.object({ app_token: trimmed().min(1, t("slackApp.wizard.install.appTokenRequired")) });
export type AppTokenForm = z.infer<ReturnType<typeof makeAppTokenSchema>>;

export const makeCredentialsSchema = (t: Translate, firstField: string) =>
  z
    .object({
      app_token: trimmed(),
      signing_secret: trimmed(),
      client_id: trimmed(),
      client_secret: trimmed(),
      config_refresh_token: trimmed(),
    })
    .refine((v) => Object.values(v).some((field) => field.length > 0), {
      path: [firstField],
      message: t("slackApp.credentials.atLeastOne"),
    });
export type CredentialsForm = z.infer<ReturnType<typeof makeCredentialsSchema>>;
export const credentialsDefaults = (): CredentialsForm => ({
  app_token: "",
  signing_secret: "",
  client_id: "",
  client_secret: "",
  config_refresh_token: "",
});

export const makeLinkingSchema = (t: Translate) =>
  z.object({ enabled: z.boolean(), domains: z.array(trimmed()) }).superRefine((v, ctx) => {
    const publicDomain = firstPublicDomain(v.domains);
    if (publicDomain) {
      ctx.addIssue({
        code: "custom",
        path: ["domains"],
        message: t("slackApp.linking.publicDomain", { domain: publicDomain }),
      });
    }
  });
export type LinkingForm = z.infer<ReturnType<typeof makeLinkingSchema>>;

export const makeChannelDefaultSchema = (t: Translate) =>
  z.object({
    channel_id: trimmed().min(1, t("slackApp.channels.channelRequired")),
    answer_mode: z.enum(["thread", "private"]),
  });
export type ChannelDefaultForm = {
  channel_id: string;
  answer_mode: SlackAnswerMode;
};
