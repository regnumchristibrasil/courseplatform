// Purchase confirmation email -- queued by `app.confirm_payment` when
// `did_transition` is true (per prompt_course_platform.md feature
// requirement 2), drained by `outbox-drain`. Rendering only: this module
// receives already-resolved data (course title, amount), never the raw
// outbox row or a DB join.
//
// Content language: Portuguese, per this repo's established precedent for
// end-user-facing content (see `welcome.ts`).

import type { EmailBrandContext, PurchaseConfirmationEmailData, RenderedEmail } from '../types.ts';
import { escapeHtml, renderEmailLayout } from './html-helpers.ts';

const CENTS_PER_UNIT = 100;
const THOUSANDS_SEPARATOR_RE = /\B(?=(\d{3})+(?!\d))/g;

// Local to this module on purpose -- do NOT reuse
// `_shared/payments/mercadopago/mapping.ts`'s `centsToDecimal`. That helper
// exists for the Mercado Pago API boundary (decimal reais as a number), a
// different concern from this human-readable "R$ X,XX" display string.
// Brazilian thousands/decimal separator conventions are hardcoded
// deliberately -- this product is Brazil-only (per
// prompt_course_platform.md's CDC/LGPD framing), so there is no locale
// parameter to plumb through.
function formatBrl(amountCents: number): string {
  const rounded = Math.round(amountCents);
  const negative = rounded < 0;
  const absCents = Math.abs(rounded);
  const reais = Math.floor(absCents / CENTS_PER_UNIT);
  const remainderCents = absCents % CENTS_PER_UNIT;
  const reaisWithThousands = reais.toString().replace(THOUSANDS_SEPARATOR_RE, '.');
  const centsStr = remainderCents.toString().padStart(2, '0');
  return `${negative ? '-' : ''}R$ ${reaisWithThousands},${centsStr}`;
}

export function renderPurchaseConfirmationEmail(
  data: PurchaseConfirmationEmailData,
  brand: EmailBrandContext,
): RenderedEmail {
  const amountFormatted = formatBrl(data.amountCents);
  const subject = `Confirmação de compra: ${data.courseTitle}`;

  const bodyHtml = `
    <p>Recebemos a confirmação do seu pagamento. Sua matrícula já está ativa.</p>
    <p><strong>Curso:</strong> ${escapeHtml(data.courseTitle)}<br />
    <strong>Valor pago:</strong> ${escapeHtml(amountFormatted)}</p>
    <p>Você já pode acessar o curso na plataforma.</p>
  `;

  const html = renderEmailLayout({
    heading: 'Pagamento confirmado',
    bodyHtml,
    ctaLabel: 'Acessar o curso',
    ctaUrl: brand.appPublicUrl,
    brand,
  });

  return { subject, html };
}
