<script lang="ts">
  import type { PublicCollection, PublicPlace } from '@showcase/shared';
  import { plural } from './api';
  import { href, link } from './router';

  let {
    siteTitle,
    collections,
    places,
  }: {
    siteTitle: string;
    collections: PublicCollection[];
    places: PublicPlace[];
  } = $props();

  // 4+ photos: 2×2 grid; 2–3: two side by side; 1: one image.
  const tiles = (c: PublicCollection) => c.covers.slice(0, c.covers.length >= 4 ? 4 : c.covers.length >= 2 ? 2 : 1);
</script>

<h1 class="title">{siteTitle}</h1>

<section aria-labelledby="collections">
  <h2 id="collections">Collections</h2>
  <ul class="cards">
    {#each collections as c (c.id)}
      <li>
        <a class="card" href={href({ view: 'collection', id: c.slug ?? c.id })} use:link>
          <span class="cover tiles-{tiles(c).length}">
            {#each tiles(c) as src (src)}<img {src} alt="" loading="lazy" decoding="async" />{/each}
          </span>
          <span class="text">
            <span class="name">{c.title}</span>
            <span class="count">{plural(c.count, 'photo')}</span>
            {#if c.description}<span class="desc">{c.description}</span>{/if}
          </span>
        </a>
      </li>
    {/each}
  </ul>
</section>

<section aria-labelledby="browse">
  <h2 id="browse">{collections.length ? 'More ways to look' : 'Photos'}</h2>
  <ul class="cards nav">
    <li>
      <a class="card plain" href={href({ view: 'all' })} use:link>
        <span class="icon" aria-hidden="true">▦</span>
        <span class="text"><span class="name">All photos</span><span class="count">Everything, newest first</span></span>
      </a>
    </li>
    {#if places.length}
      <li>
        <a class="card plain" href={href({ view: 'map' })} use:link>
          <span class="icon" aria-hidden="true">⌖</span>
          <span class="text"><span class="name">Map</span><span class="count">{plural(places.length, 'place')}</span></span>
        </a>
      </li>
    {/if}
  </ul>
</section>

<style>
  .title { font-size: 2rem; margin-bottom: 1.5rem; }
  section { margin-bottom: 2.5rem; }
  h2 { font-size: 1.35rem; margin-bottom: 0.75rem; }

  .cards {
    list-style: none; margin: 0; padding: 0;
    display: grid; gap: 1rem; grid-template-columns: repeat(auto-fill, minmax(min(100%, 18rem), 1fr));
  }
  .card {
    display: flex; flex-direction: column; height: 100%;
    border: 0.125rem solid var(--border); border-radius: var(--radius); overflow: hidden;
    background: var(--bg); color: var(--fg); text-decoration: none;
  }
  .card:hover { border-color: var(--fg); }
  /* A 4:3 box of up to four photos. overflow: hidden stops tall photos stretching it. */
  .cover {
    display: grid; gap: 0.2rem; aspect-ratio: 4 / 3; overflow: hidden;
    background: var(--surface);
  }
  .cover.tiles-2 { grid-template-columns: 1fr 1fr; }
  .cover.tiles-4 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }
  .cover img { width: 100%; height: 100%; min-height: 0; object-fit: cover; display: block; }
  .text { display: grid; gap: 0.15rem; padding: 0.9rem 1rem 1rem; }
  .name { font-size: 1.2rem; font-weight: 700; }
  .count { color: var(--muted); }
  .desc {
    margin-top: 0.25rem;
    display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
  }
  .cards.nav { grid-template-columns: repeat(auto-fill, minmax(min(100%, 18rem), 1fr)); }
  .card.plain { flex-direction: row; align-items: center; min-height: 5.5rem; }
  .icon {
    flex: none; display: grid; place-items: center; width: 4.5rem; align-self: stretch;
    background: var(--surface); font-size: 2rem;
  }
  @media (max-width: 40rem) {
    .title { font-size: 1.6rem; }
  }
</style>
