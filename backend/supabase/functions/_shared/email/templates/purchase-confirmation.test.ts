import { assertEquals, assertStringIncludes } from '@std/assert';
import { renderPurchaseConfirmationEmail } from './purchase-confirmation.ts';
import type { EmailBrandContext, PurchaseConfirmationEmailData } from '../types.ts';

const BRAND: EmailBrandContext = {
  companyName: 'Curso Exemplo',
  appPublicUrl: 'https://app.example.com',
  supportEmail: 'suporte@example.com',
};

function sampleData(
  overrides: Partial<PurchaseConfirmationEmailData> = {},
): PurchaseConfirmationEmailData {
  return {
    toEmail: 'ana@example.com',
    courseTitle: 'Curso de Introdução',
    amountCents: 4990,
    currency: 'BRL',
    ...overrides,
  };
}

Deno.test('renderPurchaseConfirmationEmail includes the course title, brand and app URL', () => {
  const result = renderPurchaseConfirmationEmail(sampleData(), BRAND);

  assertStringIncludes(result.subject, 'Curso de Introdução');
  assertStringIncludes(result.html, 'Curso de Introdução');
  assertStringIncludes(result.html, BRAND.companyName);
  assertStringIncludes(result.html, BRAND.appPublicUrl);
  assertStringIncludes(result.html, BRAND.supportEmail);
});

Deno.test('renderPurchaseConfirmationEmail formats a plain amount as R$ X,XX', () => {
  const result = renderPurchaseConfirmationEmail(sampleData({ amountCents: 1990 }), BRAND);
  assertStringIncludes(result.html, 'R$ 19,90');
});

Deno.test('renderPurchaseConfirmationEmail pads a single-digit cents value with a leading zero', () => {
  const result = renderPurchaseConfirmationEmail(sampleData({ amountCents: 1005 }), BRAND);
  assertStringIncludes(result.html, 'R$ 10,05');
});

Deno.test('renderPurchaseConfirmationEmail formats a zero-cents amount', () => {
  const result = renderPurchaseConfirmationEmail(sampleData({ amountCents: 100 }), BRAND);
  assertStringIncludes(result.html, 'R$ 1,00');
});

Deno.test('renderPurchaseConfirmationEmail applies a thousands separator for large amounts', () => {
  const result = renderPurchaseConfirmationEmail(sampleData({ amountCents: 123456 }), BRAND);
  assertStringIncludes(result.html, 'R$ 1.234,56');
});

Deno.test('renderPurchaseConfirmationEmail formats a negative amount (e.g. a refund adjustment) with a leading minus sign', () => {
  const result = renderPurchaseConfirmationEmail(sampleData({ amountCents: -1990 }), BRAND);
  assertStringIncludes(result.html, '-R$ 19,90');
});

Deno.test('renderPurchaseConfirmationEmail formats an amount under one real', () => {
  const result = renderPurchaseConfirmationEmail(sampleData({ amountCents: 5 }), BRAND);
  assertStringIncludes(result.html, 'R$ 0,05');
});

Deno.test('renderPurchaseConfirmationEmail escapes special characters in the course title', () => {
  const result = renderPurchaseConfirmationEmail(
    sampleData({ courseTitle: '<b>Hack</b> & Cia' }),
    BRAND,
  );

  assertEquals(result.html.includes('<b>Hack</b>'), false);
  assertStringIncludes(result.html, '&lt;b&gt;Hack&lt;/b&gt; &amp; Cia');
});

Deno.test('renderPurchaseConfirmationEmail subject and body are written in Portuguese', () => {
  const result = renderPurchaseConfirmationEmail(sampleData(), BRAND);

  assertStringIncludes(result.subject, 'Confirmação de compra');
  assertStringIncludes(result.html, 'pagamento');
});
