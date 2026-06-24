import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Bookmark, Plus, Trash2, ExternalLink, Star, Search, Filter,
    Loader, Image as ImageIcon, Video, X, Link2, ChevronDown,
    Tag, Sparkles, Globe, Download, Check, Clock, TrendingUp,
    Compass, BarChart3, RefreshCw, StickyNote, Edit3, Users, FolderOpen
} from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { useBrands } from '../context/BrandContext';
import {
    getSwipes, getCollections, getStats, getNiches, getCategories,
    createSwipe, toggleStar, deleteSwipe, bulkDeleteSwipes,
    analyzeSwipe, analyzeBulk,
    searchAdLibrary, saveAdFromLibrary,
    refreshIgThumbnails
} from '../lib/swipeFileApi';

const LANDER_API = (import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1') + '/landers';
const COMPETITOR_API = (import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1') + '/competitors';

const PLATFORMS = ['facebook', 'instagram', 'tiktok', 'youtube', 'other'];
const CREATIVE_TYPES = ['static', 'video', 'carousel', 'ugc'];
const COUNTRIES = [
    { code: 'US', label: 'United States' },
    { code: 'GB', label: 'United Kingdom' },
    { code: 'CA', label: 'Canada' },
    { code: 'AU', label: 'Australia' },
    { code: 'DE', label: 'Germany' },
    { code: 'FR', label: 'France' },
    { code: 'BR', label: 'Brazil' },
    { code: 'IN', label: 'India' },
];
const LANGUAGES = [
    { code: '', label: 'All Languages' },
    { code: 'en', label: 'English' },
    { code: 'es', label: 'Spanish' },
    { code: 'pt', label: 'Portuguese' },
    { code: 'fr', label: 'French' },
    { code: 'de', label: 'German' },
    { code: 'it', label: 'Italian' },
    { code: 'zh', label: 'Chinese' },
    { code: 'ja', label: 'Japanese' },
    { code: 'ko', label: 'Korean' },
    { code: 'ar', label: 'Arabic' },
    { code: 'hi', label: 'Hindi' },
];

export default function SwipeFile() {
    const { showSuccess, showError, showWarning, showInfo } = useToast();
    const { authFetch } = useAuth();
    const { brands } = useBrands();
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState('swipes'); // 'swipes' | 'discover' | 'landers'

    // ── My Swipes state ──────────────────────────────────────────────
    const [items, setItems] = useState([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [refreshingIg, setRefreshingIg] = useState(false);
    const [stats, setStats] = useState(null);
    const [collections, setCollections] = useState([]);

    // Filters
    const [search, setSearch] = useState('');
    const [platform, setPlatform] = useState('');
    const [collection, setCollection] = useState('');
    const [creativeType, setCreativeType] = useState('');
    const [niche, setNiche] = useState('');
    const [category, setCategory] = useState('');
    const [starredOnly, setStarredOnly] = useState(false);
    const [sourceType, setSourceType] = useState('');
    const [sort, setSort] = useState('newest');
    const [showFilters, setShowFilters] = useState(false);

    // Niche/category options
    const [niches, setNiches] = useState([]);
    const [categories, setCategories] = useState([]);

    // Add form
    const [showAdd, setShowAdd] = useState(false);
    const [addForm, setAddForm] = useState({ source_url: '', advertiser_name: '', collection: '', notes: '' });
    const [saving, setSaving] = useState(false);

    // Detail view
    const [viewItem, setViewItem] = useState(null);

    // Selection
    const [selected, setSelected] = useState(new Set());

    // AI analyze
    const [analyzing, setAnalyzing] = useState(new Set());

    // ── Discover state ───────────────────────────────────────────────
    const [discoverQuery, setDiscoverQuery] = useState('');
    const [discoverCountry, setDiscoverCountry] = useState('US');
    const [discoverLanguage, setDiscoverLanguage] = useState('');
    const [discoverSort, setDiscoverSort] = useState('days_desc');
    const [discoverActiveOnly, setDiscoverActiveOnly] = useState(true);
    const [discoverResults, setDiscoverResults] = useState([]);
    const [discoverLoading, setDiscoverLoading] = useState(false);
    const [discoverTotal, setDiscoverTotal] = useState(0);
    const [savingAds, setSavingAds] = useState(new Set());
    const [savedAds, setSavedAds] = useState(new Set());

    // ── Landers state ─────────────────────────────────────────────────
    const [landers, setLanders] = useState([]);
    const [landersLoading, setLandersLoading] = useState(false);
    const [landerSearch, setLanderSearch] = useState('');
    const [showAddLander, setShowAddLander] = useState(false);
    const [landerSaving, setLanderSaving] = useState(false);
    const [landerForm, setLanderForm] = useState({ url: '', title: '', notes: '', tags: '' });
    const [editingLanderId, setEditingLanderId] = useState(null);
    const [editLanderNotes, setEditLanderNotes] = useState('');
    const [addingToLanders, setAddingToLanders] = useState(false);

    // ── Competitors state ───────────────────────────────────────────────
    const [competitors, setCompetitors] = useState([]);
    const [competitorGroups, setCompetitorGroups] = useState([]);
    const [competitorsLoading, setCompetitorsLoading] = useState(false);
    const [competitorSearch, setCompetitorSearch] = useState('');
    const [activeGroup, setActiveGroup] = useState(null); // null = all
    const [showAddCompetitor, setShowAddCompetitor] = useState(false);
    const [competitorSaving, setCompetitorSaving] = useState(false);
    const [competitorForm, setCompetitorForm] = useState({ url: '', name: '', notes: '', tags: '', group_name: '' });
    const [newGroupName, setNewGroupName] = useState('');
    const [editingCompetitorId, setEditingCompetitorId] = useState(null);
    const [editCompetitorForm, setEditCompetitorForm] = useState({ name: '', notes: '', tags: '', group_name: '' });
    const [newEditGroupName, setNewEditGroupName] = useState('');

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const params = { sort, limit: 100 };
            if (search) params.search = search;
            if (platform) params.platform = platform;
            if (collection) params.collection = collection;
            if (creativeType) params.creative_type = creativeType;
            if (niche) params.niche = niche;
            if (category) params.category = category;
            if (sourceType) params.source_type = sourceType;
            if (starredOnly) params.starred = true;
            const res = await getSwipes(params);
            setItems(res.items || []);
            setTotal(res.total || 0);
        } catch (e) {
            showError('Failed to load swipe file');
        }
        setLoading(false);
    }, [search, platform, collection, creativeType, niche, category, sourceType, starredOnly, sort]);

    useEffect(() => { loadData(); }, [loadData]);
    useEffect(() => {
        getStats().then(setStats).catch(() => {});
        getCollections().then(setCollections).catch(() => {});
        getNiches().then(setNiches).catch(() => {});
        getCategories().then(setCategories).catch(() => {});
    }, []);

    const handleRefreshIgThumbnails = async () => {
        setRefreshingIg(true);
        try {
            const result = await refreshIgThumbnails();
            if (result.refreshed > 0) {
                const msg = `Refreshed ${result.refreshed} IG thumbnail${result.refreshed > 1 ? 's' : ''}${result.failed ? `, ${result.failed} failed` : ''}`;
                if (result.remaining > 0) {
                    showSuccess(`${msg}. ${result.remaining} remaining — click again to continue.`);
                } else {
                    showSuccess(msg);
                }
                loadData();
            } else if (result.failed > 0) {
                showWarning(`${result.failed} IG swipe${result.failed > 1 ? 's' : ''} couldn't be refreshed. Check IG credentials in Settings.`);
            } else {
                showInfo('All IG thumbnails are already up to date');
            }
        } catch (e) {
            showError(e.message);
        }
        setRefreshingIg(false);
    };

    const handleAdd = async () => {
        const urls = addForm.source_url.split('\n').map(u => u.trim()).filter(Boolean);
        if (!urls.length) {
            showError('Paste at least one URL');
            return;
        }
        setSaving(true);
        try {
            let saved = 0, skipped = 0;
            for (const url of urls) {
                try {
                    let plat = 'other';
                    if (url.includes('instagram.com')) plat = 'instagram';
                    else if (url.includes('facebook.com') || url.includes('fb.com')) plat = 'facebook';
                    else if (url.includes('tiktok.com')) plat = 'tiktok';
                    else if (url.includes('youtube.com') || url.includes('youtu.be')) plat = 'youtube';
                    await createSwipe({
                        source_url: url, platform: plat, source_type: 'manual',
                        advertiser_name: addForm.advertiser_name || undefined,
                        collection: addForm.collection || undefined,
                        notes: addForm.notes || undefined,
                    });
                    saved++;
                } catch { skipped++; }
            }
            showSuccess(`Saved ${saved} ad${saved !== 1 ? 's' : ''}${skipped ? ` · ${skipped} skipped` : ''}`);
            setShowAdd(false);
            setAddForm({ source_url: '', advertiser_name: '', collection: '', notes: '' });
            loadData();
            getStats().then(setStats).catch(() => {});
            getCollections().then(setCollections).catch(() => {});
        } catch (e) {
            showError('Failed to save');
        }
        setSaving(false);
    };

    const handleStar = async (id, e) => {
        e.stopPropagation();
        try {
            await toggleStar(id);
            setItems(prev => prev.map(i => i.id === id ? { ...i, is_starred: !i.is_starred } : i));
        } catch { showError('Failed to update'); }
    };

    const handleDelete = async (id, e) => {
        e.stopPropagation();
        try {
            await deleteSwipe(id);
            setItems(prev => prev.filter(i => i.id !== id));
            setTotal(prev => prev - 1);
            showSuccess('Deleted');
        } catch { showError('Failed to delete'); }
    };

    const handleBulkDelete = async () => {
        if (!selected.size) return;
        try {
            await bulkDeleteSwipes([...selected]);
            showSuccess(`Deleted ${selected.size} items`);
            setSelected(new Set());
            loadData();
        } catch { showError('Failed to delete'); }
    };

    const toggleSelect = (id, e) => {
        e.stopPropagation();
        setSelected(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };

    const handleAnalyze = async (id, e) => {
        if (e) e.stopPropagation();
        setAnalyzing(prev => new Set([...prev, id]));
        try {
            const updated = await analyzeSwipe(id);
            setItems(prev => prev.map(i => i.id === id ? updated : i));
            if (viewItem?.id === id) setViewItem(updated);
            showSuccess('AI analysis complete');
        } catch (err) {
            showError(err.message || 'Analysis failed');
        }
        setAnalyzing(prev => { const next = new Set(prev); next.delete(id); return next; });
    };

    const handleBulkAnalyze = async () => {
        if (!selected.size) return;
        const ids = [...selected];
        ids.forEach(id => setAnalyzing(prev => new Set([...prev, id])));
        try {
            const result = await analyzeBulk(ids);
            showSuccess(`Analyzed ${result.analyzed} ads${result.failed ? `, ${result.failed} failed` : ''}`);
            loadData();
        } catch { showError('Bulk analysis failed'); }
        setAnalyzing(new Set());
    };

    // ── Discover handlers ────────────────────────────────────────────
    const handleDiscover = async () => {
        if (!discoverQuery.trim()) { showError('Enter a search term'); return; }
        setDiscoverLoading(true);
        setDiscoverResults([]);
        try {
            const params = {
                q: discoverQuery.trim(),
                country: discoverCountry,
                limit: 50,
                active_only: discoverActiveOnly,
            };
            if (discoverLanguage) params.language = discoverLanguage;
            const res = await searchAdLibrary(params);
            let items = res.items || [];
            // Sort results
            if (discoverSort === 'days_desc') {
                items.sort((a, b) => (b.days_running || 0) - (a.days_running || 0));
            } else if (discoverSort === 'days_asc') {
                items.sort((a, b) => (a.days_running || 0) - (b.days_running || 0));
            } else if (discoverSort === 'newest') {
                items.sort((a, b) => {
                    const da = a.first_seen ? new Date(a.first_seen) : new Date(0);
                    const db = b.first_seen ? new Date(b.first_seen) : new Date(0);
                    return db - da;
                });
            }
            setDiscoverResults(items);
            setDiscoverTotal(res.total || 0);
            const alreadySaved = new Set();
            items.forEach(ad => { if (ad.already_saved) alreadySaved.add(ad.ad_library_id); });
            setSavedAds(alreadySaved);
        } catch (e) {
            showError(e.message || 'Search failed');
        }
        setDiscoverLoading(false);
    };

    const handleSaveAd = async (ad) => {
        const adId = ad.ad_library_id;
        setSavingAds(prev => new Set([...prev, adId]));
        try {
            await saveAdFromLibrary(ad);
            setSavedAds(prev => new Set([...prev, adId]));
            showSuccess('Saved to swipe file');
            // Refresh stats
            getStats().then(setStats).catch(() => {});
        } catch (e) {
            showError('Failed to save');
        }
        setSavingAds(prev => { const next = new Set(prev); next.delete(adId); return next; });
    };

    const handleSaveAllDiscover = async () => {
        const unsaved = discoverResults.filter(r => !savedAds.has(r.ad_library_id));
        if (!unsaved.length) { showError('All results already saved'); return; }
        let count = 0;
        for (const ad of unsaved) {
            try {
                await saveAdFromLibrary(ad);
                setSavedAds(prev => new Set([...prev, ad.ad_library_id]));
                count++;
            } catch {}
        }
        showSuccess(`Saved ${count} ads to swipe file`);
        getStats().then(setStats).catch(() => {});
    };

    const platformBadge = (p) => {
        const map = {
            facebook: 'bg-blue-100 text-blue-700',
            instagram: 'bg-pink-100 text-pink-700',
            tiktok: 'bg-purple-100 text-purple-700',
            youtube: 'bg-red-100 text-red-700',
            other: 'bg-gray-100 text-gray-600',
        };
        return map[p] || map.other;
    };

    const daysRunningBadge = (days) => {
        if (!days) return null;
        if (days >= 60) return 'bg-green-100 text-green-800 font-bold';
        if (days >= 30) return 'bg-green-100 text-green-700';
        if (days >= 14) return 'bg-yellow-100 text-yellow-700';
        return 'bg-gray-100 text-gray-600';
    };

    // ── Landers functions ────────────────────────────────────────────
    const loadLanders = useCallback(async () => {
        setLandersLoading(true);
        try {
            const res = await authFetch(`${LANDER_API}/`);
            if (res.ok) setLanders(await res.json());
        } catch (e) { console.error('Failed to fetch landers:', e); }
        setLandersLoading(false);
    }, []);

    useEffect(() => { if (activeTab === 'landers') loadLanders(); }, [activeTab]);

    const handleAddLander = async () => {
        if (!landerForm.url.trim()) return;
        setLanderSaving(true);
        try {
            const tags = landerForm.tags.trim() ? landerForm.tags.split(',').map(t => t.trim()).filter(Boolean) : null;
            const res = await authFetch(`${LANDER_API}/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: landerForm.url.trim(), title: landerForm.title.trim() || null, notes: landerForm.notes.trim() || null, tags }),
            });
            if (res.ok) {
                const lander = await res.json();
                setLanders(prev => [lander, ...prev]);
                setLanderForm({ url: '', title: '', notes: '', tags: '' });
                setShowAddLander(false);
                showSuccess('Lander saved');
            } else {
                const err = await res.json().catch(() => ({}));
                showError(err.detail || 'Failed to save');
            }
        } catch (e) { showError('Failed to save lander'); }
        setLanderSaving(false);
    };

    const handleDeleteLander = async (id) => {
        try {
            const res = await authFetch(`${LANDER_API}/${id}`, { method: 'DELETE' });
            if (res.ok) { setLanders(prev => prev.filter(l => l.id !== id)); showSuccess('Deleted'); }
        } catch (e) { showError('Failed to delete'); }
    };

    const handleUpdateLanderNotes = async (id) => {
        try {
            const res = await authFetch(`${LANDER_API}/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ notes: editLanderNotes }),
            });
            if (res.ok) {
                setLanders(prev => prev.map(l => l.id === id ? { ...l, notes: editLanderNotes } : l));
                setEditingLanderId(null);
                showSuccess('Notes updated');
            }
        } catch (e) { showError('Failed to update'); }
    };

    // Add landing page from a swipe to landers
    const handleAddToLanders = async (item) => {
        const url = item.landing_page_url || (item.cta_text && item.cta_text.includes('.') && !item.cta_text.includes(' ') ? `https://${item.cta_text.toLowerCase()}` : null);
        if (!url) { showError('No landing page URL available'); return; }
        setAddingToLanders(true);
        try {
            const res = await authFetch(`${LANDER_API}/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url,
                    title: item.advertiser_name ? `${item.advertiser_name} — ${item.headline || 'Ad Lander'}` : item.headline || url,
                    notes: `Saved from Swipe File${item.source_type === 'ad_library' ? ' (Ad Library)' : item.source_type === 'telegram' ? ' (In the Wild)' : ''}`,
                }),
            });
            if (res.ok) {
                showSuccess('Added to Landers');
            } else {
                const err = await res.json().catch(() => ({}));
                showError(err.detail || 'Failed to add to landers');
            }
        } catch { showError('Failed to add to landers'); }
        setAddingToLanders(false);
    };

    // Get a usable landing page URL from item data
    const getLandingPageUrl = (item) => {
        if (item.landing_page_url) return item.landing_page_url;
        if (item.cta_text && item.cta_text.includes('.') && !item.cta_text.includes(' ')) {
            return `https://${item.cta_text.toLowerCase()}`;
        }
        return null;
    };

    // ── Competitors functions ──────────────────────────────────────────
    const loadCompetitors = useCallback(async () => {
        setCompetitorsLoading(true);
        try {
            const [compRes, groupRes] = await Promise.all([
                authFetch(`${COMPETITOR_API}/`),
                authFetch(`${COMPETITOR_API}/groups`),
            ]);
            if (compRes.ok) setCompetitors(await compRes.json());
            if (groupRes.ok) setCompetitorGroups(await groupRes.json());
        } catch (e) { console.error('Failed to fetch competitors:', e); }
        setCompetitorsLoading(false);
    }, []);

    useEffect(() => { if (activeTab === 'competitors') loadCompetitors(); }, [activeTab]);

    const extractPageId = (url) => {
        const m = url.match(/view_all_page_id=(\d+)/);
        return m ? m[1] : null;
    };

    // Distinct group names for the dropdown in forms
    const existingGroupNames = [...new Set(competitors.map(c => c.group_name).filter(Boolean))].sort();

    const handleAddCompetitor = async () => {
        const url = competitorForm.url.trim();
        if (!url && !competitorForm.name.trim()) return;

        const pageId = extractPageId(url);
        if (!pageId && !url) { showError('Paste a valid FB Ads Library URL'); return; }

        let groupName = null;
        if (competitorForm.group_name === '__new__') {
            groupName = newGroupName.trim() || null;
        } else if (competitorForm.group_name) {
            groupName = competitorForm.group_name;
        } else if (activeGroup && activeGroup !== '__ungrouped__') {
            groupName = activeGroup;
        }

        setCompetitorSaving(true);
        try {
            const tags = competitorForm.tags.trim() ? competitorForm.tags.split(',').map(t => t.trim()).filter(Boolean) : null;
            const res = await authFetch(`${COMPETITOR_API}/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: url || undefined,
                    name: competitorForm.name.trim() || undefined,
                    fb_page_id: pageId || undefined,
                    group_name: groupName || undefined,
                    notes: competitorForm.notes.trim() || undefined,
                    tags,
                }),
            });
            if (res.ok) {
                const comp = await res.json();
                setCompetitors(prev => [comp, ...prev]);
                setCompetitorForm({ url: '', name: '', notes: '', tags: '', group_name: '' });
                setNewGroupName('');
                setShowAddCompetitor(false);
                showSuccess(`Saved: ${comp.name}`);
                // If name wasn't auto-detected, open edit mode so user can rename
                if (comp.auto_named) {
                    handleStartEditCompetitor(comp);
                    showError('Could not detect page name — please enter a name');
                }
                // Refresh groups
                authFetch(`${COMPETITOR_API}/groups`).then(r => r.ok && r.json().then(setCompetitorGroups)).catch(() => {});
            } else {
                const err = await res.json().catch(() => ({}));
                showError(err.detail || 'Failed to save');
            }
        } catch (e) { showError('Failed to save competitor'); }
        setCompetitorSaving(false);
    };

    const handleDeleteCompetitor = async (id) => {
        try {
            const res = await authFetch(`${COMPETITOR_API}/${id}`, { method: 'DELETE' });
            if (res.ok) {
                setCompetitors(prev => prev.filter(c => c.id !== id));
                showSuccess('Deleted');
                authFetch(`${COMPETITOR_API}/groups`).then(r => r.ok && r.json().then(setCompetitorGroups)).catch(() => {});
            }
        } catch (e) { showError('Failed to delete'); }
    };

    const handleStartEditCompetitor = (comp) => {
        setEditingCompetitorId(comp.id);
        setEditCompetitorForm({ name: comp.name, notes: comp.notes || '', tags: (comp.tags || []).join(', '), group_name: comp.group_name || '' });
        setNewEditGroupName('');
    };

    const handleSaveEditCompetitor = async (id) => {
        try {
            const tags = editCompetitorForm.tags.trim() ? editCompetitorForm.tags.split(',').map(t => t.trim()).filter(Boolean) : null;
            let groupName = editCompetitorForm.group_name === '__new__'
                ? (newEditGroupName.trim() || null)
                : (editCompetitorForm.group_name.trim() || null);
            const res = await authFetch(`${COMPETITOR_API}/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: editCompetitorForm.name.trim() || undefined,
                    group_name: groupName,
                    notes: editCompetitorForm.notes.trim() || undefined,
                    tags,
                }),
            });
            if (res.ok) {
                const updated = await res.json();
                setCompetitors(prev => prev.map(c => c.id === id ? updated : c));
                setEditingCompetitorId(null);
                showSuccess('Updated');
                authFetch(`${COMPETITOR_API}/groups`).then(r => r.ok && r.json().then(setCompetitorGroups)).catch(() => {});
            }
        } catch (e) { showError('Failed to update'); }
    };

    const filteredCompetitors = competitors.filter(c => {
        // Group filter
        if (activeGroup && activeGroup !== '__all__') {
            if (activeGroup === '__ungrouped__') {
                if (c.group_name) return false;
            } else if (c.group_name !== activeGroup) return false;
        }
        // Search filter
        if (!competitorSearch) return true;
        const q = competitorSearch.toLowerCase();
        return (c.name || '').toLowerCase().includes(q) || (c.fb_page_id || '').includes(q)
            || (c.notes || '').toLowerCase().includes(q) || (c.group_name || '').toLowerCase().includes(q)
            || (c.tags || []).some(t => t.toLowerCase().includes(q));
    });

    const filteredLanders = landers.filter(l => {
        if (!landerSearch) return true;
        const q = landerSearch.toLowerCase();
        return (l.title || '').toLowerCase().includes(q) || (l.url || '').toLowerCase().includes(q)
            || (l.notes || '').toLowerCase().includes(q) || (l.tags || []).some(t => t.toLowerCase().includes(q));
    });

    return (
        <div>
            {/* Header */}
            <div className="flex items-center justify-between gap-3 mb-6">
                <div>
                    <h1 className="text-xl sm:text-3xl font-bold text-gray-900 flex items-center gap-2 sm:gap-3">
                        <Bookmark size={24} className="text-amber-600 sm:w-8 sm:h-8" />
                        Swipe File
                    </h1>
                    <p className="text-gray-500 mt-1 text-sm">
                        {total} saved ads{stats?.starred ? ` · ${stats.starred} starred` : ''}
                    </p>
                </div>
                <button onClick={() => setShowAdd(true)}
                    className="flex items-center gap-2 px-3 sm:px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors font-medium text-sm whitespace-nowrap">
                    <Plus size={16} /> <span className="hidden sm:inline">Save Ad</span><span className="sm:hidden">Add</span>
                </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 mb-6 bg-white rounded-xl border border-gray-200 p-1 shadow-sm overflow-x-auto w-full sm:w-fit">
                <button onClick={() => setActiveTab('swipes')}
                    className={`px-3 sm:px-5 py-2 sm:py-2.5 rounded-lg text-xs sm:text-sm font-medium transition-colors flex items-center gap-1.5 sm:gap-2 whitespace-nowrap ${
                        activeTab === 'swipes'
                            ? 'bg-amber-600 text-white shadow-sm'
                            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                    }`}>
                    <Bookmark size={14} /> Swipes
                </button>
                <button onClick={() => setActiveTab('competitors')}
                    className={`px-3 sm:px-5 py-2 sm:py-2.5 rounded-lg text-xs sm:text-sm font-medium transition-colors flex items-center gap-1.5 sm:gap-2 whitespace-nowrap ${
                        activeTab === 'competitors'
                            ? 'bg-amber-600 text-white shadow-sm'
                            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                    }`}>
                    <Users size={14} /> Competitors
                </button>
                <button onClick={() => setActiveTab('discover')}
                    className={`px-3 sm:px-5 py-2 sm:py-2.5 rounded-lg text-xs sm:text-sm font-medium transition-colors flex items-center gap-1.5 sm:gap-2 whitespace-nowrap ${
                        activeTab === 'discover'
                            ? 'bg-amber-600 text-white shadow-sm'
                            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                    }`}>
                    <Compass size={14} /> <span className="hidden sm:inline">FB Ads Library</span><span className="sm:hidden">Discover</span>
                </button>
                <button onClick={() => setActiveTab('landers')}
                    className={`px-3 sm:px-5 py-2 sm:py-2.5 rounded-lg text-xs sm:text-sm font-medium transition-colors flex items-center gap-1.5 sm:gap-2 whitespace-nowrap ${
                        activeTab === 'landers'
                            ? 'bg-amber-600 text-white shadow-sm'
                            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                    }`}>
                    <Globe size={14} /> Landers
                </button>
            </div>

            {/* ═══════════════════════════════════════════════════════════════ */}
            {/* MY SWIPES TAB                                                  */}
            {/* ═══════════════════════════════════════════════════════════════ */}
            {activeTab === 'swipes' && (
                <>
                    {/* Stats bar */}
                    {stats && Object.keys(stats.by_platform || {}).length > 0 && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                            {Object.entries(stats.by_platform || {}).map(([p, count]) => (
                                <div key={p} className="bg-white rounded-xl shadow-sm border border-gray-200 px-4 py-3">
                                    <span className="text-gray-500 text-xs uppercase tracking-wide">{p}</span>
                                    <p className="text-gray-900 text-xl font-bold">{count}</p>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Search + filters */}
                    <div className="space-y-3 sm:space-y-0 mb-6">
                        <div className="relative w-full sm:max-w-sm mb-3 sm:mb-0 sm:inline-block sm:mr-3">
                            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input value={search} onChange={e => setSearch(e.target.value)}
                                placeholder="Search ads..."
                                className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-sm" />
                        </div>
                        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                            <select value={sort} onChange={e => setSort(e.target.value)}
                                className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                                <option value="newest">Newest</option>
                                <option value="oldest">Oldest</option>
                                <option value="longest_running">Longest Running</option>
                                <option value="starred">Starred First</option>
                            </select>
                            <button onClick={() => setStarredOnly(!starredOnly)}
                                className={`px-3 py-2 rounded-lg text-sm flex items-center gap-1.5 border transition-colors ${starredOnly ? 'bg-amber-50 border-amber-300 text-amber-700' : 'bg-white border-gray-300 text-gray-600 hover:text-gray-800'}`}>
                                <Star size={14} /> <span className="hidden sm:inline">Starred</span>
                            </button>
                            <button onClick={() => setSourceType(sourceType === 'telegram' ? '' : 'telegram')}
                                className={`px-3 py-2 rounded-lg text-sm flex items-center gap-1.5 border transition-colors ${sourceType === 'telegram' ? 'bg-green-50 border-green-300 text-green-700' : 'bg-white border-gray-300 text-gray-600 hover:text-gray-800'}`}>
                                <Globe size={14} /> <span className="hidden sm:inline">In the Wild</span>
                            </button>
                            <button onClick={() => setShowFilters(!showFilters)}
                                className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-600 hover:text-gray-800 text-sm flex items-center gap-1.5">
                                <Filter size={14} /> <span className="hidden sm:inline">Filters</span> <ChevronDown size={12} className={`transition-transform ${showFilters ? 'rotate-180' : ''}`} />
                            </button>
                            <button onClick={loadData} disabled={loading}
                                className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors" title="Refresh">
                                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                            </button>
                            <button onClick={handleRefreshIgThumbnails} disabled={refreshingIg}
                                className="hidden sm:flex px-3 py-2 rounded-lg text-sm items-center gap-1.5 border border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100 disabled:opacity-50 transition-colors"
                                title="Scrape missing IG thumbnails & videos using saved credentials">
                                {refreshingIg ? <Loader size={14} className="animate-spin" /> : <Download size={14} />}
                                {refreshingIg ? 'Refreshing...' : 'Refresh IG'}
                            </button>
                            <span className="text-sm text-gray-400">{items.length} result{items.length !== 1 ? 's' : ''}</span>
                        </div>
                    </div>

                    {/* Expanded filters */}
                    {showFilters && (
                        <div className="flex flex-wrap gap-3 mb-6 p-4 bg-white rounded-xl border border-gray-200 shadow-sm">
                            <select value={platform} onChange={e => setPlatform(e.target.value)}
                                className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                                <option value="">All Platforms</option>
                                {PLATFORMS.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
                            </select>
                            <select value={creativeType} onChange={e => setCreativeType(e.target.value)}
                                className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                                <option value="">All Types</option>
                                {CREATIVE_TYPES.map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}
                            </select>
                            <select value={collection} onChange={e => setCollection(e.target.value)}
                                className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                                <option value="">All Collections</option>
                                {collections.map(c => <option key={c.name} value={c.name}>{c.name} ({c.count})</option>)}
                            </select>
                            <select value={niche} onChange={e => setNiche(e.target.value)}
                                className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                                <option value="">All Niches</option>
                                {niches.map(n => <option key={n.name} value={n.name}>{n.name} ({n.count})</option>)}
                            </select>
                            <select value={category} onChange={e => setCategory(e.target.value)}
                                className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                                <option value="">All Categories</option>
                                {categories.map(c => <option key={c.name} value={c.name}>{c.name} ({c.count})</option>)}
                            </select>
                            {(platform || creativeType || collection || sourceType || niche || category) && (
                                <button onClick={() => { setPlatform(''); setCreativeType(''); setCollection(''); setSourceType(''); setNiche(''); setCategory(''); }}
                                    className="px-3 py-2 text-red-600 hover:text-red-700 text-sm flex items-center gap-1">
                                    <X size={12} /> Clear
                                </button>
                            )}
                        </div>
                    )}

                    {/* Bulk action bar */}
                    {selected.size > 0 && (
                        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-white border border-gray-300 rounded-xl shadow-xl px-6 py-3 flex items-center gap-4">
                            <span className="text-gray-900 text-sm font-medium">{selected.size} selected</span>
                            <button onClick={handleBulkAnalyze}
                                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm flex items-center gap-1.5">
                                <Sparkles size={14} /> Analyze
                            </button>
                            <button onClick={handleBulkDelete}
                                className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm flex items-center gap-1.5">
                                <Trash2 size={14} /> Delete
                            </button>
                            <button onClick={() => setSelected(new Set())}
                                className="text-gray-500 hover:text-gray-700 text-sm">Cancel</button>
                        </div>
                    )}

                    {/* Grid */}
                    {loading ? (
                        <div className="flex items-center justify-center py-16">
                            <Loader size={32} className="animate-spin text-gray-400" />
                        </div>
                    ) : items.length === 0 ? (
                        <div className="text-center py-16 text-gray-400">
                            <Bookmark size={48} className="mx-auto mb-4" />
                            <p className="text-lg font-medium text-gray-500">No swipes yet</p>
                            <p className="text-sm mt-1 mb-4">Start saving ads that catch your eye</p>
                            <div className="flex gap-3 justify-center">
                                <button onClick={() => setActiveTab('discover')}
                                    className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-medium flex items-center gap-2">
                                    <Compass size={16} /> FB Ads Library
                                </button>
                                <button onClick={() => setShowAdd(true)}
                                    className="px-4 py-2 bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-lg text-sm font-medium flex items-center gap-2">
                                    <Plus size={16} /> Save Ad
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                            {items.map(item => (
                                <SwipeCard
                                    key={item.id}
                                    item={item}
                                    selected={selected.has(item.id)}
                                    analyzing={analyzing.has(item.id)}
                                    onView={() => setViewItem(item)}
                                    onSelect={e => toggleSelect(item.id, e)}
                                    onStar={e => handleStar(item.id, e)}
                                    onDelete={e => handleDelete(item.id, e)}
                                    onAnalyze={e => handleAnalyze(item.id, e)}
                                    platformBadge={platformBadge}
                                    daysRunningBadge={daysRunningBadge}
                                    getLandingPageUrl={getLandingPageUrl}
                                />
                            ))}
                        </div>
                    )}
                </>
            )}

            {/* ═══════════════════════════════════════════════════════════════ */}
            {/* DISCOVER TAB                                                   */}
            {/* ═══════════════════════════════════════════════════════════════ */}
            {activeTab === 'discover' && (
                <>
                    {/* Search bar */}
                    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-6">
                        <div className="flex items-start gap-4">
                            <div className="flex-1">
                                <label className="block text-sm font-medium text-gray-700 mb-1.5">Search Meta Ad Library</label>
                                <div className="relative">
                                    <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                    <input
                                        value={discoverQuery}
                                        onChange={e => setDiscoverQuery(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && handleDiscover()}
                                        placeholder="Search keywords... e.g. weight loss supplement, keto diet"
                                        className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-sm"
                                    />
                                </div>
                                <p className="text-xs text-gray-400 mt-1.5">
                                    Searches active Facebook & Instagram ads. Longer-running ads = likely profitable winners.
                                </p>
                            </div>
                            <div className="flex flex-col gap-2">
                                <select value={discoverCountry} onChange={e => setDiscoverCountry(e.target.value)}
                                    className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white">
                                    {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                                </select>
                                <select value={discoverLanguage} onChange={e => setDiscoverLanguage(e.target.value)}
                                    className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white">
                                    {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
                                </select>
                            </div>
                            <div className="flex flex-col gap-2">
                                <select value={discoverSort} onChange={e => setDiscoverSort(e.target.value)}
                                    className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white">
                                    <option value="days_desc">Longest Running</option>
                                    <option value="days_asc">Shortest Running</option>
                                    <option value="newest">Newest First</option>
                                </select>
                                <label className="flex items-center gap-2 text-xs text-gray-600 px-1 cursor-pointer">
                                    <input type="checkbox" checked={discoverActiveOnly}
                                        onChange={e => setDiscoverActiveOnly(e.target.checked)}
                                        className="rounded border-gray-300 text-amber-600 focus:ring-amber-500" />
                                    Active ads only
                                </label>
                            </div>
                            <button onClick={handleDiscover} disabled={discoverLoading}
                                className="px-6 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50 mt-6">
                                {discoverLoading ? <Loader size={16} className="animate-spin" /> : <Search size={16} />}
                                Search
                            </button>
                        </div>
                    </div>

                    {/* Results header */}
                    {discoverResults.length > 0 && (
                        <div className="flex items-center justify-between mb-4">
                            <p className="text-sm text-gray-600">
                                <span className="font-medium text-gray-900">{discoverTotal}</span> ads found for "<span className="font-medium">{discoverQuery}</span>"
                            </p>
                            <button onClick={handleSaveAllDiscover}
                                className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium">
                                <Download size={16} /> Save All to Swipe File
                            </button>
                        </div>
                    )}

                    {/* Loading state */}
                    {discoverLoading && (
                        <div className="flex items-center justify-center py-16">
                            <div className="text-center">
                                <Loader size={32} className="animate-spin text-amber-500 mx-auto mb-3" />
                                <p className="text-gray-500 text-sm">Searching Meta Ad Library...</p>
                            </div>
                        </div>
                    )}

                    {/* Empty state */}
                    {!discoverLoading && discoverResults.length === 0 && (
                        <div className="text-center py-16 text-gray-400">
                            <Compass size={48} className="mx-auto mb-4" />
                            <p className="text-lg font-medium text-gray-500">Discover Winning Ads</p>
                            <p className="text-sm mt-1 max-w-md mx-auto">
                                Search the Meta Ad Library to find competitor ads. Ads running for 30+ days are likely profitable winners.
                            </p>
                        </div>
                    )}

                    {/* Results grid */}
                    {!discoverLoading && discoverResults.length > 0 && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                            {discoverResults.map((ad, i) => (
                                <DiscoverCard
                                    key={ad.ad_library_id || i}
                                    ad={ad}
                                    isSaved={savedAds.has(ad.ad_library_id)}
                                    isSaving={savingAds.has(ad.ad_library_id)}
                                    onSave={() => handleSaveAd(ad)}
                                    onView={() => setViewItem({ ...ad, _isDiscover: true })}
                                    onVideoClick={(ad) => { try { const u = new URL(ad.source_url); if (u.protocol === 'http:' || u.protocol === 'https:') window.open(ad.source_url, '_blank'); } catch {} }}
                                    platformBadge={platformBadge}
                                    daysRunningBadge={daysRunningBadge}
                                />
                            ))}
                        </div>
                    )}
                </>
            )}

            {/* ── Save Ad Modal (simplified — URL + name + notes) ──── */}
            {showAdd && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
                    onClick={() => setShowAdd(false)}>
                    <div className="bg-white rounded-xl shadow-xl border border-gray-200 w-full max-w-lg"
                        onClick={e => e.stopPropagation()}>
                        <div className="p-5 border-b border-gray-200 flex justify-between items-center">
                            <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                                <Plus size={20} className="text-amber-600" /> Save Ad
                            </h2>
                            <button onClick={() => setShowAdd(false)} className="text-gray-400 hover:text-gray-600">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-5 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">URLs</label>
                                <textarea
                                    value={addForm.source_url}
                                    onChange={e => setAddForm(f => ({ ...f, source_url: e.target.value }))}
                                    rows={3}
                                    placeholder={`Paste one or more ad URLs (one per line)\nhttps://www.facebook.com/ads/library/?id=98765\nhttps://www.instagram.com/p/ABC123/`}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-sm font-mono resize-none"
                                />
                                <p className="text-xs text-gray-400 mt-1">
                                    {addForm.source_url.split('\n').filter(u => u.trim()).length || 0} URL{addForm.source_url.split('\n').filter(u => u.trim()).length !== 1 ? 's' : ''} detected · Platform auto-detected from URL
                                </p>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Advertiser Name</label>
                                    <input value={addForm.advertiser_name}
                                        onChange={e => setAddForm(f => ({ ...f, advertiser_name: e.target.value }))}
                                        placeholder="e.g. Brand name"
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-sm" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Collection</label>
                                    <input value={addForm.collection}
                                        onChange={e => setAddForm(f => ({ ...f, collection: e.target.value }))}
                                        placeholder="e.g. Health, Winners"
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-sm" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                                <input value={addForm.notes}
                                    onChange={e => setAddForm(f => ({ ...f, notes: e.target.value }))}
                                    placeholder="Why you're saving this..."
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-sm" />
                            </div>
                        </div>
                        <div className="p-5 border-t border-gray-200 flex justify-end gap-3">
                            <button onClick={() => setShowAdd(false)}
                                className="px-4 py-2 text-gray-600 hover:text-gray-800 text-sm">Cancel</button>
                            <button onClick={handleAdd} disabled={saving}
                                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50">
                                {saving ? <Loader size={16} className="animate-spin" /> : <Plus size={16} />}
                                Save
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Video clicks open directly in Ad Library (Facebook blocks iframes) */}

            {/* ── Detail View Modal ──────────────────────────────────── */}
            {viewItem && (
                <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
                    onClick={() => setViewItem(null)}>
                    <div className="bg-white rounded-xl shadow-xl border border-gray-200 w-full max-w-2xl max-h-[90vh] overflow-y-auto"
                        onClick={e => e.stopPropagation()}>
                        <div className="p-5 border-b border-gray-200 flex justify-between items-center">
                            <h2 className="text-lg font-bold text-gray-900 truncate pr-4">
                                {viewItem.headline || viewItem.advertiser_name || 'Swipe Detail'}
                            </h2>
                            <div className="flex items-center gap-2">
                                {/* Analyze buttons (only for saved swipes, not discover results) */}
                                {!viewItem._isDiscover && (
                                    <>
                                        <button
                                            onClick={() => handleAnalyze(viewItem.id)}
                                            disabled={analyzing.has(viewItem.id)}
                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 text-amber-700 hover:bg-amber-100 rounded-lg text-sm font-medium border border-amber-200 disabled:opacity-50"
                                        >
                                            {analyzing.has(viewItem.id)
                                                ? <Loader size={14} className="animate-spin" />
                                                : <Sparkles size={14} />}
                                            {analyzing.has(viewItem.id) ? 'Analyzing...' : 'Quick Tag'}
                                        </button>
                                        <button
                                            onClick={() => { setViewItem(null); navigate(`/ai-analyzer?swipe_id=${viewItem.id}`); }}
                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-50 text-purple-700 hover:bg-purple-100 rounded-lg text-sm font-medium border border-purple-200"
                                        >
                                            <Sparkles size={14} />
                                            Deep Analyze
                                        </button>
                                    </>
                                )}
                                <button onClick={() => setViewItem(null)} className="text-gray-400 hover:text-gray-600">
                                    <X size={20} />
                                </button>
                            </div>
                        </div>
                        <div className="p-5">
                            {/* Video player or image */}
                            {viewItem.video_url ? (
                                <div className="mb-4">
                                    <video
                                        src={viewItem.video_url}
                                        controls
                                        autoPlay
                                        playsInline
                                        preload="auto"
                                        poster={viewItem.image_url || viewItem.thumbnail_url || undefined}
                                        className="w-full rounded-lg max-h-[500px] bg-black"
                                        onError={(e) => console.error('Video load error:', e.target.error)}
                                    />
                                </div>
                            ) : (viewItem.image_url || viewItem.thumbnail_url) ? (
                                <img src={viewItem.image_url || viewItem.thumbnail_url} alt=""
                                    className="w-full rounded-lg mb-4 max-h-[400px] object-contain bg-gray-50" />
                            ) : null}

                            {/* Landing page banner */}
                            {getLandingPageUrl(viewItem) && (
                                <div className="flex items-center gap-2 mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                                    <Globe size={16} className="text-blue-600 flex-shrink-0" />
                                    <a href={getLandingPageUrl(viewItem)} target="_blank" rel="noopener noreferrer"
                                        className="text-blue-700 hover:text-blue-900 text-sm font-medium truncate flex-1">
                                        {getLandingPageUrl(viewItem).replace(/^https?:\/\//, '')}
                                    </a>
                                    <button
                                        onClick={() => handleAddToLanders(viewItem)}
                                        disabled={addingToLanders}
                                        className="flex items-center gap-1 px-2.5 py-1 bg-blue-600 text-white rounded-md text-xs font-medium hover:bg-blue-700 disabled:opacity-50 flex-shrink-0"
                                    >
                                        {addingToLanders ? <Loader size={12} className="animate-spin" /> : <Bookmark size={12} />}
                                        Add to Landers
                                    </button>
                                </div>
                            )}
                            <div className="space-y-3">
                                {viewItem.advertiser_name && (
                                    <div>
                                        <span className="text-gray-500 text-xs font-medium uppercase tracking-wide">Advertiser</span>
                                        <p className="text-gray-900 font-medium">{viewItem.advertiser_name}</p>
                                    </div>
                                )}
                                {viewItem.headline && (
                                    <div>
                                        <span className="text-gray-500 text-xs font-medium uppercase tracking-wide">Headline</span>
                                        <p className="text-gray-900">{viewItem.headline}</p>
                                    </div>
                                )}
                                {viewItem.primary_text && (
                                    <div>
                                        <span className="text-gray-500 text-xs font-medium uppercase tracking-wide">Primary Text</span>
                                        <p className="text-gray-700 whitespace-pre-wrap text-sm">{viewItem.primary_text}</p>
                                    </div>
                                )}
                                {viewItem.cta_text && (
                                    <div>
                                        <span className="text-gray-500 text-xs font-medium uppercase tracking-wide">CTA</span>
                                        <p className="text-gray-900">{viewItem.cta_text}</p>
                                    </div>
                                )}

                                <div className="grid grid-cols-2 gap-3 pt-2">
                                    {viewItem.platform && (
                                        <div>
                                            <span className="text-gray-500 text-xs font-medium uppercase tracking-wide">Platform</span>
                                            <p><span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${platformBadge(viewItem.platform)}`}>{viewItem.platform}</span></p>
                                        </div>
                                    )}
                                    {(viewItem.creative_type || viewItem.media_type) && (
                                        <div>
                                            <span className="text-gray-500 text-xs font-medium uppercase tracking-wide">Creative Type</span>
                                            <p className="text-gray-900 text-sm uppercase font-medium">
                                                {viewItem.creative_type || (viewItem.media_type !== 'unknown' ? viewItem.media_type : null)}
                                            </p>
                                        </div>
                                    )}
                                    {viewItem.days_running && (
                                        <div>
                                            <span className="text-gray-500 text-xs font-medium uppercase tracking-wide">Days Running</span>
                                            <p className={`font-bold ${viewItem.days_running >= 30 ? 'text-green-700' : 'text-gray-700'}`}>
                                                {viewItem.days_running} days
                                                {viewItem.days_running >= 30 && <TrendingUp size={14} className="inline ml-1" />}
                                            </p>
                                        </div>
                                    )}
                                    {viewItem.first_seen && (
                                        <div>
                                            <span className="text-gray-500 text-xs font-medium uppercase tracking-wide">First Seen</span>
                                            <p className="text-gray-900 text-sm">{viewItem.first_seen}</p>
                                        </div>
                                    )}
                                    {viewItem.niche && (
                                        <div>
                                            <span className="text-gray-500 text-xs font-medium uppercase tracking-wide">Niche</span>
                                            <p className="text-gray-900 text-sm">{viewItem.niche}</p>
                                        </div>
                                    )}
                                    {viewItem.category && (
                                        <div>
                                            <span className="text-gray-500 text-xs font-medium uppercase tracking-wide">Category</span>
                                            <p className="text-gray-900 text-sm">{viewItem.category}</p>
                                        </div>
                                    )}
                                </div>

                                {/* Publisher platforms (from discover) */}
                                {viewItem.publisher_platforms?.length > 0 && (
                                    <div className="pt-1">
                                        <span className="text-gray-500 text-xs font-medium uppercase tracking-wide">Running On</span>
                                        <div className="flex gap-1.5 mt-1">
                                            {viewItem.publisher_platforms.map(p => (
                                                <span key={p} className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${platformBadge(p)}`}>{p}</span>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {viewItem.notes && (
                                    <div className="pt-2">
                                        <span className="text-gray-500 text-xs font-medium uppercase tracking-wide">Notes</span>
                                        <p className="text-gray-600 text-sm">{viewItem.notes}</p>
                                    </div>
                                )}

                                {viewItem.tags?.length > 0 && (
                                    <div className="flex flex-wrap gap-1 pt-2">
                                        {viewItem.tags.map(t => (
                                            <span key={t} className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">
                                                <Tag size={9} />{t}
                                            </span>
                                        ))}
                                    </div>
                                )}

                                {viewItem.ai_analysis && (
                                    <div className="pt-2">
                                        <span className="text-gray-500 text-xs font-medium uppercase tracking-wide flex items-center gap-1">
                                            <Sparkles size={12} /> AI Analysis
                                        </span>
                                        <div className="mt-1 p-3 bg-amber-50 rounded-lg text-sm text-gray-700 space-y-1 border border-amber-100">
                                            {Object.entries(viewItem.ai_analysis).map(([k, v]) => (
                                                <p key={k}><span className="text-gray-500 font-medium">{k.replace(/_/g, ' ')}:</span> {v}</p>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <div className="flex flex-wrap gap-3 pt-3">
                                    {viewItem.source_url && (
                                        <a href={viewItem.source_url} target="_blank" rel="noopener noreferrer"
                                            className="text-amber-600 hover:text-amber-700 text-sm font-medium flex items-center gap-1">
                                            <ExternalLink size={14} /> View Original
                                        </a>
                                    )}
                                    {/* Watch Video fallback — for video ads without embedded video_url */}
                                    {!viewItem.video_url && (viewItem.creative_type === 'video' || viewItem.media_type === 'video') && viewItem.source_url && (
                                        <a href={viewItem.source_url} target="_blank" rel="noopener noreferrer"
                                            className="text-purple-600 hover:text-purple-700 text-sm font-medium flex items-center gap-1">
                                            <Video size={14} /> Watch Video
                                        </a>
                                    )}
                                    {viewItem.advertiser_page_url && (
                                        <a href={viewItem.advertiser_page_url} target="_blank" rel="noopener noreferrer"
                                            className="text-amber-600 hover:text-amber-700 text-sm font-medium flex items-center gap-1">
                                            <ExternalLink size={14} /> Advertiser Page
                                        </a>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ═══════════════════════════════════════════════════════════════ */}
            {/* LANDERS TAB                                                    */}
            {/* ═══════════════════════════════════════════════════════════════ */}
            {activeTab === 'landers' && (
                <>
                    {/* Add Lander Form */}
                    <div className="flex items-center justify-between mb-4">
                        <p className="text-sm text-gray-500">Save landing pages to study and draw inspiration from</p>
                        <button onClick={() => setShowAddLander(!showAddLander)}
                            className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 font-medium text-sm">
                            <Plus size={16} /> Add Lander
                        </button>
                    </div>

                    {showAddLander && (
                        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
                            <h3 className="font-bold text-gray-900 mb-4">Add a Landing Page</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">URL *</label>
                                    <input type="url" value={landerForm.url}
                                        onChange={e => setLanderForm({ ...landerForm, url: e.target.value })}
                                        placeholder="https://example.com/landing-page"
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                                    <input type="text" value={landerForm.title}
                                        onChange={e => setLanderForm({ ...landerForm, title: e.target.value })}
                                        placeholder="e.g. Competitor foot pain lander"
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Tags</label>
                                    <input type="text" value={landerForm.tags}
                                        onChange={e => setLanderForm({ ...landerForm, tags: e.target.value })}
                                        placeholder="health, foot pain, listicle (comma separated)"
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                                    <input type="text" value={landerForm.notes}
                                        onChange={e => setLanderForm({ ...landerForm, notes: e.target.value })}
                                        placeholder="What makes this lander convert?"
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500" />
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <button onClick={handleAddLander} disabled={!landerForm.url.trim() || landerSaving}
                                    className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 font-medium flex items-center gap-2 text-sm">
                                    {landerSaving ? <Loader size={16} className="animate-spin" /> : <Plus size={16} />}
                                    Save Lander
                                </button>
                                <button onClick={() => setShowAddLander(false)} className="px-4 py-2 text-gray-600 hover:text-gray-800 text-sm">Cancel</button>
                            </div>
                        </div>
                    )}

                    {/* Search */}
                    <div className="flex flex-wrap items-center gap-3 mb-6">
                        <div className="relative flex-1 max-w-sm">
                            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input value={landerSearch} onChange={e => setLanderSearch(e.target.value)}
                                placeholder="Search landers..."
                                className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-sm" />
                        </div>
                        <span className="text-sm text-gray-400">{filteredLanders.length} lander{filteredLanders.length !== 1 ? 's' : ''}</span>
                    </div>

                    {/* Grid */}
                    {landersLoading ? (
                        <div className="flex items-center justify-center py-16">
                            <Loader size={32} className="animate-spin text-gray-400" />
                        </div>
                    ) : filteredLanders.length === 0 ? (
                        <div className="text-center py-16 text-gray-400">
                            <Globe size={48} className="mx-auto mb-4" />
                            <p className="text-lg font-medium text-gray-500">{landers.length === 0 ? 'No landers saved yet' : 'No results'}</p>
                            <p className="text-sm mt-1">{landers.length === 0 ? 'Click "Add Lander" to save a landing page' : 'Try a different search'}</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {filteredLanders.map(lander => (
                                <div key={lander.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden group hover:shadow-md transition-shadow">
                                    <div className="p-4">
                                        <div className="flex items-start justify-between gap-2 mb-2">
                                            <h3 className="font-bold text-gray-900 text-sm truncate flex-1" title={lander.title}>
                                                {lander.title || lander.url}
                                            </h3>
                                            <div className="flex items-center gap-1 flex-shrink-0">
                                                <a href={lander.url} target="_blank" rel="noopener noreferrer"
                                                    className="p-1.5 text-amber-600 hover:text-amber-700 hover:bg-amber-50 rounded-lg transition-colors" title="Open lander">
                                                    <ExternalLink size={14} />
                                                </a>
                                                <button onClick={() => handleDeleteLander(lander.id)}
                                                    className="p-1.5 text-gray-300 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100" title="Delete">
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </div>
                                        <a href={lander.url} target="_blank" rel="noopener noreferrer"
                                            className="text-xs text-gray-400 hover:text-amber-600 truncate block mb-3" title={lander.url}>
                                            {lander.url}
                                        </a>
                                        {editingLanderId === lander.id ? (
                                            <div className="mb-3">
                                                <textarea value={editLanderNotes} onChange={e => setEditLanderNotes(e.target.value)}
                                                    rows="2" className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-amber-500" autoFocus />
                                                <div className="flex gap-1 mt-1">
                                                    <button onClick={() => handleUpdateLanderNotes(lander.id)} className="p-1 text-green-600 hover:text-green-700"><Check size={14} /></button>
                                                    <button onClick={() => setEditingLanderId(null)} className="p-1 text-gray-400 hover:text-gray-600"><X size={14} /></button>
                                                </div>
                                            </div>
                                        ) : lander.notes ? (
                                            <div className="text-sm text-gray-600 mb-3 cursor-pointer hover:text-gray-800 flex items-start gap-1"
                                                onClick={() => { setEditingLanderId(lander.id); setEditLanderNotes(lander.notes || ''); }}>
                                                <StickyNote size={12} className="mt-0.5 flex-shrink-0 text-gray-400" />
                                                <span className="line-clamp-2">{lander.notes}</span>
                                            </div>
                                        ) : (
                                            <button onClick={() => { setEditingLanderId(lander.id); setEditLanderNotes(''); }}
                                                className="text-xs text-gray-300 hover:text-gray-500 mb-3 flex items-center gap-1">
                                                <Edit3 size={10} /> Add notes
                                            </button>
                                        )}
                                        <div className="flex flex-wrap items-center gap-1.5">
                                            {lander.brand_name && (
                                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">{lander.brand_name}</span>
                                            )}
                                            {(lander.tags || []).map((tag, i) => (
                                                <span key={i} className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">
                                                    <Tag size={9} />{tag}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}

            {/* ═══════════════════════════════════════════════════════════════ */}
            {/* COMPETITORS TAB                                                */}
            {/* ═══════════════════════════════════════════════════════════════ */}
            {activeTab === 'competitors' && (
                <>
                    {/* Header row */}
                    <div className="flex items-center justify-between mb-4">
                        <p className="text-sm text-gray-500">Track competitor Facebook pages and their Ad Library listings</p>
                        <button onClick={() => setShowAddCompetitor(!showAddCompetitor)}
                            className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 font-medium text-sm">
                            <Plus size={16} /> Add Competitor
                        </button>
                    </div>

                    {/* Group / Folder pills */}
                    {competitorGroups.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2 mb-4">
                            <button onClick={() => setActiveGroup(null)}
                                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                                    !activeGroup ? 'bg-amber-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                                }`}>
                                All <span className="text-xs opacity-75">({competitors.length})</span>
                            </button>
                            {competitorGroups.map(g => (
                                <button key={g.name} onClick={() => setActiveGroup(g.is_ungrouped ? '__ungrouped__' : g.name)}
                                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                                        (g.is_ungrouped ? '__ungrouped__' : g.name) === activeGroup
                                            ? 'bg-amber-600 text-white'
                                            : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                                    }`}>
                                    <FolderOpen size={14} /> {g.name} <span className="text-xs opacity-75">({g.count})</span>
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Add Competitor Form */}
                    {showAddCompetitor && (
                        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
                            <h3 className="font-bold text-gray-900 mb-1">Add a Competitor Page</h3>
                            <p className="text-xs text-gray-400 mb-4">Paste the FB Ads Library URL for a competitor page. Facebook blocks auto-detecting page names for third-party pages, so enter the name yourself.</p>
                            <div className="space-y-4 mb-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">FB Ads Library URL *</label>
                                    <input type="url" value={competitorForm.url}
                                        onChange={e => setCompetitorForm({ ...competitorForm, url: e.target.value })}
                                        placeholder="https://www.facebook.com/ads/library/?...view_all_page_id=123456..."
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-sm" />
                                    {competitorForm.url && extractPageId(competitorForm.url) && (
                                        <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                                            <Check size={12} /> Page ID detected: <span className="font-mono">{extractPageId(competitorForm.url)}</span>
                                        </p>
                                    )}
                                    {competitorForm.url && !extractPageId(competitorForm.url) && competitorForm.url.length > 10 && (
                                        <p className="text-xs text-red-500 mt-1">No page ID found — URL needs view_all_page_id= parameter</p>
                                    )}
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Page Name *</label>
                                        <input type="text" value={competitorForm.name}
                                            onChange={e => setCompetitorForm({ ...competitorForm, name: e.target.value })}
                                            placeholder="e.g. Rejuvacare Main Page"
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-sm" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Group / Folder</label>
                                        <div className="flex gap-2">
                                            <select value={competitorForm.group_name}
                                                onChange={e => { setCompetitorForm({ ...competitorForm, group_name: e.target.value }); if (e.target.value !== '__new__') setNewGroupName(''); }}
                                                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-sm">
                                                <option value="">{activeGroup && activeGroup !== '__all__' && activeGroup !== '__ungrouped__' ? activeGroup : '— No group —'}</option>
                                                {existingGroupNames.map(g => (
                                                    <option key={g} value={g}>{g}</option>
                                                ))}
                                                <option value="__new__">+ New group...</option>
                                            </select>
                                            {competitorForm.group_name === '__new__' && (
                                                <input type="text" value={newGroupName}
                                                    onChange={e => setNewGroupName(e.target.value)}
                                                    placeholder="Group name"
                                                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-sm"
                                                    autoFocus />
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Tags</label>
                                        <input type="text" value={competitorForm.tags}
                                            onChange={e => setCompetitorForm({ ...competitorForm, tags: e.target.value })}
                                            placeholder="rejuvacare, foot pain (comma separated)"
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-sm" />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                                        <input type="text" value={competitorForm.notes}
                                            onChange={e => setCompetitorForm({ ...competitorForm, notes: e.target.value })}
                                            placeholder="Main page, high spend"
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-sm" />
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <button onClick={handleAddCompetitor}
                                    disabled={!competitorForm.url.trim() || !extractPageId(competitorForm.url) || competitorSaving}
                                    className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 font-medium flex items-center gap-2 text-sm">
                                    {competitorSaving ? <Loader size={16} className="animate-spin" /> : <Plus size={16} />}
                                    Save Competitor
                                </button>
                                <button onClick={() => { setShowAddCompetitor(false); setNewGroupName(''); }} className="px-4 py-2 text-gray-600 hover:text-gray-800 text-sm">Cancel</button>
                            </div>
                        </div>
                    )}

                    {/* Search */}
                    <div className="flex flex-wrap items-center gap-3 mb-6">
                        <div className="relative flex-1 max-w-sm">
                            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input value={competitorSearch} onChange={e => setCompetitorSearch(e.target.value)}
                                placeholder="Search competitors..."
                                className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-sm" />
                        </div>
                        <span className="text-sm text-gray-400">{filteredCompetitors.length} page{filteredCompetitors.length !== 1 ? 's' : ''}</span>
                    </div>

                    {/* Grid */}
                    {competitorsLoading ? (
                        <div className="flex items-center justify-center py-16">
                            <Loader size={32} className="animate-spin text-gray-400" />
                        </div>
                    ) : filteredCompetitors.length === 0 ? (
                        <div className="text-center py-16 text-gray-400">
                            <Users size={48} className="mx-auto mb-4" />
                            <p className="text-lg font-medium text-gray-500">{competitors.length === 0 ? 'No competitors saved yet' : 'No results'}</p>
                            <p className="text-sm mt-1">{competitors.length === 0 ? 'Click "Add Competitor" to track a Facebook page' : 'Try a different search'}</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {filteredCompetitors.map(comp => (
                                <div key={comp.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden group hover:shadow-md transition-shadow">
                                    <div className="p-4">
                                        {editingCompetitorId === comp.id ? (
                                            /* Edit mode */
                                            <div className="space-y-3">
                                                <p className="text-xs text-gray-400 font-mono">Page ID: {comp.fb_page_id}</p>
                                                <div>
                                                    <label className="block text-xs font-medium text-gray-500 mb-1">Page Name *</label>
                                                    <input type="text" value={editCompetitorForm.name}
                                                        onChange={e => setEditCompetitorForm({ ...editCompetitorForm, name: e.target.value })}
                                                        placeholder="Enter page name..."
                                                        className={`w-full px-2 py-1.5 border rounded text-sm focus:ring-2 focus:ring-amber-500 ${
                                                            editCompetitorForm.name === 'Unknown Page' ? 'border-red-300 bg-red-50' : 'border-gray-300'
                                                        }`} autoFocus />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-medium text-gray-500 mb-1">Group / Folder</label>
                                                    <select value={editCompetitorForm.group_name}
                                                        onChange={e => { setEditCompetitorForm({ ...editCompetitorForm, group_name: e.target.value }); if (e.target.value !== '__new__') setNewEditGroupName(''); }}
                                                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-amber-500">
                                                        <option value="">— No group —</option>
                                                        {existingGroupNames.map(g => (
                                                            <option key={g} value={g}>{g}</option>
                                                        ))}
                                                        <option value="__new__">+ New group...</option>
                                                    </select>
                                                    {editCompetitorForm.group_name === '__new__' && (
                                                        <input type="text" value={newEditGroupName}
                                                            onChange={e => setNewEditGroupName(e.target.value)}
                                                            placeholder="New group name"
                                                            className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-amber-500 mt-2" autoFocus />
                                                    )}
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
                                                    <input type="text" value={editCompetitorForm.notes}
                                                        onChange={e => setEditCompetitorForm({ ...editCompetitorForm, notes: e.target.value })}
                                                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-amber-500"
                                                        placeholder="Notes..." />
                                                </div>
                                                <div>
                                                    <label className="block text-xs font-medium text-gray-500 mb-1">Tags</label>
                                                    <input type="text" value={editCompetitorForm.tags}
                                                        onChange={e => setEditCompetitorForm({ ...editCompetitorForm, tags: e.target.value })}
                                                        className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-amber-500"
                                                        placeholder="tag1, tag2" />
                                                </div>
                                                <div className="flex gap-2">
                                                    <button onClick={() => handleSaveEditCompetitor(comp.id)}
                                                        className="px-3 py-1 bg-amber-600 text-white rounded text-xs font-medium hover:bg-amber-700 flex items-center gap-1">
                                                        <Check size={12} /> Save
                                                    </button>
                                                    <button onClick={() => { setEditingCompetitorId(null); setNewEditGroupName(''); }}
                                                        className="px-3 py-1 text-gray-500 hover:text-gray-700 text-xs">Cancel</button>
                                                </div>
                                            </div>
                                        ) : (
                                            /* View mode */
                                            <>
                                                <div className="flex items-start justify-between gap-2 mb-2">
                                                    <h3 className="font-bold text-gray-900 text-sm truncate flex-1" title={comp.name}>
                                                        {comp.name}
                                                    </h3>
                                                    <div className="flex items-center gap-1 flex-shrink-0">
                                                        <a href={comp.fb_ads_library_url || `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=ALL&view_all_page_id=${comp.fb_page_id}&search_type=page`}
                                                            target="_blank" rel="noopener noreferrer"
                                                            className="p-1.5 text-amber-600 hover:text-amber-700 hover:bg-amber-50 rounded-lg transition-colors" title="Open in Ads Library">
                                                            <ExternalLink size={14} />
                                                        </a>
                                                        <button onClick={() => handleStartEditCompetitor(comp)}
                                                            className="p-1.5 text-gray-300 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100" title="Edit">
                                                            <Edit3 size={14} />
                                                        </button>
                                                        <button onClick={() => handleDeleteCompetitor(comp.id)}
                                                            className="p-1.5 text-gray-300 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100" title="Delete">
                                                            <Trash2 size={14} />
                                                        </button>
                                                    </div>
                                                </div>
                                                <p className="text-xs text-gray-400 font-mono mb-2">Page ID: {comp.fb_page_id}</p>
                                                {comp.group_name && (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 mb-2">
                                                        <FolderOpen size={10} /> {comp.group_name}
                                                    </span>
                                                )}
                                                {comp.notes && (
                                                    <p className="text-sm text-gray-600 mb-2 flex items-start gap-1">
                                                        <StickyNote size={12} className="mt-0.5 flex-shrink-0 text-gray-400" />
                                                        <span className="line-clamp-2">{comp.notes}</span>
                                                    </p>
                                                )}
                                                <div className="flex flex-wrap items-center gap-1.5">
                                                    {(comp.tags || []).map((tag, i) => (
                                                        <span key={i} className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">
                                                            <Tag size={9} />{tag}
                                                        </span>
                                                    ))}
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}


// ── Thumbnail with error fallback ────────────────────────────────────

function SwipeThumb({ url, isVideo }) {
    const [failed, setFailed] = useState(false);

    if (!url || failed) {
        return (
            <div className="w-full h-full flex items-center justify-center">
                {isVideo ? <Video size={40} className="text-gray-300" /> : <ImageIcon size={40} className="text-gray-300" />}
            </div>
        );
    }

    return (
        <img src={url} alt="" className="w-full h-full object-cover" onError={() => setFailed(true)} />
    );
}


// ── Swipe Card Component ─────────────────────────────────────────────

function SwipeCard({ item, selected, analyzing, onView, onSelect, onStar, onDelete, onAnalyze, platformBadge, daysRunningBadge, getLandingPageUrl }) {
    return (
        <div onClick={onView}
            className={`bg-white rounded-xl shadow-sm border overflow-hidden cursor-pointer hover:shadow-md transition-shadow group ${selected ? 'border-amber-500 ring-2 ring-amber-200' : 'border-gray-200'}`}>
            {/* Image */}
            <div className="relative aspect-video bg-gray-100 overflow-hidden">
                <SwipeThumb url={item.image_url || item.thumbnail_url} isVideo={!!item.video_url} />
                {/* Hover actions */}
                <div className="absolute top-2 left-2 right-2 flex justify-between opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={onSelect}
                        className={`w-6 h-6 rounded border-2 flex items-center justify-center ${selected ? 'bg-amber-500 border-amber-500 text-white' : 'bg-white/80 border-gray-300'}`}>
                        {selected && <span className="text-xs font-bold">&#10003;</span>}
                    </button>
                    <div className="flex gap-1">
                        <button onClick={onAnalyze} disabled={analyzing}
                            className="p-1.5 bg-white/80 rounded-lg hover:bg-amber-50 shadow-sm" title="AI Analyze">
                            {analyzing ? <Loader size={14} className="animate-spin text-amber-500" /> : <Sparkles size={14} className="text-amber-500" />}
                        </button>
                        <button onClick={onStar}
                            className="p-1.5 bg-white/80 rounded-lg hover:bg-white shadow-sm">
                            <Star size={14} className={item.is_starred ? 'text-amber-500 fill-amber-500' : 'text-gray-400'} />
                        </button>
                        <button onClick={onDelete}
                            className="p-1.5 bg-white/80 rounded-lg hover:bg-red-50 shadow-sm">
                            <Trash2 size={14} className="text-gray-400 hover:text-red-600" />
                        </button>
                    </div>
                </div>
                {/* Platform badge */}
                {item.platform && (
                    <span className={`absolute bottom-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-semibold ${platformBadge(item.platform)}`}>
                        {item.platform}
                    </span>
                )}
                {item.days_running && (
                    <span className={`absolute bottom-2 right-2 px-2 py-0.5 rounded-full text-[10px] font-semibold ${daysRunningBadge(item.days_running)}`}>
                        {item.days_running}d running
                    </span>
                )}
                {/* Video play indicator */}
                {(item.creative_type === 'video' || item.video_url) && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="w-10 h-10 rounded-full bg-black/40 flex items-center justify-center">
                            <div className="w-0 h-0 border-l-[12px] border-l-white border-y-[7px] border-y-transparent ml-0.5" />
                        </div>
                    </div>
                )}
                {/* AI analyzed indicator */}
                {item.ai_analysis && (
                    <span className="absolute top-2 right-2 opacity-0 group-hover:opacity-0 p-1 bg-amber-500/80 rounded-full" style={{ opacity: 1 }}>
                        <Sparkles size={10} className="text-white" />
                    </span>
                )}
            </div>
            {/* Card body */}
            <div className="p-3">
                {item.advertiser_name && (
                    <p className="text-gray-400 text-xs mb-1 truncate">{item.advertiser_name}</p>
                )}
                <p className="text-gray-900 text-sm font-medium line-clamp-2 mb-2">
                    {item.headline || item.primary_text?.slice(0, 80) || item.source_url || 'Untitled'}
                </p>
                {/* Landing page quick-link */}
                {getLandingPageUrl && getLandingPageUrl(item) && (
                    <a href={getLandingPageUrl(item)} target="_blank" rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="flex items-center gap-1.5 px-2 py-1.5 mb-2 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg text-blue-600 hover:text-blue-800 text-xs font-medium truncate transition-colors">
                        <Globe size={12} className="flex-shrink-0" />
                        <span className="truncate">{getLandingPageUrl(item).replace(/^https?:\/\//, '').replace(/\/$/, '')}</span>
                        <ExternalLink size={10} className="flex-shrink-0 opacity-50" />
                    </a>
                )}
                <div className="flex flex-wrap gap-1">
                    {item.source_type === 'telegram' && (
                        <span className="px-1.5 py-0.5 bg-green-50 rounded text-[10px] text-green-700 font-medium">
                            In the Wild
                        </span>
                    )}
                    {item.creative_type && (
                        <span className="px-1.5 py-0.5 bg-gray-100 rounded text-[10px] text-gray-600 uppercase font-medium">
                            {item.creative_type}
                        </span>
                    )}
                    {item.niche && (
                        <span className="px-1.5 py-0.5 bg-amber-50 rounded text-[10px] text-amber-700 font-medium">
                            {item.niche}
                        </span>
                    )}
                    {item.category && (
                        <span className="px-1.5 py-0.5 bg-blue-50 rounded text-[10px] text-blue-700 font-medium truncate max-w-[120px]" title={item.category}>
                            {item.category}
                        </span>
                    )}
                    {(item.tags || []).slice(0, 2).map(t => (
                        <span key={t} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-gray-100 rounded text-[10px] text-gray-600">
                            <Tag size={8} />{t}
                        </span>
                    ))}
                </div>
            </div>
        </div>
    );
}


// ── Discover Card Component ──────────────────────────────────────────

function DiscoverCard({ ad, isSaved, isSaving, onSave, onView, onVideoClick, platformBadge, daysRunningBadge }) {
    const isVideo = ad.media_type === 'video';

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow group">
            {/* Card content - clickable */}
            <div onClick={onView} className="cursor-pointer">
                <div className="relative aspect-video bg-gray-50 overflow-hidden">
                    {ad.thumbnail_url ? (
                        <img src={ad.thumbnail_url} alt="" className="w-full h-full object-cover"
                            onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
                    ) : null}
                    <div className={`w-full h-full flex items-center justify-center ${ad.thumbnail_url ? 'hidden' : ''}`}
                        style={ad.thumbnail_url ? { display: 'none' } : {}}>
                        {isVideo ? <Video size={40} className="text-gray-300" /> : <ImageIcon size={40} className="text-gray-300" />}
                    </div>

                    {/* Open ad in new tab */}
                    {ad.source_url && (
                        <button
                            onClick={e => { e.stopPropagation(); try { const u = new URL(ad.source_url); if (u.protocol === 'http:' || u.protocol === 'https:') window.open(ad.source_url, '_blank'); } catch {} }}
                            className="absolute top-2 right-2 w-8 h-8 rounded-lg bg-white/90 hover:bg-white flex items-center justify-center shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Open in Ad Library"
                        >
                            <ExternalLink size={14} className="text-gray-700" />
                        </button>
                    )}

                    {/* Video play button overlay */}
                    {isVideo && ad.source_url && (
                        <button
                            onClick={e => { e.stopPropagation(); onVideoClick(ad); }}
                            className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                            <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
                                <div className="w-0 h-0 border-l-[16px] border-l-gray-800 border-y-[10px] border-y-transparent ml-1" />
                            </div>
                        </button>
                    )}

                    {/* Media type badge */}
                    {ad.media_type && ad.media_type !== 'unknown' && (
                        <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px] font-semibold uppercase flex items-center gap-0.5">
                            {isVideo && <Video size={9} />}
                            {ad.media_type === 'carousel' && <ImageIcon size={9} />}
                            {ad.media_type}
                        </span>
                    )}

                    {/* Days running badge */}
                    {ad.days_running && (
                        <span className={`absolute bottom-2 right-2 px-2 py-0.5 rounded-full text-[10px] font-semibold flex items-center gap-0.5 ${daysRunningBadge(ad.days_running)}`}>
                            <Clock size={9} />
                            {ad.days_running}d
                            {ad.days_running >= 30 && <TrendingUp size={9} />}
                        </span>
                    )}
                    {/* Platform badges */}
                    {ad.publisher_platforms?.length > 0 && (
                        <div className="absolute bottom-2 left-2 flex gap-1">
                            {ad.publisher_platforms.slice(0, 2).map(p => (
                                <span key={p} className={`px-1.5 py-0.5 rounded-full text-[9px] font-semibold ${platformBadge(p)}`}>{p}</span>
                            ))}
                        </div>
                    )}
                </div>
                <div className="p-3">
                    <div className="flex items-center justify-between mb-1.5">
                        {ad.advertiser_name && (
                            <p className="text-gray-700 text-xs font-semibold truncate flex-1">{ad.advertiser_name}</p>
                        )}
                        {ad.first_seen && (
                            <span className="text-gray-500 text-[11px] ml-2 whitespace-nowrap flex items-center gap-1 font-medium">
                                <Clock size={10} /> {ad.first_seen}
                            </span>
                        )}
                    </div>
                    <p className="text-gray-900 text-sm font-semibold line-clamp-2 leading-snug mb-1">
                        {ad.headline || ad.primary_text?.slice(0, 80) || 'No headline'}
                    </p>
                    {ad.primary_text && ad.headline && (
                        <p className="text-gray-500 text-xs line-clamp-2 leading-relaxed mb-1.5">{ad.primary_text.slice(0, 140)}</p>
                    )}
                    {/* Landing page link */}
                    {(ad.landing_page_url || (ad.cta_text && ad.cta_text.includes('.') && !ad.cta_text.includes(' '))) && (
                        <a href={ad.landing_page_url || `https://${ad.cta_text.toLowerCase()}`} target="_blank" rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="text-blue-500 hover:text-blue-700 text-[10px] truncate block mb-1 flex items-center gap-0.5">
                            <Globe size={9} />{(ad.landing_page_url || `https://${ad.cta_text.toLowerCase()}`).replace(/^https?:\/\//, '')}
                        </a>
                    )}
                    {/* CTA + extra info row */}
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        {ad.cta_text && (
                            <span className="px-1.5 py-0.5 bg-amber-50 border border-amber-200 rounded text-[10px] text-amber-700 font-semibold">
                                {ad.cta_text}
                            </span>
                        )}
                        {ad.ad_library_id && (
                            <span className="text-[10px] text-gray-400 font-mono">ID: {ad.ad_library_id}</span>
                        )}
                    </div>
                </div>
            </div>
            {/* Save button */}
            <div className="px-3 pb-3">
                {isSaved ? (
                    <button disabled
                        className="w-full py-2 bg-green-50 text-green-700 rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 border border-green-200">
                        <Check size={14} /> Saved
                    </button>
                ) : (
                    <button onClick={onSave} disabled={isSaving}
                        className="w-full py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-medium flex items-center justify-center gap-1.5 disabled:opacity-50 transition-colors">
                        {isSaving ? <Loader size={14} className="animate-spin" /> : <Download size={14} />}
                        {isSaving ? 'Saving...' : 'Save to Swipe File'}
                    </button>
                )}
            </div>
        </div>
    );
}
