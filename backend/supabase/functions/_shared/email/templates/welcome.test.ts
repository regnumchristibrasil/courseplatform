import { assertEquals, assertStringIncludes } from '@std/assert';
import { renderWelcomeEmail } from './welcome.ts';
import type { EmailBrandContext, WelcomeEmailData } from '../types.ts';

const BRAND: EmailBrandContext = {
  companyName: 'Curso Exemplo',
  appPublicUrl: 'https://app.example.com',
  supportEmail: 'suporte@example.com',
};

Deno.test('renderWelcomeEmail greets the user by full name when present', () => {
  const data: WelcomeEmailData = { toEmail: 'ana@example.com', userFullName: 'Ana Silva' };

  const result = renderWelcomeEmail(data, BRAND);

  assertStringIncludes(result.html, 'Ana Silva');
  assertStringIncludes(result.subject, BRAND.companyName);
  assertStringIncludes(result.html, BRAND.companyName);
  assertStringIncludes(result.html, BRAND.appPublicUrl);
  assertStringIncludes(result.html, BRAND.supportEmail);
});

Deno.test('renderWelcomeEmail falls back to a generic greeting when userFullName is null', () => {
  const data: WelcomeEmailData = { toEmail: 'ana@example.com', userFullName: null };

  const result = renderWelcomeEmail(data, BRAND);

  assertStringIncludes(result.html, 'Olá!');
  assertEquals(result.html.includes('null'), false);
  assertEquals(result.html.includes('Olá, !'), false);
});

Deno.test('renderWelcomeEmail falls back to a generic greeting when userFullName is empty/whitespace', () => {
  const data: WelcomeEmailData = { toEmail: 'ana@example.com', userFullName: '   ' };

  const result = renderWelcomeEmail(data, BRAND);

  assertStringIncludes(result.html, 'Olá!');
  assertEquals(result.html.includes('Olá,'), false);
});

Deno.test('renderWelcomeEmail escapes special characters in the user full name', () => {
  const data: WelcomeEmailData = { toEmail: 'ana@example.com', userFullName: '<b>Ana</b>' };

  const result = renderWelcomeEmail(data, BRAND);

  assertEquals(result.html.includes('<b>Ana</b>'), false);
  assertStringIncludes(result.html, '&lt;b&gt;Ana&lt;/b&gt;');
});

Deno.test('renderWelcomeEmail subject and body are written in Portuguese', () => {
  const data: WelcomeEmailData = { toEmail: 'ana@example.com', userFullName: 'Ana' };

  const result = renderWelcomeEmail(data, BRAND);

  assertStringIncludes(result.subject, 'Bem-vindo');
  assertStringIncludes(result.html, 'plataforma');
});
