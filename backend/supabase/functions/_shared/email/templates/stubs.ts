// Deliberate stub extension points for the two not-yet-built templates --
// per prompt_course_platform.md feature requirement 5: "(Stub, don't
// implement yet) password reset and course-completion emails -- leave
// clearly marked extension points."
//
// Follows the same convention as `_shared/video/panda-provider.ts`'s
// `PandaProvider.resolve()`: the exported symbol exists with a plausible
// shape so callers can compile against it later, but it unconditionally
// throws a clearly-named error when invoked. Never a silent no-op, never
// partially-implemented, never guessed-at copy -- an obvious error here is
// far better than an email with wrong/placeholder content reaching a user.

import type { EmailBrandContext, RenderedEmail } from '../types.ts';

export class EmailTemplateNotImplementedError extends Error {
  constructor(public readonly templateName: string) {
    super(`Email template not implemented yet: ${templateName}`);
    this.name = 'EmailTemplateNotImplementedError';
  }
}

// Shape TBD when this is actually built -- nothing downstream calls this
// yet, so only the minimal plausible input (recipient + a reset link) is
// modeled for now.
export interface PasswordResetEmailData {
  readonly toEmail: string;
  readonly resetUrl: string;
}

export function renderPasswordResetEmail(
  _data: PasswordResetEmailData,
  _brand: EmailBrandContext,
): RenderedEmail {
  throw new EmailTemplateNotImplementedError('password_reset');
}

// Shape TBD when this is actually built -- nothing downstream calls this
// yet, so only the minimal plausible input (recipient + course title) is
// modeled for now.
export interface CourseCompletionEmailData {
  readonly toEmail: string;
  readonly courseTitle: string;
}

export function renderCourseCompletionEmail(
  _data: CourseCompletionEmailData,
  _brand: EmailBrandContext,
): RenderedEmail {
  throw new EmailTemplateNotImplementedError('course_completion');
}
