const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';
const BASE = `${API_URL}/hero-sync`;

export async function createHeroMap(authFetch, data) {
  const res = await authFetch(`${BASE}/maps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.detail || 'Failed to create hero map'); }
  return res.json();
}

export async function listHeroMaps(authFetch) {
  const res = await authFetch(`${BASE}/maps`);
  if (!res.ok) throw new Error('Failed to load hero maps');
  return res.json();
}

export async function getHeroMap(authFetch, mapId) {
  const res = await authFetch(`${BASE}/maps/${mapId}`);
  if (!res.ok) throw new Error('Failed to load hero map');
  return res.json();
}

export async function updateHeroMap(authFetch, mapId, data) {
  const res = await authFetch(`${BASE}/maps/${mapId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.detail || 'Failed to update'); }
  return res.json();
}

export async function deleteHeroMap(authFetch, mapId) {
  const res = await authFetch(`${BASE}/maps/${mapId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete hero map');
  return res.json();
}

export async function addEntry(authFetch, mapId, data) {
  const res = await authFetch(`${BASE}/maps/${mapId}/entries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.detail || 'Failed to add entry'); }
  return res.json();
}

export async function bulkAddEntries(authFetch, mapId, entries) {
  const res = await authFetch(`${BASE}/maps/${mapId}/entries/bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries }),
  });
  if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.detail || 'Failed to add entries'); }
  return res.json();
}

export async function updateEntry(authFetch, entryId, data) {
  const res = await authFetch(`${BASE}/entries/${entryId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.detail || 'Failed to update entry'); }
  return res.json();
}

export async function deleteEntry(authFetch, entryId) {
  const res = await authFetch(`${BASE}/entries/${entryId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete entry');
  return res.json();
}

export async function getSnippet(authFetch, mapId) {
  const res = await authFetch(`${BASE}/maps/${mapId}/snippet`);
  if (!res.ok) throw new Error('Failed to get snippet');
  return res.json();
}

export async function generateComposites(authFetch, mapId, { imageUrls, keys, labels }) {
  const res = await authFetch(`${BASE}/maps/${mapId}/generate-composites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_urls: imageUrls, keys, labels }),
  });
  if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.detail || 'Failed to generate composites'); }
  return res.json();
}

export async function importPersonas(authFetch, brandId) {
  const params = brandId ? `?brand_id=${brandId}` : '';
  const res = await authFetch(`${BASE}/import-personas${params}`, { method: 'POST' });
  if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.detail || 'Failed to import personas'); }
  return res.json();
}
