/**
 * Tiny query-string router. Every view has its own URL, so the browser's Back
 * button always works and pages can be bookmarked or shared:
 *   /            home         /?view=all     all photos
 *   /?c=<id>     collection   /?place=<id>   one place      /?view=map   map
 *   &p=<id>      a photo open in the viewer
 */
export type Route =
  | { view: 'home' }
  | { view: 'all' }
  | { view: 'map' }
  | { view: 'collection'; id: string }
  | { view: 'place'; id: string };

export interface RouteState {
  route: Route;
  photo: string | null;
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function parse(search: string): RouteState {
  const q = new URLSearchParams(search);
  const photo = q.get('p');
  const c = q.get('c');
  const place = q.get('place');
  const view = q.get('view');
  let route: Route = { view: 'home' };
  if (c && ID_RE.test(c)) route = { view: 'collection', id: c };
  else if (place && ID_RE.test(place)) route = { view: 'place', id: place };
  else if (view === 'all') route = { view: 'all' };
  else if (view === 'map') route = { view: 'map' };
  return { route, photo: photo && ID_RE.test(photo) ? photo : null };
}

export function href(route: Route, photo?: string | null): string {
  const q = new URLSearchParams();
  if (route.view === 'collection') q.set('c', route.id);
  else if (route.view === 'place') q.set('place', route.id);
  else if (route.view !== 'home') q.set('view', route.view);
  if (photo) q.set('p', photo);
  const s = q.toString();
  return s ? `?${s}` : location.pathname;
}

const listeners = new Set<() => void>();
export function onNavigate(fn: () => void): () => void {
  listeners.add(fn);
  const pop = () => fn();
  addEventListener('popstate', pop);
  return () => {
    listeners.delete(fn);
    removeEventListener('popstate', pop);
  };
}

export function navigate(url: string, opts: { replace?: boolean; keepScroll?: boolean } = {}): void {
  if (opts.replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
  if (!opts.keepScroll) scrollTo({ top: 0 });
  for (const fn of listeners) fn();
}

/** Svelte action: same-site links navigate without reloading the page. */
export function link(node: HTMLAnchorElement) {
  const click = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (node.origin !== location.origin || node.target) return;
    e.preventDefault();
    navigate(node.pathname + node.search);
  };
  node.addEventListener('click', click);
  return { destroy: () => node.removeEventListener('click', click) };
}
