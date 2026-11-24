<script lang="ts">
  import type { PublicCollection, PublicFeatured, PublicPlace } from '@showcase/shared';
  import { formatRange, plural } from './api';
  import Icon from './Icon.svelte';
  import { href, link } from './router';

  let {
    siteTitle,
    collections,
    places,
    featured,
  }: {
    siteTitle: string;
    collections: PublicCollection[];
    places: PublicPlace[];
    featured: PublicFeatured | null;
  } = $props();

  // 4+ photos: 2×2 grid; 2–3: two side by side; 1: one image.
  const tiles = (covers: string[]) => covers.slice(0, covers.length >= 4 ? 4 : covers.length >= 2 ? 2 : 1);
  const hasFeatured = $derived(!!featured && featured.count > 0);
</script>

<header class="intro">
  <h1>{siteTitle}</h1>
  <p class="sub">
    {[plural(collections.length, 'collection'), places.length ? plural(places.length, 'place') : ''].filter(Boolean).join(' · ')}
  </p>
</header>

<!-- Photography (photos ticked Featured) comes first, as a distinct dark panel. -->
{#if hasFeatured && featured}
  <section class="featured" aria-labelledby="photography">
    <a class="feature-card" href={href({ view: 'featured' })} use:link>
      <span class="mosaic tiles-{tiles(featured.covers).length}">
        {#each tiles(featured.covers) as src (src)}<img {src} alt="" loading="lazy" decoding="async" />{/each}
      </span>
      <span class="feature-text">
        <span class="kicker"><Icon name="star" />Selected favourites</span>
        <h2 id="photography">Photography</h2>
        <span class="feature-meta">{plural(featured.count, 'photo')}</span>
        <span class="btn primary go">View photography <Icon name="chevron" /></span>
      </span>
    </a>
  </section>
{/if}

{#if collections.length}
  <section aria-labelledby="collections">
    <div class="section-head"><h2 id="collections">Collections</h2><span class="chip">{collections.length}</span></div>
    <ul class="cards">
      {#each collections as c (c.id)}
        {@const range = formatRange(c.dateRange)}
        <li>
          <a class="card" href={href({ view: 'collection', id: c.slug ?? c.id })} use:link>
            <span class="cover tiles-{tiles(c.covers).length}">
              {#each tiles(c.covers) as src (src)}<img {src} alt="" loading="lazy" decoding="async" />{/each}
            </span>
            <span class="text">
              <span class="name">{c.title}</span>
              <span class="meta">
                <span><Icon name="photo" />{plural(c.count, 'photo')}</span>
                {#if range}<span><Icon name="calendar" />{range}</span>{/if}
              </span>
              {#if c.description}<span class="desc">{c.description}</span>{/if}
            </span>
          </a>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<!-- Other ways in, at the bottom: big labelled tiles -->
<section aria-labelledby="browse">
  <div class="section-head"><h2 id="browse">Browse</h2></div>
  <nav class="quick" aria-label="Ways to browse">
    <a href={href({ view: 'all' })} use:link><span class="ico"><Icon name="grid" size="1.6rem" /></span><span>All photos</span></a>
    {#if places.length}
      <a href={href({ view: 'map' })} use:link><span class="ico"><Icon name="map" size="1.6rem" /></span><span>Map</span></a>
    {/if}
  </nav>
</section>

<style>
  .intro { margin: 0.25rem 0 1.25rem; }
  h1 { font-size: 2.1rem; }
  .sub { margin: 0.35rem 0 0; color: var(--muted); }
  section { margin-bottom: 2.5rem; }

  /* Quick actions: icon in a soft circle, label underneath */
  .quick {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(5.75rem, 1fr)); gap: 0.6rem;
    max-width: 26rem;
  }
  .quick a {
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.4rem;
    min-height: 6rem; padding: 0.75rem 0.5rem;
    background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow);
    color: var(--fg); text-decoration: none; font-weight: 600;
    border: 0.125rem solid transparent;
    text-align: center; line-height: 1.25;
  }
  .quick a:hover { border-color: var(--border); }
  .ico {
    display: grid; place-items: center; width: 3.1rem; height: 3.1rem; border-radius: 50%;
    background: var(--accent-soft); color: var(--accent);
  }
  @media (prefers-color-scheme: light) { .ico { color: #14532d; } }

  .cards {
    list-style: none; margin: 0; padding: 0;
    display: grid; gap: 1.25rem; grid-template-columns: repeat(auto-fill, minmax(min(100%, 19rem), 1fr));
  }
  .card {
    display: flex; flex-direction: column; height: 100%; padding: 0.55rem;
    background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow);
    color: var(--fg); text-decoration: none; border: 0.125rem solid transparent;
    transition: box-shadow 0.15s ease, transform 0.15s ease;
  }
  .card:hover { box-shadow: var(--shadow-lg); transform: translateY(-2px); }

  /* A 4:3 box of up to four photos. overflow: hidden stops tall photos stretching it. */
  .cover, .mosaic {
    display: grid; gap: 0.25rem; aspect-ratio: 4 / 3; overflow: hidden;
    border-radius: var(--radius-sm); background: var(--surface-2);
  }
  .tiles-2 { grid-template-columns: 1fr 1fr; }
  .tiles-4 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }
  .cover img, .mosaic img { width: 100%; height: 100%; min-height: 0; object-fit: cover; display: block; }

  .text { display: grid; gap: 0.3rem; padding: 0.8rem 0.6rem 0.6rem; }
  .name { font-size: 1.25rem; font-weight: 700; line-height: 1.25; }
  .text .meta { font-size: 0.95rem; }
  .desc {
    margin-top: 0.15rem;
    display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }

  /* Featured photography: a distinct dark panel */
  .feature-card {
    display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 1.5rem; align-items: center;
    padding: 1rem; border-radius: calc(var(--radius) + 0.25rem);
    background: #111827; color: #f9fafb; text-decoration: none; box-shadow: var(--shadow-lg);
  }
  .feature-card:hover .go { filter: brightness(1.08); }
  .mosaic { aspect-ratio: 3 / 2; background: #1f2937; }
  .feature-text { display: grid; gap: 0.5rem; justify-items: start; padding: 0.5rem 0.5rem 0.75rem; }
  .kicker {
    display: inline-flex; align-items: center; gap: 0.4rem; color: #fde68a; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.06em; font-size: 0.8rem;
  }
  .featured h2 { font-size: 1.9rem; color: #ffffff; }
  .feature-meta { color: #e5e7eb; }
  .go { margin-top: 0.5rem; background: #86efac; border-color: #86efac; color: #052e16; }
  @media (max-width: 48rem) {
    .feature-card { grid-template-columns: 1fr; gap: 0.75rem; }
    .featured h2 { font-size: 1.6rem; }
    .go { width: 100%; }
  }
  @media (max-width: 40rem) {
    h1 { font-size: 1.75rem; }
  }
  @media (prefers-reduced-motion: reduce) { .card:hover { transform: none; } }
</style>
