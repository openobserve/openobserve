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

const RAW_HTTP =
  /status code \d{3}|^network error$|^timeout of \d+ms exceeded$|^request aborted$|^(bad gateway|internal server error|service unavailable|gateway timeout)$/i;

/** Transport text from axios or a proxy, which an error state replaces with its own sentence (K6). */
export function isRawHttpText(message: string): boolean {
  return RAW_HTTP.test(message.trim());
}
