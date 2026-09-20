export interface YouTubePlayerProps {
  readonly videoId: string
  readonly onPlay?: () => void
}

// The frontend never talks to YouTube directly for resolution (the
// videoId comes back from the backend's video-resolve Edge Function, an
// unlisted-but-unsigned link) — this component only renders the player.
// youtube-nocookie.com keeps this LGPD-conscious by avoiding tracking
// cookies before playback is explicitly requested by the enrolled user.
export function YouTubePlayer({ videoId, onPlay }: YouTubePlayerProps) {
  const src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}`

  return (
    <iframe
      title="Aula em vídeo"
      src={src}
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowFullScreen
      onLoad={onPlay}
      width="100%"
      height="480"
      frameBorder={0}
    />
  )
}
