// Small shared UI state: phone layout detection, hash routing and toasts.

// ---- Layout ----
const phoneQuery = matchMedia('(max-width: 700px)');
export const media = $state({ phone: phoneQuery.matches });
phoneQuery.addEventListener('change', (e) => (media.phone = e.matches));

// ---- Hash routing: #photos, #photos/<photoId>, #collections, #sync ----
export type Tab = 'photos' | 'collections' | 'sync';
const TABS: Tab[] = ['photos', 'collections', 'sync'];

function parseHash(): { tab: Tab; photo: string | null } {
  const [tab, photo] = location.hash.slice(1).split('/');
  const t = TABS.includes(tab as Tab) ? (tab as Tab) : 'photos';
  return { tab: t, photo: t === 'photos' && photo && /^[A-Za-z0-9_-]{16}$/.test(photo) ? photo : null };
}

export const route = $state(parseHash());

/** Set by the photo editor so Back can't silently discard unsaved edits. */
export const editorGuard = $state({ dirty: false, leaving: false });

// popstate also fires for hash changes (Back/Forward and typed hashes).
addEventListener('popstate', () => {
  const next = parseHash();
  if (route.photo && next.photo !== route.photo && editorGuard.dirty && !editorGuard.leaving) {
    if (!confirm('Discard unsaved changes to this photo?')) {
      // Stay on the photo: put its entry back.
      history.pushState(null, '', `#${route.tab}/${route.photo}`);
      return;
    }
  }
  editorGuard.leaving = false;
  Object.assign(route, next);
});

let pushedEditor = false;

export function go(tab: Tab, photo: string | null = null, opts: { replace?: boolean } = {}) {
  // Leaving a photo with unsaved edits by another route (e.g. a tab) asks first too.
  if (route.photo && photo !== route.photo && editorGuard.dirty && !editorGuard.leaving) {
    if (!confirm('Discard unsaved changes to this photo?')) return;
  }
  const hash = `#${tab}${photo ? `/${photo}` : ''}`;
  if (opts.replace) history.replaceState(null, '', hash);
  else history.pushState(null, '', hash);
  Object.assign(route, { tab, photo });
}

/** Open a photo in the editor; the phone's Back button then closes it. */
export function openPhoto(id: string) {
  if (route.photo) go('photos', id, { replace: true });
  else {
    pushedEditor = true;
    go('photos', id);
  }
}

export function closePhoto() {
  if (pushedEditor) {
    pushedEditor = false;
    history.back();
  } else go('photos', null, { replace: true });
}

// ---- Toasts ----
export const toast = $state({ text: '', error: false, id: 0 });
let timer: ReturnType<typeof setTimeout> | undefined;

export function notify(text: string, error = false) {
  clearTimeout(timer);
  Object.assign(toast, { text, error, id: toast.id + 1 });
  timer = setTimeout(() => (toast.text = ''), error ? 6000 : 3000);
}
