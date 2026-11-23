<script lang="ts">
  import type { PublicCollection, PublicPhoto, PublicPlace } from '@showcase/shared';
  import { plural } from './api';
  import { href, link } from './router';

  let {
    siteTitle,
    collections,
    featured,
    places,
    onopen,
  }: {
    siteTitle: string;
    collections: PublicCollection[];
    featured: PublicPhoto[];
    places: PublicPlace[];
    onopen: (id: string) => void;
  } = $props();
</script>

<h1 class="title">{siteTitle}</h1>

{#if featured.length}
  <section aria-labelledby="highlights">
    <h2 id="highlights">Highlights</h2>
    <ul class="strip">
      {#each featured as p (p.id)}
        <li>
          <button class="shot" onclick={() => onopen(p.id)} aria-label={`Open photo${p.caption ? `: ${p.caption}` : ''}`}>
            <img src={p.src.thumb} alt={p.caption ?? ''} width={p.width} height={p.height} loading="lazy" decoding="async" />
          </button>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<section aria-labelledby="albums">
  <h2 id="albums">Albums</h2>
  <ul class="cards">
    {#each collections as c (c.id)}
      <li>
        <a class="card" href={href({ view: 'collection', id: c.slug ?? c.id })} use:link>
          <span class="cover">{#if c.cover}<img src={c.cover} alt="" loading="lazy" decoding="async" />{/if}</span>
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

  .strip {
    list-style: none; margin: 0; padding: 0 0 0.75rem;
    display: flex; gap: 0.75rem; overflow-x: auto; scroll-snap-type: x mandatory;
    overscroll-behavior-x: contain;
  }
  .strip li { flex: none; scroll-snap-align: start; }
  .shot {
    display: block; padding: 0; border: 0; border-radius: var(--radius); overflow: hidden;
    background: var(--surface); cursor: zoom-in;
    height: 14rem;
  }
  .shot img { height: 100%; width: auto; display: block; object-fit: cover; max-width: 85vw; }

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
  /* overflow: hidden stops a tall photo from stretching the 4:3 box */
  .cover { display: block; aspect-ratio: 4 / 3; overflow: hidden; background: var(--surface); }
  .cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
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
    .shot { height: 11rem; }
  }
</style>
