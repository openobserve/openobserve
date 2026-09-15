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

const RESET_REQUIRED_CODE = "password_reset_required";
const RESET_REQUIRED_FOR_WRITES_CODE = "password_reset_required_for_writes";

interface RejectedResponse {
  response?: { status?: number; data?: { code?: unknown } };
}

const forbiddenCode = (error: unknown): unknown => {
  const response = (error as RejectedResponse | undefined)?.response;
  return response?.status === 403 ? response.data?.code : undefined;
};

/** Whether a rejected response is the middleware refusing everything until the password changes. */
export const isPasswordResetError = (error: unknown): boolean =>
  forbiddenCode(error) === RESET_REQUIRED_CODE;

/** Whether a rejected response is the middleware refusing only this write. */
export const isWriteRestrictedError = (error: unknown): boolean =>
  forbiddenCode(error) === RESET_REQUIRED_FOR_WRITES_CODE;
