/* Copyright 2026 OpenObserve Inc.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

// Shared edge factory for the flow canvases (Pipelines + Workflows). Produces a
// VueFlow edge with the arrowhead marker, curved custom edge type, and the
// standard stroke/animation. `sourceHandle` is optional (workflows may route
// from a specific handle; pipelines don't).
import { MarkerType } from "@vue-flow/core";

// Resting edge colour — the shared grey token. var() resolves for both the edge
// stroke and the SVG arrowhead marker fill, so we reference the token rather than
// hardcoding its value. Matches the node handles + the pipeline's hover-reset
// stroke (CustomNode.updateEdgeColors) so all edges look uniform.
const EDGE_COLOR = "var(--color-grey-500)";

export const makeEdge = (
  source: string,
  target: string,
  sourceHandle?: string,
) => ({
  id: `e${source}-${target}${sourceHandle ? `-${sourceHandle}` : ""}`,
  source,
  target,
  ...(sourceHandle ? { sourceHandle } : {}),
  markerEnd: { type: MarkerType.ArrowClosed, width: 20, height: 20, color: EDGE_COLOR },
  type: "custom",
  style: { strokeWidth: 2, stroke: EDGE_COLOR },
  animated: true,
});

export default makeEdge;
