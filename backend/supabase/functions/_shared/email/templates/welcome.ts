// Welcome email -- sent when `auth.users.email_confirmed_at` transitions
// NULL -> NOT NULL (queued via `app_private.email_outbox`, per
// prompt_course_platform.md feature requirement 1). Rendering only: this
// module receives already-resolved data, never the raw outbox row.
//
// Content language: end-user-facing copy for a Brazilian audience, written
// in Portuguese -- matches this repo's established precedent for
// business-facing content (PROGRESS.md, Track C notes). Code/comments stay
// in English.

import type { EmailBrandContext, RenderedEmail, WelcomeEmailData } from '../types.ts';
import { escapeHtml, renderEmailLayout } from './html-helpers.ts';

function greetingFor(userFullName: string | null): string {
  const trimmed = userFullName?.trim();
  return trimmed && trimmed.length > 0 ? `Olá, ${escapeHtml(trimmed)}!` : 'Olá!';
}

export function renderWelcomeEmail(
  data: WelcomeEmailData,
  brand: EmailBrandContext,
): RenderedEmail {
  const subject = `Bem-vindo(a) à ${brand.companyName}`;

  const bodyHtml = `
    <p>${greetingFor(data.userFullName)}</p>
    <p>Sua conta foi confirmada com sucesso. Agora você já pode explorar nossos cursos e começar a aprender.</p>
  `;

  const html = renderEmailLayout({
    heading: `Bem-vindo(a) à ${brand.companyName}`,
    bodyHtml,
    ctaLabel: 'Acessar a plataforma',
    ctaUrl: brand.appPublicUrl,
    brand,
  });

  return { subject, html };
}
