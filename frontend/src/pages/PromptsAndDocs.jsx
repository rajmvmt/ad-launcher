import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Copy, Trash2, Edit3, X, Check, Search, FileText, Loader, ChevronDown, ChevronUp, Download, BookOpen, Upload, Paperclip, ExternalLink, FlaskConical } from 'lucide-react';
import { jsPDF } from 'jspdf';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useBrands } from '../context/BrandContext';
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

// Upload file to R2 storage via uploads endpoint
const uploadFile = async (file) => {
    const token = localStorage.getItem('accessToken');
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(`${API_URL}/uploads/`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
    });
    if (!response.ok) throw new Error('Upload failed');
    return response.json();
};

const PROMPT_CATEGORIES = ['Higgsfield', 'Image Generation', 'Video Analysis', 'Ad Copy', 'Research', 'Other'];
const DOC_CATEGORIES = ['Research', 'Strategy', 'Playbook', 'Reference', 'Notes', 'Other'];
const RESEARCH_CATEGORIES = ['Competitor Analysis', 'Market Research', 'Product Specs', 'Ad Swipes', 'Customer Insights', 'Other'];

const CATEGORY_COLORS = {
    'Higgsfield': 'bg-purple-100 text-purple-700 border-purple-200',
    'Image Generation': 'bg-blue-100 text-blue-700 border-blue-200',
    'Video Analysis': 'bg-green-100 text-green-700 border-green-200',
    'Ad Copy': 'bg-amber-100 text-amber-700 border-amber-200',
    'Research': 'bg-indigo-100 text-indigo-700 border-indigo-200',
    'Strategy': 'bg-rose-100 text-rose-700 border-rose-200',
    'Playbook': 'bg-cyan-100 text-cyan-700 border-cyan-200',
    'Reference': 'bg-teal-100 text-teal-700 border-teal-200',
    'Notes': 'bg-yellow-100 text-yellow-700 border-yellow-200',
    'Competitor Analysis': 'bg-orange-100 text-orange-700 border-orange-200',
    'Market Research': 'bg-emerald-100 text-emerald-700 border-emerald-200',
    'Product Specs': 'bg-sky-100 text-sky-700 border-sky-200',
    'Ad Swipes': 'bg-pink-100 text-pink-700 border-pink-200',
    'Customer Insights': 'bg-violet-100 text-violet-700 border-violet-200',
    'Other': 'bg-gray-100 text-gray-700 border-gray-200',
};

const TAB_CONFIG = {
    prompt: { label: 'Prompts', icon: FileText, categories: PROMPT_CATEGORIES, newLabel: 'New Prompt', contentLabel: 'Prompt Text', contentPlaceholder: 'Paste your full prompt here...', namePlaceholder: 'e.g. Higgsfield Character Prompt', mono: true },
    doc: { label: 'Docs', icon: BookOpen, categories: DOC_CATEGORIES, newLabel: 'New Doc', contentLabel: 'Content', contentPlaceholder: 'Paste or write your document content here...', namePlaceholder: 'e.g. Facebook Policy Guidelines', mono: false },
    research: { label: 'Product Research', icon: FlaskConical, categories: RESEARCH_CATEGORIES, newLabel: 'New Research', contentLabel: 'Notes / Summary', contentPlaceholder: 'Paste research notes, summaries, or key findings...', namePlaceholder: 'e.g. Vita Feet - Product Research Master Doc', mono: false },
};

