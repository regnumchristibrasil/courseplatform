// Shared HTML building blocks for transactional email templates.
//
// Inline styles only, deliberately: email clients don't reliably support
// `<style>` blocks or external CSS, so any styling must live on `style="..."`
// attributes. This is a real email-HTML constraint, not a stylistic choice.
// Kept as a plain, readable layout -- this is not a design task.

import type { EmailBrandContext } from '../types.ts';

// All dynamic content interpolated into HTML must be escaped -- template
// inputs come from `public.users`/`public.courses` data (user-editable, in
// `full_name`'s case), so treat them as untrusted per this repo's "never
// trust external data" convention.
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface EmailLayoutInput {
  readonly heading: string;
  // Caller-composed inner HTML (paragraphs) -- callers are responsible for
  // escaping any dynamic values they interpolate before passing this in.
  readonly bodyHtml: string;
  readonly ctaLabel?: string;
  readonly ctaUrl?: string;
  readonly brand: EmailBrandContext;
}

function renderCta(ctaLabel: string | undefined, ctaUrl: string | undefined): string {
  if (!ctaLabel || !ctaUrl) return '';
  return `<p style="margin:24px 0 0 0;">` +
    `<a href="${escapeHtml(ctaUrl)}" ` +
    `style="display:inline-block;background-color:#2563eb;color:#ffffff;` +
    `padding:12px 20px;border-radius:6px;text-decoration:none;` +
    `font-family:Arial,Helvetica,sans-serif;font-size:14px;">` +
    `${escapeHtml(ctaLabel)}</a></p>`;
}

export function renderEmailLayout(input: EmailLayoutInput): string {
  const { brand } = input;
  const cta = renderCta(input.ctaLabel, input.ctaUrl);

  return `<!DOCTYPE html>
<html lang="pt-BR">
  <body style="margin:0;padding:0;background-color:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" style="max-width:600px;margin:0 auto;padding:24px 0;">
      <tr>
        <td style="background-color:#ffffff;padding:32px;border-radius:8px;">
          <h1 style="font-size:20px;color:#111827;margin:0 0 16px 0;">${
    escapeHtml(input.heading)
  }</h1>
          <div style="font-size:14px;color:#374151;line-height:1.6;">${input.bodyHtml}</div>
          ${cta}
          <p style="font-size:12px;color:#9ca3af;margin-top:32px;border-top:1px solid #e5e7eb;padding-top:16px;">
            ${escapeHtml(brand.companyName)} &middot; ${escapeHtml(brand.supportEmail)}
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
