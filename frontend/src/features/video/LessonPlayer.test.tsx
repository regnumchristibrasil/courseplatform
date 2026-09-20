import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ResolvedVideo } from '../../contracts/video'
import { LessonPlayer } from './LessonPlayer'

describe('LessonPlayer', () => {
  it('renders the youtube branch for a youtube ResolvedVideo', () => {
    const video: ResolvedVideo = { playerKind: 'youtube', videoId: 'abc123', expiresAt: null }
    render(<LessonPlayer video={video} />)

    expect(screen.getByTitle(/aula/i)).toHaveAttribute(
      'src',
      'https://www.youtube-nocookie.com/embed/abc123',
    )
  })

  it('renders the panda stub for a panda ResolvedVideo', () => {
    const video: ResolvedVideo = {
      playerKind: 'panda',
      embedUrl: 'https://panda.example/embed/xyz',
      expiresAt: '2026-01-01T00:00:00.000Z',
    }
    render(<LessonPlayer video={video} />)

    expect(screen.getByTestId('panda-player-stub')).toBeInTheDocument()
  })
})
