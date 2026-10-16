import { get, put } from '../db.js';

export async function getSettings() {
  const [store, seeded] = await Promise.all([get('settings', 'store'), get('settings', 'seeded')]);
  const { key, ...rest } = store || {};
  return { ...rest, seededAt: seeded ? seeded.seededAt : null };
}

export async function saveSettings(patch) {
  const { seededAt, key, ...clean } = patch || {};
  const current = (await get('settings', 'store')) || { key: 'store' };
  await put('settings', { ...current, ...clean, key: 'store' });
  const next = await getSettings();
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('settings:changed', { detail: next }));
  return next;
}
