import { assertEquals } from '@std/assert';
import {
  ADMIN_COURSES_ERROR_STATUS,
  COURSE_ACTIONS,
  COURSE_PERMISSION_MATRIX,
  COURSE_ROLES,
  COURSE_STATUS_TRANSITIONS,
  type CourseAction,
  type CourseActorRole,
  evaluateCoursePermission,
} from './adminCourses.ts';

// Expectations written by hand from ADR 0002 (decision 4), not derived from
// the implementation, so the test is not circular.
const EXPECTED_DENIED: Readonly<Record<CourseActorRole, readonly CourseAction[]>> = {
  superadmin: [],
  admin: [],
  tutor: ['edit_price', 'edit_access_duration'],
  student: [
    'list',
    'create',
    'edit_details',
    'edit_price',
    'edit_access_duration',
    'edit_content',
    'change_status',
    'delete',
  ],
};

Deno.test('matrix has one row per role x action', () => {
  assertEquals(COURSE_PERMISSION_MATRIX.length, COURSE_ROLES.length * COURSE_ACTIONS.length);
});

for (const role of COURSE_ROLES) {
  for (const action of COURSE_ACTIONS) {
    const allowed = !EXPECTED_DENIED[role].includes(action);
    Deno.test(`${role} ${allowed ? 'may' : 'may not'} ${action}`, () => {
      assertEquals(evaluateCoursePermission(role, action), allowed);
      const row = COURSE_PERMISSION_MATRIX.find((r) => r.role === role && r.action === action);
      assertEquals(row?.allowed, allowed);
    });
  }
}

// Written by hand from the glossary ("Status do curso"), not derived from the code.
Deno.test('status transitions are exactly draft->published, published->draft|archived, archived->draft', () => {
  assertEquals(COURSE_STATUS_TRANSITIONS, {
    draft: ['published'],
    published: ['draft', 'archived'],
    archived: ['draft'],
  });
});

Deno.test('invalid_transition and publish_gate_violated are conflicts (409)', () => {
  assertEquals(ADMIN_COURSES_ERROR_STATUS.invalid_transition, 409);
  assertEquals(ADMIN_COURSES_ERROR_STATUS.publish_gate_violated, 409);
});
