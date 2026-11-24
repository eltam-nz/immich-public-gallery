<script lang="ts">
  import { formatDuration, type PublicPhoto } from '@showcase/shared';
  import { formatDate } from './format';

  let { photos, onopen }: { photos: PublicPhoto[]; onopen: (id: string) => void } = $props();

  const ratio = (p: PublicPhoto) => (p.width && p.height ? p.width / p.height : 1.5);
  const label = (p: PublicPhoto, i: number) =>
    [
      `${p.type === 'video' ? 'Video' : 'Photo'} ${i + 1} of ${photos.length}`,
      p.video?.duration ? spokenLength(p.video.duration) : null,
      p.caption,
      formatDate(p.takenAt),
    ]
      .filter(Boolean)
      .join(', ');
  const spokenLength = (ms: number) => {
    const t = Math.round(ms / 1000);
    const m = Math.floor(t / 60);
    const sec = t % 60;
    return [m && `${m} minute${m === 1 ? '' : 's'}`, sec && `${sec} second${sec === 1 ? '' : 's'}`].filter(Boolean).join(' ');
  };
</script>

<!-- Justified rows: each tile grows in proportion to its aspect ratio. -->
<ul class="grid">
  {#each photos as p, i (p.id)}
    <li style:--r={ratio(p)}>
      <button onclick={() => onopen(p.id)} aria-label={label(p, i)}>
        <img
          src={p.src.thumb}
          alt={p.caption ?? p.description ?? ''}
          width={p.width}
          height={p.height}
          loading="lazy"
          decoding="async"
        />
        {#if p.type === 'video'}
          <span class="play" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="1.1em" height="1.1em"><path d="M8 5.5v13l11-6.5z" fill="currentColor" /></svg>
            {#if p.video?.duration}<span>{formatDuration(p.video.duration)}</span>{/if}
          </span>
        {/if}
      </button>
    </li>
  {/each}
  <li class="filler" aria-hidden="true"></li>
</ul>

<style>
  .grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  li {
    flex-grow: calc(var(--r) * 100);
    flex-basis: calc(var(--r) * var(--row-height));
    aspect-ratio: var(--r);
    max-height: calc(var(--row-height) * 1.8);
    min-width: 0;
  }
  li.filler {
    flex-grow: 10000;
    flex-basis: 0;
    aspect-ratio: auto;
  }
  button {
    position: relative;
    display: block;
    width: 100%;
    height: 100%;
    padding: 0;
    border: 0;
    background: var(--surface-2);
    cursor: zoom-in;
    overflow: hidden;
    border-radius: 0.75rem;
    box-shadow: 0 1px 2px rgba(17, 24, 39, 0.08);
  }
  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 0.25s ease;
  }
  button:hover img { transform: scale(1.03); }
  /* Play badge on video tiles: dark pill with a play triangle and the length. */
  .play {
    position: absolute; left: 0.5rem; bottom: 0.5rem;
    display: inline-flex; align-items: center; gap: 0.3rem;
    padding: 0.2rem 0.6rem 0.2rem 0.45rem; border-radius: 999px;
    background: rgba(0, 0, 0, 0.72); color: #fff; font-size: 0.85rem; font-weight: 700;
  }
  @media (max-width: 40rem) { .grid { gap: 0.35rem; } button { border-radius: 0.55rem; } }
</style>
