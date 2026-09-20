import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConsentBanner } from './ConsentBanner'

describe('ConsentBanner', () => {
  it('explains what is collected and why, per LGPD', () => {
    render(<ConsentBanner onAccept={vi.fn()} onDecline={vi.fn()} />)
    expect(screen.getByText(/LGPD/i)).toBeInTheDocument()
  })

  it('calls onAccept when the user accepts', async () => {
    const user = userEvent.setup()
    const onAccept = vi.fn()
    render(<ConsentBanner onAccept={onAccept} onDecline={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /aceitar/i }))

    expect(onAccept).toHaveBeenCalledTimes(1)
  })

  it('calls onDecline when the user declines', async () => {
    const user = userEvent.setup()
    const onDecline = vi.fn()
    render(<ConsentBanner onAccept={vi.fn()} onDecline={onDecline} />)

    await user.click(screen.getByRole('button', { name: /recusar/i }))

    expect(onDecline).toHaveBeenCalledTimes(1)
  })
})
