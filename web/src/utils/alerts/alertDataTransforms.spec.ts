import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  transformFEToBE,
  retransformBEToFE,
  updateGroup,
  removeConditionGroup,
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
