import { describe, expect, it } from 'vitest'
import { parseVideoRef, VIDEO_REF_CASES } from './videoRef'

// Same table as backend/contracts/videoRef.test.ts and the pgTAP test a33:
// the three parsers (this one, the Deno copy, SQL) must agree on every case.
describe('parseVideoRef shared cases', () => {
  it.each(VIDEO_REF_CASES.map((c) => [JSON.stringify(c.input), c] as const))('%s', (_label, { input, expected }) => {
    expect(parseVideoRef(input)).toEqual(expected)
  })
})
