<script lang="ts">
  import type { PublicPhoto } from '@showcase/shared';
  import { formatDate } from './format';

  let { photos, onopen }: { photos: PublicPhoto[]; onopen: (id: string) => void } = $props();

  const ratio = (p: PublicPhoto) => (p.width && p.height ? p.width / p.height : 1.5);
  const label = (p: PublicPhoto, i: number) =>
    [`Photo ${i + 1} of ${photos.length}`, p.caption, formatDate(p.takenAt)].filter(Boolean).join(', ');
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
  @media (max-width: 40rem) { .grid { gap: 0.35rem; } button { border-radius: 0.55rem; } }
</style>
