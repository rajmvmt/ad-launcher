const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';
const BASE = `${API_URL}/personas`;

// ─── Personas ────────────────────────────────────────────────────────────────

export async function getPersonas(authFetch, { isActive, offer, brandId } = {}) {
  const params = new URLSearchParams();
  if (isActive !== undefined) params.set('is_active', isActive);
  if (offer) params.set('offer', offer);
  if (brandId) params.set('brand_id', brandId);
  const qs = params.toString();
  const res = await authFetch(`${BASE}/${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error('Failed to fetch personas');
  return res.json();
}

export async function getPersona(authFetch, id) {
  const res = await authFetch(`${BASE}/${id}`);
  if (!res.ok) throw new Error('Failed to fetch persona');
  return res.json();
}

export async function createPersona(authFetch, data) {
  const res = await authFetch(`${BASE}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to create persona');
  }
  return res.json();
}

export async function updatePersona(authFetch, id, data) {
  const res = await authFetch(`${BASE}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to update persona');
  }
  return res.json();
}

export async function deletePersona(authFetch, id) {
  const res = await authFetch(`${BASE}/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete persona');
  return res.json();
}

// ─── Seed ────────────────────────────────────────────────────────────────────

export async function seedPersonas(authFetch) {
  const res = await authFetch(`${BASE}/seed`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to seed personas');
  }
  return res.json();
}

// ─── Stats ───────────────────────────────────────────────────────────────────

export async function getStats(authFetch) {
  const res = await authFetch(`${BASE}/stats`);
  if (!res.ok) throw new Error('Failed to fetch stats');
  return res.json();
}

// ─── Posts ────────────────────────────────────────────────────────────────────

export async function getPersonaPosts(authFetch, personaId, { postType, status } = {}) {
  const params = new URLSearchParams();
  if (postType) params.set('post_type', postType);
  if (status) params.set('status', status);
  const qs = params.toString();
  const res = await authFetch(`${BASE}/${personaId}/posts${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error('Failed to fetch posts');
  return res.json();
}

export async function generateHeadlines(authFetch, personaId) {
  const res = await authFetch(`${BASE}/${personaId}/generate-headlines`, {
    method: 'POST',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to generate headlines');
  }
  return res.json();
}

export async function updatePost(authFetch, postId, data) {
  const res = await authFetch(`${BASE}/posts/${postId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to update post');
  return res.json();
}

export async function deletePost(authFetch, postId) {
  const res = await authFetch(`${BASE}/posts/${postId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete post');
  return res.json();
}

export async function publishPost(authFetch, personaId, postId, { connectionId, imageUrl }) {
  const res = await authFetch(`${BASE}/${personaId}/posts/${postId}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ connection_id: connectionId, image_url: imageUrl || null }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to publish post');
  }
  return res.json();
}

// ─── Page Posts (fetch from FB) ──────────────────────────────────────────────

export async function getPagePosts(authFetch, personaId, connectionId, limit = 10) {
  const params = new URLSearchParams({ connection_id: connectionId, limit: String(limit) });
  const res = await authFetch(`${BASE}/${personaId}/page-posts?${params}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to fetch page posts');
  }
  return res.json();
}

// ─── Comments ────────────────────────────────────────────────────────────────

export async function getPersonaComments(authFetch, personaId, { commentType, status } = {}) {
  const params = new URLSearchParams();
  if (commentType) params.set('comment_type', commentType);
  if (status) params.set('status', status);
  const qs = params.toString();
  const res = await authFetch(`${BASE}/${personaId}/comments${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error('Failed to fetch comments');
  return res.json();
}

export async function updateComment(authFetch, commentId, data) {
  const res = await authFetch(`${BASE}/comments/${commentId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to update comment');
  return res.json();
}

export async function deleteComment(authFetch, commentId) {
  const res = await authFetch(`${BASE}/comments/${commentId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete comment');
  return res.json();
}

// ─── Image Prompts ───────────────────────────────────────────────────────────

export async function getPersonaImagePrompts(authFetch, personaId, { promptType, status } = {}) {
  const params = new URLSearchParams();
  if (promptType) params.set('prompt_type', promptType);
  if (status) params.set('status', status);
  const qs = params.toString();
  const res = await authFetch(`${BASE}/${personaId}/image-prompts${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error('Failed to fetch image prompts');
  return res.json();
}

export async function updateImagePrompt(authFetch, promptId, data) {
  const res = await authFetch(`${BASE}/image-prompts/${promptId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to update image prompt');
  return res.json();
}

export async function deleteImagePrompt(authFetch, promptId) {
  const res = await authFetch(`${BASE}/image-prompts/${promptId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete image prompt');
  return res.json();
}

// ─── Persona Images ─────────────────────────────────────────────────────────

export async function getPersonaImages(authFetch, personaId, category) {
  const params = new URLSearchParams();
  if (category) params.set('category', category);
  const qs = params.toString();
  const res = await authFetch(`${BASE}/${personaId}/images${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error('Failed to fetch images');
  return res.json();
}

export async function uploadPersonaImage(authFetch, personaId, file, category = 'before_after', notes = '') {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('category', category);
  if (notes) formData.append('notes', notes);
  const res = await authFetch(`${BASE}/${personaId}/images`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to upload image');
  }
  return res.json();
}

export async function deletePersonaImage(authFetch, imageId) {
  const res = await authFetch(`${BASE}/images/${imageId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete image');
  return res.json();
}

// ─── Content Generation ──────────────────────────────────────────────────────

export async function generateContent(authFetch, personaId, contentType = 'all', model = 'sonnet') {
  const res = await authFetch(`${BASE}/${personaId}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content_type: contentType, model }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Content generation failed');
  }
  return res.json();
}

export async function generatePersonaFromImages(authFetch, { brandId, files, imageUrls, gender, ethnicity, model = 'sonnet', queueItemId }) {
  // If we have pre-uploaded R2 URLs, use the JSON endpoint
  if (imageUrls && imageUrls.length > 0) {
    const body = { brand_id: brandId, image_urls: imageUrls, model };
    if (gender) body.gender = gender;
    if (ethnicity) body.ethnicity = ethnicity;
    if (queueItemId) body.queue_item_id = queueItemId;
    const res = await authFetch(`${BASE}/generate-from-urls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to generate persona from images');
    }
    return res.json();
  }

  // Fallback: send files directly (legacy)
  const formData = new FormData();
  formData.append('brand_id', brandId);
  formData.append('model', model);
  if (gender) formData.append('gender', gender);
  if (ethnicity) formData.append('ethnicity', ethnicity);
  (files || []).forEach(file => formData.append('files', file));

  const res = await authFetch(`${BASE}/generate-from-images`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to generate persona from images');
  }
  return res.json();
}

export async function generateBatchPersonas(authFetch, { brandId, count = 1, gender, imagePromptTemplates = null, model = 'sonnet' }) {
  const body = { brand_id: brandId, count, image_prompt_templates: imagePromptTemplates, model };
  if (gender) body.gender = gender;
  const res = await authFetch(`${BASE}/generate-batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to generate personas');
  }
  return res.json();
}

export async function generateAllContent(authFetch, offer = 'akemi', model = 'sonnet') {
  const res = await authFetch(`${BASE}/generate-all`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ offer, model }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Batch generation failed');
  }
  return res.json();
}

// ─── Affiliate URLs ──────────────────────────────────────────────────────────

export async function getAffiliateUrls(authFetch, offer) {
  const params = new URLSearchParams();
  if (offer) params.set('offer', offer);
  const qs = params.toString();
  const res = await authFetch(`${BASE}/affiliate-urls/list${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error('Failed to fetch affiliate URLs');
  return res.json();
}

export async function createAffiliateUrl(authFetch, data) {
  const res = await authFetch(`${BASE}/affiliate-urls`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to create affiliate URL');
  }
  return res.json();
}

export async function deleteAffiliateUrl(authFetch, id) {
  const res = await authFetch(`${BASE}/affiliate-urls/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete affiliate URL');
  return res.json();
}

// ─── Persona Queue ──────────────────────────────────────────────────────────

export async function getPersonaQueue(authFetch, brandId) {
  const res = await authFetch(`${BASE}/queue?brand_id=${encodeURIComponent(brandId)}`);
  if (!res.ok) throw new Error('Failed to fetch persona queue');
  return res.json();
}

export async function addToPersonaQueue(authFetch, { brandId, imageUrls, gender, ethnicity }) {
  const body = { brand_id: brandId, image_urls: imageUrls };
  if (gender) body.gender = gender;
  if (ethnicity) body.ethnicity = ethnicity;
  const res = await authFetch(`${BASE}/queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('Failed to add to persona queue');
  return res.json();
}

export async function removeFromPersonaQueue(authFetch, id) {
  const res = await authFetch(`${BASE}/queue/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to remove from persona queue');
  return res.json();
}

export async function clearPersonaQueue(authFetch, brandId) {
  const res = await authFetch(`${BASE}/queue/clear?brand_id=${encodeURIComponent(brandId)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to clear persona queue');
  return res.json();
}

// ─── Model Comparison ───────────────────────────────────────────────────────

export async function generateModelComparison(authFetch, personaId) {
  const res = await authFetch(`${API_URL}/model-compare/generate-comparison`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ persona_id: personaId }),
  });
  if (!res.ok) throw new Error('Failed to generate comparison');
  return res.json();
}

// ─── Winners ────────────────────────────────────────────────────────────────

export async function getWinners(authFetch, { offer } = {}) {
  const params = new URLSearchParams();
  if (offer) params.set('offer', offer);
  const qs = params.toString();
  const res = await authFetch(`${BASE}/winners${qs ? `?${qs}` : ''}`);
  if (!res.ok) throw new Error('Failed to fetch winners');
  return res.json();
}

export async function promoteWinner(authFetch, personaId, { notes, proven_offers } = {}) {
  const res = await authFetch(`${BASE}/${personaId}/promote-winner`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes, proven_offers }),
  });
  if (!res.ok) throw new Error('Failed to promote persona to winner');
  return res.json();
}

export async function demoteWinner(authFetch, personaId) {
  const res = await authFetch(`${BASE}/${personaId}/demote-winner`, {
    method: 'PATCH',
  });
  if (!res.ok) throw new Error('Failed to demote persona');
  return res.json();
}

export async function updateWinnerNotes(authFetch, personaId, { notes, proven_offers } = {}) {
  const res = await authFetch(`${BASE}/${personaId}/winner-notes`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes, proven_offers }),
  });
  if (!res.ok) throw new Error('Failed to update winner notes');
  return res.json();
}
