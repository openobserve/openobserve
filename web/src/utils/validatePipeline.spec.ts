// Copyright 2023 OpenObserve Inc.
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
// You should have received a copy of the GNU Aud General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect } from "vitest";
import { validatePipeline, ValidationResult } from "./validatePipeline";

describe("Pipeline Validation", () => {
  const validPipeline = {
    source: {
      org_id: "org123",
      source_type: "stream",
      stream_name: "test_stream"
    },
    nodes: [
      {
        id: "node1",
        data: {
          node_type: "stream",
          org_id: "org123",
          stream_name: "input_stream",
          stream_type: "logs"
        },
        io_type: "input"
      },
      {
        id: "node2",
        data: {
          node_type: "function",
          name: "test_function",
          after_flatten: true
        },
        io_type: "default"
      },
      {
        id: "node3",
        data: {
          node_type: "stream",
          org_id: "org123",
          stream_name: "output_stream",
          stream_type: "logs"
        },
        io_type: "output"
      }
    ],
    edges: [
      {
        id: "edge1",
        source: "node1",
        target: "node2"
      },
      {
        id: "edge2",
        source: "node2",
        target: "node3"
      }
    ]
  };

  const validContext = {
    streamList: ["input_stream", "output_stream"],
    usedStreamsList: ["other_stream"],
    originalPipeline: null,
    pipelineDestinations: ["dest1", "dest2"],
    functionsList: ["test_function", "other_function"],
    selectedOrgId: "org123"
  };

  describe("Valid pipeline validation", () => {
    it("should pass validation for a completely valid pipeline", () => {
      const result = validatePipeline(validPipeline, validContext);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should pass validation without context", () => {
      const result = validatePipeline(validPipeline);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("Node io_type validation", () => {
    it("should fail if node is missing io_type", () => {
      const pipeline = {
        ...validPipeline,
        nodes: [
          {
            id: "node1",
            data: {
              node_type: "stream"
            }
            // missing io_type
          }
        ]
      };
      
      const result = validatePipeline(pipeline as any, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Node node1 is missing required 'io_type' field");
    });

    it("should fail for invalid io_type values", () => {
      const pipeline = {
        ...validPipeline,
        nodes: [
          {
            id: "node1",
            data: {
              node_type: "stream"
            },
            io_type: "invalid"
          }
        ]
      };
      
      const result = validatePipeline(pipeline as any, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Node node1 has invalid io_type 'invalid'. Must be one of: input, output, default");
    });

    it("should pass for valid io_type values", () => {
      const validIoTypes = ["input", "output", "default"];
      
      validIoTypes.forEach(ioType => {
        // Create different pipeline structures based on io_type to satisfy edge constraints
        let pipeline;
        
        if (ioType === "input") {
          pipeline = {
            ...validPipeline,
            nodes: [
              {
                id: "node1",
                data: {
                  node_type: "stream",
                  org_id: "org123",
                  stream_name: "test"
                },
                io_type: ioType
              }
            ],
            edges: []
          };
        } else if (ioType === "output") {
          pipeline = {
            ...validPipeline,
            nodes: [
              {
                id: "node1",
                data: {
                  node_type: "stream",
                  org_id: "org123",
                  stream_name: "input"
                },
                io_type: "input"
              },
              {
                id: "node2",
                data: {
                  node_type: "stream",
                  org_id: "org123",
                  stream_name: "test"
                },
                io_type: ioType
              }
            ],
            edges: [
              {
                id: "edge1",
                source: "node1",
                target: "node2"
              }
            ]
          };
        } else { // default
          pipeline = {
            ...validPipeline,
            nodes: [
              {
                id: "node1",
                data: {
                  node_type: "stream",
                  org_id: "org123",
                  stream_name: "input"
                },
                io_type: "input"
              },
              {
                id: "node2",
                data: {
                  node_type: "function",
                  name: "test_function",
                  after_flatten: true
                },
                io_type: ioType
              },
              {
                id: "node3",
                data: {
                  node_type: "stream",
                  org_id: "org123",
                  stream_name: "output"
                },
                io_type: "output"
              }
            ],
            edges: [
              {
                id: "edge1",
                source: "node1",
                target: "node2"
              },
              {
                id: "edge2",
                source: "node2",
                target: "node3"
              }
            ]
          };
        }
        
        const result = validatePipeline(pipeline, validContext);
        expect(result.isValid).toBe(true);
      });
    });
  });

  describe("Node type validation", () => {
    it("should fail if node is missing node_type", () => {
      const pipeline = {
        ...validPipeline,
        nodes: [
          {
            id: "node1",
            data: {
              // missing node_type
            },
            io_type: "input"
          }
        ]
      };
      
      const result = validatePipeline(pipeline as any, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Node node1 is missing required 'node_type' field");
    });

    it("should fail for invalid node_type values", () => {
      const pipeline = {
        ...validPipeline,
        nodes: [
          {
            id: "node1",
            data: {
              node_type: "invalid"
            },
            io_type: "input"
          }
        ]
      };
      
      const result = validatePipeline(pipeline as any, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Node node1 has invalid node_type 'invalid'. Must be one of: stream, query, function, condition, remote_stream");
    });

    it("should pass for valid node_type values", () => {
      const validNodeTypes = ["stream", "query", "function", "condition", "remote_stream"];
      
      validNodeTypes.forEach(nodeType => {
        const nodeData: any = { node_type: nodeType };
        
        // Add required fields based on node type
        if (nodeType === "stream" || nodeType === "remote_stream") {
          nodeData.org_id = "org123";
          nodeData.stream_name = "test";
        }
        if (nodeType === "function") {
          nodeData.name = "test_function";
          nodeData.after_flatten = true;
        }
        if (nodeType === "query") {
          nodeData.query_condition = {
            type: "sql",
            sql: "SELECT * FROM logs",
            promql: null,
            promql_condition: null
          };
          nodeData.trigger_condition = {
            frequency_type: "minutes",
            timezone: "UTC",
            silence: 0,
            threshold: 0,
            frequency: 1,
            period: 1
          };
        }
        
        // For input nodes, just validate the node structure
        const pipeline = {
          ...validPipeline,
          nodes: [
            {
              id: "node1",
              data: nodeData,
              io_type: "input"
            }
          ],
          edges: []
        };
        
        const result = validatePipeline(pipeline, validContext);
        // Should pass node type validation (edge constraints will be tested separately)
        const nodeTypeErrors = result.errors.filter(error => 
          error.includes('invalid node_type') || 
          error.includes('missing required') && !error.includes('edge')
        );
        expect(nodeTypeErrors).toHaveLength(0);
      });
    });
  });

  describe("Stream type validation", () => {
    it("should pass for valid stream types", () => {
      const validStreamTypes = ["logs", "metrics", "traces"];
      
      validStreamTypes.forEach(streamType => {
        const pipeline = {
          ...validPipeline,
          nodes: [
            {
              id: "node1",
              data: {
                node_type: "stream",
                org_id: "org123",
                stream_name: "test",
                stream_type: streamType
              },
              io_type: "input"
            }
          ],
          edges: []
        };
        
        const result = validatePipeline(pipeline, validContext);
        expect(result.isValid).toBe(true);
      });
    });

    it("should fail for invalid stream types", () => {
      const pipeline = {
        ...validPipeline,
        nodes: [
          {
            id: "node1",
            data: {
              node_type: "stream",
              org_id: "org123",
              stream_name: "test",
              stream_type: "invalid"
            },
            io_type: "input"
          }
        ]
      };
      
      const result = validatePipeline(pipeline as any, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Node node1 has invalid stream_type 'invalid'. Must be one of: logs, metrics, traces");
    });
  });

  describe("Organization ID validation", () => {
    it("should fail if stream/remote_stream node is missing org_id", () => {
      const pipeline = {
        ...validPipeline,
        nodes: [
          {
            id: "node1",
            data: {
              node_type: "stream",
              // missing org_id
              stream_name: "test"
            },
            io_type: "input"
          }
        ]
      };
      
      const result = validatePipeline(pipeline as any, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Node node1 is missing required 'org_id' field");
    });

    it("should fail if org_id doesn't match source", () => {
      const pipeline = {
        ...validPipeline,
        nodes: [
          {
            id: "node1",
            data: {
              node_type: "stream",
              org_id: "wrong_org",
              stream_name: "test"
            },
            io_type: "input"
          }
        ]
      };
      
      const result = validatePipeline(pipeline, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Node node1 has mismatched org_id. Expected 'org123', got 'wrong_org'");
    });

    it("should not validate org_id for non-stream nodes", () => {
      const pipeline = {
        ...validPipeline,
        nodes: [
          {
            id: "node1",
            data: {
              node_type: "function",
              name: "test_function",
              after_flatten: true
              // no org_id needed for function nodes
            },
            io_type: "input"
          }
        ],
        edges: []
      };
      
      const result = validatePipeline(pipeline, validContext);
      // Should not have org_id related errors
      const orgIdErrors = result.errors.filter(error => error.includes('org_id'));
      expect(orgIdErrors).toHaveLength(0);
    });
  });

  describe("Stream usage validation", () => {
    it("should fail if input stream is already used by another pipeline", () => {
      const contextWithUsedStream = {
        ...validContext,
        usedStreamsList: ["input_stream"]
      };
      
      const pipeline = {
        ...validPipeline,
        nodes: [
          {
            id: "node1",
            data: {
              node_type: "stream",
              org_id: "org123",
              stream_name: "input_stream"
            },
            io_type: "input"
          }
        ]
      };
      
      const result = validatePipeline(pipeline, contextWithUsedStream);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Input stream "input_stream" in node node1 is already used by another realtime pipeline');
    });

    it("should pass if stream is same as original (editing existing pipeline)", () => {
      const contextWithOriginal = {
        ...validContext,
        usedStreamsList: ["input_stream"],
        originalPipeline: {
          nodes: [
            {
              id: "node1",
              data: {
                stream_name: "input_stream"
              }
            }
          ]
        }
      };
      
      const pipeline = {
        ...validPipeline,
        nodes: [
          {
            id: "node1",
            data: {
              node_type: "stream",
              org_id: "org123",
              stream_name: "input_stream"
            },
            io_type: "input"
          }
        ],
        edges: []
      };
      
      const result = validatePipeline(pipeline, contextWithOriginal);
      // Should not have stream usage errors
      const streamUsageErrors = result.errors.filter(error => 
        error.includes('already used by another realtime pipeline')
      );
      expect(streamUsageErrors).toHaveLength(0);
    });

    it("should handle stream_name as object with value property", () => {
      const pipeline = {
        ...validPipeline,
        nodes: [
          {
            id: "node1",
            data: {
              node_type: "stream",
              org_id: "org123",
              stream_name: { label: "Test Stream", value: "test_stream" }
            },
            io_type: "input"
          }
        ],
        edges: []
      };
      
      const result = validatePipeline(pipeline, validContext);
      // Should not have stream name format errors
      const streamNameErrors = result.errors.filter(error => 
        error.includes('stream_name') && !error.includes('edge')
      );
      expect(streamNameErrors).toHaveLength(0);
    });
  });

  describe("Query node validation", () => {
    it("should fail if query node is missing query_condition", () => {
      const pipeline = {
        ...validPipeline,
        nodes: [
          {
            id: "node1",
            data: {
              node_type: "query"
              // missing query_condition
            },
            io_type: "input"
          }
        ]
      };
      
      const result = validatePipeline(pipeline as any, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Query node node1 is missing query_condition");
    });

    it("should fail if query_condition has no type", () => {
      const pipeline = {
        ...validPipeline,
        nodes: [
          {
            id: "node1",
            data: {
              node_type: "query",
              query_condition: {
                // missing type
                sql: "SELECT * FROM logs"
              }
            },
            io_type: "input"
          }
        ]
      };
      
      const result = validatePipeline(pipeline as any, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Query node node1 has empty query type. Must be either 'sql' or 'promql'");
    });

    it("should fail for invalid query type", () => {
      const pipeline = {
        ...validPipeline,
        nodes: [
          {
            id: "node1",
            data: {
              node_type: "query",
              query_condition: {
                type: "invalid",
                sql: "SELECT * FROM logs"
              }
            },
            io_type: "input"
          }
        ]
      };
      
      const result = validatePipeline(pipeline as any, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Query node node1 has invalid query type 'invalid'. Must be either 'sql' or 'promql'");
    });

    it("should validate SQL query correctly", () => {
      const pipeline = {
        ...validPipeline,
        nodes: [
          {
            id: "node1",
            data: {
              node_type: "query",
              query_condition: {
                type: "sql",
                sql: "SELECT level FROM logs",
                promql: null,
                promql_condition: null
              },
              trigger_condition: {
                frequency_type: "minutes",
                timezone: "UTC",
                silence: 0,
                threshold: 0,
                frequency: 1,
                period: 1
              }
            },
            io_type: "input"
          }
        ],
        edges: []
      };
      
      const result = validatePipeline(pipeline, validContext);
      expect(result.isValid).toBe(true);
    });

    it("should fail if SQL query is empty", () => {
      const pipeline = {
        ...validPipeline,
        nodes: [
          {
            id: "node1",
            data: {
              node_type: "query",
              query_condition: {
                type: "sql",
                sql: ""
              }
            },
            io_type: "input"
          }
        ]
      };
      
      const result = validatePipeline(pipeline, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Query node node1 has empty SQL query");
    });

    it("should fail if SQL type has PromQL data", () => {
      const pipeline = {
        ...validPipeline,
        nodes: [
          {
            id: "node1",
            data: {
              node_type: "query",
              query_condition: {
                type: "sql",
                sql: "SELECT * FROM logs",
                promql: "rate(http_requests[5m])",
                promql_condition: null
              }
            },
            io_type: "input"
          }
        ]
      };
      
      const result = validatePipeline(pipeline, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Query node node1 has SQL type but contains PromQL related data");
    });

    it("should validate PromQL query correctly", () => {
      const pipeline = {
        ...validPipeline,
        nodes: [
          {
            id: "node1",
            data: {
              node_type: "query",
              query_condition: {
                type: "promql",
                promql: "rate(http_requests[5m])",
                sql: null
              },
              trigger_condition: {
                frequency_type: "minutes",
                timezone: "UTC",
                silence: 0,
                threshold: 0,
                frequency: 1,
                period: 1
              }
            },
            io_type: "input"
          }
        ],
        edges: []
      };
      
      const result = validatePipeline(pipeline, validContext);
      expect(result.isValid).toBe(true);
    });

    it("should fail if PromQL query is empty", () => {
      const pipeline = {
        ...validPipeline,
        nodes: [
          {
            id: "node1",
            data: {
              node_type: "query",
              query_condition: {
                type: "promql",
                promql: ""
              }
            },
            io_type: "input"
          }
        ]
      };
      
      const result = validatePipeline(pipeline, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Query node node1 has empty PromQL query");
    });

    it("should fail if PromQL type has SQL data", () => {
      const pipeline = {
        ...validPipeline,
        nodes: [
          {
            id: "node1",
            data: {
              node_type: "query",
              query_condition: {
                type: "promql",
                promql: "rate(http_requests[5m])",
                sql: "SELECT * FROM logs"
              }
            },
            io_type: "input"
          }
        ]
      };
      
      const result = validatePipeline(pipeline, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Query node node1 has PromQL type but contains SQL related data");
    });
  });

  describe("Trigger condition validation", () => {
    const baseQueryNode = {
      id: "node1",
      data: {
        node_type: "query",
        query_condition: {
          type: "sql",
          sql: "SELECT * FROM logs",
          promql: null,
          promql_condition: null
        }
      },
      io_type: "input"
    };

    it("should fail if query node is missing trigger_condition", () => {
      const pipeline = {
        ...validPipeline,
        nodes: [baseQueryNode]
      };
      
      const result = validatePipeline(pipeline as any, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Query node node1 is missing trigger_condition");
    });

    it("should fail for empty frequency_type", () => {
      const pipeline = {
        ...validPipeline,
        nodes: [
          {
            ...baseQueryNode,
            data: {
              ...baseQueryNode.data,
              trigger_condition: {
                // missing frequency_type
                timezone: "UTC"
              }
            }
          }
        ]
      };
      
      const result = validatePipeline(pipeline as any, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Query node node1 has empty frequency_type. Must be either 'minutes' or 'cron'");
    });

    it("should fail for invalid frequency_type", () => {
      const pipeline = {
        ...validPipeline,
        nodes: [
          {
            ...baseQueryNode,
            data: {
              ...baseQueryNode.data,
              trigger_condition: {
                frequency_type: "invalid",
                timezone: "UTC"
              }
            }
          }
        ]
      };
      
      const result = validatePipeline(pipeline as any, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Query node node1 has invalid frequency_type 'invalid'. Must be either 'minutes' or 'cron'");
    });

    it("should fail for empty timezone", () => {
      const pipeline = {
        ...validPipeline,
        nodes: [
          {
            ...baseQueryNode,
            data: {
              ...baseQueryNode.data,
              trigger_condition: {
                frequency_type: "minutes",
                timezone: ""
              }
            }
          }
        ]
      };
      
      const result = validatePipeline(pipeline, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Query node node1 has empty timezone");
    });

    it("should fail for negative silence", () => {
      const pipeline = {
        ...validPipeline,
        nodes: [
          {
            ...baseQueryNode,
            data: {
              ...baseQueryNode.data,
              trigger_condition: {
                frequency_type: "minutes",
                timezone: "UTC",
                silence: -1,
                threshold: 0,
                frequency: 1,
                period: 1
              }
            }
          }
        ]
      };
      
      const result = validatePipeline(pipeline, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Query node node1 has invalid silence value. Must be >= 0");
    });

    it("should fail for negative threshold", () => {
      const pipeline = {
        ...validPipeline,
        nodes: [
          {
            ...baseQueryNode,
            data: {
              ...baseQueryNode.data,
              trigger_condition: {
                frequency_type: "minutes",
                timezone: "UTC",
                silence: 0,
                threshold: -1,
                frequency: 1,
                period: 1
              }
            }
          }
        ]
      };
      
      const result = validatePipeline(pipeline, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Query node node1 has invalid threshold value. Must be >= 0");
    });

    it("should validate minutes frequency type correctly", () => {
      const pipeline = {
        ...validPipeline,
        nodes: [
          {
            ...baseQueryNode,
            data: {
              ...baseQueryNode.data,
              trigger_condition: {
                frequency_type: "minutes",
                timezone: "UTC",
                silence: 0,
                threshold: 0,
                frequency: 5,
                period: 5
              }
            }
          }
        ],
        edges: []
      };
      
      const result = validatePipeline(pipeline, validContext);
      expect(result.isValid).toBe(true);
    });

    it("should fail for invalid frequency in minutes mode", () => {
      const pipeline = {
        ...validPipeline,
        nodes: [
          {
            ...baseQueryNode,
            data: {
              ...baseQueryNode.data,
              trigger_condition: {
                frequency_type: "minutes",
                timezone: "UTC",
                silence: 0,
                threshold: 0,
                frequency: 0,
                period: 1
              }
            }
          }
        ]
      };
      
      const result = validatePipeline(pipeline, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Query node node1 has invalid frequency. Must be >= 1 for minutes frequency type");
    });

    it("should fail for mismatched frequency and period in minutes mode", () => {
      const pipeline = {
        ...validPipeline,
        nodes: [
          {
            ...baseQueryNode,
            data: {
              ...baseQueryNode.data,
              trigger_condition: {
                frequency_type: "minutes",
                timezone: "UTC",
                silence: 0,
                threshold: 0,
                frequency: 5,
                period: 3
              }
            }
          }
        ]
      };
      
      const result = validatePipeline(pipeline, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Query node node1 has mismatched frequency and period. They must be equal for minutes frequency type");
    });

    it("should validate cron frequency type correctly", () => {
      const pipeline = {
        ...validPipeline,
        nodes: [
          {
            ...baseQueryNode,
            data: {
              ...baseQueryNode.data,
              trigger_condition: {
                frequency_type: "cron",
                timezone: "UTC",
                silence: 0,
                threshold: 0,
                cron: "0 */5 * * *"
              }
            }
          }
        ],
        edges: []
      };
      
      const result = validatePipeline(pipeline, validContext);
      expect(result.isValid).toBe(true);
    });

    it("should fail for empty cron expression in cron mode", () => {
      const pipeline = {
        ...validPipeline,
        nodes: [
          {
            ...baseQueryNode,
            data: {
              ...baseQueryNode.data,
              trigger_condition: {
                frequency_type: "cron",
                timezone: "UTC",
                silence: 0,
                threshold: 0,
                cron: ""
              }
            }
          }
        ]
      };
      
      const result = validatePipeline(pipeline, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Query node node1 has empty cron expression");
    });
  });

  describe("Function node validation", () => {
    it("should validate function nodes correctly", () => {
      const pipeline = {
        ...validPipeline,
        nodes: [
          {
            id: "node1",
            data: {
              node_type: "function",
              name: "test_function",
              after_flatten: true
            },
            io_type: "input"
          }
        ],
        edges: []
      };
      
      const result = validatePipeline(pipeline, validContext);
      // Should not have function node validation errors (edge constraints tested separately)
      const functionErrors = result.errors.filter(error => 
        error.includes('after_flatten') || 
        error.includes('function name') ||
        error.includes('invalid function')
      );
      expect(functionErrors).toHaveLength(0);
    });

    it("should fail if after_flatten is not boolean", () => {
      const pipeline = {
        ...validPipeline,
        nodes: [
          {
            id: "node1",
            data: {
              node_type: "function",
              name: "test_function",
              after_flatten: "yes"
            },
            io_type: "default"
          }
        ]
      };
      
      const result = validatePipeline(pipeline as any, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Function node node1 must have 'after_flatten' field as boolean");
    });

    it("should fail for empty function name", () => {
      const pipeline = {
        ...validPipeline,
        nodes: [
          {
            id: "node1",
            data: {
              node_type: "function",
              name: "",
              after_flatten: true
            },
            io_type: "default"
          }
        ]
      };
      
      const result = validatePipeline(pipeline, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Function node node1 has empty function name");
    });

    it("should fail for invalid function name", () => {
      const pipeline = {
        ...validPipeline,
        nodes: [
          {
            id: "node1",
            data: {
              node_type: "function",
              name: "invalid_function",
              after_flatten: true
            },
            io_type: "default"
          }
        ]
      };
      
      const result = validatePipeline(pipeline, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Function node node1 has invalid function name "invalid_function". Must be one of the available functions.');
    });
  });

  describe("Output node validation", () => {
    it("should validate output stream nodes correctly", () => {
      const pipeline = {
        ...validPipeline,
        nodes: [
          {
            id: "node1",
            data: {
              node_type: "stream",
              org_id: "org123",
              stream_name: "output_stream"
            },
            io_type: "output"
          }
        ]
      };
      
      const result = validatePipeline(pipeline, validContext);
      expect(result.isValid).toBe(false); // Will fail because output node needs incoming edge
      expect(result.errors).toContain("Output node node1 should have exactly one incoming edge. Found 0 incoming edges.");
    });

    it("should fail for empty stream name in output stream", () => {
      const pipeline = {
        ...validPipeline,
        nodes: [
          {
            id: "node1",
            data: {
              node_type: "stream",
              org_id: "org123",
              stream_name: ""
            },
            io_type: "output"
          }
        ]
      };
      
      const result = validatePipeline(pipeline, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Output stream node node1 has empty stream name");
    });

    it("should validate remote_stream output nodes correctly", () => {
      const pipeline = {
        ...validPipeline,
        nodes: [
          {
            id: "node1",
            data: {
              node_type: "remote_stream",
              org_id: "org123",
              destination_name: "dest1"
            },
            io_type: "output"
          }
        ]
      };
      
      const result = validatePipeline(pipeline, validContext);
      expect(result.isValid).toBe(false); // Will fail because output node needs incoming edge
      expect(result.errors).toContain("Output node node1 should have exactly one incoming edge. Found 0 incoming edges.");
    });

    it("should fail for empty destination name in remote_stream", () => {
      const pipeline = {
        ...validPipeline,
        nodes: [
          {
            id: "node1",
            data: {
              node_type: "remote_stream",
              org_id: "org123",
              destination_name: ""
            },
            io_type: "output"
          }
        ]
      };
      
      const result = validatePipeline(pipeline, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Remote stream node node1 has empty destination name");
    });

    it("should fail for invalid destination in remote_stream", () => {
      const pipeline = {
        ...validPipeline,
        nodes: [
          {
            id: "node1",
            data: {
              node_type: "remote_stream",
              org_id: "org123",
              destination_name: "invalid_dest"
            },
            io_type: "output"
          }
        ]
      };
      
      const result = validatePipeline(pipeline, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Remote stream node node1 has invalid destination "invalid_dest". Must be one of the available pipeline destinations.');
    });
  });

  describe("Edge validation", () => {
    it("should fail for edges referencing non-existent nodes", () => {
      const pipeline = {
        ...validPipeline,
        nodes: [
          {
            id: "node1",
            data: { node_type: "stream", org_id: "org123", stream_name: "test" },
            io_type: "input"
          }
        ],
        edges: [
          {
            id: "edge1",
            source: "node1",
            target: "nonexistent"
          },
          {
            id: "edge2",
            source: "nonexistent",
            target: "node1"
          }
        ]
      };
      
      const result = validatePipeline(pipeline, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Edge edge1 references non-existent target node nonexistent");
      expect(result.errors).toContain("Edge edge2 references non-existent source node nonexistent");
    });

    it("should validate input node edge constraints", () => {
      const pipeline = {
        ...validPipeline,
        nodes: [
          {
            id: "node1",
            data: { node_type: "stream", org_id: "org123", stream_name: "test" },
            io_type: "input"
          },
          {
            id: "node2",
            data: { node_type: "function", name: "test_function", after_flatten: true },
            io_type: "default"
          }
        ],
        edges: [
          {
            id: "edge1",
            source: "node2",
            target: "node1" // Input node should not have incoming edges
          }
        ]
      };
      
      const result = validatePipeline(pipeline, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Input node node1 should not have incoming edges. Found 1 incoming edges.");
    });

    it("should validate output node edge constraints", () => {
      const pipeline = {
        ...validPipeline,
        nodes: [
          {
            id: "node1",
            data: { node_type: "stream", org_id: "org123", stream_name: "test" },
            io_type: "output"
          }
        ],
        edges: []
      };
      
      const result = validatePipeline(pipeline, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Output node node1 should have exactly one incoming edge. Found 0 incoming edges.");
    });

    it("should validate function/condition node edge constraints", () => {
      const pipeline = {
        ...validPipeline,
        nodes: [
          {
            id: "node1",
            data: { node_type: "function", name: "test_function", after_flatten: true },
            io_type: "default"
          }
        ],
        edges: []
      };
      
      const result = validatePipeline(pipeline, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("Function/Condition node node1 should have at least one incoming edge.");
      expect(result.errors).toContain("Function/Condition node node1 should have at least one outgoing edge.");
    });
  });

  describe("Complex validation scenarios", () => {
    it("should accumulate multiple errors", () => {
      const invalidPipeline = {
        source: {
          org_id: "org123",
          source_type: "stream",
          stream_name: "test"
        },
        nodes: [
          {
            id: "node1",
            data: {
              node_type: "invalid",
              // missing required fields
            },
            io_type: "invalid"
          }
        ],
        edges: [
          {
            id: "edge1",
            source: "nonexistent1",
            target: "nonexistent2"
          }
        ]
      };
      
      const result = validatePipeline(invalidPipeline as any, validContext);
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(3);
    });

    it("should handle missing context gracefully", () => {
      const pipeline = {
        ...validPipeline,
        nodes: [
          {
            id: "node1",
            data: {
              node_type: "function",
              name: "any_function",
              after_flatten: true
            },
            io_type: "default"
          }
        ]
      };
      
      const result = validatePipeline(pipeline);
      expect(result.isValid).toBe(false); // Will fail on edge constraints but not context validation
      expect(result.errors).not.toContain("Must be one of the available functions");
    });
  });
});