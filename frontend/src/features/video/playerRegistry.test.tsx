import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ResolvedVideo } from '../../contracts/video'
import { resolvePlayerElement } from './playerRegistry'

describe('resolvePlayerElement', () => {
  it('renders the YouTube player for playerKind "youtube"', () => {
    const video: ResolvedVideo = { playerKind: 'youtube', videoId: 'abc123', expiresAt: null }

    render(<>{resolvePlayerElement(video)}</>)

    const iframe = screen.getByTitle(/aula/i)
    expect(iframe).toHaveAttribute('src', expect.stringContaining('abc123'))
  })

  it('renders a clearly marked stub for playerKind "panda", never blank', () => {
    const video: ResolvedVideo = {
      playerKind: 'panda',
      embedUrl: 'https://panda.example/embed/xyz',
      expiresAt: '2026-01-01T00:00:00.000Z',
    }

    render(<>{resolvePlayerElement(video)}</>)

    expect(screen.getByTestId('panda-player-stub')).toBeInTheDocument()
    expect(screen.getByTestId('panda-player-stub')).not.toBeEmptyDOMElement()
  })

  it('throws loudly instead of silently rendering blank for an unhandled playerKind', () => {
    const bogusVideo = { playerKind: 'vimeo' } as unknown as ResolvedVideo

    expect(() => resolvePlayerElement(bogusVideo)).toThrow(/vimeo/)
  })
})
