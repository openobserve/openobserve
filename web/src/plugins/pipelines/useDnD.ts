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

import { getUUID } from "@/utils/zincutils";
import { useVueFlow } from "@vue-flow/core";
import { watch, reactive } from "vue";
import { detectCycle } from "@/composables/flow/detectCycle";
import { makeEdge } from "@/composables/flow/makeEdge";
import { toast } from "@/lib/feedback/Toast/useToast";

const dialogObj = {
  show: false,
  name: "",
  title: "",
  message: "",
  data: null,
};

const defaultPipelineObj = {
  name: "",
  description: "",
  source: {
    source_type: "realtime",
  },
  nodes: <any>[],
  edges: <any>[],
  org: "",
};

const defaultObject = {
  dirtyFlag: false,
  isEditPipeline: false,
  isEditNode: false,
  edgesChange: false,
  draggedNode: <any>null,
  isDragOver: false,
  isDragging: false,
  hasInputNode: false,
  currentSelectedNodeID: "",
  currentSelectedNodeData: <any>{
    stream_type: "logs",
    stream_name: "",
    dynamic_stream_name: "",
    data: {},
    type: "",
  },
  dialog: dialogObj,
  nodeTypes: [] as Array<{
    label: string;
    icon: string;
    isSectionHeader: boolean;
    subtype?: string;
    io_type?: string;
    tooltip?: string;
  }>,
  // Node rail open/closed. Lives here rather than in PipelineEditor because the
  // toggle sits in Vue Flow's control stack (PipelineFlow) while the rail it
  // opens is rendered by the editor — shared state is the seam between them.
  // Starts CLOSED so the canvas gets the full width on open.
  showNodePalette: false,
  currentSelectedPipeline: defaultPipelineObj,
  pipelineWithoutChange: defaultPipelineObj,
  functions: {},
  // Edge to create when the staged node's config is saved (hover-`+` add-after).
  pendingEdge: <any>null,
  // Step picker (searchable dialog), in one of two modes:
  //   "next"   — the node's source handle was clicked; `source` is that node id
  //              and picking a type calls addNodeAfter.
  //   "source" — the empty-canvas start node was clicked; there is no source
  //              node yet, so `position` carries where to drop the first one
  //              and picking a type calls addSourceNode.
  stepPicker: {
    show: false,
    source: "",
    mode: "next" as "next" | "source",
    // Flow coords for the new node (source mode only).
    position: null as { x: number; y: number } | null,
    // Viewport coords of the click, so the picker opens at the node.
    anchor: null as { x: number; y: number } | null,
  },
  pipelineNameError: false,
  pipelineNameErrorMessage: "",
  previousNodeOptions: <any>[],
  userSelectedNode: <any>{},
  userClickedNode: <any>{},
  // Realtime streams already used by other pipelines. Populated once when the
  // editor mounts (PipelineEditor): first with the in-flight request promise,
  // then with its resolved array. The Stream node drawer `await`s whichever it
  // finds, so a node drag never issues its own pipelines/streams request.
  // `null` = the editor hasn't started the fetch yet (true fallback only).
  usedStreams: <any>null,
};

const pipelineObj = reactive(Object.assign({}, defaultObject));

