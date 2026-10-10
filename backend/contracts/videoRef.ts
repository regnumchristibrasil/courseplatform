// Lesson video reference parsing, shared verbatim between frontend and backend
// (ticket #19). app_private.parse_video_ref in SQL implements the same rules;
// VIDEO_REF_CASES is the table all three implementations are tested against.
// The server only checks the FORMAT, never that the video exists (GLOSSARY).
//
// - YouTube: 11-character id, or watch / embed / youtu.be URL.
// - Panda: UUID, or an embed URL containing the UUID (stored lowercase).

export type VideoRefProvider = 'youtube' | 'panda';

export interface ParsedVideoRef {
  readonly provider: VideoRefProvider;
  readonly externalRef: string; // canonical reference as stored
}

export interface VideoRefCase {
  readonly input: string;
  readonly expected: ParsedVideoRef | null; // null = rejected
}

// Whitespace set is explicit (not \s / trim()) so SQL btrim matches exactly.
const EDGE_WHITESPACE = /^[ \t\r\n]+|[ \t\r\n]+$/g;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_URL =
  /^(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})(?:[?&#][^\r\n]*)?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PANDA_EMBED = /pandavideo\.com\.br\/embed\/?\?(?:[^\r\n]*&)?v=([0-9a-f-]{36})/i;

export function parseVideoRef(raw: string): ParsedVideoRef | null {
  const text = raw.replace(EDGE_WHITESPACE, '');
  const youtubeUrl = YOUTUBE_URL.exec(text)?.[1];
  if (youtubeUrl) return { provider: 'youtube', externalRef: youtubeUrl };
  if (YOUTUBE_ID.test(text)) return { provider: 'youtube', externalRef: text };
  const pandaEmbed = PANDA_EMBED.exec(text)?.[1];
  if (pandaEmbed && UUID.test(pandaEmbed)) {
    return { provider: 'panda', externalRef: pandaEmbed.toLowerCase() };
  }
  if (UUID.test(text)) return { provider: 'panda', externalRef: text.toLowerCase() };
  return null;
}

const YT = 'dQw4w9WgXcQ';
const PANDA = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

const youtube = (externalRef: string): ParsedVideoRef => ({ provider: 'youtube', externalRef });
const panda = (externalRef: string): ParsedVideoRef => ({ provider: 'panda', externalRef });

export const VIDEO_REF_CASES: readonly VideoRefCase[] = [
  // YouTube: bare id
  { input: YT, expected: youtube(YT) },
  { input: '  dQw4w9WgXcQ\n', expected: youtube(YT) },
  { input: '-_-_-_-_-_-', expected: youtube('-_-_-_-_-_-') },
  // YouTube: URLs
  { input: `https://www.youtube.com/watch?v=${YT}`, expected: youtube(YT) },
  { input: `http://youtube.com/watch?v=${YT}`, expected: youtube(YT) },
  { input: `youtube.com/watch?v=${YT}`, expected: youtube(YT) },
  { input: `https://www.youtube.com/watch?v=${YT}&t=42s`, expected: youtube(YT) },
  { input: `https://www.youtube.com/embed/${YT}`, expected: youtube(YT) },
  { input: `https://www.youtube.com/embed/${YT}?rel=0`, expected: youtube(YT) },
  { input: `https://youtu.be/${YT}`, expected: youtube(YT) },
  { input: `https://youtu.be/${YT}?si=abc123`, expected: youtube(YT) },
  { input: `https://youtu.be/${YT}#t=10`, expected: youtube(YT) },
  // YouTube: rejected
  { input: 'dQw4w9WgXc', expected: null },
  { input: 'dQw4w9WgXcQQ', expected: null },
  { input: 'dQw4w9WgXc!', expected: null },
  { input: 'dQw4w9 WgXc', expected: null },
  { input: 'https://www.youtube.com/watch?v=short', expected: null },
  { input: `https://www.youtube.com/watch?v=${YT}x`, expected: null },
  { input: `https://www.youtube.com/watch?feature=share&v=${YT}`, expected: null },
  { input: `https://m.youtube.com/watch?v=${YT}`, expected: null },
  { input: `https://example.com/watch?v=${YT}`, expected: null },
  { input: `https://youtu.be/${YT}\nextra`, expected: null },
  { input: `https://youtu.be/${YT}\rextra`, expected: null },
  { input: `HTTPS://YOUTU.BE/${YT}`, expected: null },
  // Panda: UUID
  { input: PANDA, expected: panda(PANDA) },
  { input: PANDA.toUpperCase(), expected: panda(PANDA) },
  { input: `\t${PANDA}  `, expected: panda(PANDA) },
  // Panda: embed URLs
  {
    input: `https://player-vz-abc123.tv.pandavideo.com.br/embed/?v=${PANDA}`,
    expected: panda(PANDA),
  },
  {
    input: `https://player-vz-abc123.tv.pandavideo.com.br/embed?v=${PANDA}`,
    expected: panda(PANDA),
  },
  {
    input: `https://player-vz-abc123.tv.pandavideo.com.br/embed/?autoplay=1&v=${PANDA}`,
    expected: panda(PANDA),
  },
  {
    input: `https://player-vz-abc123.tv.pandavideo.com.br/embed/?v=${PANDA.toUpperCase()}`,
    expected: panda(PANDA),
  },
  {
    input: `https://player-vz-abc123.tv.pandavideo.com.br/embed/?v=${PANDA}&autoplay=1`,
    expected: panda(PANDA),
  },
  {
    input:
      `https://player-vz-abc123.tv.pandavideo.com.br/embed/?v=${PANDA}&v=9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f`,
    expected: panda('9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f'),
  },
  // Panda: rejected
  { input: PANDA.slice(0, -1), expected: null },
  { input: `${PANDA}0`, expected: null },
  { input: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4g', expected: null },
  { input: '0a1b2c3d4e5f4a6b8c7d9e0f1a2b3c4d', expected: null },
  { input: '----------------------------------------', expected: null },
  { input: '------------------------------------', expected: null },
  {
    input: 'https://player.pandavideo.com.br/embed/?v=not-a-uuid-not-a-uuid-not-a-uuid-1',
    expected: null,
  },
  { input: `https://example.com/embed/?v=${PANDA}`, expected: null },
  // Blank
  { input: '', expected: null },
  { input: '   \n\t', expected: null },
];