function generateId(type) {
    return `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function downloadPdf(item) {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 20;
    const usable = pageWidth - margin * 2;
    let y = 20;

    const addText = (text, size, style) => {
        doc.setFontSize(size);
        doc.setFont('helvetica', style);
        const lines = doc.splitTextToSize(text, usable);
        for (const line of lines) {
            if (y > 275) { doc.addPage(); y = 20; }
            doc.text(line, margin, y);
            y += size * 0.45;
        }
    };

    doc.setTextColor(30, 30, 30);
    addText(item.name, 18, 'bold');
    y += 2;
    doc.setTextColor(120, 120, 120);
    const meta = [item.category, item.brand_name].filter(Boolean).join('  ·  ');
    addText(meta || item.category, 10, 'normal');
    y += 2;
    doc.setDrawColor(220, 220, 220);
    doc.line(margin, y, pageWidth - margin, y);
    y += 6;

    if (item.description) {
        doc.setTextColor(80, 80, 80);
        addText(item.description, 10, 'italic');
        y += 4;
    }

    if (item.template) {
        doc.setTextColor(30, 30, 30);
        doc.setFont(item.type === 'prompt' ? 'courier' : 'helvetica', 'normal');
        const fs = item.type === 'prompt' ? 9 : 10;
        doc.setFontSize(fs);
        const contentLines = doc.splitTextToSize(item.template, usable);
        for (const line of contentLines) {
            if (y > 275) { doc.addPage(); y = 20; }
            doc.text(line, margin, y);
            y += fs * 0.45;
        }
    }

    if (item.files?.length) {
        y += 6;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(30, 30, 30);
        doc.text('Attached Files:', margin, y);
        y += 5;
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(80, 80, 80);
        for (const f of item.files) {
            if (y > 275) { doc.addPage(); y = 20; }
            doc.text(`• ${f.name} (${(f.size / 1024).toFixed(0)} KB)`, margin + 4, y);
            y += 4.5;
        }
    }

    if (item.notes) {
        y += 6;
        if (y > 260) { doc.addPage(); y = 20; }
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(146, 64, 14);
        doc.text('Notes:', margin, y);
        y += 5;
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(80, 80, 80);
        addText(item.notes, 10, 'normal');
    }

    doc.save(`${item.name.replace(/[^a-zA-Z0-9_\- ]/g, '').trim()}.pdf`);
}

function parseApiError(err) {
    const detail = err.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) return detail.map(e => e.msg || e.message || JSON.stringify(e)).join(', ');
    return null;
}

function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function PromptsAndDocs() {
    const { authFetch } = useAuth();
    const { showSuccess, showError } = useToast();
    const { brands } = useBrands();
    const fileInputRef = useRef(null);
    const [searchParams, setSearchParams] = useSearchParams();

    const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'prompt');
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [filterCategory, setFilterCategory] = useState('');
    const [filterBrand, setFilterBrand] = useState(searchParams.get('brand') || '');
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [expandedId, setExpandedId] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [dragActive, setDragActive] = useState(false);
    const [formData, setFormData] = useState({
        name: '',
        category: 'Other',
        description: '',
        template: '',
        notes: '',
        brand_id: '',
        files: [],
    });

    const tab = TAB_CONFIG[activeTab];
    const isResearch = activeTab === 'research';

    useEffect(() => { fetchItems(); }, [activeTab]);

    const fetchItems = async () => {
        setLoading(true);
        try {
            const res = await authFetch(`${API_URL}/prompts/?type=${activeTab}`);
            if (!res.ok) throw new Error('Failed to fetch');
            setItems(await res.json());
        } catch (err) { showError(err.message); }
        finally { setLoading(false); }
    };

    const handleFileUpload = async (fileList) => {
        if (!fileList?.length) return;
        setUploading(true);
        try {
            const newFiles = [];
            for (const file of fileList) {
                const result = await uploadFile(file);
                newFiles.push({ name: file.name, url: result.url, size: file.size, type: result.media_type });
            }
            setFormData(prev => ({ ...prev, files: [...prev.files, ...newFiles] }));
            showSuccess(`${newFiles.length} file${newFiles.length > 1 ? 's' : ''} uploaded`);
        } catch (err) { showError(`Upload failed: ${err.message}`); }
        finally { setUploading(false); }
    };

    const removeFile = (idx) => {
        setFormData(prev => ({ ...prev, files: prev.files.filter((_, i) => i !== idx) }));
    };

    const handleSave = async () => {
        if (!formData.name.trim()) { showError('Name is required'); return; }
        if (!isResearch && !formData.template.trim()) { showError(`${tab.contentLabel} is required`); return; }
        if (isResearch && !formData.template.trim() && !formData.files.length) { showError('Add notes or upload at least one file'); return; }

        try {
            const payload = {
                name: formData.name,
                category: formData.category,
                description: formData.description || null,
                template: formData.template || '(files only)',
                notes: formData.notes || null,
                brand_id: formData.brand_id || null,
                files: formData.files.length ? formData.files : null,
            };

            if (editingId) {
                const res = await authFetch(`${API_URL}/prompts/${editingId}`, {
                    method: 'PUT', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
                if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(parseApiError(err) || 'Failed to update'); }
                const updated = await res.json();
                setItems(prev => prev.map(p => p.id === editingId ? updated : p));
                showSuccess(`${tab.label.replace(/s$/, '')} updated`);
            } else {
                const res = await authFetch(`${API_URL}/prompts/`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: generateId(activeTab), type: activeTab, variables: [], ...payload }),
                });
                if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(parseApiError(err) || 'Failed to create'); }
                const created = await res.json();
                setItems(prev => [created, ...prev]);
                showSuccess(`${tab.label.replace(/s$/, '')} saved`);
            }
            resetForm();
        } catch (err) { showError(err.message); }
    };

    const handleDelete = async (id) => {
        try {
            const res = await authFetch(`${API_URL}/prompts/${id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('Failed to delete');
            setItems(prev => prev.filter(p => p.id !== id));
            showSuccess('Deleted');
            if (expandedId === id) setExpandedId(null);
        } catch (err) { showError(err.message); }
    };

    const handleEdit = (item) => {
        setEditingId(item.id);
        setFormData({
            name: item.name, category: item.category, description: item.description || '',
            template: item.template === '(files only)' ? '' : (item.template || ''),
            notes: item.notes || '', brand_id: item.brand_id || '', files: item.files || [],
        });
        setShowForm(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleCopy = (text) => { navigator.clipboard.writeText(text); showSuccess('Copied to clipboard'); };

    const resetForm = () => {
        setShowForm(false); setEditingId(null);
        setFormData({ name: '', category: 'Other', description: '', template: '', notes: '', brand_id: '', files: [] });
    };

    const switchTab = (t) => { setActiveTab(t); setFilterCategory(''); setFilterBrand(''); setSearchQuery(''); setExpandedId(null); resetForm(); setSearchParams(t === 'prompt' ? {} : { tab: t }); };

    const handleDrop = (e) => { e.preventDefault(); setDragActive(false); handleFileUpload(Array.from(e.dataTransfer.files)); };

    const filtered = items.filter(p => {
        if (filterCategory && p.category !== filterCategory) return false;
        if (filterBrand && p.brand_id !== filterBrand) return false;
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            return p.name.toLowerCase().includes(q) || (p.template || '').toLowerCase().includes(q)
                || (p.description || '').toLowerCase().includes(q) || (p.notes || '').toLowerCase().includes(q)
                || (p.brand_name || '').toLowerCase().includes(q);
        }
        return true;
    });

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900">Prompts & Docs</h1>
                    <p className="text-gray-500 mt-1">Save prompts, research docs, and reference materials</p>
                </div>
                <button
                    onClick={() => { resetForm(); setShowForm(true); }}
                    className="flex items-center gap-2 px-5 py-2.5 bg-amber-600 text-white rounded-lg font-medium hover:bg-amber-700"
                >
                    <Plus size={18} /> {tab.newLabel}
                </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 mb-5 bg-gray-100 rounded-lg p-1 w-fit">
                {Object.entries(TAB_CONFIG).map(([key, cfg]) => {
                    const Icon = cfg.icon;
                    return (
                        <button key={key} onClick={() => switchTab(key)}
                            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === key ? 'bg-white text-amber-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                            <Icon size={16} /> {cfg.label}
                        </button>
                    );
                })}
            </div>

            {/* Create / Edit Form */}
            {showForm && (
                <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6 space-y-4">
                    <div className="flex items-center justify-between">
                        <h2 className="text-lg font-semibold text-gray-900">
                            {editingId ? `Edit ${tab.label.replace(/s$/, '')}` : tab.newLabel}
                        </h2>
                        <button onClick={resetForm} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                    </div>

                    <div className={`grid grid-cols-1 ${isResearch ? 'md:grid-cols-3' : 'md:grid-cols-2'} gap-4`}>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                            <input type="text" value={formData.name}
                                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                                placeholder={tab.namePlaceholder}
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
                            <select value={formData.category}
                                onChange={(e) => setFormData(prev => ({ ...prev, category: e.target.value }))}
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent">
                                {tab.categories.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                        {isResearch && (
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Brand</label>
                                <select value={formData.brand_id}
                                    onChange={(e) => setFormData(prev => ({ ...prev, brand_id: e.target.value }))}
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent">
                                    <option value="">No brand</option>
                                    {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                                </select>
                            </div>
                        )}
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                        <input type="text" value={formData.description}
                            onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                            placeholder={isResearch ? 'Brief summary of this research' : tab.contentLabel === 'Content' ? 'What is this document about?' : 'Brief description of what this prompt does'}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent" />
                    </div>

                    {/* File Upload (Research tab) */}
                    {isResearch && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Files</label>
                            <div
                                className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer ${dragActive ? 'border-amber-400 bg-amber-50' : 'border-gray-300 hover:border-amber-400 hover:bg-amber-50/30'}`}
                                onDrop={handleDrop}
                                onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                                onDragLeave={() => setDragActive(false)}
                                onClick={() => fileInputRef.current?.click()}
                            >
                                {uploading ? (
                                    <div className="flex items-center justify-center gap-2 text-amber-600">
                                        <Loader size={20} className="animate-spin" /> Uploading...
                                    </div>
                                ) : (
                                    <>
                                        <Upload size={24} className="mx-auto text-gray-400 mb-2" />
                                        <p className="text-sm text-gray-500">Drag & drop files here or click to browse</p>
                                        <p className="text-xs text-gray-400 mt-1">PDF, markdown, images, docs, spreadsheets — up to 25MB</p>
                                    </>
                                )}
                                <input ref={fileInputRef} type="file" multiple className="hidden"
                                    onChange={(e) => { handleFileUpload(Array.from(e.target.files)); e.target.value = ''; }} />
                            </div>

                            {/* Uploaded files list */}
                            {formData.files.length > 0 && (
                                <div className="mt-3 space-y-2">
                                    {formData.files.map((f, i) => (
                                        <div key={i} className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-lg">
                                            <Paperclip size={14} className="text-gray-400 flex-shrink-0" />
                                            <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline truncate flex-1">{f.name}</a>
                                            <span className="text-xs text-gray-400 flex-shrink-0">{formatFileSize(f.size)}</span>
                                            <button onClick={() => removeFile(i)} className="text-gray-400 hover:text-red-500 flex-shrink-0"><X size={14} /></button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            {tab.contentLabel} {isResearch ? '' : '*'}
                        </label>
                        <textarea value={formData.template}
                            onChange={(e) => setFormData(prev => ({ ...prev, template: e.target.value }))}
                            placeholder={tab.contentPlaceholder}
                            rows={isResearch ? 8 : activeTab === 'doc' ? 16 : 10}
                            className={`w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent text-sm ${tab.mono ? 'font-mono' : ''}`} />
                        {formData.template.length > 0 && <p className="text-xs text-gray-400 mt-1">{formData.template.length} characters</p>}
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                        <textarea value={formData.notes}
                            onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                            placeholder="Any notes, tips, or context..." rows="3"
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent" />
                    </div>

                    <div className="flex justify-end gap-3 pt-2">
                        <button onClick={resetForm} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                        <button onClick={handleSave}
                            disabled={!formData.name.trim() || (!isResearch && !formData.template.trim()) || (isResearch && !formData.template.trim() && !formData.files.length)}
                            className="flex items-center gap-2 px-6 py-2 bg-amber-600 text-white rounded-lg font-medium hover:bg-amber-700 disabled:opacity-50">
                            <Check size={16} /> {editingId ? 'Update' : 'Save'}
                        </button>
                    </div>
                </div>
            )}

            {/* Search & Filter */}
            <div className="flex items-center gap-3 mb-4 flex-wrap">
                <div className="relative flex-1 min-w-[200px]">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input type="text" value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder={`Search ${tab.label.toLowerCase()}...`}
                        className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent text-sm" />
                </div>
                {isResearch && (
                    <select value={filterBrand} onChange={(e) => setFilterBrand(e.target.value)}
                        className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-transparent">
                        <option value="">All Brands</option>
                        {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                )}
                <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                    <button onClick={() => setFilterCategory('')}
                        className={`px-3 py-2 text-xs font-medium ${!filterCategory ? 'bg-amber-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>All</button>
                    {tab.categories.map(cat => (
                        <button key={cat} onClick={() => setFilterCategory(filterCategory === cat ? '' : cat)}
                            className={`px-3 py-2 text-xs font-medium ${filterCategory === cat ? 'bg-amber-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>{cat}</button>
                    ))}
                </div>
            </div>

            {/* Items List */}
            {loading ? (
                <div className="flex items-center justify-center py-16"><Loader size={28} className="animate-spin text-amber-600" /></div>
            ) : filtered.length === 0 ? (
                <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                    {React.createElement(tab.icon, { size: 40, className: 'mx-auto text-gray-300 mb-3' })}
                    <p className="text-gray-500">
                        {items.length === 0 ? `No ${tab.label.toLowerCase()} saved yet. Click "${tab.newLabel}" to get started.` : `No ${tab.label.toLowerCase()} match your search.`}
                    </p>
                </div>
            ) : (
                <div className="space-y-3">
                    {filtered.map(item => {
                        const isExpanded = expandedId === item.id;
                        const fileCount = item.files?.length || 0;
                        return (
                            <div key={item.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                                <div className="px-5 py-4 flex items-center gap-3 cursor-pointer hover:bg-gray-50 transition-colors"
                                    onClick={() => setExpandedId(isExpanded ? null : item.id)}>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <h3 className="font-semibold text-gray-900">{item.name}</h3>
                                            <span className={`text-xs px-2 py-0.5 rounded-full border ${CATEGORY_COLORS[item.category] || CATEGORY_COLORS['Other']}`}>{item.category}</span>
                                            {item.brand_name && (
                                                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">{item.brand_name}</span>
                                            )}
                                            {fileCount > 0 && (
                                                <span className="text-xs text-gray-400 flex items-center gap-1"><Paperclip size={12} />{fileCount}</span>
                                            )}
                                        </div>
                                        {item.description && <p className="text-sm text-gray-500 mt-0.5 truncate">{item.description}</p>}
                                    </div>
                                    <div className="flex items-center gap-1 flex-shrink-0">
                                        <button onClick={(e) => { e.stopPropagation(); downloadPdf(item); }}
                                            className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors" title="Download as PDF"><Download size={16} /></button>
                                        <button onClick={(e) => { e.stopPropagation(); handleCopy(item.template || ''); }}
                                            className="p-2 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors" title="Copy content"><Copy size={16} /></button>
                                        <button onClick={(e) => { e.stopPropagation(); handleEdit(item); }}
                                            className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Edit"><Edit3 size={16} /></button>
                                        <button onClick={(e) => { e.stopPropagation(); handleDelete(item.id); }}
                                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Delete"><Trash2 size={16} /></button>
                                        {isExpanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                                    </div>
                                </div>

                                {isExpanded && (
                                    <div className="px-5 pb-5 border-t border-gray-100">
                                        {/* Files section */}
                                        {item.files?.length > 0 && (
                                            <div className="mt-4 space-y-2">
                                                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Attached Files</p>
                                                {item.files.map((f, i) => (
                                                    <a key={i} href={f.url} target="_blank" rel="noopener noreferrer"
                                                        className="flex items-center gap-3 px-3 py-2 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors group">
                                                        <Paperclip size={14} className="text-blue-400" />
                                                        <span className="text-sm text-blue-700 truncate flex-1">{f.name}</span>
                                                        <span className="text-xs text-blue-400">{formatFileSize(f.size)}</span>
                                                        <ExternalLink size={14} className="text-blue-400 opacity-0 group-hover:opacity-100" />
                                                    </a>
                                                ))}
                                            </div>
                                        )}

                                        {/* Text content */}
                                        {item.template && item.template !== '(files only)' && (
                                            <div className="mt-4 bg-gray-50 rounded-lg p-4 relative">
                                                <button onClick={() => handleCopy(item.template)}
                                                    className="absolute top-2 right-2 p-1.5 text-gray-400 hover:text-amber-600 hover:bg-white rounded transition-colors" title="Copy"><Copy size={14} /></button>
                                                <pre className={`text-sm text-gray-800 whitespace-pre-wrap pr-8 max-h-[600px] overflow-y-auto ${tab.mono ? 'font-mono' : ''}`}>{item.template}</pre>
                                            </div>
                                        )}
                                        {item.template && item.template !== '(files only)' && (
                                            <p className="text-xs text-gray-400 mt-2">{item.template.length} characters</p>
                                        )}

                                        {item.notes && (
                                            <div className="mt-3 text-sm text-gray-600 bg-amber-50 rounded-lg p-3 border border-amber-100">
                                                <span className="font-medium text-amber-700">Notes: </span>{item.notes}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
