const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';
const BASE = `${API_URL}/comment-farm`;

export async function createJob(authFetch, data) {
  const res = await authFetch(`${BASE}/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to create job');
  }
  return res.json();
}

export async function listJobs(authFetch, status) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  const qs = params.toString();
  const res = await authFetch(`${BASE}/jobs${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error('Failed to fetch jobs');
  return res.json();
}

export async function getJob(authFetch, jobId) {
  const res = await authFetch(`${BASE}/jobs/${jobId}`);
  if (!res.ok) throw new Error('Failed to fetch job');
  return res.json();
}

export async function deleteJob(authFetch, jobId) {
  const res = await authFetch(`${BASE}/jobs/${jobId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete job');
  return res.json();
}

export async function generateConversation(authFetch, jobId, model = 'sonnet') {
  const res = await authFetch(`${BASE}/jobs/${jobId}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to generate conversation');
  }
  return res.json();
}

export async function addCommenters(authFetch, jobId, personaIds) {
  const res = await authFetch(`${BASE}/jobs/${jobId}/add-commenters`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ persona_ids: personaIds }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to add commenters');
  }
  return res.json();
}

export async function updateEntry(authFetch, entryId, data) {
  const res = await authFetch(`${BASE}/entries/${entryId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to update entry');
  return res.json();
}

export async function deleteEntry(authFetch, entryId) {
  const res = await authFetch(`${BASE}/entries/${entryId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete entry');
  return res.json();
}

export async function executeJob(authFetch, jobId) {
  const res = await authFetch(`${BASE}/jobs/${jobId}/execute`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to execute job');
  }
  return res.json();
}

export async function getJobStatus(authFetch, jobId) {
  const res = await authFetch(`${BASE}/jobs/${jobId}/status`);
  if (!res.ok) throw new Error('Failed to fetch job status');
  return res.json();
}