export { pipelineObj };
export default function useDragAndDrop() {
  const { screenToFlowCoordinate, onNodesInitialized, updateNode } = useVueFlow();

  watch(
    () => pipelineObj.isDragging,
    (dragging) => {
      document.body.style.userSelect = dragging ? "none" : "";
    },
  );

  function hasInputNodeFn() {
    pipelineObj.hasInputNode = pipelineObj.currentSelectedPipeline.nodes.some(
      (node: any) => node.io_type === "input",
    );
  }

  function onDragStart(event: any, node: any) {
    if (event.dataTransfer) {
      event.dataTransfer.setData("application/vueflow", node.io_type);
      event.dataTransfer.effectAllowed = "move";
    }

    pipelineObj.draggedNode = node;
    pipelineObj.isDragging = true;
    pipelineObj.currentSelectedNodeData = null;

    document.addEventListener("drop", onDragEnd);
  }

  /**
   * Handles the drag over event.
   *
   * @param {DragEvent} event
   */
  function onDragOver(event: any) {
    event.preventDefault();

    if (pipelineObj.draggedNode?.io_type) {
      pipelineObj.isDragOver = true;

      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
    }
  }

  function onDragLeave() {
    pipelineObj.isDragOver = false;
  }

  function onDragEnd() {
    pipelineObj.isDragging = false;
    pipelineObj.isDragOver = false;
    document.removeEventListener("drop", onDragEnd);
  }

  /**
   * Handles the drop event.
   *
   * @param {DragEvent} event
   */
  function onDrop(event: any, offSet: any = { x: 0, y: 0 }) {
    if (pipelineObj.hasInputNode && pipelineObj.draggedNode.io_type == "input") {
      toast({
        message: "Only 1 source node is allowed",
        variant: "warning",
      });
      return;
    }

    const position = screenToFlowCoordinate({
      x: event.clientX + offSet.x,
      y: event.clientY + offSet.y,
    });

    const nodeId = getUUID();

    const newNode = {
      id: nodeId,
      type: pipelineObj.draggedNode.io_type || "default",
      io_type: pipelineObj.draggedNode.io_type || "default",
      position,
      data: { label: nodeId, node_type: pipelineObj.draggedNode.subtype },
    };

    /**
     * Align node position after drop, so it's centered to the mouse
     *
     * We can hook into events even in a callback, and we can remove the event listener after it's been called.
     */
    const { off } = onNodesInitialized(() => {
      updateNode(nodeId, (node) => ({
        position: {
          x: node.position.x - node.dimensions.width / 2,
          y: node.position.y - node.dimensions.height / 2,
        },
      }));

      off();
    });

    pipelineObj.currentSelectedNodeData = newNode;
    pipelineObj.dialog.name = newNode.data.node_type;
    pipelineObj.dialog.show = true;
    pipelineObj.isEditNode = false;
  }

  // VueFlow @node-change handler — node state is driven by v-model, so this is
  // an intentional no-op (kept because the template binds to it).
  function onNodeChange() {}

  function onNodesChange() {
    hasInputNodeFn();
  }

  function onEdgesChange(changes: any) {
    if (pipelineObj.isEditPipeline == true) {
      pipelineObj.dirtyFlag = true;
    }
    if (changes.length > 0) {
      pipelineObj.edgesChange = true;
    }
  }

  function onConnect(connection: any) {
    if (
      (connection.sourceHandle === "input" && connection.targetHandle === "input") ||
      (connection.sourceHandle === "output" && connection.targetHandle === "output")
    ) {
      toast({
        message: "Same type of edges / nodes cannot be connected",
        variant: "warning",
      });
      return;
    }
    const isConnectionAlreadyAvailable = pipelineObj.currentSelectedPipeline.edges.find(
      (previousEdge: any) => previousEdge.targetNode.id === connection.target,
    );
    if (isConnectionAlreadyAvailable) {
      toast({
        message: "Only one Incoming Edge to the node is allowed",
        variant: "warning",
      });
      return;
    }

    const isCycle = detectCycle(pipelineObj.currentSelectedPipeline.edges, connection);
    if (isCycle) {
      toast({
        message: "Adding this edge will create a cycle in the pipeline",
        variant: "warning",
      });
      return;
    }
    // Add new connection (edge) to edges array (shared edge factory)
    const newEdge = makeEdge(connection.source, connection.target);

    pipelineObj.currentSelectedPipeline.edges = [
      ...pipelineObj.currentSelectedPipeline.edges,
      newEdge,
    ]; // Update edges state
  }

  // detectCycle is shared with the workflow canvas (composables/flow). It
  // normalizes edge endpoints, so it accepts both plain source/target and
  // VueFlow's runtime-enriched sourceNode/targetNode.

  function validateConnection({ source, target }: any) {
    // Example validation rules
    const sourceNode = pipelineObj.currentSelectedPipeline.nodes.find(
      (node: any) => node.id === source,
    );
    const targetNode = pipelineObj.currentSelectedPipeline.nodes.find(
      (node: any) => node.id === target,
    );

    // Input-only node (cannot be the source of a connection)
    if (sourceNode.type === "input") {
      return false;
    }

    // Output-only node (cannot be the target of a connection)
    if (targetNode.type === "output") {
      return false;
    }

    return true; // Allow connection for 'both' nodes
  }

  function addNode(newNode: any) {
    // (Legacy userClickedNode/userSelectedNode auto-edge wiring removed — it
    // fired with an empty {} source and created bogus edges. Programmatic
    // "add step after" now wires a single pendingEdge below.)

    if (pipelineObj.isEditPipeline == true) {
      pipelineObj.dirtyFlag = true;
    }
    let currentSelectedNode = pipelineObj.currentSelectedNodeData;
    if (pipelineObj.isEditNode == true && currentSelectedNode.id != "") {
      if (currentSelectedNode) {
        currentSelectedNode.data = { ...currentSelectedNode.data, ...newNode };

        //find the index from pipelineObj.currentSelectedPipeline.nodes based on id
        const index = pipelineObj.currentSelectedPipeline.nodes.findIndex(
          (node: any) => node.id === currentSelectedNode.id,
        );

        pipelineObj.currentSelectedPipeline.nodes[index] = currentSelectedNode;
      }
    } else {
      if (currentSelectedNode) {
        currentSelectedNode.data = { ...currentSelectedNode.data, ...newNode };
        pipelineObj.currentSelectedPipeline.nodes = [
          ...pipelineObj.currentSelectedPipeline.nodes,
          currentSelectedNode,
        ];
        // Hover-`+` "add step after": wire source -> this new node.
        if (pipelineObj.pendingEdge?.source && currentSelectedNode.id) {
          const edge = makeEdge(pipelineObj.pendingEdge.source, currentSelectedNode.id);
          if (detectCycle(pipelineObj.currentSelectedPipeline.edges, edge)) {
            toast({
              variant: "warning",
              message: "Adding this edge will create a cycle in the pipeline",
            });
          } else {
            pipelineObj.currentSelectedPipeline.edges = [
              ...pipelineObj.currentSelectedPipeline.edges,
              edge,
            ];
          }
        }
      }
    }

    pipelineObj.isEditNode = false;
    pipelineObj.pendingEdge = null;
    //here we will be adding a default output node when it is a realtime pipeline and user drags teh input node
    if (
      pipelineObj.currentSelectedNodeData.type == "input" &&
      pipelineObj.currentSelectedNodeData.data.node_type == "stream" &&
      pipelineObj.currentSelectedPipeline.nodes.length === 1
    ) {
      const position = {
        x: pipelineObj.currentSelectedNodeData.position.x,
        y: pipelineObj.currentSelectedNodeData.position.y + 200,
      };

      const nodeId = getUUID();

      const outputNode = {
        id: nodeId,
        type: "output",
        io_type: "output",
        position,
        data: { ...pipelineObj.currentSelectedNodeData.data, label: nodeId },
      };
      pipelineObj.currentSelectedPipeline.nodes.push(outputNode);
      const newEdge = makeEdge(pipelineObj.currentSelectedNodeData.id, outputNode.id);
      pipelineObj.currentSelectedPipeline.edges = [
        ...pipelineObj.currentSelectedPipeline.edges,
        newEdge,
      ];
    }
    if (
      Object.prototype.hasOwnProperty.call(newNode, "meta") &&
      Object.prototype.hasOwnProperty.call(newNode.meta, "append_data")
    ) {
      pipelineObj.currentSelectedNodeData.meta = newNode.meta;
      delete newNode.meta;
      delete pipelineObj.currentSelectedNodeData.data.meta;
    }
  }

  // Clicking a node's source handle opens the step picker anchored to it.
  function openStepPicker(sourceId: string, event?: MouseEvent) {
    pipelineObj.stepPicker = {
      show: true,
      source: sourceId,
      mode: "next",
      position: null,
      anchor: event ? { x: event.clientX, y: event.clientY } : null,
    };
  }

  // The empty-canvas start node opens the SAME picker, restricted to sources.
  // The click point becomes the new node's position, so the node lands where
  // the placeholder the user clicked was sitting.
  function openSourcePicker(event: MouseEvent) {
    pipelineObj.stepPicker = {
      show: true,
      source: "",
      mode: "source",
      position: screenToFlowCoordinate({ x: event.clientX, y: event.clientY }),
      anchor: { x: event.clientX, y: event.clientY },
    };
  }

  function closeStepPicker() {
    pipelineObj.stepPicker = {
      show: false,
      source: "",
      mode: "next",
      position: null,
      anchor: null,
    };
  }

  // Start node picked: stage the pipeline's first (source) node and open its
  // config modal. Mirrors onDrop — no edge, since nothing precedes it — and is
  // committed on Save / discarded on Cancel exactly like a dropped node.
  function addSourceNode(
    item: { subtype: string; io_type: string },
    position: { x: number; y: number } | null,
  ) {
    const nodeId = getUUID();
    const newNode = {
      id: nodeId,
      type: item.io_type || "input",
      io_type: item.io_type || "input",
      position: position ?? { x: 0, y: 0 },
      data: { label: nodeId, node_type: item.subtype },
    };

    // Same re-centering as onDrop: the position above is the click point, so
    // shift by half the rendered size once dimensions are known.
    const { off } = onNodesInitialized(() => {
      updateNode(nodeId, (node) => ({
        position: {
          x: node.position.x - node.dimensions.width / 2,
          y: node.position.y - node.dimensions.height / 2,
        },
      }));
      off();
    });

    pipelineObj.currentSelectedNodeData = newNode;
    pipelineObj.dialog.name = item.subtype;
    pipelineObj.dialog.show = true;
    pipelineObj.isEditNode = false;
  }

  // Hover-`+` "add step after": stage a new node below `sourceId` and open its
  // config modal. The node + the source->node edge are committed on Save
  // (addNode reads pendingEdge); discarded on Cancel (resetDialog clears it).
  function addNodeAfter(sourceId: string, item: { subtype: string; io_type: string }) {
    const src = pipelineObj.currentSelectedPipeline.nodes.find((n: any) => n.id === sourceId);
    if (!src || !item) return;
    // Offset siblings on the same source so they don't overlap (fan-out).
    const children = pipelineObj.currentSelectedPipeline.edges.filter(
      (e: any) => (e.source ?? e.sourceNode?.id) === sourceId,
    );
    const position = {
      x: (src.position?.x ?? 0) + children.length * 280,
      y: (src.position?.y ?? 0) + 160,
    };
    const id = getUUID();
    pipelineObj.currentSelectedNodeData = {
      id,
      type: item.io_type,
      io_type: item.io_type,
      position,
      data: { label: id, node_type: item.subtype },
    };
    pipelineObj.pendingEdge = { source: sourceId };
    pipelineObj.isEditNode = false;
    pipelineObj.dialog.name = item.subtype;
    pipelineObj.dialog.show = true;
  }

  function editNode(updatedNode: any) {
    const index = pipelineObj.currentSelectedPipeline.nodes.findIndex(
      (node: any) => node.id === updatedNode.id,
    );
    if (index !== -1) {
      pipelineObj.currentSelectedPipeline.nodes[index] = {
        ...pipelineObj.currentSelectedPipeline.nodes[index],
        ...updatedNode,
      };
    }
  }
  const comparePipelinesById = (pipeline1: any, pipeline2: any) => {
    const compareIds = (items1: any, items2: any) => {
      const extractAndSortIds = (items: any) => items.map((item: any) => item.id).sort();

      const ids1 = extractAndSortIds(items1);
      const ids2 = extractAndSortIds(items2);

      return JSON.stringify(ids1) === JSON.stringify(ids2);
    };
    const nodesEqual = compareIds(pipeline1.nodes, pipeline2.nodes);

    return nodesEqual;
  };

  function deletePipelineNode(nodeId: any) {
    pipelineObj.currentSelectedPipeline.nodes = pipelineObj.currentSelectedPipeline.nodes.filter(
      (node: any) => node.id !== nodeId,
    );

    pipelineObj.currentSelectedPipeline.edges = pipelineObj.currentSelectedPipeline.edges.filter(
      (edge: any) => edge.source !== nodeId && edge.target !== nodeId,
    );
    pipelineObj.currentSelectedNodeData = null;
    hasInputNodeFn();

    const arePipelinesEqualById = comparePipelinesById(
      pipelineObj.currentSelectedPipeline,
      pipelineObj.pipelineWithoutChange,
    );
    if (
      arePipelinesEqualById == true &&
      pipelineObj.edgesChange == false &&
      pipelineObj.isEditPipeline == true
    ) {
      pipelineObj.dirtyFlag = false;
    }
    if (arePipelinesEqualById == false && pipelineObj.isEditPipeline == true) {
      pipelineObj.dirtyFlag = true;
    }
  }

  const resetPipelineData = () => {
    pipelineObj.currentSelectedPipeline = JSON.parse(JSON.stringify(defaultPipelineObj));
    pipelineObj.currentSelectedNodeData = JSON.parse(JSON.stringify(dialogObj));
    pipelineObj.isEditPipeline = false;
    pipelineObj.isEditNode = false;
    pipelineObj.dirtyFlag = false;
    pipelineObj.hasInputNode = false;
    pipelineObj.draggedNode = null;
    // Transient editor state — the module singleton outlives one editor visit,
    // so anything left set here leaks into the next pipeline that opens. The
    // rail in particular documents itself as "starts CLOSED".
    pipelineObj.showNodePalette = false;
    pipelineObj.stepPicker = {
      show: false,
      source: "",
      mode: "next",
      position: null,
      anchor: null,
    };
    pipelineObj.pendingEdge = null;
  };

  const getInputNodeStream = () => {
    const nodes = pipelineObj.currentSelectedPipeline?.nodes ?? [];
    const inputNode = nodes.find((node: any) => node.io_type === "input");
    if (
      Object.prototype.hasOwnProperty.call(inputNode?.data, "node_type") &&
      inputNode.data.node_type === "stream"
    ) {
      return inputNode?.data?.stream_name?.value || inputNode.data.stream_name || "";
    } else {
      return null;
    }
  };

  const checkIfDefaultDestinationNode = (id: string) => {
    const inputNodeStream = getInputNodeStream();
    if (!inputNodeStream) return false;
    const nodes = pipelineObj.currentSelectedPipeline?.nodes ?? [];
    if (inputNodeStream) {
      return nodes.some(
        (node: any) =>
          node.id === id &&
          node.type === "output" &&
          (node.data.stream_name.value === inputNodeStream ||
            node.data.stream_name === inputNodeStream),
      );
    }
  };

  return {
    pipelineObj,
    onDragStart,
    onDragLeave,
    onDragOver,
    onDrop,
    onNodeChange,
    onNodesChange,
    onEdgesChange,
    onConnect,
    validateConnection,
    addNode,
    addNodeAfter,
    openStepPicker,
    openSourcePicker,
    closeStepPicker,
    addSourceNode,
    editNode,
    deletePipelineNode,
    resetPipelineData,
    comparePipelinesById,
    // Exporting internal functions for testing
    hasInputNodeFn,
    detectCycle,
    // Exporting constants for testing
    defaultObject,
    defaultPipelineObj,
    dialogObj,
    checkIfDefaultDestinationNode,
  };
}
