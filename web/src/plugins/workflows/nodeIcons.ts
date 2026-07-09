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

// Workflow node icons — reuse the pipeline node images so the two canvases look
// consistent (same glyphs on the palette and on the canvas nodes). Single source
// for both WorkflowNode (canvas) and the shared NodePalette (via WorkflowEditor).
//   trigger  → input stream image · condition/function → their pipeline images
//   destination → external/remote destination image
import { getImageURL } from "@/utils/zincutils";

export const WORKFLOW_NODE_IMAGE: Record<string, string> = {
  workflow_trigger: getImageURL("images/pipeline/input_stream.png"),
  condition: getImageURL("images/pipeline/transform_condition.png"),
  function: getImageURL("images/pipeline/transform_function.png"),
  destination: getImageURL("images/pipeline/output_remote.png"),
};

// Raw image URL for a node_type, or undefined to fall back to its OIcon glyph.
export const workflowNodeImage = (nodeType?: string): string | undefined =>
  nodeType ? WORKFLOW_NODE_IMAGE[nodeType] : undefined;
