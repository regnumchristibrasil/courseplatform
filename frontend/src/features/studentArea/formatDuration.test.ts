import { describe, expect, it } from 'vitest'
import { formatDuration } from './formatDuration'

describe('formatDuration', () => {
  it.each([
    [null, ''],
    [0, ''],
    [20, '1min'],
    [300, '5min'],
    [3600, '1h'],
    [3900, '1h 05min'],
    [7385, '2h 03min'],
  ])('formats %s seconds as "%s"', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected)
  })
})
