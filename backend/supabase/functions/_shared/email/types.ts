// Shared types for the email module -- template-agnostic output shape,
// brand context passed into every renderer, and per-template input data.
// No runtime logic lives here (pure type declarations), matching this
// repo's convention of not adding a `.test.ts` for type-only files (see
// `_shared/payments/mercadopago/types.ts`).

export interface EmailBrandContext {
  readonly companyName: string;
  readonly appPublicUrl: string;
  readonly supportEmail: string;
}

export interface RenderedEmail {
  readonly subject: string;
  readonly html: string;
}

export interface WelcomeEmailData {
  readonly toEmail: string;
  // `public.users.full_name` is nullable -- renderers must fall back to a
  // generic greeting, never interpolate `null`/empty string directly.
  readonly userFullName: string | null;
}

export interface PurchaseConfirmationEmailData {
  readonly toEmail: string;
  readonly courseTitle: string;
  readonly amountCents: number;
  // Always 'BRL' in this codebase today, but kept as a plain string (not a
  // hardcoded literal type) so a future non-BRL course doesn't require an
  // interface change -- display formatting itself is still Brazil-only
  // hardcoded 'R$' per prompt_course_platform.md (Brazil-only product).
  readonly currency: string;
}
