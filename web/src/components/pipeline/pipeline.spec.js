import { describe, it, expect } from 'vitest'
import { sanitizeStreamName } from './utils/pipelineCommonValidation'

describe('sanitizeStreamName', () => {
  it('should convert special characters to underscores in a simple stream name', () => {
    const input = 'example-stream@name'
    const expected = 'example_stream_name'
    expect(sanitizeStreamName(input)).toBe(expected)
  })

  it('should preserve dynamic parts within curly braces', () => {
    const input = '{dynamic_stream_name_output}'
    const expected = '{dynamic_stream_name_output}'
    expect(sanitizeStreamName(input)).toBe(expected)
  })

  it('should handle mixed static and dynamic parts', () => {
    const input = 'someprefix{stream_name}somesuffix'
    const expected = 'someprefix{stream_name}somesuffix'
    expect(sanitizeStreamName(input)).toBe(expected)
  })

  it('should not process stream names longer than 100 characters', () => {
    const longInput = 'a'.repeat(101)
    expect(sanitizeStreamName(longInput)).toBe('')
  })

  it('should return null for empty or whitespace-only stream names', () => {
    expect(sanitizeStreamName('')).toBe('')
  })
})
