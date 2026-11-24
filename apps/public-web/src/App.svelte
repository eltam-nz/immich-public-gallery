<script lang="ts">
  import type { PublicCollection, PublicFeatured, PublicPhoto, PublicPlace } from '@showcase/shared';
  import { api, formatRange, plural, previewOf } from './lib/api';
  import Gallery from './lib/Gallery.svelte';
  import Home from './lib/Home.svelte';
  import Icon from './lib/Icon.svelte';
  import Lightbox from './lib/Lightbox.svelte';
  import { href, link, navigate, onNavigate, parse, type Route } from './lib/router';

  let loc = $state(parse(location.search));
  onNavigate(() => (loc = parse(location.search)));

  let siteTitle = $state('Photos');
  let collections = $state<PublicCollection[] | null>(null);
  let places = $state<PublicPlace[]>([]);
  let featured = $state<PublicFeatured | null>(null);
  let photos = $state<PublicPhoto[]>([]);
  // Places of the open collection, for its small map.
  let collectionPlaces = $state<PublicPlace[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  // Whether the viewer was opened by us (so Close can use the Back history).
  let viewerPushed = false;

  api.site().then((s) => (siteTitle = s.title)).catch(() => {});
  api.collections().then((c) => (collections = c)).catch(() => (collections = []));
  api.places().then((p) => (places = p)).catch(() => {});
  api.featured().then((f) => (featured = f)).catch(() => {});

  const routeKey = $derived(JSON.stringify(loc.route));
  const route = $derived(JSON.parse(routeKey) as Route);
  const isHomeGrid = $derived(route.view === 'home' && collections !== null && collections.length === 0);

  // Load the photos for the current page (not when only the open photo changes).
  // Each load gets a number; a slower response from an earlier page is ignored.
  let loadSeq = 0;
  $effect(() => {
    const r = route;
    const homeGrid = isHomeGrid;
    const seq = ++loadSeq; // also invalidates earlier loads when this page loads nothing
    if (r.view === 'map' || (r.view === 'home' && collections === null)) return;
    const current = () => seq === loadSeq;
    loading = true;
    error = null;
    const wanted =
      r.view === 'collection' ? api.photos({ collection: r.id })
      : r.view === 'place' ? api.photos({ place: r.id })
      : r.view === 'featured' ? api.photos({ featured: true })
      : r.view === 'all' || homeGrid ? api.photos()
      : Promise.resolve([] as PublicPhoto[]);
    collectionPlaces = [];
    if (r.view === 'collection') api.places(r.id).then((p) => current() && (collectionPlaces = p)).catch(() => {});
    wanted
      .then((p) => current() && (photos = p))
      .catch((e: Error) => current() && (error = e.message))
      .finally(() => current() && (loading = false));
  });

  const collection = $derived(
    route.view === 'collection' ? (collections ?? []).find((c) => c.id === route.id || c.slug === route.id) ?? null : null,
  );
  const place = $derived(route.view === 'place' ? places.find((p) => p.id === route.id) ?? null : null);

  const heading = $derived(
    route.view === 'all' ? 'All photos'
    : route.view === 'map' ? 'Map'
    : route.view === 'featured' ? 'Photography'
    : route.view === 'collection' ? collection?.title ?? 'Collection'
    : route.view === 'place' ? (place ? `${place.name}, ${place.country}` : 'Place')
    : siteTitle,
  );

  // Collection and Featured pages open with a large photo.
  const hero = $derived(
    route.view === 'collection' ? collection?.covers[0]
    : route.view === 'featured' ? featured?.covers[0]
    : undefined,
  );
  // Dates are shown for collections (the Photography page shows just a count).
  const range = $derived(route.view === 'collection' ? formatRange(collection?.dateRange ?? null) : null);
  const placeSummary = $derived(
    collectionPlaces.length
      ? collectionPlaces.slice(0, 2).map((p) => p.name).join(', ') + (collectionPlaces.length > 2 ? ` +${collectionPlaces.length - 2} more` : '')
      : null,
  );

  $effect(() => {
    document.title = route.view === 'home' ? siteTitle : `${heading} · ${siteTitle}`;
  });

  // The list the viewer steps through: the current page's photos.
  const viewerList = $derived(photos);
  const openIndex = $derived(loc.photo ? viewerList.findIndex((p) => p.id === loc.photo) : -1);

  function openPhoto(id: string) {
    viewerPushed = true;
    navigate(href(route, id), { keepScroll: true });
  }
  function showPhoto(i: number) {
    const p = viewerList[i];
    if (p) navigate(href(route, p.id), { replace: true, keepScroll: true });
  }
  function closePhoto() {
    if (viewerPushed) {
      viewerPushed = false;
      history.back();
    } else {
      navigate(href(route), { replace: true, keepScroll: true });
    }
  }
  function goToPlace(id: string) {
    viewerPushed = false;
    navigate(href({ view: 'place', id }));
  }

  // The map (and Leaflet) is only downloaded when a page with a map is opened.
  const loadMap = () => import('./lib/MapView.svelte');
  const loadCollectionMap = () => import('./lib/CollectionMap.svelte');
</script>

<a class="skip visually-hidden" href="#main">Skip to content</a>
{#if route.view !== 'home'}
  <header class="topbar">
    <a class="btn home" href={href({ view: 'home' })} use:link><Icon name="back" /> Home</a>
    <span class="site">{siteTitle}</span>
  </header>
{/if}

<main id="main">
  {#if route.view === 'home' && !isHomeGrid}
    <Home {siteTitle} collections={collections ?? []} {places} {featured} />
  {:else if route.view === 'map'}
    <div class="page-head">
      <h1>Map</h1>
      <p class="sub">Photos by town or city. Tap a circle, or choose a place from the list.</p>
    </div>
    {#await loadMap() then m}
      <m.default {places} />
    {:catch}
      <p class="status">The map couldn't be loaded.</p>
    {/await}
  {:else}
    {#if hero}
      <div class="hero"><img src={previewOf(hero)} alt="" /></div>
    {/if}
    <div class="page-head" class:over-hero={!!hero}>
      {#if route.view === 'featured'}<p class="kicker"><Icon name="star" />Selected favourites</p>{/if}
      <h1>{heading}</h1>
      <p class="meta">
        {#if !loading && !error}<span><Icon name="photo" />{plural(photos.length, 'photo')}</span>{/if}
        {#if range}<span><Icon name="calendar" />{range}</span>{/if}
        {#if route.view === 'collection' && placeSummary}<span><Icon name="pin" />{placeSummary}</span>{/if}
      </p>
      {#if collection?.description}<p class="desc">{collection.description}</p>{/if}
    </div>
    {#if route.view === 'collection' && collectionPlaces.length}
      {#await loadCollectionMap() then m}
        <m.default places={collectionPlaces} />
      {/await}
    {/if}
    {#if error}
      <p class="status">Sorry, the photos couldn't be loaded. Please try again later.</p>
    {:else if loading && photos.length === 0}
      <p class="status">Loading photos…</p>
    {:else if photos.length === 0}
      <p class="status">There are no photos here yet.</p>
      <p><a class="btn" href={href({ view: 'home' })} use:link>Go to the home page</a></p>
    {:else}
      {#if route.view === 'collection' || route.view === 'featured'}
        <div class="section-head"><h2>Photos</h2><span class="chip">{photos.length}</span></div>
      {/if}
      <Gallery {photos} onopen={openPhoto} />
    {/if}
  {/if}
</main>

{#if openIndex >= 0}
  <Lightbox
    photos={viewerList}
    index={openIndex}
    onnavigate={showPhoto}
    onclose={closePhoto}
    onplace={goToPlace}
  />
{/if}

<style>
  .skip:focus {
    position: fixed !important; top: 0.5rem; left: 0.5rem; width: auto; height: auto; clip: auto;
    z-index: 100; background: var(--surface); padding: 0.75rem 1rem;
  }
  .topbar {
    position: sticky; top: 0; z-index: 10;
    display: flex; align-items: center; gap: 1rem;
    padding: 0.5rem 1rem;
    padding-left: max(1rem, env(safe-area-inset-left));
    padding-right: max(1rem, env(safe-area-inset-right));
    min-height: 4rem;
    background: color-mix(in srgb, var(--bg) 88%, transparent);
    -webkit-backdrop-filter: saturate(1.4) blur(12px);
    backdrop-filter: saturate(1.4) blur(12px);
    border-bottom: 0.0625rem solid var(--border);
  }
  .site { font-weight: 700; font-size: 1.05rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .home { flex: none; }
  main {
    max-width: 90rem; margin: 0 auto;
    padding: 1.25rem 1rem 4rem;
    padding-left: max(1rem, env(safe-area-inset-left));
    padding-right: max(1rem, env(safe-area-inset-right));
  }

  .hero {
    border-radius: var(--radius); overflow: hidden; box-shadow: var(--shadow-lg);
    aspect-ratio: 16 / 9; max-height: 55vh; width: 100%; background: var(--surface-2);
  }
  .hero img { width: 100%; height: 100%; object-fit: cover; display: block; }

  .page-head { margin-bottom: 1.5rem; }
  /* On collection/featured pages, the title sits on a card overlapping the photo. */
  .page-head.over-hero {
    position: relative; margin: -2.5rem 0.75rem 1.5rem; padding: 1.1rem 1.25rem 1.25rem;
    background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow-lg);
    max-width: 50rem;
  }
  h1 { font-size: 1.9rem; }
  .sub { margin: 0.35rem 0 0; color: var(--muted); }
  .page-head .meta { margin: 0.5rem 0 0; }
  .kicker {
    display: inline-flex; align-items: center; gap: 0.4rem; margin: 0 0 0.25rem;
    color: var(--muted); font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; font-size: 0.8rem;
  }
  .desc { margin: 0.75rem 0 0; max-width: 45rem; }
  .status { color: var(--muted); padding: 2rem 0; font-size: 1.1rem; }
  @media (max-width: 40rem) {
    h1 { font-size: 1.6rem; }
    .hero { aspect-ratio: 4 / 3; }
    .page-head.over-hero { margin: -2rem 0.4rem 1.25rem; padding: 1rem; }
  }
</style>
