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

export function logsPageCount(
  communicationMethod: string,
  jobId: string,
  results:
    | { pagination?: readonly unknown[]; partitionDetail?: { paginations?: readonly unknown[] } }
    | null
    | undefined,
): number | undefined {
  return communicationMethod === "streaming" || jobId !== ""
    ? results?.pagination?.length
    : results?.partitionDetail?.paginations?.length;
}
