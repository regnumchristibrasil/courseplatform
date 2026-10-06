import type { Course } from './types'

const YT = 'dQw4w9WgXcQ'
const PANDA = '3f2a9c1e-5b7d-4e8a-9c3b-1a2b3c4d5e6f'

// Three scenarios:
//  1. published, sold (enrollments + pending orders): delete is blocked, archive offered,
//     price edits warn about pending orders, has an archived lesson and an empty module.
//  2. draft, unsold: gate fails (lesson without video, empty module), hard delete allowed.
//  3. archived, sold: can only go back to draft.
export const initialCourses = (): readonly Course[] => [
  {
    id: 'c1',
    title: 'Discernimento Espiritual',
    description: 'Fundamentos e prática do discernimento na vida cotidiana.',
    priceCents: 19_900,
    accessDurationDays: 365,
    status: 'published',
    enrollments: 12,
    pendingOrders: 2,
    modules: [
      {
        id: 'c1m1',
        title: 'Fundamentos',
        archived: false,
        lessons: [
          { id: 'c1l1', title: 'Boas-vindas e visão geral', durationSeconds: 300, isFreePreview: true, archived: false, video: { provider: 'youtube', ref: YT } },
          { id: 'c1l2', title: 'O que é discernimento?', durationSeconds: 900, isFreePreview: false, archived: false, video: { provider: 'youtube', ref: YT } },
          { id: 'c1l3', title: 'Aula antiga (substituída)', durationSeconds: 600, isFreePreview: false, archived: true, video: { provider: 'youtube', ref: 'abcdefghijk' } },
        ],
      },
      {
        id: 'c1m2',
        title: 'Prática',
        archived: false,
        lessons: [
          { id: 'c1l4', title: 'Exercícios práticos', durationSeconds: 1200, isFreePreview: false, archived: false, video: { provider: 'panda', ref: PANDA } },
        ],
      },
      { id: 'c1m3', title: 'Módulo futuro (ainda vazio)', archived: false, lessons: [] },
    ],
  },
  {
    id: 'c2',
    title: 'Liderança a Serviço',
    description: 'Curso em preparação.',
    priceCents: 24_900,
    accessDurationDays: null,
    status: 'draft',
    enrollments: 0,
    pendingOrders: 0,
    modules: [
      {
        id: 'c2m1',
        title: 'Introdução',
        archived: false,
        lessons: [
          { id: 'c2l1', title: 'Fundamentos da liderança', durationSeconds: 600, isFreePreview: true, archived: false, video: { provider: 'youtube', ref: YT } },
          { id: 'c2l2', title: 'Liderança a serviço (gravar)', durationSeconds: null, isFreePreview: false, archived: false, video: null },
        ],
      },
      { id: 'c2m2', title: 'Estudos de caso', archived: false, lessons: [] },
    ],
  },
  {
    id: 'c3',
    title: 'Curso de Verão 2025',
    description: 'Encerrado, mantido para quem já comprou.',
    priceCents: 9_900,
    accessDurationDays: 90,
    status: 'archived',
    enrollments: 3,
    pendingOrders: 0,
    modules: [
      {
        id: 'c3m1',
        title: 'Único módulo',
        archived: false,
        lessons: [{ id: 'c3l1', title: 'Aula única', durationSeconds: 1800, isFreePreview: false, archived: false, video: { provider: 'youtube', ref: 'zyxwvutsrqp' } }],
      },
    ],
  },
]
