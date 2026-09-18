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

export interface ExtractedFrames {
  events: string[];
  rest: string;
}

function payloadOf(line: string): string | null {
  if (!line.trim().startsWith("data: ")) return null;
  // No brace means indexOf returns -1 and substring(-1) hands back the whole line, which then fails to parse.
  const jsonStr = line.substring(line.indexOf("{"));
  if (!jsonStr || !jsonStr.trim()) return null;
  return jsonStr;
}

export function extractFrames(buffer: string): ExtractedFrames {
  const lines = buffer.split("\n");
  const rest = lines.pop() || "";
  const events: string[] = [];
  for (const line of lines) {
    const payload = payloadOf(line);
    if (payload !== null) events.push(payload);
  }
  return { events, rest };
}

export function extractTailFrames(buffer: string): string[] {
  if (!buffer.trim()) return [];
  const events: string[] = [];
  for (const line of buffer.split("\n")) {
    const payload = payloadOf(line);
    if (payload !== null) events.push(payload);
  }
  return events;
}
