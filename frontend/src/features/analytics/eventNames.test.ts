import { describe, expect, it } from 'vitest'
import { CLIENT_EVENT_NAMES } from './eventNames'

describe('CLIENT_EVENT_NAMES', () => {
  it('matches the frozen client event list from the spec exactly', () => {
    expect(CLIENT_EVENT_NAMES).toEqual([
      'catalog_viewed',
      'course_viewed',
      'checkout_started',
      'checkout_pix_displayed',
      'checkout_completed',
      'video_played',
      'video_resolve_failed',
      'signup_started',
      'signup_completed',
      'login_completed',
    ])
  })
})
