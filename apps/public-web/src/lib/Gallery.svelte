<script lang="ts">
  import type { PublicPhoto } from '@showcase/shared';

  let { photos, onopen }: { photos: PublicPhoto[]; onopen: (id: string) => void } = $props();

  const ratio = (p: PublicPhoto) => (p.width && p.height ? p.width / p.height : 1.5);
</script>

<!-- Justified rows: each tile grows in proportion to its aspect ratio. -->
<ul class="grid">
  {#each photos as p (p.id)}
    <li style:--r={ratio(p)}>
      <button onclick={() => onopen(p.id)} aria-label={p.caption ?? p.description ?? 'Open photo'}>
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
    gap: 6px;
  }
  li {
    flex-grow: calc(var(--r) * 100);
    flex-basis: calc(var(--r) * var(--row-height));
    aspect-ratio: var(--r);
    max-height: calc(var(--row-height) * 1.6);
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
    background: var(--border);
    cursor: zoom-in;
    overflow: hidden;
    border-radius: 3px;
  }
  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 0.3s ease;
  }
  button:hover img,
  button:focus-visible img {
    transform: scale(1.03);
  }
  @media (prefers-reduced-motion: reduce) {
    img { transition: none; }
  }
</style>
