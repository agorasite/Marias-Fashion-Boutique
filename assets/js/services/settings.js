import { get, tx, reqP } from '../db.js';

export async function getSettings() {
  const [store, seeded] = await Promise.all([get('settings', 'store'), get('settings', 'seeded')]);
  const { key, ...rest } = store || {};
  return { ...rest, seededAt: seeded ? seeded.seededAt : null };
}

const notify = (next) => {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('settings:changed', { detail: next }));
};

/** Merge the patch into the stored settings (unknown keys kept, seededAt never overwritten): one write, then 'settings:changed'. */
export async function saveSettings(patch) {
  const { seededAt, key, ...clean } = patch || {};
  await tx(['settings'], 'readwrite', async (t) => {
    const store = t.objectStore('settings');
    const current = (await reqP(store.get('store'))) || { key: 'store' };
    await reqP(store.put({ ...current, ...clean, key: 'store' }));
  });
  const next = await getSettings();
  notify(next);
  return next;
}

/** Restore ONLY the store settings to data/catalog-meta.json (products, orders, content are untouched). */
export async function resetSettingsToDefaults() {
  const res = await fetch(new URL('../../../data/catalog-meta.json', import.meta.url));
  if (!res.ok) throw new Error('Failed to load catalog-meta.json');
  const meta = await res.json();
  await tx(['settings'], 'readwrite', (t) => reqP(t.objectStore('settings').put({ key: 'store', ...JSON.parse(JSON.stringify(meta.settings)) })));
  const next = await getSettings();
  notify(next);
  return next;
}
