import { assertEquals } from '@std/assert';
import {
  COURSE_ACTIONS,
  COURSE_PERMISSION_MATRIX,
  COURSE_ROLES,
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
