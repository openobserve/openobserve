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

// The server's refusal of a template binding, shown under the picker; null for other errors.
export function templateBindingError(err: any): string | null {
  if (err?.response?.status !== 400) return null;
  const message: string = err.response.data?.message ?? err.response.data?.error ?? "";
  if (!/^(validation error: )?template '[^']*' /.test(message)) return null;
  return message.replace(/^validation error: /, "");
}
