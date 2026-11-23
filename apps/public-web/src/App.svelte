<script lang="ts">
  import type { PublicCollection, PublicPhoto, PublicPlace } from '@showcase/shared';
  import { api, plural } from './lib/api';
  import Gallery from './lib/Gallery.svelte';
  import Home from './lib/Home.svelte';
  import Lightbox from './lib/Lightbox.svelte';
  import { href, link, navigate, onNavigate, parse, type Route } from './lib/router';

  let loc = $state(parse(location.search));
  onNavigate(() => (loc = parse(location.search)));

  let siteTitle = $state('Photos');
  let collections = $state<PublicCollection[] | null>(null);
  let places = $state<PublicPlace[]>([]);
  let photos = $state<PublicPhoto[]>([]);
  let featured = $state<PublicPhoto[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  // Whether the viewer was opened by us (so Close can use the Back history).
  let viewerPushed = false;

  api.site().then((s) => (siteTitle = s.title)).catch(() => {});
  api.collections().then((c) => (collections = c)).catch(() => (collections = []));
  api.places().then((p) => (places = p)).catch(() => {});

  const routeKey = $derived(JSON.stringify(loc.route));
  const route = $derived(JSON.parse(routeKey) as Route);
  const isHomeGrid = $derived(route.view === 'home' && collections !== null && collections.length === 0);

  // Load the photos for the current page (not when only the open photo changes).
  $effect(() => {
    const r = route;
    const homeGrid = isHomeGrid;
    if (r.view === 'map' || (r.view === 'home' && collections === null)) return;
    loading = true;
    error = null;
    const wanted =
      r.view === 'collection' ? api.photos({ collection: r.id })
      : r.view === 'place' ? api.photos({ place: r.id })
      : r.view === 'all' || homeGrid ? api.photos()
      : Promise.resolve([] as PublicPhoto[]);
    if (r.view === 'home') api.photos({ featured: true }).then((f) => (featured = f)).catch(() => {});
    wanted
      .then((p) => (photos = p))
      .catch((e: Error) => (error = e.message))
      .finally(() => (loading = false));
  });

  const collection = $derived(
    route.view === 'collection' ? (collections ?? []).find((c) => c.id === route.id || c.slug === route.id) ?? null : null,
  );
  const place = $derived(route.view === 'place' ? places.find((p) => p.id === route.id) ?? null : null);

  const heading = $derived(
    route.view === 'all' ? 'All photos'
    : route.view === 'map' ? 'Map'
    : route.view === 'collection' ? collection?.title ?? 'Collection'
    : route.view === 'place' ? (place ? `${place.name}, ${place.country}` : 'Place')
    : siteTitle,
  );

  $effect(() => {
    document.title = route.view === 'home' ? siteTitle : `${heading} · ${siteTitle}`;
  });

  // The list the viewer steps through: the page's photos, or the featured strip on home.
  const viewerList = $derived(route.view === 'home' && !isHomeGrid ? featured : photos);
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

  // The map (and Leaflet) is only downloaded when the Map page is opened.
  const loadMap = () => import('./lib/MapView.svelte');
</script>

<a class="skip visually-hidden" href="#main">Skip to content</a>
{#if route.view !== 'home'}
  <header class="topbar">
    <a class="btn home" href={href({ view: 'home' })} use:link><span aria-hidden="true">←</span> Home</a>
    <span class="site">{siteTitle}</span>
  </header>
{/if}

<main id="main">
  {#if route.view === 'home' && !isHomeGrid}
    <Home {siteTitle} collections={collections ?? []} {featured} {places} onopen={openPhoto} />
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
    <div class="page-head">
      <h1>{heading}</h1>
      {#if !loading && !error}<p class="sub">{plural(photos.length, 'photo')}</p>{/if}
      {#if collection?.description}<p class="desc">{collection.description}</p>{/if}
    </div>
    {#if error}
      <p class="status">Sorry, the photos couldn't be loaded. Please try again later.</p>
    {:else if loading && photos.length === 0}
      <p class="status">Loading photos…</p>
    {:else if photos.length === 0}
      <p class="status">There are no photos here yet.</p>
      <p><a class="btn" href={href({ view: 'home' })} use:link>Go to the home page</a></p>
    {:else}
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
    z-index: 100; background: var(--bg); padding: 0.75rem 1rem;
  }
  .topbar {
    position: sticky; top: 0; z-index: 10;
    display: flex; align-items: center; gap: 1rem;
    padding: 0.5rem 1rem;
    padding-left: max(1rem, env(safe-area-inset-left));
    padding-right: max(1rem, env(safe-area-inset-right));
    min-height: 4rem;
    background: var(--bg);
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
  .page-head { margin-bottom: 1.25rem; }
  h1 { font-size: 1.75rem; letter-spacing: -0.01em; }
  .sub { margin: 0.25rem 0 0; color: var(--muted); }
  .desc { margin: 0.75rem 0 0; max-width: 45rem; }
  .status { color: var(--muted); padding: 2rem 0; font-size: 1.1rem; }
</style>
