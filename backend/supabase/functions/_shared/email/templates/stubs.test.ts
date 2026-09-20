import { assertEquals, assertThrows } from '@std/assert';
import {
  EmailTemplateNotImplementedError,
  renderCourseCompletionEmail,
  renderPasswordResetEmail,
} from './stubs.ts';
import type { EmailBrandContext } from '../types.ts';

const BRAND: EmailBrandContext = {
  companyName: 'Curso Exemplo',
  appPublicUrl: 'https://app.example.com',
  supportEmail: 'suporte@example.com',
};

Deno.test('renderPasswordResetEmail throws EmailTemplateNotImplementedError naming "password_reset"', () => {
  const error = assertThrows(
    () =>
      renderPasswordResetEmail(
        { toEmail: 'ana@example.com', resetUrl: 'https://app.example.com/reset/token' },
        BRAND,
      ),
    EmailTemplateNotImplementedError,
  );

  assertEquals(error.templateName, 'password_reset');
  assertEquals(error.message, 'Email template not implemented yet: password_reset');
});

Deno.test('renderCourseCompletionEmail throws EmailTemplateNotImplementedError naming "course_completion"', () => {
  const error = assertThrows(
    () =>
      renderCourseCompletionEmail(
        { toEmail: 'ana@example.com', courseTitle: 'Curso de Introdução' },
        BRAND,
      ),
    EmailTemplateNotImplementedError,
  );

  assertEquals(error.templateName, 'course_completion');
  assertEquals(error.message, 'Email template not implemented yet: course_completion');
});
