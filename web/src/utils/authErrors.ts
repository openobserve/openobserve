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

export const UNAUTHORIZED_MESSAGE =
  "Unauthorized Access: You are not authorized to perform this operation, please contact your administrator.";

/**
 * Check whether an error message or error_type indicates an authorization failure.
 * Checks both fields independently — auth if either indicates it.
 */
export const isAuthError = (message?: string, errorType?: string): boolean => {
  if (errorType && /unauthorized|forbidden|permission_denied/i.test(errorType)) {
    return true;
  }
  if (message && /unauthorized|forbidden|not\s+authorized|permission\s*denied/i.test(message)) {
    return true;
  }
  return false;
};
