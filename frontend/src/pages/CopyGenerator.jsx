import React, { useState, useEffect } from 'react';
import { Sparkles, Zap, Crown, FlaskConical, Copy, RefreshCw, Loader, Check, ChevronDown, ChevronUp, MessageCircle } from 'lucide-react';
import { useBrands } from '../context/BrandContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

export default function CopyGenerator() {
    const { brands, customerProfiles } = useBrands();
    const { authFetch } = useAuth();
    const { showSuccess, showError, showWarning } = useToast();

    const [selectedBrandId, setSelectedBrandId] = useState('');
    const [selectedProductId, setSelectedProductId] = useState('');
    const [selectedProfileId, setSelectedProfileId] = useState('');
    const [selectedResearchDocId, setSelectedResearchDocId] = useState('');
    const [aiModel, setAiModel] = useState('sonnet');
    const [language, setLanguage] = useState('English');
    const [variationCount, setVariationCount] = useState(3);
    const [offer, setOffer] = useState('');
    const [messaging, setMessaging] = useState('');
    const [generating, setGenerating] = useState(false);
    const [variations, setVariations] = useState([]);
    const [researchDocs, setResearchDocs] = useState([]);
    const [copiedIdx, setCopiedIdx] = useState(null);

    const selectedBrand = brands.find(b => b.id === selectedBrandId);
    const products = selectedBrand?.products || [];
    const selectedProduct = products.find(p => p.id === selectedProductId);
    const selectedProfile = customerProfiles.find(p => p.id === selectedProfileId);

    // Fetch research docs when brand changes
    useEffect(() => {
        if (!selectedBrandId) { setResearchDocs([]); setSelectedResearchDocId(''); return; }
        const fetchDocs = async () => {
            try {
                const res = await authFetch(`${API_URL}/prompts/?type=research&brand_id=${selectedBrandId}`);
                if (res.ok) {
                    const docs = await res.json();
                    setResearchDocs(docs);
                    if (docs.length === 1) setSelectedResearchDocId(docs[0].id);
                    else setSelectedResearchDocId('');
                }
            } catch {}
        };
        fetchDocs();
    }, [selectedBrandId]);

    const handleGenerate = async () => {
        if (!selectedBrandId) { showWarning('Select a brand'); return; }
        if (!offer.trim()) { showWarning('Enter an offer'); return; }
        if (!messaging.trim()) { showWarning('Enter key messaging'); return; }

        setGenerating(true);
        try {
            const payload = {
                brand: {
                    name: selectedBrand.name,
                    voice: selectedBrand.voice || '',
                },
                product: {
                    name: selectedProduct?.name || 'General',
                    description: selectedProduct?.description || '',
                },
                profile: {
                    name: selectedProfile?.name || 'General audience',
                    demographics: selectedProfile?.demographics || '',
                    pain_points: selectedProfile?.pain_points || '',
                    goals: selectedProfile?.goals || '',
                },
                template: null,
                variationCount,
                campaignDetails: { offer, messaging },
                model: aiModel,
                language,
                research_doc_id: selectedResearchDocId || null,
            };

            const res = await authFetch(`${API_URL}/copy-generation/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || 'Generation failed');
            }

            const data = await res.json();
            setVariations(data.variations || []);
            showSuccess(`Generated ${(data.variations || []).length} variations with ${aiModel === 'sonnet' ? 'Sonnet' : aiModel === 'haiku' ? 'Haiku' : 'Gemini'}`);
        } catch (err) {
            showError(err.message);
        } finally {
            setGenerating(false);
        }
    };

    const handleCopy = (text, idx) => {
        navigator.clipboard.writeText(text);
        setCopiedIdx(idx);
        setTimeout(() => setCopiedIdx(null), 1500);
    };

    const handleCopyAll = () => {
        const text = variations.map((v, i) =>
            `--- Variation ${i + 1} ---\nHeadline: ${v.headline}\nBody: ${v.body}\nCTA: ${v.cta}`
        ).join('\n\n');
        navigator.clipboard.writeText(text);
        showSuccess('All variations copied');
    };

    return (
        <div>
            <div className="mb-6">
                <h1 className="text-3xl font-bold text-gray-900">Copy Generator</h1>
                <p className="text-gray-500 mt-1">Generate ad copy powered by Claude or Gemini with product research context</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left: Controls */}
                <div className="lg:col-span-1 space-y-4">
                    <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
                        {/* Brand */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Brand *</label>
                            <select value={selectedBrandId}
                                onChange={(e) => { setSelectedBrandId(e.target.value); setSelectedProductId(''); }}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent text-sm">
                                <option value="">Select brand...</option>
                                {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                            </select>
                        </div>

                        {/* Product */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Product</label>
                            <select value={selectedProductId}
                                onChange={(e) => setSelectedProductId(e.target.value)}
                                disabled={!selectedBrandId}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent text-sm disabled:opacity-50">
                                <option value="">All Products</option>
                                {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                        </div>

                        {/* Profile */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Target Audience</label>
                            <select value={selectedProfileId}
                                onChange={(e) => setSelectedProfileId(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent text-sm">
                                <option value="">General audience</option>
                                {customerProfiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                        </div>

                        {/* Research Doc */}
                        {researchDocs.length > 0 && (
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                    <FlaskConical size={13} className="inline mr-1 -mt-0.5" />
                                    Research Doc
                                </label>
                                <select value={selectedResearchDocId}
                                    onChange={(e) => setSelectedResearchDocId(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent text-sm">
                                    <option value="">No research context</option>
                                    {researchDocs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                                </select>
                                {selectedResearchDocId && (
                                    <p className="text-xs text-green-600 mt-1">Grounded in real product data</p>
                                )}
                            </div>
                        )}

                        <hr className="border-gray-100" />

                        {/* Offer */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Offer *</label>
                            <input type="text" value={offer}
                                onChange={(e) => setOffer(e.target.value)}
                                placeholder="e.g. 50% off today only"
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent text-sm" />
                        </div>

                        {/* Messaging */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Key Messaging *</label>
                            <textarea value={messaging}
                                onChange={(e) => setMessaging(e.target.value)}
                                placeholder="Key points to hit in the copy..."
                                rows={3}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent text-sm" />
                        </div>

                        {/* Variation Count */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Variations</label>
                            <select value={variationCount}
                                onChange={(e) => setVariationCount(Number(e.target.value))}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent text-sm">
                                {[1,2,3,5,8,10].map(n => <option key={n} value={n}>{n}</option>)}
                            </select>
                        </div>

                        <hr className="border-gray-100" />

                        {/* Language */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Output Language</label>
                            <select value={language}
                                onChange={(e) => setLanguage(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent text-sm">
                                <option value="English">English</option>
                                <option value="German">German (Deutsch)</option>
                                <option value="Spanish">Spanish (Español)</option>
                                <option value="French">French (Français)</option>
                                <option value="Italian">Italian (Italiano)</option>
                                <option value="Portuguese">Portuguese (Português)</option>
                                <option value="Dutch">Dutch (Nederlands)</option>
                                <option value="Polish">Polish (Polski)</option>
                                <option value="Swedish">Swedish (Svenska)</option>
                                <option value="Norwegian">Norwegian (Norsk)</option>
                                <option value="Danish">Danish (Dansk)</option>
                            </select>
                            {language !== 'English' && (
                                <p className="text-xs text-amber-700 mt-1">Copy will be written in native {language} — not translated English</p>
                            )}
                        </div>

                        {/* Model Picker */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">AI Model</label>
                            <div className="space-y-2">
                                <button onClick={() => setAiModel('haiku')}
                                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border-2 text-left transition-all ${
                                        aiModel === 'haiku' ? 'border-amber-500 bg-amber-50' : 'border-gray-200 bg-white hover:border-gray-300'
                                    }`}>
                                    <Zap size={18} className={aiModel === 'haiku' ? 'text-amber-600' : 'text-gray-400'} />
                                    <div>
                                        <div className={`text-sm font-medium ${aiModel === 'haiku' ? 'text-amber-800' : 'text-gray-700'}`}>Quick Copy</div>
                                        <div className="text-xs text-gray-400">Haiku — fast & cheap</div>
                                    </div>
                                    {aiModel === 'haiku' && <Check size={16} className="ml-auto text-amber-600" />}
                                </button>
                                <button onClick={() => setAiModel('sonnet')}
                                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border-2 text-left transition-all ${
                                        aiModel === 'sonnet' ? 'border-purple-500 bg-purple-50' : 'border-gray-200 bg-white hover:border-gray-300'
                                    }`}>
                                    <Crown size={18} className={aiModel === 'sonnet' ? 'text-purple-600' : 'text-gray-400'} />
                                    <div>
                                        <div className={`text-sm font-medium ${aiModel === 'sonnet' ? 'text-purple-800' : 'text-gray-700'}`}>Premium Copy</div>
                                        <div className="text-xs text-gray-400">Sonnet — best quality</div>
                                    </div>
                                    {aiModel === 'sonnet' && <Check size={16} className="ml-auto text-purple-600" />}
                                </button>
                                <button onClick={() => setAiModel('gemini')}
                                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border-2 text-left transition-all ${
                                        aiModel === 'gemini' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:border-gray-300'
                                    }`}>
                                    <Sparkles size={18} className={aiModel === 'gemini' ? 'text-blue-600' : 'text-gray-400'} />
                                    <div>
                                        <div className={`text-sm font-medium ${aiModel === 'gemini' ? 'text-blue-800' : 'text-gray-700'}`}>Gemini Flash</div>
                                        <div className="text-xs text-gray-400">Google — free tier</div>
                                    </div>
                                    {aiModel === 'gemini' && <Check size={16} className="ml-auto text-blue-600" />}
                                </button>
                                <button onClick={() => setAiModel('group_voice')}
                                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border-2 text-left transition-all ${
                                        aiModel === 'group_voice' ? 'border-green-500 bg-green-50' : 'border-gray-200 bg-white hover:border-gray-300'
                                    }`}>
                                    <MessageCircle size={18} className={aiModel === 'group_voice' ? 'text-green-600' : 'text-gray-400'} />
                                    <div>
                                        <div className={`text-sm font-medium ${aiModel === 'group_voice' ? 'text-green-800' : 'text-gray-700'}`}>FB Group Voice</div>
                                        <div className="text-xs text-gray-400">Sonnet — sounds like real people</div>
                                    </div>
                                    {aiModel === 'group_voice' && <Check size={16} className="ml-auto text-green-600" />}
                                </button>
                            </div>
                        </div>

                        {/* Generate Button */}
                        <button onClick={handleGenerate}
                            disabled={generating || !selectedBrandId || !offer.trim() || !messaging.trim()}
                            className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-amber-600 text-white rounded-lg font-medium hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                            {generating ? (
                                <><Loader size={18} className="animate-spin" /> Generating with {aiModel === 'sonnet' ? 'Sonnet' : aiModel === 'haiku' ? 'Haiku' : aiModel === 'group_voice' ? 'Group Voice' : 'Gemini'}...</>
                            ) : (
                                <><Sparkles size={18} /> Generate Copy</>
                            )}
                        </button>
                    </div>
                </div>

                {/* Right: Results */}
                <div className="lg:col-span-2">
                    {variations.length > 0 ? (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <h2 className="text-lg font-semibold text-gray-900">{variations.length} Variations</h2>
                                <div className="flex gap-2">
                                    <button onClick={handleCopyAll}
                                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200">
                                        <Copy size={14} /> Copy All
                                    </button>
                                    <button onClick={handleGenerate} disabled={generating}
                                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-amber-700 bg-amber-50 rounded-lg hover:bg-amber-100 border border-amber-200 disabled:opacity-50">
                                        <RefreshCw size={14} className={generating ? 'animate-spin' : ''} /> Regenerate
                                    </button>
                                </div>
                            </div>

                            {variations.map((v, idx) => (
                                <div key={idx} className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow">
                                    <div className="flex items-start justify-between gap-3">
                                        <span className="text-xs font-bold text-gray-400 bg-gray-100 px-2 py-1 rounded flex-shrink-0">#{idx + 1}</span>
                                        <button onClick={() => handleCopy(`${v.headline}\n\n${v.body}\n\n${v.cta}`, idx)}
                                            className={`flex-shrink-0 p-1.5 rounded-lg transition-colors ${copiedIdx === idx ? 'text-green-600 bg-green-50' : 'text-gray-400 hover:text-amber-600 hover:bg-amber-50'}`}>
                                            {copiedIdx === idx ? <Check size={16} /> : <Copy size={16} />}
                                        </button>
                                    </div>

                                    <div className="mt-3 space-y-3">
                                        <div>
                                            <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">Headline</label>
                                            <p className="text-lg font-bold text-gray-900 mt-0.5">{v.headline}</p>
                                        </div>
                                        <div>
                                            <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">Body</label>
                                            <p className="text-gray-700 mt-0.5 whitespace-pre-wrap">{v.body}</p>
                                        </div>
                                        <div>
                                            <label className="text-xs font-medium text-gray-400 uppercase tracking-wide">CTA</label>
                                            <span className="inline-block mt-0.5 px-4 py-1.5 bg-amber-600 text-white rounded-lg text-sm font-medium">{v.cta}</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                            <Sparkles size={40} className="mx-auto text-gray-300 mb-3" />
                            <h3 className="text-lg font-medium text-gray-500 mb-1">No copy generated yet</h3>
                            <p className="text-sm text-gray-400">Select a brand, fill in campaign details, and hit Generate</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
