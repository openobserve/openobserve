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

import { computed } from "vue";
import { useStore } from "vuex";
import { useQuery } from "@tanstack/vue-query";
import { orgUsersQuery } from "@/services/users.queries";
import { raw, useI18nTyped, type I18nText } from "@/types/i18n";

/** A person as a picker row: the name to read, the email to tell two namesakes apart. */
export type PersonOption = {
  label: I18nText;
  value: string;
  subLabel?: I18nText;
  subLabelInline?: boolean;
  searchText: string;
};

/** A person's display name from the org's cached user list, or their email until it loads or when they have none. */
export function useOrgUserNames() {
  const store = useStore();
  // Optional chaining: components using this render inside specs that mount no store.
  const orgId = computed<string>(() => store?.state?.selectedOrganization?.identifier ?? "");
  const users = useQuery(() =>
    Object.assign(orgUsersQuery(orgId.value), { enabled: !!orgId.value }),
  );

  function nameOf(email: string): string {
    const list: Array<{ email: string; first_name?: string; last_name?: string }> =
      users.data.value ?? [];
    const user = list.find((u) => u.email.toLowerCase() === email.toLowerCase());
    const name = [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim();
    return name || email;
  }

  const { t } = useI18nTyped();

  /** Name and email in one line, for a tooltip; just the email when there is no name. */
  function tooltipOf(email: string): I18nText {
    const name = nameOf(email);
    return name === email
      ? raw(email)
      : t("oncall.personNameWithEmail", { name: raw(name), email: raw(email) });
  }

  /** `inline` for multi-selects, whose stacked rows push the checkbox onto a line of its own. */
  function optionOf(email: string, inline = false): PersonOption {
    const name = nameOf(email);
    return {
      label: raw(name),
      value: email,
      subLabel: name === email ? undefined : raw(email),
      subLabelInline: inline,
      searchText: `${name} ${email}`.toLowerCase(),
    };
  }

  return { nameOf, tooltipOf, optionOf };
}
