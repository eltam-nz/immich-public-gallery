<script lang="ts">
  // Simple stroke icons (decorative; always paired with visible text).
  const PATHS = {
    grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
    map: 'M9 4 3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5 9 4zM9 4v13M15 6.5v13',
    pin: 'M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
    star: 'M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.85L12 16.9l-5.25 2.75 1-5.85L3.5 9.7l5.9-.9L12 3.5z',
    calendar: 'M4 6.5h16V20H4zM4 10h16M8 4v4M16 4v4',
    photo: 'M4 6h16v13H4zM4 15l4.5-4.5 4 4 2.5-2.5L20 17M15.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
    back: 'M15 5l-7 7 7 7',
    chevron: 'M9 5l7 7-7 7',
    home: 'M4 11l8-7 8 7M6 9.5V20h12V9.5',
  } as const;

  let { name, size = '1.25em' }: { name: keyof typeof PATHS; size?: string } = $props();
</script>

<svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false"
  fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
  <path d={PATHS[name]} />
</svg>

<style>
  svg { flex: none; display: inline-block; vertical-align: middle; }
</style>
