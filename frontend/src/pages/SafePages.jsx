import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    FileText, Plus, Trash2, Search, Loader, Download, Eye, ChevronDown, ChevronRight,
    RefreshCw, Image, Video, MapPin, Phone, Copy, Check, X, Settings2, Code, Globe, Wand2, Upload
} from 'lucide-react';
import { useToast } from '../context/ToastContext';
import {
    getThemes, getLanguages, getBrandTemplates, getSafePages, generateSafePage, deleteSafePage,
    downloadSafePage, deploySafePageFtp, uniqueizeImage, uniqueizeVideo, getCountries,
    generateAddress, generatePhone, getPresets, createPreset, deletePreset,
} from '../lib/safePageApi';

const TABS = [
    { id: 'generator', label: 'Generator', icon: Wand2 },
    { id: 'history', label: 'History', icon: FileText },
    { id: 'uniqueizers', label: 'Uniqueizers', icon: Image },
    { id: 'data', label: 'Data Generators', icon: MapPin },
];

export default function SafePages() {
    const { showSuccess, showError } = useToast();
    const [activeTab, setActiveTab] = useState('generator');

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Safe Pages</h1>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 mb-6 bg-gray-100 dark:bg-gray-800 rounded-xl p-1 w-fit">
                {TABS.map(tab => {
                    const Icon = tab.icon;
                    const active = activeTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${active
                                ? 'bg-white dark:bg-gray-700 text-amber-700 dark:text-amber-300 shadow-sm'
                                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                            }`}
                        >
                            <Icon size={16} />
                            {tab.label}
                        </button>
                    );
                })}
            </div>

            {activeTab === 'generator' && <GeneratorTab />}
            {activeTab === 'history' && <HistoryTab />}
            {activeTab === 'uniqueizers' && <UniqueizersTab />}
            {activeTab === 'data' && <DataGeneratorsTab />}
        </div>
    );
}


// ════════════════════════════════════════════════════
// GENERATOR TAB
// ════════════════════════════════════════════════════

function GeneratorTab() {
    const { showSuccess, showError } = useToast();
    const [mode, setMode] = useState('simple'); // simple | professional
    const [themes, setThemes] = useState([]);
    const [languages, setLanguages] = useState([]);
    const [domains, setDomains] = useState([]);
    const [generating, setGenerating] = useState(false);
    const [previewHtml, setPreviewHtml] = useState('');
    const [lastGenerated, setLastGenerated] = useState(null);
    const iframeRef = useRef(null);

    const [brandTemplates, setBrandTemplates] = useState([]);

    // Form state
    const [form, setForm] = useState({
        generator_type: 'blog',
        template_category: '',
        template_id: '',
        theme: 'health',
        language: 'en',
        keywords: '',
        domain_name: '',
        domain_id: '',
        link_name: '',
        num_pages: 1,
        page_title: '',
        redirect_link: '',
        button_redirect: false,
        form_redirect: false,
        index_filename: 'index.html',
        company_name: '',
        tos_domain: '',
        phone_number: '',
        email: '',
        pixel_code: '',
        head_code: '',
        body_start_code: '',
        body_end_code: '',
        // Traffic Armor
        ta_campaign_id: '',  // If set, adds TA script tag to the page
    });

    // Pro mode sections
    const [sections, setSections] = useState({
        additional: false,
        tos: false,
        code: false,
    });

    useEffect(() => {
        (async () => {
            try {
                const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';
                const token = localStorage.getItem('accessToken');
                const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

                const [t, l, domRes, bt] = await Promise.all([
                    getThemes(),
                    getLanguages(),
                    fetch(`${API_BASE}/domains`, { headers }).then(r => r.ok ? r.json() : { items: [] }),
                    getBrandTemplates().catch(() => []),
                ]);
                setThemes(t);
                setLanguages(l);
                setDomains((domRes.items || domRes || []).filter(d => d.name || d.domain_name));
                setBrandTemplates(bt);
            } catch (e) { showError(e.message); }
        })();
    }, []);

    const updateForm = (key, value) => setForm(prev => ({ ...prev, [key]: value }));
    const toggleSection = (key) => setSections(prev => ({ ...prev, [key]: !prev[key] }));

    const handleGenerate = async () => {
        const selectedDomain = domains.find(d => d.id === form.domain_id);
        if (form.domain_id && selectedDomain?.hosting_account_id && !form.link_name) {
            showError('Link Name is required for hosting deploy');
            return;
        }
        setGenerating(true);
        try {
            const result = await generateSafePage(form);
            setPreviewHtml(result.preview_html || '');
            setLastGenerated(result);
            if (result.deploy_url) {
                showSuccess(`Generated & deployed to ${result.deploy_url}`);
            } else if (result.deploy_result?.success) {
                showSuccess(`Generated & deployed to ${result.deploy_result.domain}!`);
            } else if (result.deploy_result?.error) {
                showSuccess('Generated! Deploy failed: ' + result.deploy_result.error);
            } else {
                showSuccess('Safe page generated!');
            }
        } catch (e) {
            showError(e.message);
        } finally {
            setGenerating(false);
        }
    };

    const handleDownload = async () => {
        if (!lastGenerated) return;
        try {
            const blob = await downloadSafePage(lastGenerated.id);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `safe-page-${lastGenerated.id.slice(0, 8)}.zip`;
            a.click();
            URL.revokeObjectURL(url);
            showSuccess('Downloaded! Each download is re-randomized.');
        } catch (e) {
            showError(e.message);
        }
    };

    return (
        <div className="space-y-6">
            {/* Mode toggle */}
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Safe Page Generator</h2>
                    <div className="flex bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
                        <button
                            onClick={() => setMode('simple')}
                            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${mode === 'simple' ? 'bg-amber-500 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}`}
                        >
                            Simple Mode
                        </button>
                        <button
                            onClick={() => setMode('professional')}
                            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${mode === 'professional' ? 'bg-amber-500 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'}`}
                        >
                            Professional Mode
                        </button>
                    </div>
                </div>

                {/* Simple mode fields */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Generator</label>
                        <select value={form.generator_type} onChange={e => { updateForm('generator_type', e.target.value); if (e.target.value !== 'brand_template') { updateForm('template_category', ''); updateForm('template_id', ''); } }} className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm">
                            <option value="blog">Blog / News</option>
                            <option value="wordpress">WordPress Style</option>
                            {brandTemplates.length > 0 && <option value="brand_template">Brand Template</option>}
                        </select>
                    </div>
                    {form.generator_type === 'brand_template' ? (
                        <>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Brand</label>
                                <select value={form.template_category} onChange={e => { updateForm('template_category', e.target.value); updateForm('template_id', brandTemplates.find(b => b.id === e.target.value)?.templates[0]?.id || ''); }} className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm">
                                    <option value="">Select brand...</option>
                                    {brandTemplates.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Template</label>
                                <select value={form.template_id} onChange={e => updateForm('template_id', e.target.value)} className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm">
                                    <option value="">Select template...</option>
                                    {(brandTemplates.find(b => b.id === form.template_category)?.templates || []).map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                                </select>
                            </div>
                        </>
                    ) : (
                        <>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Theme</label>
                                <select value={form.theme} onChange={e => updateForm('theme', e.target.value)} className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm">
                                    {themes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Language</label>
                                <select value={form.language} onChange={e => updateForm('language', e.target.value)} className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm">
                                    {languages.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                                </select>
                            </div>
                        </>
                    )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    {form.generator_type === 'brand_template' ? (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">CTA Link</label>
                            <input type="text" value={form.redirect_link} onChange={e => updateForm('redirect_link', e.target.value)} placeholder="https://offer.com/checkout" className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm" />
                            <p className="text-xs text-gray-400 mt-1">All buttons/links on the page go here</p>
                        </div>
                    ) : (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Keywords</label>
                            <input
                                type="text" value={form.keywords} onChange={e => updateForm('keywords', e.target.value)}
                                placeholder="health, wellness, tips"
                                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
                            />
                            <p className="text-xs text-gray-400 mt-1">Comma-separated keywords for content</p>
                        </div>
                    )}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Domain</label>
                        <select
                            value={form.domain_id || '__custom'}
                            onChange={e => {
                                if (e.target.value === '__custom') {
                                    setForm(prev => ({ ...prev, domain_id: '', domain_name: '' }));
                                } else {
                                    const d = domains.find(d => d.id === e.target.value);
                                    setForm(prev => ({ ...prev, domain_id: e.target.value, domain_name: d?.name || '' }));
                                }
                            }}
                            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
                        >
                            <option value="__custom">-- Custom domain --</option>
                            {domains.map(d => (
                                <option key={d.id} value={d.id}>
                                    {d.name}{d.hosting_account_id ? ' (FTP — auto-deploy)' : d.cloudflare_zone_id ? ' (CF — auto-deploy)' : ''}
                                </option>
                            ))}
                        </select>
                        {!form.domain_id && (
                            <input
                                type="text" value={form.domain_name} onChange={e => updateForm('domain_name', e.target.value)}
                                placeholder="example.com"
                                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm mt-2"
                            />
                        )}
                        {form.domain_id && (domains.find(d => d.id === form.domain_id)?.hosting_account_id || domains.find(d => d.id === form.domain_id)?.cloudflare_zone_id) && (
                            <p className="text-xs text-green-600 mt-1">Will auto-deploy to this domain on generation</p>
                        )}
                    </div>
                    {form.domain_id && domains.find(d => d.id === form.domain_id)?.hosting_account_id && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                Link Name <span className="text-red-500">*</span>
                            </label>
                            <div className="flex items-center gap-1">
                                <span className="text-xs text-gray-400 whitespace-nowrap">/links/</span>
                                <input
                                    type="text" value={form.link_name} onChange={e => updateForm('link_name', e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
                                    placeholder="de9b67"
                                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm font-mono"
                                />
                            </div>
                            <p className="text-xs text-gray-400 mt-1">Deploys to /links/{form.link_name || '{name}'}/</p>
                        </div>
                    )}
                    {mode === 'simple' && form.generator_type !== 'brand_template' && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Page Title</label>
                            <input
                                type="text" value={form.page_title} onChange={e => updateForm('page_title', e.target.value)}
                                placeholder="My Health Blog"
                                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
                            />
                        </div>
                    )}
                </div>

                {/* Traffic Armor Script — hidden, phasing out */}

                {/* Professional mode sections */}
                {mode === 'professional' && (
                    <div className="space-y-3 mb-6">
                        {/* Additional Settings */}
                        <CollapsibleSection title="Additional Settings" icon={Settings2} open={sections.additional} onToggle={() => toggleSection('additional')}>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Page Title</label>
                                    <input type="text" value={form.page_title} onChange={e => updateForm('page_title', e.target.value)} placeholder="My Health Blog" className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Number of Pages</label>
                                    <input type="number" min={1} max={10} value={form.num_pages} onChange={e => updateForm('num_pages', parseInt(e.target.value) || 1)} className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Redirection Link</label>
                                    <input type="text" value={form.redirect_link} onChange={e => updateForm('redirect_link', e.target.value)} placeholder="https://offer.com/lp" className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm" />
                                    <div className="flex gap-4 mt-2">
                                        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                                            <input type="checkbox" checked={form.button_redirect} onChange={e => updateForm('button_redirect', e.target.checked)} className="rounded" />
                                            Button Redirect
                                        </label>
                                        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                                            <input type="checkbox" checked={form.form_redirect} onChange={e => updateForm('form_redirect', e.target.checked)} className="rounded" />
                                            Form Redirect
                                        </label>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Rename Index File</label>
                                    <input type="text" value={form.index_filename} onChange={e => updateForm('index_filename', e.target.value)} placeholder="index.html" className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm" />
                                </div>
                            </div>
                        </CollapsibleSection>

                        {/* TOS & Privacy */}
                        <CollapsibleSection title="TOS & Privacy Settings" icon={FileText} open={sections.tos} onToggle={() => toggleSection('tos')}>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Company Name</label>
                                    <input type="text" value={form.company_name} onChange={e => updateForm('company_name', e.target.value)} placeholder="Acme Inc." className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Domain Name</label>
                                    <input type="text" value={form.tos_domain} onChange={e => updateForm('tos_domain', e.target.value)} placeholder="example.com" className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Phone Number</label>
                                    <input type="text" value={form.phone_number} onChange={e => updateForm('phone_number', e.target.value)} placeholder="+1 (555) 123-4567" className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Email</label>
                                    <input type="text" value={form.email} onChange={e => updateForm('email', e.target.value)} placeholder="contact@example.com" className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm" />
                                </div>
                            </div>
                        </CollapsibleSection>

                        {/* Code Integration */}
                        <CollapsibleSection title="Code Integration" icon={Code} open={sections.code} onToggle={() => toggleSection('code')}>
                            <div className="space-y-4">
                                {[
                                    { key: 'pixel_code', label: 'Pixel Code', placeholder: '<!-- Facebook Pixel, Google Analytics, etc. -->' },
                                    { key: 'head_code', label: 'Code into <head>', placeholder: '<!-- Custom head code -->' },
                                    { key: 'body_start_code', label: 'Code into start of <body>', placeholder: '<!-- Code after <body> -->' },
                                    { key: 'body_end_code', label: 'Code into end of </body>', placeholder: '<!-- Code before </body> -->' },
                                ].map(field => (
                                    <div key={field.key}>
                                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{field.label}</label>
                                        <textarea
                                            value={form[field.key]}
                                            onChange={e => updateForm(field.key, e.target.value)}
                                            placeholder={field.placeholder}
                                            rows={3}
                                            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm font-mono"
                                        />
                                    </div>
                                ))}
                            </div>
                        </CollapsibleSection>
                    </div>
                )}

                {/* Actions */}
                <div className="flex gap-3">
                    <button
                        onClick={handleGenerate}
                        disabled={generating}
                        className="flex items-center gap-2 px-6 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white rounded-lg font-medium text-sm transition-colors"
                    >
                        {generating ? <Loader size={16} className="animate-spin" /> : <Wand2 size={16} />}
                        {generating ? 'Generating...' : 'Generate'}
                    </button>
                    {lastGenerated && (
                        <button
                            onClick={handleDownload}
                            className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium text-sm transition-colors"
                        >
                            <Download size={16} />
                            Download ZIP
                        </button>
                    )}
                </div>

                {/* Result panel — shows live URL after generation */}
                {lastGenerated && (
                    <div className="mt-4 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg space-y-3">
                        <div className="flex items-center gap-2 text-green-700 dark:text-green-400 font-medium text-sm">
                            <Check size={16} />
                            Safe page generated{lastGenerated.deployed ? ' & deployed' : ''}
                        </div>
                        {lastGenerated.deployed && lastGenerated.domain_name && (
                            <div>
                                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Deployed to</label>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="text"
                                        readOnly
                                        value={lastGenerated.deploy_url || `https://${lastGenerated.domain_name}`}
                                        className="flex-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm font-mono text-gray-900 dark:text-white"
                                    />
                                    <button
                                        onClick={() => { navigator.clipboard.writeText(lastGenerated.deploy_url || `https://${lastGenerated.domain_name}`); showSuccess('URL copied!'); }}
                                        className="px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-medium flex items-center gap-1"
                                    >
                                        <Copy size={14} /> Copy
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Preview */}
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Preview</h3>
                    {lastGenerated?.zip_url && (
                        <a href={lastGenerated.zip_url} target="_blank" rel="noopener noreferrer" className="text-sm text-amber-600 hover:text-amber-700">
                            Direct ZIP Link
                        </a>
                    )}
                </div>
                {previewHtml ? (
                    <iframe
                        ref={iframeRef}
                        srcDoc={previewHtml}
                        className="w-full h-[600px] border border-gray-200 dark:border-gray-700 rounded-lg"
                        sandbox="allow-same-origin"
                        title="Safe Page Preview"
                    />
                ) : (
                    <div className="flex items-center justify-center h-64 text-gray-400 dark:text-gray-600 border border-dashed border-gray-200 dark:border-gray-700 rounded-lg">
                        <div className="text-center">
                            <Wand2 size={32} className="mx-auto mb-2 opacity-50" />
                            <p>Click Generate to create a safe page.</p>
                            <p className="text-sm mt-1">A preview will appear here.</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}


// ════════════════════════════════════════════════════
// HISTORY TAB
// ════════════════════════════════════════════════════

function HistoryTab() {
    const { showSuccess, showError } = useToast();
    const [pages, setPages] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [previewPage, setPreviewPage] = useState(null);

    const loadPages = useCallback(async () => {
        try {
            const data = await getSafePages({ search, limit: 100 });
            setPages(data.items || []);
        } catch (e) {
            showError(e.message);
        } finally {
            setLoading(false);
        }
    }, [search]);

    useEffect(() => { loadPages(); }, [loadPages]);

    const handleDelete = async (id) => {
        try {
            await deleteSafePage(id);
            setPages(prev => prev.filter(p => p.id !== id));
            showSuccess('Deleted');
        } catch (e) { showError(e.message); }
    };

    const [ftpDeploying, setFtpDeploying] = useState(null);
    const [deployPrompt, setDeployPrompt] = useState(null); // { page, linkName }

    const handleFtpDeploy = async (page, linkName) => {
        if (!page.domain_id) {
            showError('No domain linked — generate with a domain selected');
            return;
        }
        if (!linkName) {
            // Show prompt for link name
            setDeployPrompt({ page, linkName: '' });
            return;
        }
        setDeployPrompt(null);
        setFtpDeploying(page.id);
        try {
            const result = await deploySafePageFtp(page.id, linkName);
            if (result.success) {
                showSuccess(`Deployed to ${result.url || result.domain}`);
                await loadPages();
            } else {
                showError(result.error || 'Deploy failed');
            }
        } catch (e) { showError(e.message); }
        finally { setFtpDeploying(null); }
    };

    const handleDownload = async (page) => {
        try {
            const blob = await downloadSafePage(page.id);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `safe-page-${page.id.slice(0, 8)}.zip`;
            a.click();
            URL.revokeObjectURL(url);
            showSuccess('Downloaded (re-randomized)');
        } catch (e) { showError(e.message); }
    };

    if (loading) return <div className="flex items-center justify-center p-12"><Loader className="animate-spin text-amber-500" size={28} /></div>;

    return (
        <div>
            {/* Search */}
            <div className="relative mb-4 max-w-md">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                    type="text" value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="Search by name, keywords, domain..."
                    className="w-full pl-9 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm"
                />
            </div>

            {pages.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                    <FileText size={32} className="mx-auto mb-2 opacity-50" />
                    <p>No safe pages generated yet.</p>
                </div>
            ) : (
                <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Name</th>
                                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Theme</th>
                                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Language</th>
                                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Status</th>
                                <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Created</th>
                                <th className="text-right px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {pages.map(page => (
                                <tr key={page.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                                    <td className="px-4 py-3">
                                        <div className="font-medium text-gray-900 dark:text-white">{page.name || 'Untitled'}</div>
                                        {/* TA campaign info hidden — phasing out */}
                                    </td>
                                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400 capitalize">{page.theme}</td>
                                    <td className="px-4 py-3 text-gray-600 dark:text-gray-400 uppercase">{page.language}</td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-1.5">
                                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                                page.status === 'completed' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                                : page.status === 'failed' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                                : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                                            }`}>{page.status}</span>
                                            {page.deployed && (
                                                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">live</span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 text-xs">
                                        {page.created_at ? new Date(page.created_at).toLocaleDateString() : '—'}
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <div className="flex items-center justify-end gap-1">
                                            {page.preview_html && (
                                                <button onClick={() => setPreviewPage(page)} className="p-1.5 text-gray-400 hover:text-blue-500 rounded" title="Preview">
                                                    <Eye size={16} />
                                                </button>
                                            )}
                                            {page.status === 'completed' && (
                                                <button onClick={() => handleDownload(page)} className="p-1.5 text-gray-400 hover:text-green-500 rounded" title="Download ZIP">
                                                    <Download size={16} />
                                                </button>
                                            )}
                                            {page.status === 'completed' && page.domain_id && (
                                                <button onClick={() => handleFtpDeploy(page)} disabled={ftpDeploying === page.id}
                                                    className={`p-1.5 rounded ${page.deployed ? 'text-green-500 hover:text-green-700' : 'text-gray-400 hover:text-green-500'}`}
                                                    title={page.deployed ? 'Re-deploy to hosting' : 'Deploy to hosting'}>
                                                    {ftpDeploying === page.id ? <Loader size={16} className="animate-spin" /> : <Globe size={16} />}
                                                </button>
                                            )}
                                            <button onClick={() => handleDelete(page.id)} className="p-1.5 text-gray-400 hover:text-red-500 rounded" title="Delete">
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* Deploy link name prompt */}
            {deployPrompt && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setDeployPrompt(null)}>
                    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
                        <h3 className="font-semibold text-gray-900 dark:text-white mb-4">Deploy to Hosting</h3>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Link Name</label>
                        <div className="flex items-center gap-1 mb-2">
                            <span className="text-xs text-gray-400 whitespace-nowrap">/links/</span>
                            <input
                                type="text"
                                value={deployPrompt.linkName}
                                onChange={e => setDeployPrompt(prev => ({ ...prev, linkName: e.target.value.replace(/[^a-zA-Z0-9_-]/g, '') }))}
                                placeholder="de9b67"
                                autoFocus
                                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm font-mono"
                                onKeyDown={e => { if (e.key === 'Enter' && deployPrompt.linkName) handleFtpDeploy(deployPrompt.page, deployPrompt.linkName); }}
                            />
                        </div>
                        <p className="text-xs text-gray-400 mb-4">Enter a link name for the deploy path</p>
                        <div className="flex justify-end gap-2">
                            <button onClick={() => setDeployPrompt(null)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 dark:text-gray-400">Cancel</button>
                            <button
                                onClick={() => handleFtpDeploy(deployPrompt.page, deployPrompt.linkName)}
                                disabled={!deployPrompt.linkName}
                                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white rounded-lg text-sm font-medium"
                            >Deploy</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Preview modal */}
            {previewPage && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setPreviewPage(null)}>
                    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                            <h3 className="font-semibold text-gray-900 dark:text-white">{previewPage.name}</h3>
                            <button onClick={() => setPreviewPage(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                        </div>
                        <div className="flex-1 overflow-hidden p-4">
                            <iframe
                                srcDoc={previewPage.preview_html}
                                className="w-full h-full min-h-[500px] border border-gray-200 dark:border-gray-700 rounded-lg"
                                sandbox="allow-same-origin"
                                title="Preview"
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}


// ════════════════════════════════════════════════════
// UNIQUEIZERS TAB
// ════════════════════════════════════════════════════

function UniqueizersTab() {
    return (
        <div className="space-y-6">
            <ImageUniqueizer />
            <VideoUniqueizer />
        </div>
    );
}

function ImageUniqueizer() {
    const { showSuccess, showError } = useToast();
    const [file, setFile] = useState(null);
    const [preview, setPreview] = useState(null);
    const [result, setResult] = useState(null);
    const [degree, setDegree] = useState('medium');
    const [processing, setProcessing] = useState(false);

    const handleFileSelect = (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        setFile(f);
        setPreview(URL.createObjectURL(f));
        setResult(null);
    };

    const handleProcess = async () => {
        if (!file) return;
        setProcessing(true);
        try {
            const blob = await uniqueizeImage(file, degree);
            setResult(URL.createObjectURL(blob));
            showSuccess('Image uniqueized!');
        } catch (e) { showError(e.message); }
        finally { setProcessing(false); }
    };

    const handleDownload = () => {
        if (!result) return;
        const a = document.createElement('a');
        a.href = result;
        a.download = `unique-${file?.name || 'image.png'}`;
        a.click();
    };

    return (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <Image size={20} className="text-amber-500" /> Photo Uniqueizer
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Original */}
                <div>
                    <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">Original</p>
                    <div className="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-lg p-4 h-48 flex items-center justify-center relative overflow-hidden">
                        {preview ? (
                            <img src={preview} alt="Original" className="max-h-full max-w-full object-contain" />
                        ) : (
                            <label className="cursor-pointer text-center text-gray-400">
                                <Image size={32} className="mx-auto mb-2 opacity-50" />
                                <p className="text-sm">Select a file</p>
                                <p className="text-xs mt-1">jpg, png, webp</p>
                                <input type="file" accept="image/*" onChange={handleFileSelect} className="hidden" />
                            </label>
                        )}
                    </div>
                </div>
                {/* Result */}
                <div>
                    <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">Preview</p>
                    <div className="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-lg p-4 h-48 flex items-center justify-center overflow-hidden">
                        {result ? (
                            <img src={result} alt="Uniqueized" className="max-h-full max-w-full object-contain" />
                        ) : (
                            <p className="text-sm text-gray-400">Result will appear here</p>
                        )}
                    </div>
                </div>
            </div>
            {/* Controls */}
            <div className="flex items-center gap-4 mt-4">
                <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600 dark:text-gray-400">Degree:</span>
                    {['light', 'medium', 'strong'].map(d => (
                        <button key={d} onClick={() => setDegree(d)}
                            className={`px-3 py-1 rounded-md text-sm font-medium transition-all ${degree === d ? 'bg-amber-500 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                        >{d.charAt(0).toUpperCase() + d.slice(1)}</button>
                    ))}
                </div>
                <div className="flex gap-2 ml-auto">
                    {preview && (
                        <label className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300">
                            Replace
                            <input type="file" accept="image/*" onChange={handleFileSelect} className="hidden" />
                        </label>
                    )}
                    <button onClick={handleProcess} disabled={!file || processing}
                        className="px-4 py-1.5 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white rounded-lg text-sm font-medium flex items-center gap-2">
                        {processing ? <Loader size={14} className="animate-spin" /> : <Wand2 size={14} />}
                        Make it Unique
                    </button>
                    {result && (
                        <button onClick={handleDownload} className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium flex items-center gap-2">
                            <Download size={14} /> Download
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

function VideoUniqueizer() {
    const { showSuccess, showError } = useToast();
    const [file, setFile] = useState(null);
    const [preview, setPreview] = useState(null);
    const [result, setResult] = useState(null);
    const [degree, setDegree] = useState('medium');
    const [processing, setProcessing] = useState(false);

    const handleFileSelect = (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        if (f.size > 50 * 1024 * 1024) { showError('Video too large (max 50MB)'); return; }
        setFile(f);
        setPreview(URL.createObjectURL(f));
        setResult(null);
    };

    const handleProcess = async () => {
        if (!file) return;
        setProcessing(true);
        try {
            const blob = await uniqueizeVideo(file, degree);
            setResult(URL.createObjectURL(blob));
            showSuccess('Video uniqueized!');
        } catch (e) { showError(e.message); }
        finally { setProcessing(false); }
    };

    const handleDownload = () => {
        if (!result) return;
        const a = document.createElement('a');
        a.href = result;
        a.download = `unique-${file?.name || 'video.mp4'}`;
        a.click();
    };

    return (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                <Video size={20} className="text-amber-500" /> Video Uniqueizer
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                    <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">Original</p>
                    <div className="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-lg p-4 h-48 flex items-center justify-center overflow-hidden">
                        {preview ? (
                            <video src={preview} className="max-h-full max-w-full" controls />
                        ) : (
                            <label className="cursor-pointer text-center text-gray-400">
                                <Video size={32} className="mx-auto mb-2 opacity-50" />
                                <p className="text-sm">Select a file</p>
                                <p className="text-xs mt-1">mp4, webm (max 50MB)</p>
                                <input type="file" accept="video/*" onChange={handleFileSelect} className="hidden" />
                            </label>
                        )}
                    </div>
                </div>
                <div>
                    <p className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">Preview</p>
                    <div className="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-lg p-4 h-48 flex items-center justify-center overflow-hidden">
                        {result ? (
                            <video src={result} className="max-h-full max-w-full" controls />
                        ) : (
                            <p className="text-sm text-gray-400">Result will appear here</p>
                        )}
                    </div>
                </div>
            </div>
            <div className="flex items-center gap-4 mt-4">
                <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600 dark:text-gray-400">Degree:</span>
                    {['light', 'medium', 'strong'].map(d => (
                        <button key={d} onClick={() => setDegree(d)}
                            className={`px-3 py-1 rounded-md text-sm font-medium transition-all ${degree === d ? 'bg-amber-500 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                        >{d.charAt(0).toUpperCase() + d.slice(1)}</button>
                    ))}
                </div>
                <div className="flex gap-2 ml-auto">
                    {preview && (
                        <label className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300">
                            Replace
                            <input type="file" accept="video/*" onChange={handleFileSelect} className="hidden" />
                        </label>
                    )}
                    <button onClick={handleProcess} disabled={!file || processing}
                        className="px-4 py-1.5 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white rounded-lg text-sm font-medium flex items-center gap-2">
                        {processing ? <Loader size={14} className="animate-spin" /> : <Wand2 size={14} />}
                        Make it Unique
                    </button>
                    {result && (
                        <button onClick={handleDownload} className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium flex items-center gap-2">
                            <Download size={14} /> Download
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}


// ════════════════════════════════════════════════════
// DATA GENERATORS TAB
// ════════════════════════════════════════════════════

function DataGeneratorsTab() {
    const { showSuccess, showError } = useToast();
    const [countries, setCountries] = useState([]);
    const [addrCountry, setAddrCountry] = useState('US');
    const [phoneCountry, setPhoneCountry] = useState('US');
    const [address, setAddress] = useState(null);
    const [phone, setPhoneResult] = useState(null);
    const [copiedAddr, setCopiedAddr] = useState(false);
    const [copiedPhone, setCopiedPhone] = useState(false);

    useEffect(() => {
        (async () => {
            try {
                const c = await getCountries();
                setCountries(c);
            } catch (e) { /* silent */ }
        })();
    }, []);

    const handleGenerateAddress = async () => {
        try {
            const result = await generateAddress(addrCountry);
            setAddress(result);
        } catch (e) { showError(e.message); }
    };

    const handleGeneratePhone = async () => {
        try {
            const result = await generatePhone(phoneCountry);
            setPhoneResult(result);
        } catch (e) { showError(e.message); }
    };

    const copyText = async (text, type) => {
        await navigator.clipboard.writeText(text);
        if (type === 'addr') { setCopiedAddr(true); setTimeout(() => setCopiedAddr(false), 2000); }
        else { setCopiedPhone(true); setTimeout(() => setCopiedPhone(false), 2000); }
        showSuccess('Copied to clipboard');
    };

    return (
        <div className="space-y-6">
            {/* Address Generator */}
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                    <MapPin size={20} className="text-amber-500" /> Address Generator
                </h3>
                <div className="flex items-end gap-4">
                    <div className="flex-1 max-w-xs">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Country</label>
                        <select value={addrCountry} onChange={e => setAddrCountry(e.target.value)} className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm">
                            {countries.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
                        </select>
                    </div>
                    <button onClick={handleGenerateAddress} className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-medium">
                        Generate
                    </button>
                </div>
                {address && (
                    <div className="mt-4 flex items-center gap-3">
                        <div className="flex-1">
                            <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">Generated Address</label>
                            <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-800 rounded-lg text-gray-900 dark:text-white border border-gray-200 dark:border-gray-700">
                                {address.formatted}
                            </div>
                        </div>
                        <button onClick={() => copyText(address.formatted, 'addr')} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium flex items-center gap-2 mt-6">
                            {copiedAddr ? <Check size={14} /> : <Copy size={14} />}
                            {copiedAddr ? 'Copied' : 'Copy'}
                        </button>
                    </div>
                )}
            </div>

            {/* Phone Generator */}
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                    <Phone size={20} className="text-amber-500" /> Phone Number Generator
                </h3>
                <div className="flex items-end gap-4">
                    <div className="flex-1 max-w-xs">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Country</label>
                        <select value={phoneCountry} onChange={e => setPhoneCountry(e.target.value)} className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm">
                            {countries.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
                        </select>
                    </div>
                    <button onClick={handleGeneratePhone} className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-medium">
                        Generate
                    </button>
                </div>
                {phone && (
                    <div className="mt-4 flex items-center gap-3">
                        <div className="flex-1">
                            <label className="block text-sm text-gray-500 dark:text-gray-400 mb-1">Generated Number</label>
                            <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-800 rounded-lg text-gray-900 dark:text-white border border-gray-200 dark:border-gray-700">
                                {phone.formatted}
                            </div>
                        </div>
                        <button onClick={() => copyText(phone.formatted, 'phone')} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium flex items-center gap-2 mt-6">
                            {copiedPhone ? <Check size={14} /> : <Copy size={14} />}
                            {copiedPhone ? 'Copied' : 'Copy'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}


// ════════════════════════════════════════════════════
// SHARED COMPONENTS
// ════════════════════════════════════════════════════

function CollapsibleSection({ title, icon: Icon, open, onToggle, children }) {
    return (
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
            <button onClick={onToggle} className="w-full flex items-center gap-3 px-4 py-3 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white font-medium text-sm hover:bg-gray-100 dark:hover:bg-gray-750 transition-colors">
                {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                {Icon && <Icon size={16} className="text-amber-500" />}
                {title}
            </button>
            {open && <div className="p-4">{children}</div>}
        </div>
    );
}
