import React, { useEffect, useState } from 'react';
import { Globe, Plus, Trash2, ExternalLink, Tag, X, Loader, Search, StickyNote, Edit3, Check } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useBrands } from '../context/BrandContext';
import { useToast } from '../context/ToastContext';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

export default function Landers() {
    const { authFetch } = useAuth();
    const { brands } = useBrands();
    const { showSuccess, showError } = useToast();

    const [landers, setLanders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showAdd, setShowAdd] = useState(false);
    const [saving, setSaving] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [filterBrand, setFilterBrand] = useState('');

    // Add form
    const [newUrl, setNewUrl] = useState('');
    const [newTitle, setNewTitle] = useState('');
    const [newNotes, setNewNotes] = useState('');
    const [newTags, setNewTags] = useState('');
    const [newBrandId, setNewBrandId] = useState('');

    // Edit
    const [editingId, setEditingId] = useState(null);
    const [editNotes, setEditNotes] = useState('');

    const fetchLanders = async () => {
        try {
            const params = filterBrand ? `?brand_id=${filterBrand}` : '';
            const res = await authFetch(`${API_URL}/landers/${params}`);
            if (res.ok) setLanders(await res.json());
        } catch (e) {
            console.error('Failed to fetch landers:', e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchLanders(); }, [filterBrand]);

    const handleAdd = async () => {
        if (!newUrl.trim()) return;
        setSaving(true);
        try {
            const tags = newTags.trim() ? newTags.split(',').map(t => t.trim()).filter(Boolean) : [];
            const res = await authFetch(`${API_URL}/landers/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: newUrl.trim(),
                    title: newTitle.trim() || null,
                    notes: newNotes.trim() || null,
                    tags: tags.length > 0 ? tags : null,
                    brand_id: newBrandId || null,
                }),
            });
            if (res.ok) {
                const lander = await res.json();
                setLanders(prev => [lander, ...prev]);
                setNewUrl(''); setNewTitle(''); setNewNotes(''); setNewTags(''); setNewBrandId('');
                setShowAdd(false);
                showSuccess('Lander saved');
            } else {
                const err = await res.json().catch(() => ({}));
                showError(err.detail || 'Failed to save');
            }
        } catch (e) {
            showError('Failed to save lander');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id) => {
        try {
            const res = await authFetch(`${API_URL}/landers/${id}`, { method: 'DELETE' });
            if (res.ok) {
                setLanders(prev => prev.filter(l => l.id !== id));
                showSuccess('Deleted');
            }
        } catch (e) {
            showError('Failed to delete');
        }
    };

    const handleUpdateNotes = async (id) => {
        try {
            const res = await authFetch(`${API_URL}/landers/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ notes: editNotes }),
            });
            if (res.ok) {
                setLanders(prev => prev.map(l => l.id === id ? { ...l, notes: editNotes } : l));
                setEditingId(null);
                showSuccess('Notes updated');
            }
        } catch (e) {
            showError('Failed to update');
        }
    };

    const filtered = landers.filter(l => {
        if (!searchQuery) return true;
        const q = searchQuery.toLowerCase();
        return (l.title || '').toLowerCase().includes(q)
            || (l.url || '').toLowerCase().includes(q)
            || (l.notes || '').toLowerCase().includes(q)
            || (l.tags || []).some(t => t.toLowerCase().includes(q));
    });

    return (
        <div>
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
                        <Globe size={32} className="text-amber-600" />
                        Landers to Rip
                    </h1>
                    <p className="text-gray-500 mt-1">Save landing pages to study and draw inspiration from</p>
                </div>
                <button
                    onClick={() => setShowAdd(!showAdd)}
                    className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors font-medium"
                >
                    <Plus size={18} />
                    Add Lander
                </button>
            </div>

            {/* Add Form */}
            {showAdd && (
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
                    <h3 className="font-bold text-gray-900 mb-4">Add a Landing Page</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">URL *</label>
                            <input
                                type="url"
                                value={newUrl}
                                onChange={(e) => setNewUrl(e.target.value)}
                                placeholder="https://example.com/landing-page"
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                            <input
                                type="text"
                                value={newTitle}
                                onChange={(e) => setNewTitle(e.target.value)}
                                placeholder="e.g. Competitor foot pain lander"
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Brand</label>
                            <select
                                value={newBrandId}
                                onChange={(e) => setNewBrandId(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                            >
                                <option value="">No brand</option>
                                {brands.map(b => (
                                    <option key={b.id} value={b.id}>{b.name}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Tags</label>
                            <input
                                type="text"
                                value={newTags}
                                onChange={(e) => setNewTags(e.target.value)}
                                placeholder="health, foot pain, listicle (comma separated)"
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                            />
                        </div>
                    </div>
                    <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                        <textarea
                            value={newNotes}
                            onChange={(e) => setNewNotes(e.target.value)}
                            placeholder="What makes this lander convert? What elements to study?"
                            rows="2"
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                        />
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleAdd}
                            disabled={!newUrl.trim() || saving}
                            className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium flex items-center gap-2"
                        >
                            {saving ? <Loader size={16} className="animate-spin" /> : <Plus size={16} />}
                            Save Lander
                        </button>
                        <button
                            onClick={() => setShowAdd(false)}
                            className="px-4 py-2 text-gray-600 hover:text-gray-800"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3 mb-6">
                <div className="relative flex-1 max-w-sm">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search landers..."
                        className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 text-sm"
                    />
                </div>
                <select
                    value={filterBrand}
                    onChange={(e) => setFilterBrand(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                >
                    <option value="">All brands</option>
                    {brands.map(b => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                </select>
                <span className="text-sm text-gray-400">{filtered.length} lander{filtered.length !== 1 ? 's' : ''}</span>
            </div>

            {/* Landers Grid */}
            {loading ? (
                <div className="flex items-center justify-center py-16">
                    <Loader size={32} className="animate-spin text-gray-400" />
                </div>
            ) : filtered.length === 0 ? (
                <div className="text-center py-16 text-gray-400">
                    <Globe size={48} className="mx-auto mb-4" />
                    <p className="text-lg font-medium">{landers.length === 0 ? 'No landers saved yet' : 'No results'}</p>
                    <p className="text-sm mt-1">{landers.length === 0 ? 'Click "Add Lander" to save a landing page for inspiration' : 'Try a different search'}</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filtered.map(lander => (
                        <div key={lander.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden group hover:shadow-md transition-shadow">
                            {/* Card Header */}
                            <div className="p-4">
                                <div className="flex items-start justify-between gap-2 mb-2">
                                    <h3 className="font-bold text-gray-900 text-sm truncate flex-1" title={lander.title}>
                                        {lander.title || lander.url}
                                    </h3>
                                    <div className="flex items-center gap-1 flex-shrink-0">
                                        <a
                                            href={lander.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="p-1.5 text-amber-600 hover:text-amber-700 hover:bg-amber-50 rounded-lg transition-colors"
                                            title="Open lander"
                                        >
                                            <ExternalLink size={14} />
                                        </a>
                                        <button
                                            onClick={() => handleDelete(lander.id)}
                                            className="p-1.5 text-gray-300 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                                            title="Delete"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                </div>

                                {/* URL */}
                                <a
                                    href={lander.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-gray-400 hover:text-amber-600 truncate block mb-3"
                                    title={lander.url}
                                >
                                    {lander.url}
                                </a>

                                {/* Notes */}
                                {editingId === lander.id ? (
                                    <div className="mb-3">
                                        <textarea
                                            value={editNotes}
                                            onChange={(e) => setEditNotes(e.target.value)}
                                            rows="2"
                                            className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-amber-500"
                                            autoFocus
                                        />
                                        <div className="flex gap-1 mt-1">
                                            <button onClick={() => handleUpdateNotes(lander.id)} className="p-1 text-green-600 hover:text-green-700"><Check size={14} /></button>
                                            <button onClick={() => setEditingId(null)} className="p-1 text-gray-400 hover:text-gray-600"><X size={14} /></button>
                                        </div>
                                    </div>
                                ) : lander.notes ? (
                                    <div
                                        className="text-sm text-gray-600 mb-3 cursor-pointer hover:text-gray-800 flex items-start gap-1"
                                        onClick={() => { setEditingId(lander.id); setEditNotes(lander.notes || ''); }}
                                    >
                                        <StickyNote size={12} className="mt-0.5 flex-shrink-0 text-gray-400" />
                                        <span className="line-clamp-2">{lander.notes}</span>
                                    </div>
                                ) : (
                                    <button
                                        onClick={() => { setEditingId(lander.id); setEditNotes(''); }}
                                        className="text-xs text-gray-300 hover:text-gray-500 mb-3 flex items-center gap-1"
                                    >
                                        <Edit3 size={10} /> Add notes
                                    </button>
                                )}

                                {/* Tags + Brand */}
                                <div className="flex flex-wrap items-center gap-1.5">
                                    {lander.brand_name && (
                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                                            {lander.brand_name}
                                        </span>
                                    )}
                                    {(lander.tags || []).map((tag, i) => (
                                        <span key={i} className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">
                                            <Tag size={9} />
                                            {tag}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
