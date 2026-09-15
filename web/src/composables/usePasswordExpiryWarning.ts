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

// The days-until-expiry the sign-in response carried, held for the life of the session. Written
// once by the login page, read by the banner MainLayout mounts. sessionStorage rather than a
// module ref so the number survives a reload without re-fetching — the count moves once a day, and
// the start of a session is the one moment it needs computing.

import { ref } from "vue";

const STORAGE_KEY = "password_rotation_warning";

const readStored = (): number | null => {
  const stored = Number(sessionStorage.getItem(STORAGE_KEY));
  return stored > 0 ? stored : null;
};

const daysRemaining = ref<number | null>(readStored());

export function usePasswordExpiryWarning() {
  /** Record what the sign-in response said; absent means there is nothing to warn about. */
  const remember = (days: unknown) => {
    const count = Number(days);
    if (!(count > 0)) return;
    sessionStorage.setItem(STORAGE_KEY, String(count));
    daysRemaining.value = count;
  };

  const dismiss = () => {
    sessionStorage.removeItem(STORAGE_KEY);
    daysRemaining.value = null;
  };

  return { daysRemaining, remember, dismiss };
}
