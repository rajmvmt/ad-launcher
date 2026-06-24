import React, { useState, useEffect, useCallback, useRef } from 'react';
import { FileText, RefreshCw, Loader, Trash2, X, Search, Edit2, Plus, Send, ExternalLink, Image as ImageIcon, ChevronDown, Upload, MessageSquare, Shield } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useBrands } from '../context/BrandContext';
import { getConnections } from '../api/facebookConnections';
import { getAdAccounts } from '../lib/facebookApi';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

export default function FacebookPages() {
    const { authFetch } = useAuth();
    const { showSuccess, showError, showWarning } = useToast();
    const { brands } = useBrands();

    const [pages, setPages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [filterBrand, setFilterBrand] = useState('');
    const [filterAccount, setFilterAccount] = useState('');
    const [searchTerm, setSearchTerm] = useState('');

    // Edit modal
    const [editPage, setEditPage] = useState(null);
    const [editBrand, setEditBrand] = useState('');
    const [editAccount, setEditAccount] = useState('');
    const [editDomain, setEditDomain] = useState('');
    const [editNotes, setEditNotes] = useState('');
    const [saving, setSaving] = useState(false);

    // Delete
    const [deletingId, setDeletingId] = useState(null);

    // Ad accounts & domains
    const [adAccounts, setAdAccounts] = useState([]);
    const [domains, setDomains] = useState([]);

    // Post modal
    const [postPage, setPostPage] = useState(null);
    const [postMessage, setPostMessage] = useState('');
    const [postImageUrl, setPostImageUrl] = useState('');
    const [postImagePreview, setPostImagePreview] = useState('');
    const [postLink, setPostLink] = useState('');
    const [postFirstComment, setPostFirstComment] = useState('For those who would like to see the article: ');
    const [posting, setPosting] = useState(false);
    const [uploadingImage, setUploadingImage] = useState(false);
    const [lastPostUrl, setLastPostUrl] = useState(null);
    const fileInputRef = useRef(null);
    const dropZoneRef = useRef(null);

    // Persona posts picker
    const [personaPosts, setPersonaPosts] = useState([]);
    const [loadingPersonaPosts, setLoadingPersonaPosts] = useState(false);
    const [showPersonaPicker, setShowPersonaPicker] = useState(false);

    // Persona images picker
    const [personaImages, setPersonaImages] = useState([]);
    const [loadingPersonaImages, setLoadingPersonaImages] = useState(false);
    const [showImagePicker, setShowImagePicker] = useState(false);

    // Comment filters
    const [applyingFilters, setApplyingFilters] = useState(null);

    // Load ad accounts and domains
    useEffect(() => {
        (async () => {
            try {
                const conns = await getConnections();
                const def = conns.find(c => c.is_default) || conns[0];
                if (def) {
                    const accounts = await getAdAccounts(def.id);
                    setAdAccounts(accounts);
                }
            } catch (e) {
                console.warn('Failed to load ad accounts:', e);
            }
            try {
                const res = await authFetch(`${API_URL}/domains`);
                if (res.ok) setDomains(await res.json());
            } catch (e) {
                console.warn('Failed to load domains:', e);
            }
        })();
    }, []);

    const fetchPages = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (filterBrand) params.set('brand_id', filterBrand);
            if (filterAccount) params.set('ad_account_id', filterAccount);
            const res = await authFetch(`${API_URL}/tracked-pages?${params}`);
            if (res.ok) setPages(await res.json());
        } catch { showError('Failed to load pages'); }
        finally { setLoading(false); }
    }, [authFetch, filterBrand, filterAccount]);

    useEffect(() => { fetchPages(); }, [fetchPages]);

    // ── Sync ────────────────────────────────────────
    const handleSync = async () => {
        setSyncing(true);
        try {
            const res = await authFetch(`${API_URL}/tracked-pages/sync`, { method: 'POST' });
            if (res.ok) {
                const data = await res.json();
                showSuccess(`Synced ${data.synced} pages (${data.created} new)`);
                fetchPages();
            } else {
                const err = await res.json();
                showError(err.detail || 'Sync failed');
            }
        } catch { showError('Sync failed'); }
        finally { setSyncing(false); }
    };

    // ── Edit ────────────────────────────────────────
    const openEdit = (page) => {
        setEditPage(page);
        setEditBrand(page.brand_id || '');
        setEditAccount(page.ad_account_id || '');
        setEditDomain(page.domain_id || '');
        setEditNotes(page.notes || '');
    };

    const handleSaveEdit = async () => {
        if (!editPage) return;
        setSaving(true);
        try {
            const res = await authFetch(`${API_URL}/tracked-pages/${editPage.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    brand_id: editBrand,
                    ad_account_id: editAccount,
                    domain_id: editDomain,
                    notes: editNotes,
                }),
            });
            if (res.ok) {
                showSuccess('Page updated');
                setEditPage(null);
                fetchPages();
            } else {
                const err = await res.json();
                showError(err.detail || 'Update failed');
            }
        } catch { showError('Update failed'); }
        finally { setSaving(false); }
    };

    // ── Delete ──────────────────────────────────────
    const handleDelete = async (page) => {
        if (!window.confirm(`Remove "${page.name}" from tracked pages?`)) return;
        setDeletingId(page.id);
        try {
            const res = await authFetch(`${API_URL}/tracked-pages/${page.id}`, { method: 'DELETE' });
            if (res.ok) {
                showSuccess(`Removed ${page.name}`);
                fetchPages();
            }
        } catch { showError('Delete failed'); }
        finally { setDeletingId(null); }
    };

    // ── Apply Comment Filters ─────────────────────────
    const handleApplyFilters = async (page) => {
        setApplyingFilters(page.id);
        try {
            const res = await authFetch(`${API_URL}/tracked-pages/${page.id}/comment-filters`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ append: true }),
            });
            const data = await res.json();
            if (res.ok && data.success) {
                showSuccess(`Applied ${data.keywords_applied} filter keywords to "${page.name}"`);
            } else {
                showError(data.detail || 'Failed to apply filters');
            }
        } catch (e) { showError(e.message || 'Failed to apply filters'); }
        finally { setApplyingFilters(null); }
    };

    // ── Manual Add ─────────────────────────────────
    const [addPageId, setAddPageId] = useState('');
    const [adding, setAdding] = useState(false);

    const handleAddPage = async () => {
        const val = addPageId.trim();
        if (!val) return;
        setAdding(true);
        try {
            const res = await authFetch(`${API_URL}/tracked-pages/add`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fb_page_id: val }),
            });
            if (res.ok) {
                const data = await res.json();
                if (data.status === 'already_exists') {
                    showWarning(`"${data.page.name}" is already tracked`);
                } else {
                    showSuccess(`Added "${data.page.name}"`);
                }
                setAddPageId('');
                fetchPages();
            } else {
                const err = await res.json();
                showError(err.detail || 'Failed to add page');
            }
        } catch { showError('Failed to add page'); }
        finally { setAdding(false); }
    };

    // ── Image Upload ─────────────────────────────────
    const handleImageUpload = async (file) => {
        if (!file) return;
        setUploadingImage(true);
        try {
            const formData = new FormData();
            formData.append('file', file);
            const res = await authFetch(`${API_URL}/uploads/`, {
                method: 'POST',
                body: formData,
            });
            if (res.ok) {
                const data = await res.json();
                const url = data.url || data.file_url;
                setPostImageUrl(url);
                setPostImagePreview(url);
            } else {
                const err = await res.json();
                showError(err.detail || 'Upload failed');
            }
        } catch { showError('Image upload failed'); }
        finally { setUploadingImage(false); }
    };

    const handleFileDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const file = e.dataTransfer?.files?.[0];
        if (file && file.type.startsWith('image/')) handleImageUpload(file);
    };

    const handlePaste = (e) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        for (const item of items) {
            if (item.type.startsWith('image/')) {
                e.preventDefault();
                const file = item.getAsFile();
                if (file) handleImageUpload(file);
                return;
            }
        }
    };

    // ── Post to Page ─────────────────────────────────
    const openPostModal = (page) => {
        setPostPage(page);
        setPostMessage('');
        setPostImageUrl('');
        setPostImagePreview('');
        setPostLink('');
        setPostFirstComment('For those who would like to see the article: ');
        setLastPostUrl(null);
        setShowPersonaPicker(false);
        setShowImagePicker(false);
    };

    const handlePublishPost = async () => {
        if (!postPage || !postMessage.trim()) return;
        setPosting(true);
        try {
            const res = await authFetch(`${API_URL}/facebook/pages/${postPage.fb_page_id}/posts`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: postMessage.trim(),
                    image_url: postImageUrl.trim() || undefined,
                    link: postLink.trim() || undefined,
                    first_comment: postFirstComment.trim() || undefined,
                }),
            });
            if (res.ok) {
                const data = await res.json();
                showSuccess('Post published!');
                setLastPostUrl(data.post_url);
            } else {
                const err = await res.json();
                showError(err.detail || 'Failed to publish post');
            }
        } catch { showError('Failed to publish post'); }
        finally { setPosting(false); }
    };

    // Fetch persona posts for picker
    const loadPersonaPosts = async () => {
        if (personaPosts.length > 0) {
            setShowPersonaPicker(!showPersonaPicker);
            return;
        }
        setLoadingPersonaPosts(true);
        try {
            const res = await authFetch(`${API_URL}/personas/?limit=100`);
            if (res.ok) {
                const personas = await res.json();
                const allPosts = [];
                for (const p of (personas.items || personas)) {
                    try {
                        const postRes = await authFetch(`${API_URL}/personas/${p.id}/posts`);
                        if (postRes.ok) {
                            const posts = await postRes.json();
                            for (const post of posts) {
                                allPosts.push({ ...post, persona_name: p.name, persona_id: p.id });
                            }
                        }
                    } catch { /* skip */ }
                }
                setPersonaPosts(allPosts);
                setShowPersonaPicker(true);
            }
        } catch { showError('Failed to load persona posts'); }
        finally { setLoadingPersonaPosts(false); }
    };

    // Fetch persona images for picker
    const loadPersonaImages = async () => {
        if (personaImages.length > 0) {
            setShowImagePicker(!showImagePicker);
            return;
        }
        setLoadingPersonaImages(true);
        try {
            const res = await authFetch(`${API_URL}/personas/?limit=100`);
            if (res.ok) {
                const personas = await res.json();
                const allImages = [];
                for (const p of (personas.items || personas)) {
                    try {
                        const imgRes = await authFetch(`${API_URL}/personas/${p.id}/images`);
                        if (imgRes.ok) {
                            const images = await imgRes.json();
                            for (const img of images) {
                                allImages.push({ ...img, persona_name: p.name });
                            }
                        }
                    } catch { /* skip */ }
                }
                setPersonaImages(allImages);
                setShowImagePicker(true);
            }
        } catch { showError('Failed to load persona images'); }
        finally { setLoadingPersonaImages(false); }
    };

    // ── Filter by search term ───────────────────────
    const filtered = pages.filter(p => {
        if (searchTerm) {
            const s = searchTerm.toLowerCase();
            return p.name.toLowerCase().includes(s) || p.fb_page_id.includes(s);
        }
        return true;
    });

    return (
        <div className="max-w-7xl mx-auto">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                        <FileText className="text-amber-600" size={28} />
                        FB Pages
                    </h1>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                        Track, manage, and post to your Facebook pages
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1">
                        <input
                            type="text"
                            value={addPageId}
                            onChange={e => setAddPageId(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleAddPage(); }}
                            placeholder="FB Page ID"
                            className="w-36 sm:w-44 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
                        />
                        <button
                            onClick={handleAddPage}
                            disabled={adding || !addPageId.trim()}
                            className="flex items-center gap-1 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors disabled:opacity-50 text-sm"
                        >
                            {adding ? <Loader size={14} className="animate-spin" /> : <Plus size={14} />}
                            Add
                        </button>
                    </div>
                    <button
                        onClick={handleSync}
                        disabled={syncing}
                        className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors disabled:opacity-50"
                    >
                        {syncing ? <Loader size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                        {syncing ? 'Syncing...' : 'Sync from Facebook'}
                    </button>
                </div>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-3 mb-6">
                <div className="relative flex-1 min-w-[200px]">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        placeholder="Search pages..."
                        className="w-full pl-9 pr-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
                    />
                </div>
                <select
                    value={filterBrand}
                    onChange={e => setFilterBrand(e.target.value)}
                    className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
                >
                    <option value="">All Brands</option>
                    {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                <select
                    value={filterAccount}
                    onChange={e => setFilterAccount(e.target.value)}
                    className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
                >
                    <option value="">All Ad Accounts</option>
                    {adAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
            </div>

            {/* Loading */}
            {loading ? (
                <div className="flex items-center justify-center py-20">
                    <Loader size={32} className="animate-spin text-amber-600" />
                </div>
            ) : filtered.length === 0 ? (
                <div className="text-center py-20 text-gray-500 dark:text-gray-400">
                    <FileText size={48} className="mx-auto mb-4 opacity-40" />
                    <p className="text-lg font-medium">No pages found</p>
                    <p className="text-sm mt-1">Click "Sync from Facebook" to import your pages</p>
                </div>
            ) : (
                /* Page Grid */
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filtered.map(page => {
                        const brand = brands.find(b => b.id === page.brand_id);
                        const account = adAccounts.find(a => a.id === page.ad_account_id);
                        const domain = domains.find(d => d.id === page.domain_id);

                        return (
                            <div key={page.id} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-4 hover:shadow-md transition-shadow">
                                <div className="flex items-start gap-3">
                                    <img
                                        src={page.picture_url || `https://graph.facebook.com/${page.fb_page_id}/picture?type=small`}
                                        alt={page.name}
                                        className="w-12 h-12 rounded-full bg-gray-200 dark:bg-gray-700 flex-shrink-0"
                                        onError={e => { e.target.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23ddd" width="100" height="100"/><text x="50" y="55" text-anchor="middle" font-size="40" fill="%23999">?</text></svg>'; }}
                                    />
                                    <div className="flex-1 min-w-0">
                                        <h3 className="font-semibold text-gray-900 dark:text-white truncate">{page.name}</h3>
                                        {page.category && (
                                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{page.category}</p>
                                        )}
                                        <p className="text-xs text-gray-400 dark:text-gray-500 font-mono mt-0.5">{page.fb_page_id}</p>
                                    </div>
                                    <div className="flex gap-1">
                                        <a
                                            href={`https://facebook.com/${page.fb_page_id}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="p-1.5 text-gray-400 hover:text-blue-600 transition-colors"
                                            title="View page on Facebook"
                                        >
                                            <ExternalLink size={14} />
                                        </a>
                                        <button
                                            onClick={() => openPostModal(page)}
                                            className="p-1.5 text-gray-400 hover:text-blue-600 transition-colors"
                                            title="Post to this page"
                                        >
                                            <Send size={14} />
                                        </button>
                                        <button
                                            onClick={() => handleApplyFilters(page)}
                                            disabled={applyingFilters === page.id}
                                            className="p-1.5 text-gray-400 hover:text-green-600 transition-colors disabled:opacity-50"
                                            title="Apply comment filters"
                                        >
                                            {applyingFilters === page.id ? <Loader size={14} className="animate-spin" /> : <Shield size={14} />}
                                        </button>
                                        <button onClick={() => openEdit(page)} className="p-1.5 text-gray-400 hover:text-amber-600 transition-colors" title="Edit">
                                            <Edit2 size={14} />
                                        </button>
                                        <button
                                            onClick={() => handleDelete(page)}
                                            disabled={deletingId === page.id}
                                            className="p-1.5 text-gray-400 hover:text-red-600 transition-colors disabled:opacity-50"
                                            title="Remove"
                                        >
                                            {deletingId === page.id ? <Loader size={14} className="animate-spin" /> : <Trash2 size={14} />}
                                        </button>
                                    </div>
                                </div>

                                <div className="mt-3 space-y-1.5">
                                    {brand && (
                                        <div className="flex items-center gap-2 text-xs">
                                            <span className="text-gray-400 dark:text-gray-500 w-16">Brand:</span>
                                            <span className="text-gray-700 dark:text-gray-300 font-medium">{brand.name}</span>
                                        </div>
                                    )}
                                    {account && (
                                        <div className="flex items-center gap-2 text-xs">
                                            <span className="text-gray-400 dark:text-gray-500 w-16">Account:</span>
                                            <span className="text-gray-700 dark:text-gray-300 font-medium">{account.name}</span>
                                        </div>
                                    )}
                                    {domain && (
                                        <div className="flex items-center gap-2 text-xs">
                                            <span className="text-gray-400 dark:text-gray-500 w-16">Domain:</span>
                                            <span className="text-gray-700 dark:text-gray-300 font-medium">{domain.name}</span>
                                        </div>
                                    )}
                                    {page.notes && (
                                        <div className="flex items-start gap-2 text-xs">
                                            <span className="text-gray-400 dark:text-gray-500 w-16">Notes:</span>
                                            <span className="text-gray-600 dark:text-gray-400 line-clamp-2">{page.notes}</span>
                                        </div>
                                    )}
                                    {page.last_post_at && (
                                        <div className="flex items-center gap-2 text-xs">
                                            <span className="text-gray-400 dark:text-gray-500 w-16">Last post:</span>
                                            <span className="text-gray-600 dark:text-gray-400">{new Date(page.last_post_at).toLocaleDateString()}</span>
                                        </div>
                                    )}
                                    {!brand && !account && !domain && !page.notes && (
                                        <p className="text-xs text-gray-400 dark:text-gray-500 italic">No associations — click edit to assign</p>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Edit Modal */}
            {editPage && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setEditPage(null)}>
                    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
                            <div className="flex items-center gap-3">
                                <img
                                    src={editPage.picture_url || `https://graph.facebook.com/${editPage.fb_page_id}/picture?type=small`}
                                    alt={editPage.name}
                                    className="w-8 h-8 rounded-full"
                                    onError={e => { e.target.style.display = 'none'; }}
                                />
                                <h3 className="font-semibold text-gray-900 dark:text-white">{editPage.name}</h3>
                            </div>
                            <button onClick={() => setEditPage(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                        </div>
                        <div className="p-4 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Brand</label>
                                <select value={editBrand} onChange={e => setEditBrand(e.target.value)} className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm">
                                    <option value="">No brand</option>
                                    {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Ad Account</label>
                                <select value={editAccount} onChange={e => setEditAccount(e.target.value)} className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm">
                                    <option value="">No ad account</option>
                                    {adAccounts.filter(a => !pages.some(p => p.ad_account_id === a.id && p.id !== editPage?.id)).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Domain</label>
                                <select value={editDomain} onChange={e => setEditDomain(e.target.value)} className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm">
                                    <option value="">No domain</option>
                                    {domains.filter(d => !pages.some(p => p.domain_id === d.id && p.id !== editPage?.id)).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notes</label>
                                <textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} rows={3} className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm" placeholder="Optional notes..." />
                            </div>
                        </div>
                        <div className="flex justify-end gap-2 p-4 border-t border-gray-200 dark:border-gray-700">
                            <button onClick={() => setEditPage(null)} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">Cancel</button>
                            <button onClick={handleSaveEdit} disabled={saving} className="px-4 py-2 text-sm bg-amber-600 hover:bg-amber-700 text-white rounded-lg disabled:opacity-50">
                                {saving ? 'Saving...' : 'Save'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Post to Page Modal */}
            {postPage && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setPostPage(null)}>
                    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()} onPaste={handlePaste}>
                        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-900 z-10">
                            <div className="flex items-center gap-3">
                                <img
                                    src={postPage.picture_url || `https://graph.facebook.com/${postPage.fb_page_id}/picture?type=small`}
                                    alt={postPage.name}
                                    className="w-8 h-8 rounded-full"
                                    onError={e => { e.target.style.display = 'none'; }}
                                />
                                <div>
                                    <h3 className="font-semibold text-gray-900 dark:text-white">Post to {postPage.name}</h3>
                                    <p className="text-xs text-gray-400">Publish as this page</p>
                                </div>
                            </div>
                            <button onClick={() => setPostPage(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                        </div>
                        <div className="p-4 space-y-4">
                            {/* Persona post picker */}
                            <div>
                                <button
                                    onClick={loadPersonaPosts}
                                    disabled={loadingPersonaPosts}
                                    className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
                                >
                                    {loadingPersonaPosts ? <Loader size={14} className="animate-spin" /> : <ChevronDown size={14} className={showPersonaPicker ? 'rotate-180 transition-transform' : 'transition-transform'} />}
                                    Pick from Persona Posts
                                </button>
                                {showPersonaPicker && personaPosts.length > 0 && (
                                    <div className="mt-2 max-h-48 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-800">
                                        {personaPosts.map((post, i) => (
                                            <button
                                                key={post.id || i}
                                                onClick={() => {
                                                    setPostMessage(post.body_text || post.content || '');
                                                    setShowPersonaPicker(false);
                                                }}
                                                className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                                            >
                                                <span className="text-xs font-medium text-amber-600">{post.persona_name}</span>
                                                <span className="text-xs text-gray-400 ml-2">{post.post_type}</span>
                                                <p className="text-sm text-gray-700 dark:text-gray-300 line-clamp-2 mt-0.5">
                                                    {post.body_text || post.content || ''}
                                                </p>
                                            </button>
                                        ))}
                                    </div>
                                )}
                                {showPersonaPicker && personaPosts.length === 0 && !loadingPersonaPosts && (
                                    <p className="mt-2 text-xs text-gray-400">No persona posts found. Generate some in Persona Farm first.</p>
                                )}
                            </div>

                            {/* Message */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Message</label>
                                <textarea
                                    value={postMessage}
                                    onChange={e => setPostMessage(e.target.value)}
                                    rows={6}
                                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm resize-y"
                                    placeholder="Write your post or pick from persona posts above..."
                                />
                                <p className="text-xs text-gray-400 mt-1 text-right">{postMessage.length} characters</p>
                            </div>

                            {/* Image Upload / Paste / Persona Pick */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    <ImageIcon size={14} className="inline mr-1" />
                                    Image <span className="text-gray-400 font-normal">(optional)</span>
                                </label>

                                {postImagePreview ? (
                                    <div className="relative inline-block">
                                        <img src={postImagePreview} alt="Post image" className="max-h-40 rounded-lg border border-gray-200 dark:border-gray-700" />
                                        <button
                                            onClick={() => { setPostImageUrl(''); setPostImagePreview(''); }}
                                            className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-0.5 hover:bg-red-600"
                                        >
                                            <X size={14} />
                                        </button>
                                    </div>
                                ) : (
                                    <div
                                        ref={dropZoneRef}
                                        onDrop={handleFileDrop}
                                        onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
                                        onClick={() => fileInputRef.current?.click()}
                                        className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-4 text-center cursor-pointer hover:border-amber-400 dark:hover:border-amber-500 transition-colors"
                                    >
                                        {uploadingImage ? (
                                            <div className="flex items-center justify-center gap-2 text-gray-500">
                                                <Loader size={16} className="animate-spin" />
                                                <span className="text-sm">Uploading...</span>
                                            </div>
                                        ) : (
                                            <>
                                                <Upload size={20} className="mx-auto text-gray-400 mb-1" />
                                                <p className="text-sm text-gray-500 dark:text-gray-400">
                                                    Drop image, paste from clipboard, or click to upload
                                                </p>
                                            </>
                                        )}
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            accept="image/*"
                                            className="hidden"
                                            onChange={e => {
                                                const file = e.target.files?.[0];
                                                if (file) handleImageUpload(file);
                                            }}
                                        />
                                    </div>
                                )}

                                {/* Pick from persona images */}
                                {!postImagePreview && (
                                    <button
                                        onClick={loadPersonaImages}
                                        disabled={loadingPersonaImages}
                                        className="mt-2 flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 transition-colors"
                                    >
                                        {loadingPersonaImages ? <Loader size={14} className="animate-spin" /> : <ChevronDown size={14} className={showImagePicker ? 'rotate-180 transition-transform' : 'transition-transform'} />}
                                        Pick from Persona Images
                                    </button>
                                )}
                                {showImagePicker && personaImages.length > 0 && !postImagePreview && (
                                    <div className="mt-2 max-h-52 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg p-2">
                                        <div className="grid grid-cols-4 gap-2">
                                            {personaImages.map((img, i) => (
                                                <button
                                                    key={img.id || i}
                                                    onClick={() => {
                                                        setPostImageUrl(img.url);
                                                        setPostImagePreview(img.url);
                                                        setShowImagePicker(false);
                                                    }}
                                                    className="relative group"
                                                    title={`${img.persona_name} - ${img.category}`}
                                                >
                                                    <img src={img.url} alt={img.category} className="w-full h-20 object-cover rounded-lg border border-gray-200 dark:border-gray-700 group-hover:border-amber-400 transition-colors" />
                                                    <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] px-1 py-0.5 rounded-b-lg truncate">
                                                        {img.persona_name}
                                                    </span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                {showImagePicker && personaImages.length === 0 && !loadingPersonaImages && (
                                    <p className="mt-2 text-xs text-gray-400">No persona images found.</p>
                                )}
                            </div>

                            {/* Link (only if no image) */}
                            {!postImageUrl.trim() && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        Link <span className="text-gray-400 font-normal">(optional, no image)</span>
                                    </label>
                                    <input
                                        type="text"
                                        value={postLink}
                                        onChange={e => setPostLink(e.target.value)}
                                        className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
                                        placeholder="https://example.com/article"
                                    />
                                </div>
                            )}

                            {/* First Comment */}
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                    <MessageSquare size={14} className="inline mr-1" />
                                    First Comment <span className="text-gray-400 font-normal">(optional, posted as Page after publish)</span>
                                </label>
                                <input
                                    type="text"
                                    value={postFirstComment}
                                    onChange={e => setPostFirstComment(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
                                    placeholder="e.g. For those asking, here's the article: https://your-link.com"
                                />
                            </div>

                            {/* Success result */}
                            {lastPostUrl && (
                                <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                                    <span className="text-sm text-green-700 dark:text-green-400 font-medium">Post published!</span>
                                    <a
                                        href={lastPostUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 underline"
                                    >
                                        View on Facebook <ExternalLink size={12} />
                                    </a>
                                </div>
                            )}
                        </div>
                        <div className="flex justify-end gap-2 p-4 border-t border-gray-200 dark:border-gray-700 sticky bottom-0 bg-white dark:bg-gray-900">
                            <button onClick={() => setPostPage(null)} className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">Cancel</button>
                            <button
                                onClick={handlePublishPost}
                                disabled={posting || !postMessage.trim()}
                                className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 transition-colors"
                            >
                                {posting ? <Loader size={14} className="animate-spin" /> : <Send size={14} />}
                                {posting ? 'Publishing...' : 'Publish Post'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
