import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  transformFEToBE,
  retransformBEToFE,
  updateGroup,
  removeConditionGroup,
  detectConditionsVersion,
  convertV0ToV2,
  convertV1ToV2,
  convertV1BEToV2,
  ensureIds,
  TransformContext,
} from './alertDataTransforms';

// Mock getUUID
vi.mock('@/utils/zincutils', () => ({
  getUUID: vi.fn(() => 'mock-uuid-123'),
}));

describe('alertDataTransforms - OR Operator Pipeline Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('transformFEToBE - OR Operator Transformations', () => {
    it('should transform simple OR group with single condition', () => {
      const input = {
        groupId: 'group-1',
        label: 'or',
        items: [
          { id: '1', column: 'status', operator: '=', value: 'active', ignore_case: true }
        ]
      };

      const result = transformFEToBE(input);

      expect(result).toEqual({
        or: [
          { column: 'status', operator: '=', value: 'active', ignore_case: true }
        ]
      });
    });

    it('should transform OR group with multiple conditions', () => {
      const input = {
        groupId: 'group-1',
        label: 'or',
        items: [
          { id: '1', column: 'status', operator: '=', value: 'active', ignore_case: true },
          { id: '2', column: 'type', operator: '=', value: 'premium', ignore_case: false },
          { id: '3', column: 'level', operator: '>', value: '5', ignore_case: false }
        ]
      };

      const result = transformFEToBE(input);

      expect(result).toEqual({
        or: [
          { column: 'status', operator: '=', value: 'active', ignore_case: true },
          { column: 'type', operator: '=', value: 'premium', ignore_case: false },
          { column: 'level', operator: '>', value: '5', ignore_case: false }
        ]
      });
    });

    it('should transform nested OR inside AND group', () => {
      const input = {
        groupId: 'root',
        label: 'and',
        items: [
          { id: '1', column: 'country', operator: '=', value: 'US', ignore_case: false },
          {
            groupId: 'nested-or',
            label: 'or',
            items: [
              { id: '2', column: 'status', operator: '=', value: 'active', ignore_case: true },
              { id: '3', column: 'status', operator: '=', value: 'pending', ignore_case: true }
            ]
          }
        ]
      };

      const result = transformFEToBE(input);

      expect(result).toEqual({
        and: [
          { column: 'country', operator: '=', value: 'US', ignore_case: false },
          {
            or: [
              { column: 'status', operator: '=', value: 'active', ignore_case: true },
              { column: 'status', operator: '=', value: 'pending', ignore_case: true }
            ]
          }
        ]
      });
    });

    it('should transform nested AND inside OR group', () => {
      const input = {
        groupId: 'root',
        label: 'or',
        items: [
          { id: '1', column: 'priority', operator: '=', value: 'high', ignore_case: false },
          {
            groupId: 'nested-and',
            label: 'and',
            items: [
              { id: '2', column: 'status', operator: '=', value: 'error', ignore_case: true },
              { id: '3', column: 'severity', operator: '>=', value: '3', ignore_case: false }
            ]
          }
        ]
      };

      const result = transformFEToBE(input);

      expect(result).toEqual({
        or: [
          { column: 'priority', operator: '=', value: 'high', ignore_case: false },
          {
            and: [
              { column: 'status', operator: '=', value: 'error', ignore_case: true },
              { column: 'severity', operator: '>=', value: '3', ignore_case: false }
            ]
          }
        ]
      });
    });

    it('should transform complex nested structure with multiple OR groups', () => {
      const input = {
        groupId: 'root',
        label: 'and',
        items: [
          {
            groupId: 'or-1',
            label: 'or',
            items: [
              { id: '1', column: 'region', operator: '=', value: 'US', ignore_case: false },
              { id: '2', column: 'region', operator: '=', value: 'EU', ignore_case: false }
            ]
          },
          {
            groupId: 'or-2',
            label: 'or',
            items: [
              { id: '3', column: 'tier', operator: '=', value: 'gold', ignore_case: true },
              { id: '4', column: 'tier', operator: '=', value: 'platinum', ignore_case: true }
            ]
          }
        ]
      };

      const result = transformFEToBE(input);

      expect(result).toEqual({
        and: [
          {
            or: [
              { column: 'region', operator: '=', value: 'US', ignore_case: false },
              { column: 'region', operator: '=', value: 'EU', ignore_case: false }
            ]
          },
          {
            or: [
              { column: 'tier', operator: '=', value: 'gold', ignore_case: true },
              { column: 'tier', operator: '=', value: 'platinum', ignore_case: true }
            ]
          }
        ]
      });
    });

    it('should handle OR with different operators', () => {
      const input = {
        groupId: 'group-1',
        label: 'or',
        items: [
          { id: '1', column: 'count', operator: '>', value: '100', ignore_case: false },
          { id: '2', column: 'count', operator: '<', value: '10', ignore_case: false },
          { id: '3', column: 'status', operator: 'Contains', value: 'error', ignore_case: true },
          { id: '4', column: 'name', operator: '!=', value: 'test', ignore_case: false }
        ]
      };

      const result = transformFEToBE(input);

      expect(result).toEqual({
        or: [
          { column: 'count', operator: '>', value: '100', ignore_case: false },
          { column: 'count', operator: '<', value: '10', ignore_case: false },
          { column: 'status', operator: 'Contains', value: 'error', ignore_case: true },
          { column: 'name', operator: '!=', value: 'test', ignore_case: false }
        ]
      });
    });

    it('should handle OR with case-sensitive and case-insensitive conditions', () => {
      const input = {
        groupId: 'group-1',
        label: 'or',
        items: [
          { id: '1', column: 'message', operator: 'Contains', value: 'ERROR', ignore_case: true },
          { id: '2', column: 'message', operator: 'Contains', value: 'Error', ignore_case: false },
          { id: '3', column: 'message', operator: '=', value: 'error', ignore_case: true }
        ]
      };

      const result = transformFEToBE(input);

      expect(result).toEqual({
        or: [
          { column: 'message', operator: 'Contains', value: 'ERROR', ignore_case: true },
          { column: 'message', operator: 'Contains', value: 'Error', ignore_case: false },
          { column: 'message', operator: '=', value: 'error', ignore_case: true }
        ]
      });
    });

    it('should transform deeply nested OR structure (3 levels)', () => {
      const input = {
        groupId: 'root',
        label: 'or',
        items: [
          { id: '1', column: 'level', operator: '=', value: 'critical', ignore_case: false },
          {
            groupId: 'nested-1',
            label: 'and',
            items: [
              { id: '2', column: 'source', operator: '=', value: 'api', ignore_case: false },
              {
                groupId: 'nested-2',
                label: 'or',
                items: [
                  { id: '3', column: 'code', operator: '=', value: '500', ignore_case: false },
                  { id: '4', column: 'code', operator: '=', value: '503', ignore_case: false }
                ]
              }
            ]
          }
        ]
      };

      const result = transformFEToBE(input);

      expect(result).toEqual({
        or: [
          { column: 'level', operator: '=', value: 'critical', ignore_case: false },
          {
            and: [
              { column: 'source', operator: '=', value: 'api', ignore_case: false },
              {
                or: [
                  { column: 'code', operator: '=', value: '500', ignore_case: false },
                  { column: 'code', operator: '=', value: '503', ignore_case: false }
                ]
              }
            ]
          }
        ]
      });
    });

    it('should handle OR with empty string values', () => {
      const input = {
        groupId: 'group-1',
        label: 'or',
        items: [
          { id: '1', column: 'field1', operator: '=', value: '', ignore_case: false },
          { id: '2', column: 'field2', operator: '!=', value: '', ignore_case: true }
        ]
      };

      const result = transformFEToBE(input);

      expect(result).toEqual({
        or: [
          { column: 'field1', operator: '=', value: '', ignore_case: false },
          { column: 'field2', operator: '!=', value: '', ignore_case: true }
        ]
      });
    });

    it('should handle OR with undefined ignore_case (defaults to false)', () => {
      const input = {
        groupId: 'group-1',
        label: 'or',
        items: [
          { id: '1', column: 'status', operator: '=', value: 'active' },
          { id: '2', column: 'type', operator: '=', value: 'premium', ignore_case: undefined }
        ]
      };

      const result = transformFEToBE(input);

      expect(result).toEqual({
        or: [
          { column: 'status', operator: '=', value: 'active', ignore_case: false },
          { column: 'type', operator: '=', value: 'premium', ignore_case: false }
        ]
      });
    });
  });

  describe('retransformBEToFE - OR Operator Reverse Transformations', () => {
    it('should retransform simple OR group from backend', () => {
      const input = {
        or: [
          { column: 'status', operator: '=', value: 'active', ignore_case: true }
        ]
      };

      const result = retransformBEToFE(input);

      expect(result.label).toBe('or');
      expect(result.groupId).toBe('mock-uuid-123');
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual({
        column: 'status',
        operator: '=',
        value: 'active',
        ignore_case: true,
        id: 'mock-uuid-123'
      });
    });

    it('should retransform OR group with multiple conditions', () => {
      const input = {
        or: [
          { column: 'priority', operator: '=', value: 'high', ignore_case: false },
          { column: 'priority', operator: '=', value: 'critical', ignore_case: false },
          { column: 'status', operator: '!=', value: 'closed', ignore_case: true }
        ]
      };

      const result = retransformBEToFE(input);

      expect(result.label).toBe('or');
      expect(result.items).toHaveLength(3);
      expect(result.items[0].column).toBe('priority');
      expect(result.items[1].column).toBe('priority');
      expect(result.items[2].column).toBe('status');
    });

    it('should retransform nested OR inside AND', () => {
      const input = {
        and: [
          { column: 'environment', operator: '=', value: 'production', ignore_case: false },
          {
            or: [
              { column: 'severity', operator: '>=', value: '3', ignore_case: false },
              { column: 'severity', operator: '=', value: 'critical', ignore_case: true }
            ]
          }
        ]
      };

      const result = retransformBEToFE(input);

      expect(result.label).toBe('and');
      expect(result.items).toHaveLength(2);
      expect(result.items[0].column).toBe('environment');
      expect(result.items[1].label).toBe('or');
      expect(result.items[1].items).toHaveLength(2);
    });

    it('should retransform nested AND inside OR', () => {
      const input = {
        or: [
          { column: 'type', operator: '=', value: 'error', ignore_case: false },
          {
            and: [
              { column: 'source', operator: '=', value: 'database', ignore_case: false },
              { column: 'duration', operator: '>', value: '1000', ignore_case: false }
            ]
          }
        ]
      };

      const result = retransformBEToFE(input);

      expect(result.label).toBe('or');
      expect(result.items).toHaveLength(2);
      expect(result.items[0].column).toBe('type');
      expect(result.items[1].label).toBe('and');
      expect(result.items[1].items).toHaveLength(2);
    });

    it('should retransform complex nested structure with multiple OR groups', () => {
      const input = {
        and: [
          {
            or: [
              { column: 'region', operator: '=', value: 'US', ignore_case: false },
              { column: 'region', operator: '=', value: 'CA', ignore_case: false }
            ]
          },
          {
            or: [
              { column: 'platform', operator: '=', value: 'web', ignore_case: false },
              { column: 'platform', operator: '=', value: 'mobile', ignore_case: false }
            ]
          }
        ]
      };

      const result = retransformBEToFE(input);

      expect(result.label).toBe('and');
      expect(result.items).toHaveLength(2);
      expect(result.items[0].label).toBe('or');
      expect(result.items[0].items).toHaveLength(2);
      expect(result.items[1].label).toBe('or');
      expect(result.items[1].items).toHaveLength(2);
    });

    it('should retransform deeply nested OR structure', () => {
      const input = {
        or: [
          { column: 'alert', operator: '=', value: 'true', ignore_case: false },
          {
            and: [
              { column: 'metric', operator: '>', value: '100', ignore_case: false },
              {
                or: [
                  { column: 'tag', operator: 'Contains', value: 'prod', ignore_case: true },
                  { column: 'tag', operator: 'Contains', value: 'staging', ignore_case: true }
                ]
              }
            ]
          }
        ]
      };

      const result = retransformBEToFE(input);

      expect(result.label).toBe('or');
      expect(result.items).toHaveLength(2);
      expect(result.items[1].label).toBe('and');
      expect(result.items[1].items[1].label).toBe('or');
      expect(result.items[1].items[1].items).toHaveLength(2);
    });

    it('should preserve ignore_case flag correctly in OR groups', () => {
      const input = {
        or: [
          { column: 'msg', operator: 'Contains', value: 'ERROR', ignore_case: true },
          { column: 'msg', operator: 'Contains', value: 'WARN', ignore_case: false }
        ]
      };

      const result = retransformBEToFE(input);

      expect(result.items[0].ignore_case).toBe(true);
      expect(result.items[1].ignore_case).toBe(false);
    });

    it('should handle OR with false ignore_case values', () => {
      const input = {
        or: [
          { column: 'field1', operator: '=', value: 'value1', ignore_case: false },
          { column: 'field2', operator: '=', value: 'value2', ignore_case: false }
        ]
      };

      const result = retransformBEToFE(input);

      expect(result.items[0].ignore_case).toBe(false);
      expect(result.items[1].ignore_case).toBe(false);
    });
  });

  describe('Bidirectional Transformation - OR Operator', () => {
    it('should maintain consistency when transforming OR group FE->BE->FE', () => {
      const original = {
        groupId: 'test-group',
        label: 'or',
        items: [
          { id: '1', column: 'status', operator: '=', value: 'active', ignore_case: true },
          { id: '2', column: 'type', operator: '!=', value: 'test', ignore_case: false }
        ]
      };

      const transformed = transformFEToBE(original);
      const retransformed = retransformBEToFE(transformed);

      expect(retransformed.label).toBe(original.label);
      expect(retransformed.items).toHaveLength(original.items.length);
      expect(retransformed.items[0].column).toBe(original.items[0].column);
      expect(retransformed.items[1].operator).toBe(original.items[1].operator);
    });

    it('should maintain consistency for nested OR in AND structure', () => {
      const original = {
        groupId: 'root',
        label: 'and',
        items: [
          { id: '1', column: 'env', operator: '=', value: 'prod', ignore_case: false },
          {
            groupId: 'nested',
            label: 'or',
            items: [
              { id: '2', column: 'level', operator: '=', value: 'error', ignore_case: true },
              { id: '3', column: 'level', operator: '=', value: 'critical', ignore_case: true }
            ]
          }
        ]
      };

      const transformed = transformFEToBE(original);
      const retransformed = retransformBEToFE(transformed);

      expect(retransformed.label).toBe('and');
      expect(retransformed.items[1].label).toBe('or');
      expect(retransformed.items[1].items).toHaveLength(2);
    });

    it('should maintain consistency for complex nested structure with multiple OR groups', () => {
      const original = {
        groupId: 'root',
        label: 'or',
        items: [
          {
            groupId: 'and-1',
            label: 'and',
            items: [
              { id: '1', column: 'a', operator: '=', value: '1', ignore_case: false },
              { id: '2', column: 'b', operator: '>', value: '2', ignore_case: false }
            ]
          },
          {
            groupId: 'and-2',
            label: 'and',
            items: [
              { id: '3', column: 'c', operator: '<', value: '3', ignore_case: false },
              { id: '4', column: 'd', operator: '!=', value: '4', ignore_case: true }
            ]
          }
        ]
      };

      const transformed = transformFEToBE(original);
      const retransformed = retransformBEToFE(transformed);

      expect(retransformed.label).toBe('or');
      expect(retransformed.items).toHaveLength(2);
      expect(retransformed.items[0].label).toBe('and');
      expect(retransformed.items[1].label).toBe('and');
    });
  });

  describe('updateGroup - OR Operator Context', () => {
    it('should update OR group in formData', () => {
      const context: TransformContext = {
        formData: {
          query_condition: {
            conditions: {
              groupId: 'root',
              label: 'and',
              items: [
                {
                  groupId: 'or-group-1',
                  label: 'or',
                  items: [
                    { id: '1', column: 'field1', operator: '=', value: 'value1', ignore_case: false }
                  ]
                }
              ]
            }
          }
        }
      };

      const updatedGroup = {
        groupId: 'or-group-1',
        label: 'or',
        items: [
          { id: '1', column: 'field1', operator: '=', value: 'updated', ignore_case: true },
          { id: '2', column: 'field2', operator: '!=', value: 'value2', ignore_case: false }
        ]
      };

      updateGroup(updatedGroup, context);

      const updatedItem = context.formData.query_condition.conditions.items[0];
      expect(updatedItem.items).toHaveLength(2);
      expect(updatedItem.items[0].value).toBe('updated');
      expect(updatedItem.items[1].column).toBe('field2');
    });

    it('should update nested OR group within AND group', () => {
      const context: TransformContext = {
        formData: {
          query_condition: {
            conditions: {
              groupId: 'root',
              label: 'and',
              items: [
                { id: '1', column: 'base', operator: '=', value: 'test', ignore_case: false },
                {
                  groupId: 'nested-or',
                  label: 'or',
                  items: [
                    { id: '2', column: 'status', operator: '=', value: 'old', ignore_case: false }
                  ]
                }
              ]
            }
          }
        }
      };

      const updatedGroup = {
        groupId: 'nested-or',
        label: 'or',
        items: [
          { id: '2', column: 'status', operator: '=', value: 'new', ignore_case: true },
          { id: '3', column: 'priority', operator: '>', value: '5', ignore_case: false }
        ]
      };

      updateGroup(updatedGroup, context);

      const orGroup = context.formData.query_condition.conditions.items[1];
      expect(orGroup.items).toHaveLength(2);
      expect(orGroup.items[0].value).toBe('new');
      expect(orGroup.items[1].column).toBe('priority');
    });

    it('should handle updating OR group with multiple conditions', () => {
      const context: TransformContext = {
        formData: {
          query_condition: {
            conditions: {
              groupId: 'root',
              label: 'or',
              items: [
                {
                  groupId: 'target-or',
                  label: 'or',
                  items: [
                    { id: '1', column: 'a', operator: '=', value: '1', ignore_case: false }
                  ]
                }
              ]
            }
          }
        }
      };

      const updatedGroup = {
        groupId: 'target-or',
        label: 'or',
        items: [
          { id: '1', column: 'a', operator: '=', value: '1', ignore_case: false },
          { id: '2', column: 'b', operator: '=', value: '2', ignore_case: false },
          { id: '3', column: 'c', operator: '=', value: '3', ignore_case: true },
          { id: '4', column: 'd', operator: '>', value: '4', ignore_case: false }
        ]
      };

      updateGroup(updatedGroup, context);

      const orGroup = context.formData.query_condition.conditions.items[0];
      expect(orGroup.items).toHaveLength(4);
    });
  });

  describe('removeConditionGroup - OR Operator Context', () => {
    it('should remove OR group from root', () => {
      const context: TransformContext = {
        formData: {
          query_condition: {
            conditions: {
              groupId: 'root',
              label: 'and',
              items: [
                { id: '1', column: 'field1', operator: '=', value: 'value1', ignore_case: false },
                {
                  groupId: 'or-to-remove',
                  label: 'or',
                  items: [
                    { id: '2', column: 'field2', operator: '=', value: 'value2', ignore_case: false }
                  ]
                }
              ]
            }
          }
        }
      };

      removeConditionGroup('or-to-remove', null, context);

      expect(context.formData.query_condition.conditions.items).toHaveLength(1);
      expect(context.formData.query_condition.conditions.items[0].id).toBe('1');
    });

    it('should remove nested OR group and clean up empty parents', () => {
      const context: TransformContext = {
        formData: {
          query_condition: {
            conditions: {
              groupId: 'root',
              label: 'and',
              items: [
                {
                  groupId: 'parent-or',
                  label: 'or',
                  items: [
                    {
                      groupId: 'nested-to-remove',
                      label: 'and',
                      items: [
                        { id: '1', column: 'field1', operator: '=', value: 'value1', ignore_case: false }
                      ]
                    }
                  ]
                }
              ]
            }
          }
        }
      };

      removeConditionGroup('nested-to-remove', null, context);

      // Parent OR group should be removed as it's now empty
      expect(context.formData.query_condition.conditions.items).toHaveLength(0);
    });

    it('should remove one OR group while keeping others', () => {
      const context: TransformContext = {
        formData: {
          query_condition: {
            conditions: {
              groupId: 'root',
              label: 'and',
              items: [
                {
                  groupId: 'or-keep',
                  label: 'or',
                  items: [
                    { id: '1', column: 'keep', operator: '=', value: 'this', ignore_case: false }
                  ]
                },
                {
                  groupId: 'or-remove',
                  label: 'or',
                  items: [
                    { id: '2', column: 'remove', operator: '=', value: 'this', ignore_case: false }
                  ]
                }
              ]
            }
          }
        }
      };

      removeConditionGroup('or-remove', null, context);

      expect(context.formData.query_condition.conditions.items).toHaveLength(1);
      expect(context.formData.query_condition.conditions.items[0].groupId).toBe('or-keep');
    });

    it('should remove deeply nested OR group', () => {
      const context: TransformContext = {
        formData: {
          query_condition: {
            conditions: {
              groupId: 'root',
              label: 'and',
              items: [
                {
                  groupId: 'level-1',
                  label: 'or',
                  items: [
                    { id: '1', column: 'a', operator: '=', value: '1', ignore_case: false },
                    {
                      groupId: 'level-2',
                      label: 'and',
                      items: [
                        {
                          groupId: 'level-3-remove',
                          label: 'or',
                          items: [
                            { id: '2', column: 'b', operator: '=', value: '2', ignore_case: false }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          }
        }
      };

      removeConditionGroup('level-3-remove', null, context);

      const level1 = context.formData.query_condition.conditions.items[0];
      expect(level1.items).toHaveLength(1);
      expect(level1.items[0].id).toBe('1');
    });
  });

  describe('Edge Cases - OR Operator', () => {
    it('should handle transformFEToBE with null input', () => {
      const result = transformFEToBE(null);
      expect(result).toEqual({});
    });

    it('should handle transformFEToBE with undefined items', () => {
      const input = {
        groupId: 'test',
        label: 'or',
        items: undefined
      };
      const result = transformFEToBE(input);
      expect(result).toEqual({});
    });

    it('should handle transformFEToBE with empty items array', () => {
      const input = {
        groupId: 'test',
        label: 'or',
        items: []
      };
      const result = transformFEToBE(input);
      expect(result).toEqual({ or: [] });
    });

    it('should handle transformFEToBE with invalid label', () => {
      const input = {
        groupId: 'test',
        label: 'invalid',
        items: [{ id: '1', column: 'field', operator: '=', value: 'value' }]
      };
      const result = transformFEToBE(input);
      expect(result).toEqual({});
    });

    it('should handle retransformBEToFE with null input', () => {
      const result = retransformBEToFE(null);
      expect(result).toBeNull();
    });

    it('should handle retransformBEToFE with empty object', () => {
      const result = retransformBEToFE({});
      expect(result).toBeNull();
    });

    it('should handle retransformBEToFE with multiple root keys', () => {
      const input = {
        or: [{ column: 'a', operator: '=', value: '1', ignore_case: false }],
        and: [{ column: 'b', operator: '=', value: '2', ignore_case: false }]
      };
      const result = retransformBEToFE(input);
      expect(result).toBeNull();
    });

    it('should handle removeConditionGroup with null items', () => {
      const context: TransformContext = {
        formData: {
          query_condition: {
            conditions: {
              groupId: 'root',
              label: 'or',
              items: null
            }
          }
        }
      };

      expect(() => {
        removeConditionGroup('any-id', null, context);
      }).not.toThrow();
    });

    it('should handle removeConditionGroup with non-array items', () => {
      const context: TransformContext = {
        formData: {
          query_condition: {
            conditions: {
              groupId: 'root',
              label: 'or',
              items: 'not-an-array' as any
            }
          }
        }
      };

      expect(() => {
        removeConditionGroup('any-id', null, context);
      }).not.toThrow();
    });

    it('should handle OR with special characters in values', () => {
      const input = {
        groupId: 'group-1',
        label: 'or',
        items: [
          { id: '1', column: 'field', operator: '=', value: 'value with spaces', ignore_case: true },
          { id: '2', column: 'field', operator: 'Contains', value: 'special!@#$%^&*()', ignore_case: false },
          { id: '3', column: 'field', operator: '=', value: 'unicode: 你好', ignore_case: true }
        ]
      };

      const result = transformFEToBE(input);

      expect(result.or[0].value).toBe('value with spaces');
      expect(result.or[1].value).toBe('special!@#$%^&*()');
      expect(result.or[2].value).toBe('unicode: 你好');
    });

    it('should handle OR with numeric and string values', () => {
      const input = {
        groupId: 'group-1',
        label: 'or',
        items: [
          { id: '1', column: 'count', operator: '>', value: '100', ignore_case: false },
          { id: '2', column: 'status', operator: '=', value: 'active', ignore_case: true }
        ]
      };

      const result = transformFEToBE(input);

      expect(result.or[0].value).toBe('100');
      expect(result.or[1].value).toBe('active');
    });
  });
});

// ============================================================================
// VERSION 2 (V2) COMPREHENSIVE TESTS
// ============================================================================

describe('alertDataTransforms - V2 Structure Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('detectConditionsVersion', () => {
    it('should detect V2 structure with filterType and conditions array', () => {
      const v2Data = {
        filterType: 'group',
        logicalOperator: 'AND',
        conditions: [
          {
            filterType: 'condition',
            column: 'status',
            operator: '=',
            value: 'active',
            logicalOperator: 'AND',
            id: '1'
          }
        ],
        groupId: 'root'
      };

      expect(detectConditionsVersion(v2Data)).toBe(2);
    });

    it('should detect V1 structure with and/or keys', () => {
      const v1BEData = {
        and: [
          { column: 'status', operator: '=', value: 'active', ignore_case: true }
        ]
      };

      expect(detectConditionsVersion(v1BEData)).toBe(1);
    });

    it('should detect V1 structure with label and items', () => {
      const v1FEData = {
        label: 'and',
        items: [
          { id: '1', column: 'status', operator: '=', value: 'active' }
        ],
        groupId: 'test'
      };

      expect(detectConditionsVersion(v1FEData)).toBe(1);
    });

    it('should detect V0 structure (flat array)', () => {
      const v0Data = [
        { column: 'status', operator: '=', value: 'active', ignore_case: true },
        { column: 'type', operator: '!=', value: 'test', ignore_case: false }
      ];

      expect(detectConditionsVersion(v0Data)).toBe(0);
    });

    it('should return 0 for null or undefined', () => {
      expect(detectConditionsVersion(null)).toBe(0);
      expect(detectConditionsVersion(undefined)).toBe(0);
    });

    it('should return 0 for empty array', () => {
      expect(detectConditionsVersion([])).toBe(0);
    });

    it('should return 0 for empty object', () => {
      expect(detectConditionsVersion({})).toBe(0);
    });
  });

  describe('convertV0ToV2', () => {
    it('should convert flat array to V2 group structure', () => {
      const v0Data = [
        { column: 'status', operator: '=', value: 'active', ignore_case: true },
        { column: 'type', operator: '!=', value: 'test', ignore_case: false }
      ];

      const result = convertV0ToV2(v0Data);

      expect(result.filterType).toBe('group');
      expect(result.logicalOperator).toBe('AND');
      expect(result.conditions).toHaveLength(2);
      expect(result.groupId).toBe('mock-uuid-123');

      expect(result.conditions[0]).toMatchObject({
        filterType: 'condition',
        column: 'status',
        operator: '=',
        value: 'active',
        logicalOperator: 'AND',
      });
    });

    it('should convert empty array to empty V2 group', () => {
      const result = convertV0ToV2([]);

      expect(result.filterType).toBe('group');
      expect(result.logicalOperator).toBe('AND');
      expect(result.conditions).toHaveLength(0);
      expect(result.groupId).toBe('mock-uuid-123');
    });

    it('should handle V0 with existing ids', () => {
      const v0Data = [
        { id: 'existing-1', column: 'field1', operator: '=', value: 'val1' }
      ];

      const result = convertV0ToV2(v0Data);

      expect(result.conditions[0].id).toBe('existing-1');
    });

    it('should generate ids for V0 items without ids', () => {
      const v0Data = [
        { column: 'field1', operator: '=', value: 'val1' }
      ];

      const result = convertV0ToV2(v0Data);

      expect(result.conditions[0].id).toBe('mock-uuid-123');
    });


    it('should handle V0 with all operators', () => {
      const v0Data = [
        { column: 'a', operator: '=', value: '1' },
        { column: 'b', operator: '!=', value: '2' },
        { column: 'c', operator: '>', value: '3' },
        { column: 'd', operator: '<', value: '4' },
        { column: 'e', operator: '>=', value: '5' },
        { column: 'f', operator: '<=', value: '6' },
        { column: 'g', operator: 'Contains', value: '7' },
        { column: 'h', operator: 'NotContains', value: '8' }
      ];

      const result = convertV0ToV2(v0Data);

      expect(result.conditions).toHaveLength(8);
      expect(result.conditions[0].operator).toBe('=');
      expect(result.conditions[6].operator).toBe('Contains');
    });

    it('should set all conditions to AND operator (V0 implicit AND)', () => {
      const v0Data = [
        { column: 'a', operator: '=', value: '1' },
        { column: 'b', operator: '=', value: '2' }
      ];

      const result = convertV0ToV2(v0Data);

      expect(result.conditions[0].logicalOperator).toBe('AND');
      expect(result.conditions[1].logicalOperator).toBe('AND');
    });
  });

  describe('convertV1ToV2 - Frontend Format', () => {
    it('should convert V1 FE format to V2 with single condition', () => {
      const v1Data = {
        groupId: 'test-group',
        label: 'and',
        items: [
          { id: '1', column: 'status', operator: '=', value: 'active', ignore_case: true }
        ]
      };

      const result = convertV1ToV2(v1Data);

      expect(result.filterType).toBe('group');
      expect(result.logicalOperator).toBe('AND');
      expect(result.groupId).toBe('test-group');
      expect(result.conditions).toHaveLength(1);
      expect(result.conditions[0]).toMatchObject({
        filterType: 'condition',
        column: 'status',
        operator: '=',
        value: 'active',
        logicalOperator: 'AND',
        id: '1'
      });
    });

    it('should convert V1 OR group to V2', () => {
      const v1Data = {
        groupId: 'or-group',
        label: 'or',
        items: [
          { id: '1', column: 'type', operator: '=', value: 'error', ignore_case: false },
          { id: '2', column: 'type', operator: '=', value: 'warning', ignore_case: false }
        ]
      };

      const result = convertV1ToV2(v1Data);

      expect(result.logicalOperator).toBe('OR');
      expect(result.conditions).toHaveLength(2);
      expect(result.conditions[0].logicalOperator).toBe('OR');
      expect(result.conditions[1].logicalOperator).toBe('OR');
    });

    it('should convert nested V1 groups to V2', () => {
      const v1Data = {
        groupId: 'root',
        label: 'and',
        items: [
          { id: '1', column: 'env', operator: '=', value: 'prod', ignore_case: false },
          {
            groupId: 'nested-or',
            label: 'or',
            items: [
              { id: '2', column: 'level', operator: '=', value: 'error', ignore_case: true },
              { id: '3', column: 'level', operator: '=', value: 'critical', ignore_case: true }
            ]
          }
        ]
      };

      const result = convertV1ToV2(v1Data);

      expect(result.filterType).toBe('group');
      expect(result.logicalOperator).toBe('AND');
      expect(result.conditions).toHaveLength(2);

      // First item is a condition
      expect(result.conditions[0].filterType).toBe('condition');

      // Second item is a nested group
      expect(result.conditions[1].filterType).toBe('group');
      expect(result.conditions[1].logicalOperator).toBe('OR');
      expect(result.conditions[1].conditions).toHaveLength(2);
    });

    it('should handle deeply nested V1 structure (3 levels)', () => {
      const v1Data = {
        groupId: 'root',
        label: 'and',
        items: [
          {
            groupId: 'level-1',
            label: 'or',
            items: [
              { id: '1', column: 'a', operator: '=', value: '1' },
              {
                groupId: 'level-2',
                label: 'and',
                items: [
                  { id: '2', column: 'b', operator: '=', value: '2' },
                  {
                    groupId: 'level-3',
                    label: 'or',
                    items: [
                      { id: '3', column: 'c', operator: '=', value: '3' }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      };

      const result = convertV1ToV2(v1Data);

      expect(result.filterType).toBe('group');
      expect(result.conditions[0].filterType).toBe('group');
      expect(result.conditions[0].conditions[1].filterType).toBe('group');
      expect(result.conditions[0].conditions[1].conditions[1].filterType).toBe('group');
    });

    it('should return as-is if already V2 format', () => {
      const v2Data = {
        filterType: 'group',
        logicalOperator: 'AND',
        conditions: [],
        groupId: 'test'
      };

      const result = convertV1ToV2(v2Data);

      expect(result).toBe(v2Data);
    });

    it('should handle null input', () => {
      const result = convertV1ToV2(null);

      expect(result.filterType).toBe('group');
      expect(result.logicalOperator).toBe('AND');
      expect(result.conditions).toHaveLength(0);
    });

    it('should preserve existing ids from V1 conditions', () => {
      const v1Data = {
        label: 'and',
        items: [
          { id: 'custom-id-123', column: 'field', operator: '=', value: 'val' }
        ]
      };

      const result = convertV1ToV2(v1Data);

      expect(result.conditions[0].id).toBe('custom-id-123');
    });
  });

  describe('convertV1BEToV2 - Backend Format', () => {
    it('should convert V1 BE format with AND to V2', () => {
      const v1BEData = {
        and: [
          { column: 'status', operator: '=', value: 'active', ignore_case: true },
          { column: 'type', operator: '!=', value: 'test', ignore_case: false }
        ]
      };

      const result = convertV1BEToV2(v1BEData);

      expect(result.filterType).toBe('group');
      expect(result.logicalOperator).toBe('AND');
      expect(result.conditions).toHaveLength(2);
      expect(result.conditions[0].logicalOperator).toBe('AND');
      expect(result.conditions[1].logicalOperator).toBe('AND');
    });

    it('should convert V1 BE format with OR to V2', () => {
      const v1BEData = {
        or: [
          { column: 'level', operator: '=', value: 'error', ignore_case: true },
          { column: 'level', operator: '=', value: 'critical', ignore_case: true }
        ]
      };

      const result = convertV1BEToV2(v1BEData);

      expect(result.filterType).toBe('group');
      expect(result.logicalOperator).toBe('OR');
      expect(result.conditions).toHaveLength(2);
      expect(result.conditions[0].logicalOperator).toBe('OR');
    });

    it('should convert nested V1 BE format', () => {
      const v1BEData = {
        and: [
          { column: 'env', operator: '=', value: 'prod', ignore_case: false },
          {
            or: [
              { column: 'severity', operator: '>=', value: '3', ignore_case: false },
              { column: 'priority', operator: '=', value: 'high', ignore_case: true }
            ]
          }
        ]
      };

      const result = convertV1BEToV2(v1BEData);

      expect(result.logicalOperator).toBe('AND');
      expect(result.conditions).toHaveLength(2);

      // First is condition
      expect(result.conditions[0].filterType).toBe('condition');

      // Second is nested OR group
      // The nested group's logicalOperator is overridden to parent's "AND"
      expect(result.conditions[1].filterType).toBe('group');
      expect(result.conditions[1].logicalOperator).toBe('AND'); // Overridden from parent
    });

    it('should convert deeply nested V1 BE structure', () => {
      const v1BEData = {
        or: [
          { column: 'alert', operator: '=', value: 'true', ignore_case: false },
          {
            and: [
              { column: 'metric', operator: '>', value: '100', ignore_case: false },
              {
                or: [
                  { column: 'tag', operator: 'Contains', value: 'prod', ignore_case: true },
                  { column: 'tag', operator: 'Contains', value: 'staging', ignore_case: true }
                ]
              }
            ]
          }
        ]
      };

      const result = convertV1BEToV2(v1BEData);

      // Root group has 'or' key, so logicalOperator should be 'OR'
      expect(result.logicalOperator).toBe('OR');
      expect(result.conditions).toHaveLength(2);

      // conditions[0] is a condition
      expect(result.conditions[0].filterType).toBe('condition');

      // conditions[1] is a nested group with 'and' key
      // The nested group's logicalOperator is overridden to parent's "OR"
      expect(result.conditions[1].filterType).toBe('group');
      expect(result.conditions[1].logicalOperator).toBe('OR'); // Overridden from parent
      expect(result.conditions[1].conditions).toHaveLength(2);

      // conditions[1].conditions[1] is a deeply nested group with 'or' key
      // The nested group's logicalOperator is overridden to parent's "AND"
      expect(result.conditions[1].conditions[1].filterType).toBe('group');
      expect(result.conditions[1].conditions[1].logicalOperator).toBe('AND'); // Overridden from parent
      expect(result.conditions[1].conditions[1].conditions).toHaveLength(2);
    });

    it('should return as-is if already V2 format', () => {
      const v2Data = {
        filterType: 'group',
        logicalOperator: 'AND',
        conditions: []
      };

      const result = convertV1BEToV2(v2Data);

      expect(result).toBe(v2Data);
    });

    it('should handle null input', () => {
      const result = convertV1BEToV2(null);

      expect(result.filterType).toBe('group');
      expect(result.logicalOperator).toBe('AND');
      expect(result.conditions).toHaveLength(0);
    });

    it('should handle empty object', () => {
      const result = convertV1BEToV2({});

      expect(result.filterType).toBe('group');
      expect(result.logicalOperator).toBe('AND');
      expect(result.conditions).toHaveLength(0);
    });

    it('should generate ids for conditions without ids', () => {
      const v1BEData = {
        and: [
          { column: 'field', operator: '=', value: 'val', ignore_case: true }
        ]
      };

      const result = convertV1BEToV2(v1BEData);

      expect(result.conditions[0].id).toBe('mock-uuid-123');
    });

    it('should preserve existing ids from V1 BE conditions', () => {
      const v1BEData = {
        and: [
          { id: 'existing-id', column: 'field', operator: '=', value: 'val', ignore_case: true }
        ]
      };

      const result = convertV1BEToV2(v1BEData);

      expect(result.conditions[0].id).toBe('existing-id');
    });

    it('should generate groupId for the root group', () => {
      const v1BEData = {
        and: [
          { column: 'field', operator: '=', value: 'val' }
        ]
      };

      const result = convertV1BEToV2(v1BEData);

      expect(result.groupId).toBe('mock-uuid-123');
    });

    // ============================================================================
    // COMPREHENSIVE TEST SCENARIOS - User Query Conversion
    // These tests ensure the conversion is bulletproof for real user queries
    // ============================================================================

    describe('Complex Real-World Scenarios', () => {
      it('SCENARIO 1: Simple OR with two conditions', () => {
        // V1: job = 'sde' OR job = 'swe'
        const v1BEData = {
          or: [
            { column: 'job', operator: '=', value: 'sde', ignore_case: false },
            { column: 'job', operator: '=', value: 'swe', ignore_case: true }
          ]
        };

        const result = convertV1BEToV2(v1BEData);

        expect(result.logicalOperator).toBe('OR');
        expect(result.conditions).toHaveLength(2);
        expect(result.conditions[0].logicalOperator).toBe('OR');
        expect(result.conditions[1].logicalOperator).toBe('OR');
      });

      it('SCENARIO 2: OR with nested AND group (original user issue)', () => {
        // V1: job = 'sde' OR job = 'swe' OR (level >= 'senior' AND log = 'ontime')
        const v1BEData = {
          or: [
            { column: 'job', operator: '=', value: 'sde', ignore_case: false },
            { column: 'job', operator: '=', value: 'swe', ignore_case: true },
            {
              and: [
                { column: 'level', operator: '>=', value: 'senior', ignore_case: true },
                { column: 'log', operator: '=', value: 'ontime', ignore_case: true }
              ]
            }
          ]
        };

        const result = convertV1BEToV2(v1BEData);

        // Root level - all items should have OR
        expect(result.logicalOperator).toBe('OR');
        expect(result.conditions).toHaveLength(3);
        expect(result.conditions[0].logicalOperator).toBe('OR');
        expect(result.conditions[1].logicalOperator).toBe('OR');

        // Nested group should have logicalOperator set to parent's OR
        const nestedGroup = result.conditions[2] as any;
        expect(nestedGroup.filterType).toBe('group');
        expect(nestedGroup.logicalOperator).toBe('OR'); // Overridden from parent
        expect(nestedGroup.conditions).toHaveLength(2);

        // Inside nested group - items should have AND (the group's internal operator)
        expect(nestedGroup.conditions[0].logicalOperator).toBe('AND');
        expect(nestedGroup.conditions[1].logicalOperator).toBe('AND');
      });

      it('SCENARIO 3: OR with nested AND containing nested OR', () => {
        // V1: job = 'sde' OR job = 'swe' OR (level >= 'senior' AND log = 'ontime' AND (_timestamp = '12'))
        const v1BEData = {
          or: [
            { column: 'job', operator: '=', value: 'sde', ignore_case: false },
            { column: 'job', operator: '=', value: 'swe', ignore_case: true },
            {
              and: [
                { column: 'level', operator: '>=', value: 'senior', ignore_case: true },
                { column: 'log', operator: '=', value: 'ontime', ignore_case: true },
                {
                  or: [
                    { column: '_timestamp', operator: '=', value: '12', ignore_case: true }
                  ]
                }
              ]
            }
          ]
        };

        const result = convertV1BEToV2(v1BEData);

        // Root level
        expect(result.logicalOperator).toBe('OR');
        expect(result.conditions).toHaveLength(3);

        // First nested group (AND)
        const firstNestedGroup = result.conditions[2] as any;
        expect(firstNestedGroup.logicalOperator).toBe('OR'); // From parent
        expect(firstNestedGroup.conditions).toHaveLength(3);
        expect(firstNestedGroup.conditions[0].logicalOperator).toBe('AND');
        expect(firstNestedGroup.conditions[1].logicalOperator).toBe('AND');

        // Second nested group (OR inside AND)
        const secondNestedGroup = firstNestedGroup.conditions[2];
        expect(secondNestedGroup.logicalOperator).toBe('AND'); // From parent (the AND group)
        expect(secondNestedGroup.conditions).toHaveLength(1);
        expect(secondNestedGroup.conditions[0].logicalOperator).toBe('OR');
      });

      it('SCENARIO 4: AND with nested OR group', () => {
        // V1: env = 'prod' AND (severity = 'high' OR priority = 'urgent')
        const v1BEData = {
          and: [
            { column: 'env', operator: '=', value: 'prod', ignore_case: false },
            {
              or: [
                { column: 'severity', operator: '=', value: 'high', ignore_case: false },
                { column: 'priority', operator: '=', value: 'urgent', ignore_case: false }
              ]
            }
          ]
        };

        const result = convertV1BEToV2(v1BEData);

        expect(result.logicalOperator).toBe('AND');
        expect(result.conditions).toHaveLength(2);
        expect(result.conditions[0].logicalOperator).toBe('AND');

        // Nested OR group
        const nestedGroup = result.conditions[1] as any;
        expect(nestedGroup.logicalOperator).toBe('AND'); // From parent
        expect(nestedGroup.conditions[0].logicalOperator).toBe('OR');
        expect(nestedGroup.conditions[1].logicalOperator).toBe('OR');
      });

      it('SCENARIO 5: Multiple nested groups at same level', () => {
        // V1: (status = 'active' OR status = 'pending') AND (type = 'urgent' OR type = 'high')
        const v1BEData = {
          and: [
            {
              or: [
                { column: 'status', operator: '=', value: 'active', ignore_case: false },
                { column: 'status', operator: '=', value: 'pending', ignore_case: false }
              ]
            },
            {
              or: [
                { column: 'type', operator: '=', value: 'urgent', ignore_case: false },
                { column: 'type', operator: '=', value: 'high', ignore_case: false }
              ]
            }
          ]
        };

        const result = convertV1BEToV2(v1BEData);

        expect(result.logicalOperator).toBe('AND');
        expect(result.conditions).toHaveLength(2);

        // First nested OR group
        const firstGroup = result.conditions[0] as any;
        expect(firstGroup.logicalOperator).toBe('AND'); // From parent
        expect(firstGroup.conditions[0].logicalOperator).toBe('OR');
        expect(firstGroup.conditions[1].logicalOperator).toBe('OR');

        // Second nested OR group
        const secondGroup = result.conditions[1] as any;
        expect(secondGroup.logicalOperator).toBe('AND'); // From parent
        expect(secondGroup.conditions[0].logicalOperator).toBe('OR');
        expect(secondGroup.conditions[1].logicalOperator).toBe('OR');
      });

      it('SCENARIO 6: Single condition (no grouping)', () => {
        // V1: status = 'active'
        const v1BEData = {
          and: [
            { column: 'status', operator: '=', value: 'active', ignore_case: false }
          ]
        };

        const result = convertV1BEToV2(v1BEData);

        expect(result.logicalOperator).toBe('AND');
        expect(result.conditions).toHaveLength(1);
        expect(result.conditions[0].filterType).toBe('condition');
        expect(result.conditions[0].column).toBe('status');
      });

      it('SCENARIO 7: Deep nesting (4 levels)', () => {
        // V1: A OR (B AND (C OR (D AND E)))
        const v1BEData = {
          or: [
            { column: 'A', operator: '=', value: '1', ignore_case: false },
            {
              and: [
                { column: 'B', operator: '=', value: '2', ignore_case: false },
                {
                  or: [
                    { column: 'C', operator: '=', value: '3', ignore_case: false },
                    {
                      and: [
                        { column: 'D', operator: '=', value: '4', ignore_case: false },
                        { column: 'E', operator: '=', value: '5', ignore_case: false }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        };

        const result = convertV1BEToV2(v1BEData);

        // Root: OR
        expect(result.logicalOperator).toBe('OR');
        expect(result.conditions).toHaveLength(2);

        // Level 1: AND group (overridden to OR from parent)
        const level1 = result.conditions[1] as any;
        expect(level1.logicalOperator).toBe('OR');
        expect(level1.conditions[0].logicalOperator).toBe('AND');

        // Level 2: OR group (overridden to AND from parent)
        const level2 = level1.conditions[1] as any;
        expect(level2.logicalOperator).toBe('AND');
        expect(level2.conditions[0].logicalOperator).toBe('OR');

        // Level 3: AND group (overridden to OR from parent)
        const level3 = level2.conditions[1] as any;
        expect(level3.logicalOperator).toBe('OR');
        expect(level3.conditions[0].logicalOperator).toBe('AND');
        expect(level3.conditions[1].logicalOperator).toBe('AND');
      });

      it('SCENARIO 8: Complex real-world monitoring query', () => {
        // V1: (status = 'error' OR status = 'critical') AND
        //     (service = 'api' OR service = 'web') AND
        //     response_time > 1000
        const v1BEData = {
          and: [
            {
              or: [
                { column: 'status', operator: '=', value: 'error', ignore_case: false },
                { column: 'status', operator: '=', value: 'critical', ignore_case: false }
              ]
            },
            {
              or: [
                { column: 'service', operator: '=', value: 'api', ignore_case: false },
                { column: 'service', operator: '=', value: 'web', ignore_case: false }
              ]
            },
            { column: 'response_time', operator: '>', value: '1000', ignore_case: false }
          ]
        };

        const result = convertV1BEToV2(v1BEData);

        expect(result.logicalOperator).toBe('AND');
        expect(result.conditions).toHaveLength(3);

        // All items at root level should have AND
        expect(result.conditions[0].logicalOperator).toBe('AND');
        expect(result.conditions[1].logicalOperator).toBe('AND');
        expect(result.conditions[2].logicalOperator).toBe('AND');

        // Nested OR groups should be overridden to AND
        expect((result.conditions[0] as any).logicalOperator).toBe('AND');
        expect((result.conditions[1] as any).logicalOperator).toBe('AND');
      });

      it('SCENARIO 9: Mixed operators with special characters', () => {
        // V1: email Contains '@company.com' OR (role != 'guest' AND login_count >= 5)
        const v1BEData = {
          or: [
            { column: 'email', operator: 'Contains', value: '@company.com', ignore_case: true },
            {
              and: [
                { column: 'role', operator: '!=', value: 'guest', ignore_case: false },
                { column: 'login_count', operator: '>=', value: '5', ignore_case: false }
              ]
            }
          ]
        };

        const result = convertV1BEToV2(v1BEData);

        expect(result.logicalOperator).toBe('OR');
        expect(result.conditions[0].operator).toBe('Contains');
        expect(result.conditions[0].value).toBe('@company.com');

        const nestedGroup = result.conditions[1] as any;
        expect(nestedGroup.conditions[0].operator).toBe('!=');
        expect(nestedGroup.conditions[1].operator).toBe('>=');
      });

      it('SCENARIO 10: All conditions with ignore_case variations', () => {
        // V1: Various ignore_case combinations
        const v1BEData = {
          or: [
            { column: 'field1', operator: '=', value: 'val1', ignore_case: true },
            { column: 'field2', operator: '=', value: 'val2', ignore_case: false },
            {
              and: [
                { column: 'field3', operator: '=', value: 'val3', ignore_case: true },
                { column: 'field4', operator: '=', value: 'val4' } // missing ignore_case
              ]
            }
          ]
        };

        const result = convertV1BEToV2(v1BEData);

        // Verify all conditions are created
        expect(result.conditions).toHaveLength(3);

        // Verify nested group structure
        const nestedGroup = result.conditions[2] as any;
        expect(nestedGroup.conditions).toHaveLength(2);
      });

      it('SCENARIO 11: Empty arrays and edge cases', () => {
        // V1: Empty OR array
        const v1BEData = {
          or: []
        };

        const result = convertV1BEToV2(v1BEData);

        expect(result.logicalOperator).toBe('OR');
        expect(result.conditions).toHaveLength(0);
      });

      it('SCENARIO 12: Single nested group (no sibling conditions)', () => {
        // V1: Only a nested group, no sibling conditions
        const v1BEData = {
          or: [
            {
              and: [
                { column: 'field1', operator: '=', value: 'val1', ignore_case: false },
                { column: 'field2', operator: '=', value: 'val2', ignore_case: false }
              ]
            }
          ]
        };

        const result = convertV1BEToV2(v1BEData);

        expect(result.logicalOperator).toBe('OR');
        expect(result.conditions).toHaveLength(1);

        const nestedGroup = result.conditions[0] as any;
        expect(nestedGroup.filterType).toBe('group');
        expect(nestedGroup.logicalOperator).toBe('OR'); // From parent
        expect(nestedGroup.conditions[0].logicalOperator).toBe('AND');
        expect(nestedGroup.conditions[1].logicalOperator).toBe('AND');
      });

      it('SCENARIO 13: Only conditions (no nested groups)', () => {
        // V1: Multiple conditions, no groups
        // job = 'sde' OR job = 'swe' OR level >= 'senior'
        const v1BEData = {
          or: [
            { column: 'job', operator: '=', value: 'sde', ignore_case: false },
            { column: 'job', operator: '=', value: 'swe', ignore_case: true },
            { column: 'level', operator: '>=', value: 'senior', ignore_case: false }
          ]
        };

        const result = convertV1BEToV2(v1BEData);

        expect(result.logicalOperator).toBe('OR');
        expect(result.conditions).toHaveLength(3);

        // All should be conditions, no groups
        expect(result.conditions[0].filterType).toBe('condition');
        expect(result.conditions[0].column).toBe('job');
        expect(result.conditions[0].logicalOperator).toBe('OR');

        expect(result.conditions[1].filterType).toBe('condition');
        expect(result.conditions[1].column).toBe('job');
        expect(result.conditions[1].logicalOperator).toBe('OR');

        expect(result.conditions[2].filterType).toBe('condition');
        expect(result.conditions[2].column).toBe('level');
        expect(result.conditions[2].logicalOperator).toBe('OR');
      });

      it('SCENARIO 14: Only nested groups (no direct conditions)', () => {
        // V1: Multiple nested groups, no conditions at top level
        // (job = 'sde' AND level = 'senior') OR (status = 'active' AND type = 'urgent')
        const v1BEData = {
          or: [
            {
              and: [
                { column: 'job', operator: '=', value: 'sde', ignore_case: false },
                { column: 'level', operator: '=', value: 'senior', ignore_case: false }
              ]
            },
            {
              and: [
                { column: 'status', operator: '=', value: 'active', ignore_case: false },
                { column: 'type', operator: '=', value: 'urgent', ignore_case: false }
              ]
            }
          ]
        };

        const result = convertV1BEToV2(v1BEData);

        expect(result.logicalOperator).toBe('OR');
        expect(result.conditions).toHaveLength(2);

        // Both should be groups
        expect(result.conditions[0].filterType).toBe('group');
        expect(result.conditions[0].logicalOperator).toBe('OR'); // From parent
        expect((result.conditions[0] as any).conditions).toHaveLength(2);
        expect((result.conditions[0] as any).conditions[0].logicalOperator).toBe('AND');
        expect((result.conditions[0] as any).conditions[1].logicalOperator).toBe('AND');

        expect(result.conditions[1].filterType).toBe('group');
        expect(result.conditions[1].logicalOperator).toBe('OR'); // From parent
        expect((result.conditions[1] as any).conditions).toHaveLength(2);
        expect((result.conditions[1] as any).conditions[0].logicalOperator).toBe('AND');
        expect((result.conditions[1] as any).conditions[1].logicalOperator).toBe('AND');
      });

      it('SCENARIO 15: Group then condition', () => {
        // V1: Group first, then condition
        // (job = 'sde' AND level = 'senior') OR status = 'active'
        const v1BEData = {
          or: [
            {
              and: [
                { column: 'job', operator: '=', value: 'sde', ignore_case: false },
                { column: 'level', operator: '=', value: 'senior', ignore_case: false }
              ]
            },
            { column: 'status', operator: '=', value: 'active', ignore_case: false }
          ]
        };

        const result = convertV1BEToV2(v1BEData);

        expect(result.logicalOperator).toBe('OR');
        expect(result.conditions).toHaveLength(2);

        // First should be group
        expect(result.conditions[0].filterType).toBe('group');
        expect(result.conditions[0].logicalOperator).toBe('OR');

        // Second should be condition
        expect(result.conditions[1].filterType).toBe('condition');
        expect(result.conditions[1].column).toBe('status');
        expect(result.conditions[1].logicalOperator).toBe('OR');
      });

      it('SCENARIO 16: Condition then group then condition', () => {
        // V1: condition, group, condition pattern
        // job = 'sde' OR (level = 'senior' AND type = 'urgent') OR status = 'active'
        const v1BEData = {
          or: [
            { column: 'job', operator: '=', value: 'sde', ignore_case: false },
            {
              and: [
                { column: 'level', operator: '=', value: 'senior', ignore_case: false },
                { column: 'type', operator: '=', value: 'urgent', ignore_case: false }
              ]
            },
            { column: 'status', operator: '=', value: 'active', ignore_case: false }
          ]
        };

        const result = convertV1BEToV2(v1BEData);

        expect(result.logicalOperator).toBe('OR');
        expect(result.conditions).toHaveLength(3);

        // First: condition
        expect(result.conditions[0].filterType).toBe('condition');
        expect(result.conditions[0].column).toBe('job');
        expect(result.conditions[0].logicalOperator).toBe('OR');

        // Second: group
        expect(result.conditions[1].filterType).toBe('group');
        expect(result.conditions[1].logicalOperator).toBe('OR'); // From parent

        // Third: condition
        expect(result.conditions[2].filterType).toBe('condition');
        expect(result.conditions[2].column).toBe('status');
        expect(result.conditions[2].logicalOperator).toBe('OR');
      });

      it('SCENARIO 17: Multiple groups interspersed with conditions', () => {
        // V1: Complex pattern: cond, group, cond, group, cond
        // A OR (B AND C) OR D OR (E AND F) OR G
        const v1BEData = {
          or: [
            { column: 'A', operator: '=', value: '1', ignore_case: false },
            {
              and: [
                { column: 'B', operator: '=', value: '2', ignore_case: false },
                { column: 'C', operator: '=', value: '3', ignore_case: false }
              ]
            },
            { column: 'D', operator: '=', value: '4', ignore_case: false },
            {
              and: [
                { column: 'E', operator: '=', value: '5', ignore_case: false },
                { column: 'F', operator: '=', value: '6', ignore_case: false }
              ]
            },
            { column: 'G', operator: '=', value: '7', ignore_case: false }
          ]
        };

        const result = convertV1BEToV2(v1BEData);

        expect(result.logicalOperator).toBe('OR');
        expect(result.conditions).toHaveLength(5);

        // Check pattern: cond, group, cond, group, cond
        expect(result.conditions[0].filterType).toBe('condition');
        expect(result.conditions[0].logicalOperator).toBe('OR');

        expect(result.conditions[1].filterType).toBe('group');
        expect(result.conditions[1].logicalOperator).toBe('OR');

        expect(result.conditions[2].filterType).toBe('condition');
        expect(result.conditions[2].logicalOperator).toBe('OR');

        expect(result.conditions[3].filterType).toBe('group');
        expect(result.conditions[3].logicalOperator).toBe('OR');

        expect(result.conditions[4].filterType).toBe('condition');
        expect(result.conditions[4].logicalOperator).toBe('OR');
      });

      it('SCENARIO 18: AND with only groups', () => {
        // V1: AND with multiple nested OR groups
        // (status = 'active' OR status = 'pending') AND (type = 'urgent' OR type = 'high') AND (level = 'critical' OR level = 'error')
        const v1BEData = {
          and: [
            {
              or: [
                { column: 'status', operator: '=', value: 'active', ignore_case: false },
                { column: 'status', operator: '=', value: 'pending', ignore_case: false }
              ]
            },
            {
              or: [
                { column: 'type', operator: '=', value: 'urgent', ignore_case: false },
                { column: 'type', operator: '=', value: 'high', ignore_case: false }
              ]
            },
            {
              or: [
                { column: 'level', operator: '=', value: 'critical', ignore_case: false },
                { column: 'level', operator: '=', value: 'error', ignore_case: false }
              ]
            }
          ]
        };

        const result = convertV1BEToV2(v1BEData);

        expect(result.logicalOperator).toBe('AND');
        expect(result.conditions).toHaveLength(3);

        // All should be groups with AND from parent
        result.conditions.forEach((item: any) => {
          expect(item.filterType).toBe('group');
          expect(item.logicalOperator).toBe('AND'); // From parent
          expect(item.conditions).toHaveLength(2);
          expect(item.conditions[0].logicalOperator).toBe('OR'); // Internal
          expect(item.conditions[1].logicalOperator).toBe('OR'); // Internal
        });
      });

      it('SCENARIO 19: Alternating pattern with different depths', () => {
        // V1: Complex alternating with nested depth
        // A AND (B OR C) AND D AND (E OR (F AND G))
        const v1BEData = {
          and: [
            { column: 'A', operator: '=', value: '1', ignore_case: false },
            {
              or: [
                { column: 'B', operator: '=', value: '2', ignore_case: false },
                { column: 'C', operator: '=', value: '3', ignore_case: false }
              ]
            },
            { column: 'D', operator: '=', value: '4', ignore_case: false },
            {
              or: [
                { column: 'E', operator: '=', value: '5', ignore_case: false },
                {
                  and: [
                    { column: 'F', operator: '=', value: '6', ignore_case: false },
                    { column: 'G', operator: '=', value: '7', ignore_case: false }
                  ]
                }
              ]
            }
          ]
        };

        const result = convertV1BEToV2(v1BEData);

        expect(result.logicalOperator).toBe('AND');
        expect(result.conditions).toHaveLength(4);

        // Pattern: cond, group, cond, group
        expect(result.conditions[0].filterType).toBe('condition');
        expect(result.conditions[1].filterType).toBe('group');
        expect(result.conditions[2].filterType).toBe('condition');
        expect(result.conditions[3].filterType).toBe('group');

        // Check deeply nested group
        const deepGroup = result.conditions[3] as any;
        expect(deepGroup.conditions).toHaveLength(2);
        expect(deepGroup.conditions[0].filterType).toBe('condition');
        expect(deepGroup.conditions[1].filterType).toBe('group');
        expect(deepGroup.conditions[1].logicalOperator).toBe('OR'); // From parent OR group
      });

      it('SCENARIO 20: Three consecutive groups', () => {
        // V1: Three groups in a row
        // (A AND B) OR (C AND D) OR (E AND F)
        const v1BEData = {
          or: [
            {
              and: [
                { column: 'A', operator: '=', value: '1', ignore_case: false },
                { column: 'B', operator: '=', value: '2', ignore_case: false }
              ]
            },
            {
              and: [
                { column: 'C', operator: '=', value: '3', ignore_case: false },
                { column: 'D', operator: '=', value: '4', ignore_case: false }
              ]
            },
            {
              and: [
                { column: 'E', operator: '=', value: '5', ignore_case: false },
                { column: 'F', operator: '=', value: '6', ignore_case: false }
              ]
            }
          ]
        };

        const result = convertV1BEToV2(v1BEData);

        expect(result.logicalOperator).toBe('OR');
        expect(result.conditions).toHaveLength(3);

        // All should be groups
        result.conditions.forEach((item: any) => {
          expect(item.filterType).toBe('group');
          expect(item.logicalOperator).toBe('OR'); // From parent
          expect(item.conditions).toHaveLength(2);
          expect(item.conditions[0].logicalOperator).toBe('AND');
          expect(item.conditions[1].logicalOperator).toBe('AND');
        });
      });
    });
  });

  describe('ensureIds', () => {
    it('should add groupId to group without one', () => {
      const data = {
        filterType: 'group',
        logicalOperator: 'AND',
        conditions: []
      };

      const result = ensureIds(data);

      expect(result.groupId).toBe('mock-uuid-123');
    });

    it('should preserve existing groupId', () => {
      const data = {
        filterType: 'group',
        logicalOperator: 'AND',
        conditions: [],
        groupId: 'existing-group-id'
      };

      const result = ensureIds(data);

      expect(result.groupId).toBe('existing-group-id');
    });

    it('should add id to condition without one', () => {
      const data = {
        filterType: 'group',
        logicalOperator: 'AND',
        conditions: [
          {
            filterType: 'condition',
            column: 'status',
            operator: '=',
            value: 'active'
          }
        ]
      };

      const result = ensureIds(data);

      expect(result.conditions[0].id).toBe('mock-uuid-123');
    });

    it('should preserve existing condition ids', () => {
      const data = {
        filterType: 'group',
        logicalOperator: 'AND',
        conditions: [
          {
            id: 'existing-id',
            filterType: 'condition',
            column: 'status',
            operator: '=',
            value: 'active'
          }
        ]
      };

      const result = ensureIds(data);

      expect(result.conditions[0].id).toBe('existing-id');
    });

    it('should recursively add ids to nested groups', () => {
      const data = {
        filterType: 'group',
        logicalOperator: 'AND',
        conditions: [
          {
            filterType: 'condition',
            column: 'env',
            operator: '=',
            value: 'prod'
          },
          {
            filterType: 'group',
            logicalOperator: 'OR',
            conditions: [
              {
                filterType: 'condition',
                column: 'level',
                operator: '=',
                value: 'error'
              }
            ]
          }
        ]
      };

      const result = ensureIds(data);

      expect(result.groupId).toBe('mock-uuid-123');
      expect(result.conditions[0].id).toBe('mock-uuid-123');
      expect(result.conditions[1].groupId).toBe('mock-uuid-123');
      expect(result.conditions[1].conditions[0].id).toBe('mock-uuid-123');
    });

    it('should handle deeply nested structure (3 levels)', () => {
      const data = {
        filterType: 'group',
        logicalOperator: 'AND',
        conditions: [
          {
            filterType: 'group',
            logicalOperator: 'OR',
            conditions: [
              {
                filterType: 'group',
                logicalOperator: 'AND',
                conditions: [
                  {
                    filterType: 'condition',
                    column: 'deep',
                    operator: '=',
                    value: 'value'
                  }
                ]
              }
            ]
          }
        ]
      };

      const result = ensureIds(data);

      // Root group
      expect(result.groupId).toBeDefined();
      // Level 1 group
      expect(result.conditions[0].groupId).toBeDefined();
      // Level 2 group
      expect(result.conditions[0].conditions[0].groupId).toBeDefined();
      // Level 3 condition
      expect(result.conditions[0].conditions[0].conditions[0].id).toBeDefined();
    });

    it('should handle null input', () => {
      const result = ensureIds(null);

      expect(result).toBeNull();
    });

    it('should handle undefined input', () => {
      const result = ensureIds(undefined);

      expect(result).toBeUndefined();
    });

    it('should handle group with null conditions', () => {
      const data = {
        filterType: 'group',
        logicalOperator: 'AND',
        conditions: null
      };

      const result = ensureIds(data);

      expect(result.groupId).toBe('mock-uuid-123');
      expect(result.conditions).toBeNull();
    });

    it('should handle group with undefined conditions', () => {
      const data = {
        filterType: 'group',
        logicalOperator: 'AND'
      };

      const result = ensureIds(data);

      expect(result.groupId).toBe('mock-uuid-123');
    });

    it('should handle mixed conditions with and without ids', () => {
      const data = {
        filterType: 'group',
        logicalOperator: 'AND',
        conditions: [
          {
            id: 'has-id',
            filterType: 'condition',
            column: 'a',
            operator: '=',
            value: '1'
          },
          {
            filterType: 'condition',
            column: 'b',
            operator: '=',
            value: '2'
          },
          {
            id: 'has-id-2',
            filterType: 'condition',
            column: 'c',
            operator: '=',
            value: '3'
          }
        ]
      };

      const result = ensureIds(data);

      expect(result.conditions[0].id).toBe('has-id');
      expect(result.conditions[1].id).toBe('mock-uuid-123');
      expect(result.conditions[2].id).toBe('has-id-2');
    });
  });

  describe('updateGroup - V2 Structure', () => {
    it('should update root V2 group', () => {
      const context: TransformContext = {
        formData: {
          query_condition: {
            conditions: {
              filterType: 'group',
              logicalOperator: 'AND',
              groupId: 'root',
              conditions: [
                {
                  filterType: 'condition',
                  column: 'old',
                  operator: '=',
                  value: 'value',
                  logicalOperator: 'AND',
                  id: '1'
                }
              ]
            }
          }
        }
      };

      const updatedGroup = {
        filterType: 'group',
        logicalOperator: 'OR',
        groupId: 'root',
        conditions: [
          {
            filterType: 'condition',
            column: 'new',
            operator: '!=',
            value: 'updated',
            logicalOperator: 'OR',
            id: '2'
          }
        ]
      };

      updateGroup(updatedGroup, context);

      expect(context.formData.query_condition.conditions.logicalOperator).toBe('OR');
      expect(context.formData.query_condition.conditions.conditions[0].column).toBe('new');
    });

    it('should update nested V2 group', () => {
      const context: TransformContext = {
        formData: {
          query_condition: {
            conditions: {
              filterType: 'group',
              logicalOperator: 'AND',
              groupId: 'root',
              conditions: [
                {
                  filterType: 'condition',
                  column: 'base',
                  operator: '=',
                  value: 'test',
                  logicalOperator: 'AND',
                  id: '1'
                },
                {
                  filterType: 'group',
                  logicalOperator: 'OR',
                  groupId: 'nested',
                  conditions: [
                    {
                      filterType: 'condition',
                      column: 'old',
                      operator: '=',
                      value: 'value',
                      logicalOperator: 'OR',
                      id: '2'
                    }
                  ]
                }
              ]
            }
          }
        }
      };

      const updatedGroup = {
        filterType: 'group',
        logicalOperator: 'OR',
        groupId: 'nested',
        conditions: [
          {
            filterType: 'condition',
            column: 'new',
            operator: '!=',
            value: 'updated',
            logicalOperator: 'OR',
            id: '3'
          }
        ]
      };

      updateGroup(updatedGroup, context);

      const nestedGroup = context.formData.query_condition.conditions.conditions[1];
      expect(nestedGroup.conditions[0].column).toBe('new');
      expect(nestedGroup.conditions[0].value).toBe('updated');
    });

    it('should handle deeply nested V2 update (3 levels)', () => {
      const context: TransformContext = {
        formData: {
          query_condition: {
            conditions: {
              filterType: 'group',
              logicalOperator: 'AND',
              groupId: 'root',
              conditions: [
                {
                  filterType: 'group',
                  logicalOperator: 'OR',
                  groupId: 'level-1',
                  conditions: [
                    {
                      filterType: 'group',
                      logicalOperator: 'AND',
                      groupId: 'level-2-target',
                      conditions: [
                        {
                          filterType: 'condition',
                          column: 'old',
                          operator: '=',
                          value: 'old',
                          logicalOperator: 'AND',
                          id: '1'
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          }
        }
      };

      const updatedGroup = {
        filterType: 'group',
        logicalOperator: 'AND',
        groupId: 'level-2-target',
        conditions: [
          {
            filterType: 'condition',
            column: 'new',
            operator: '=',
            value: 'new',
            logicalOperator: 'AND',
            id: '2'
          }
        ]
      };

      updateGroup(updatedGroup, context);

      const deepGroup = context.formData.query_condition.conditions.conditions[0].conditions[0];
      expect(deepGroup.conditions[0].column).toBe('new');
      expect(deepGroup.conditions[0].value).toBe('new');
    });

    it('should handle V2 group with multiple conditions', () => {
      const context: TransformContext = {
        formData: {
          query_condition: {
            conditions: {
              filterType: 'group',
              logicalOperator: 'AND',
              groupId: 'root',
              conditions: [
                {
                  filterType: 'group',
                  logicalOperator: 'OR',
                  groupId: 'target',
                  conditions: []
                }
              ]
            }
          }
        }
      };

      const updatedGroup = {
        filterType: 'group',
        logicalOperator: 'OR',
        groupId: 'target',
        conditions: [
          {
            filterType: 'condition',
            column: 'a',
            operator: '=',
            value: '1',
            logicalOperator: 'OR',
            id: '1'
          },
          {
            filterType: 'condition',
            column: 'b',
            operator: '=',
            value: '2',
            logicalOperator: 'OR',
            id: '2'
          },
          {
            filterType: 'condition',
            column: 'c',
            operator: '=',
            value: '3',
            logicalOperator: 'OR',
            id: '3'
          }
        ]
      };

      updateGroup(updatedGroup, context);

      const targetGroup = context.formData.query_condition.conditions.conditions[0];
      expect(targetGroup.conditions).toHaveLength(3);
    });
  });

  describe('removeConditionGroup - V2 Structure', () => {
    it('should remove V2 condition from root group', () => {
      const context: TransformContext = {
        formData: {
          query_condition: {
            conditions: {
              filterType: 'group',
              logicalOperator: 'AND',
              groupId: 'root',
              conditions: [
                {
                  filterType: 'condition',
                  column: 'keep',
                  operator: '=',
                  value: 'this',
                  logicalOperator: 'AND',
                  id: 'keep-id'
                },
                {
                  filterType: 'group',
                  logicalOperator: 'OR',
                  groupId: 'remove-this',
                  conditions: []
                }
              ]
            }
          }
        }
      };

      removeConditionGroup('remove-this', null, context);

      expect(context.formData.query_condition.conditions.conditions).toHaveLength(1);
      expect(context.formData.query_condition.conditions.conditions[0].id).toBe('keep-id');
    });

    it('should remove nested V2 group', () => {
      const context: TransformContext = {
        formData: {
          query_condition: {
            conditions: {
              filterType: 'group',
              logicalOperator: 'AND',
              groupId: 'root',
              conditions: [
                {
                  filterType: 'group',
                  logicalOperator: 'OR',
                  groupId: 'parent',
                  conditions: [
                    {
                      filterType: 'condition',
                      column: 'keep',
                      operator: '=',
                      value: 'keep',
                      logicalOperator: 'OR',
                      id: 'keep-id'
                    },
                    {
                      filterType: 'group',
                      logicalOperator: 'AND',
                      groupId: 'remove-nested',
                      conditions: []
                    }
                  ]
                }
              ]
            }
          }
        }
      };

      removeConditionGroup('remove-nested', null, context);

      const parentGroup = context.formData.query_condition.conditions.conditions[0];
      expect(parentGroup.conditions).toHaveLength(1);
      expect(parentGroup.conditions[0].id).toBe('keep-id');
    });

    it('should remove empty parent groups after nested removal', () => {
      const context: TransformContext = {
        formData: {
          query_condition: {
            conditions: {
              filterType: 'group',
              logicalOperator: 'AND',
              groupId: 'root',
              conditions: [
                {
                  filterType: 'group',
                  logicalOperator: 'OR',
                  groupId: 'parent',
                  conditions: [
                    {
                      filterType: 'group',
                      logicalOperator: 'AND',
                      groupId: 'only-child-remove',
                      conditions: []
                    }
                  ]
                }
              ]
            }
          }
        }
      };

      removeConditionGroup('only-child-remove', null, context);

      // Parent group should be removed since it's now empty
      expect(context.formData.query_condition.conditions.conditions).toHaveLength(0);
    });

    it('should handle removing from deeply nested V2 structure', () => {
      const context: TransformContext = {
        formData: {
          query_condition: {
            conditions: {
              filterType: 'group',
              logicalOperator: 'AND',
              groupId: 'root',
              conditions: [
                {
                  filterType: 'group',
                  logicalOperator: 'OR',
                  groupId: 'level-1',
                  conditions: [
                    {
                      filterType: 'condition',
                      column: 'keep',
                      operator: '=',
                      value: 'keep',
                      logicalOperator: 'OR',
                      id: 'keep-id'
                    },
                    {
                      filterType: 'group',
                      logicalOperator: 'AND',
                      groupId: 'level-2',
                      conditions: [
                        {
                          filterType: 'group',
                          logicalOperator: 'OR',
                          groupId: 'level-3-remove',
                          conditions: []
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          }
        }
      };

      removeConditionGroup('level-3-remove', null, context);

      const level1 = context.formData.query_condition.conditions.conditions[0];
      // level-2 should be removed since it's now empty
      expect(level1.conditions).toHaveLength(1);
      expect(level1.conditions[0].id).toBe('keep-id');
    });
  });

  describe('V2 Integration Tests', () => {
    it('should convert V0 to V2 and ensure all ids', () => {
      const v0Data = [
        { column: 'status', operator: '=', value: 'active' },
        { column: 'type', operator: '!=', value: 'test' }
      ];

      const v2Data = convertV0ToV2(v0Data);
      const withIds = ensureIds(v2Data);

      expect(withIds.groupId).toBeDefined();
      expect(withIds.conditions[0].id).toBeDefined();
      expect(withIds.conditions[1].id).toBeDefined();
    });

    it('should convert V1 FE to V2 and ensure all ids for nested structure', () => {
      const v1Data = {
        label: 'and',
        items: [
          { column: 'env', operator: '=', value: 'prod' },
          {
            label: 'or',
            items: [
              { column: 'level', operator: '=', value: 'error' },
              { column: 'level', operator: '=', value: 'critical' }
            ]
          }
        ]
      };

      const v2Data = convertV1ToV2(v1Data);
      const withIds = ensureIds(v2Data);

      expect(withIds.groupId).toBeDefined();
      expect(withIds.conditions[0].id).toBeDefined();
      expect(withIds.conditions[1].groupId).toBeDefined();
      expect(withIds.conditions[1].conditions[0].id).toBeDefined();
      expect(withIds.conditions[1].conditions[1].id).toBeDefined();
    });

    it('should convert V1 BE to V2 and ensure all ids', () => {
      const v1BEData = {
        and: [
          { column: 'env', operator: '=', value: 'prod', ignore_case: false },
          {
            or: [
              { column: 'severity', operator: '>=', value: '3', ignore_case: false },
              { column: 'priority', operator: '=', value: 'high', ignore_case: true }
            ]
          }
        ]
      };

      const v2Data = convertV1BEToV2(v1BEData);
      const withIds = ensureIds(v2Data);

      expect(withIds.groupId).toBeDefined();
      expect(withIds.conditions[0].id).toBeDefined();
      expect(withIds.conditions[1].groupId).toBeDefined();
      expect(withIds.conditions[1].conditions[0].id).toBeDefined();
      expect(withIds.conditions[1].conditions[1].id).toBeDefined();
    });

    it('should detect version, convert, and ensure ids in complete flow', () => {
      const v1Data = {
        and: [
          { column: 'status', operator: '=', value: 'active', ignore_case: true }
        ]
      };

      const version = detectConditionsVersion(v1Data);
      expect(version).toBe(1);

      const v2Data = convertV1BEToV2(v1Data);
      expect(v2Data.filterType).toBe('group');

      const withIds = ensureIds(v2Data);
      expect(withIds.groupId).toBeDefined();
      expect(withIds.conditions[0].id).toBeDefined();
    });

    it('should handle complete CRUD flow with V2 structure', () => {
      // Create initial V2 structure
      const context: TransformContext = {
        formData: {
          query_condition: {
            conditions: ensureIds({
              filterType: 'group',
              logicalOperator: 'AND',
              conditions: [
                {
                  filterType: 'condition',
                  column: 'status',
                  operator: '=',
                  value: 'active',
                  logicalOperator: 'AND'
                }
              ]
            })
          }
        }
      };

      // Update: Add nested group
      const updatedRoot = {
        ...context.formData.query_condition.conditions,
        conditions: [
          ...context.formData.query_condition.conditions.conditions,
          ensureIds({
            filterType: 'group',
            logicalOperator: 'OR',
            groupId: 'new-group',
            conditions: [
              {
                filterType: 'condition',
                column: 'type',
                operator: '=',
                value: 'error',
                logicalOperator: 'OR'
              }
            ]
          })
        ]
      };

      updateGroup(updatedRoot, context);

      expect(context.formData.query_condition.conditions.conditions).toHaveLength(2);

      // Delete: Remove the nested group
      removeConditionGroup('new-group', null, context);

      expect(context.formData.query_condition.conditions.conditions).toHaveLength(1);
    });
  });
});
