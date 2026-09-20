import { assertEquals, assertStringIncludes } from '@std/assert';
import { escapeHtml, renderEmailLayout } from './html-helpers.ts';
import type { EmailBrandContext } from '../types.ts';

const BRAND: EmailBrandContext = {
  companyName: 'Curso Exemplo',
  appPublicUrl: 'https://app.example.com',
  supportEmail: 'suporte@example.com',
};

Deno.test('escapeHtml neutralizes an injected <script> tag', () => {
  const escaped = escapeHtml(`<script>alert('x')</script>`);
  assertEquals(escaped.includes('<script>'), false);
  assertEquals(escaped, '&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;');
});

Deno.test('escapeHtml escapes each reserved character correctly', () => {
  assertEquals(escapeHtml('&'), '&amp;');
  assertEquals(escapeHtml('<'), '&lt;');
  assertEquals(escapeHtml('>'), '&gt;');
  assertEquals(escapeHtml('"'), '&quot;');
  assertEquals(escapeHtml("'"), '&#39;');
});

Deno.test('escapeHtml leaves unicode and emoji untouched', () => {
  assertEquals(escapeHtml('José ☕ 😀'), 'José ☕ 😀');
});

Deno.test('renderEmailLayout includes the heading, body, brand name and support email', () => {
  const html = renderEmailLayout({
    heading: 'Ola',
    bodyHtml: '<p>corpo</p>',
    brand: BRAND,
  });

  assertStringIncludes(html, 'Ola');
  assertStringIncludes(html, '<p>corpo</p>');
  assertStringIncludes(html, 'Curso Exemplo');
  assertStringIncludes(html, 'suporte@example.com');
});

Deno.test('renderEmailLayout escapes the heading and brand fields', () => {
  const html = renderEmailLayout({
    heading: '<b>hack</b>',
    bodyHtml: '<p>corpo</p>',
    brand: { ...BRAND, companyName: '<i>Co</i>' },
  });

  assertEquals(html.includes('<b>hack</b>'), false);
  assertStringIncludes(html, '&lt;b&gt;hack&lt;/b&gt;');
  assertStringIncludes(html, '&lt;i&gt;Co&lt;/i&gt;');
});

Deno.test('renderEmailLayout omits the CTA block when ctaLabel/ctaUrl are not provided', () => {
  const html = renderEmailLayout({
    heading: 'Ola',
    bodyHtml: '<p>corpo</p>',
    brand: BRAND,
  });

  assertEquals(html.includes('<a href='), false);
});

Deno.test('renderEmailLayout renders an escaped CTA link when both ctaLabel and ctaUrl are provided', () => {
  const html = renderEmailLayout({
    heading: 'Ola',
    bodyHtml: '<p>corpo</p>',
    ctaLabel: 'Clique aqui',
    ctaUrl: 'https://app.example.com/?a=1&b=2',
    brand: BRAND,
  });

  assertStringIncludes(html, 'Clique aqui');
  assertStringIncludes(html, 'https://app.example.com/?a=1&amp;b=2');
});

Deno.test('renderEmailLayout only styles inline (no <style> block, matching email-client constraints)', () => {
  const html = renderEmailLayout({
    heading: 'Ola',
    bodyHtml: '<p>corpo</p>',
    brand: BRAND,
  });

  assertEquals(html.includes('<style'), false);
});
