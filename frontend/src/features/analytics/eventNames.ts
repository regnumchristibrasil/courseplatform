// Frozen client event list from the spec's "PostHog event names (frozen)"
// section. Typed as a union so `capture()` call sites can't typo an event
// name — the compiler enforces using only these names.
export const CLIENT_EVENT_NAMES = [
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
] as const

export type ClientEventName = (typeof CLIENT_EVENT_NAMES)[number]
