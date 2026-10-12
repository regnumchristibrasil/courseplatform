/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync('src/index.css', 'utf8')

function tokenValue(name: string): string | undefined {
  return new RegExp(`${name}:\\s*([^;]+);`).exec(css)?.[1]?.trim()
}

describe('brand tokens (docs/ui/ui-specification.md section 4)', () => {
  it.each([
    ['--color-brand', '#91152b'],
    ['--color-brand-strong', '#941a2c'],
    ['--color-brand-web', '#990000'],
    ['--color-ink', '#474b50'],
    ['--color-ink-strong', '#000000'],
    ['--color-surface', '#ffffff'],
    ['--color-surface-muted', '#f2f2f2'],
    ['--color-line', '#d4d4d4'],
    ['--color-ink-soft', '#8f8f8f'],
  ])('defines %s as %s', (name, value) => {
    expect(tokenValue(name)).toBe(value)
  })

  it('defines the Helvetica Neue font stack', () => {
    expect(tokenValue('--font-sans')).toBe("'Helvetica Neue', Helvetica, Arial, sans-serif")
  })

  it('draws a visible focus ring in the brand color', () => {
    expect(css).toMatch(/:focus-visible\s*{[^}]*outline:\s*2px solid var\(--color-brand\)/)
  })
})
