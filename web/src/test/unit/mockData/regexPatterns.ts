// Copyright 2025 OpenObserve Inc.
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

export const regexPatterns = {
  patterns: [
    {
      id: "pattern-1",
      name: "Email Pattern",
      pattern: "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$",
      description: "Matches email addresses",
      created_at: 1640995200, // 2022-01-01
      updated_at: 1640995200
    },
    {
      id: "pattern-2", 
      name: "IP Address Pattern",
      pattern: "^(?:[0-9]{1,3}\\.){3}[0-9]{1,3}$",
      description: "Matches IPv4 addresses",
      created_at: 1640995300,
      updated_at: 1640995300
    }
  ]
};

export const testResults = {
  results: ["test@example.com", "user@domain.org"]
};

export default regexPatterns;