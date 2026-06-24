const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';
const BASE = `${API_URL}/headline-presets`;

export async function getHeadlinePresets(authFetch, { offer } = {}) {
  const params = new URLSearchParams();
  if (offer) params.set('offer', offer);
  const qs = params.toString();
  const res = await authFetch(`${BASE}/${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error('Failed to fetch headline presets');
  return res.json();
}

export async function createHeadlinePreset(authFetch, data) {
  const res = await authFetch(`${BASE}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to create headline preset');
  return res.json();
}

export async function updateHeadlinePreset(authFetch, id, data) {
  const res = await authFetch(`${BASE}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to update headline preset');
  return res.json();
}

export async function deleteHeadlinePreset(authFetch, id) {
  const res = await authFetch(`${BASE}/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete headline preset');
  return res.json();
}
