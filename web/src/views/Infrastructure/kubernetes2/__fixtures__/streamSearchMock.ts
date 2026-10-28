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

// Adapts a unary `search({ query: { query } }) -> { data: { hits } }` mock to the _search_stream composable.
export function streamSearchApi(search: (args: any) => Promise<any>) {
  return {
    fetchQueryDataWithHttpStream: async (req: any, handlers: any) => {
      try {
        const res: any = await search({ query: { query: req.queryReq.query } });
        handlers.data(req, {
          type: "search_response_hits",
          content: { results: { hits: res?.data?.hits ?? [] } },
        });
        handlers.complete(req, {});
      } catch (e: any) {
        const status = e?.response?.status ?? e?.status ?? null;
        handlers.error(req, { content: { message: e?.message, status } });
      }
    },
    cancelStreamQueryBasedOnRequestId: () => {},
  };
}
