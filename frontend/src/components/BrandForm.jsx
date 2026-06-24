import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, Link as LinkIcon, Unlink, FlaskConical, ExternalLink, Paperclip, ChevronDown, ChevronRight, BookOpen } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useBrands } from '../context/BrandContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { validateBrandName, validateHexColor, validateProductName, validateProductDescription, validateBrandVoice, validateTextInput } from '../utils/validation';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

const BrandForm = ({ onClose, onSave, initialData = null }) => {
    const { customerProfiles, brands } = useBrands();
    const { authFetch } = useAuth();
    const { showError } = useToast();
    const navigate = useNavigate();
    const [researchDocs, setResearchDocs] = useState([]);

    useEffect(() => {
        if (!initialData?.id) return;
        const fetchResearch = async () => {
            try {
                const res = await authFetch(`${API_URL}/prompts/?type=research&brand_id=${initialData.id}`);
                if (res.ok) setResearchDocs(await res.json());
            } catch {}
        };
        fetchResearch();
    }, [initialData?.id]);

    // Get all products from all brands
    const allProducts = brands.flatMap(brand =>
        brand.products.map(product => ({
            ...product,
            brandName: brand.name,
            brandId: brand.id
        }))
    );

    const [formData, setFormData] = useState(() => {
        const data = initialData || {
            name: '',
            logo: '',
            colors: { primary: '#3B82F6', secondary: '#10B981', highlight: '#F59E0B' },
            voice: '',
            style_guide: null,
            products: [],
            profileIds: []
        };
        if (!data.style_guide) data.style_guide = {};
        return data;
    });
    const [styleGuideOpen, setStyleGuideOpen] = useState(
        !!(initialData?.style_guide && Object.values(initialData.style_guide).some(v => v && (Array.isArray(v) ? v.length > 0 : true)))
    );

    const [selectedProductId, setSelectedProductId] = useState('');
    const [selectedProfileId, setSelectedProfileId] = useState('');

    const handleLinkProduct = () => {
        if (selectedProductId && !formData.products.find(p => p.id === selectedProductId)) {
            const product = allProducts.find(p => p.id === selectedProductId);
            if (product) {
                setFormData({
                    ...formData,
                    products: [...formData.products, {
                        id: product.id,
                        name: product.name,
                        description: product.description
                    }]
                });
                setSelectedProductId('');
            }
        }
    };

    const removeProduct = (id) => {
        setFormData({
            ...formData,
            products: formData.products.filter(p => p.id !== id)
        });
    };

    const handleLinkProfile = () => {
        if (selectedProfileId && !formData.profileIds?.includes(selectedProfileId)) {
            setFormData({
                ...formData,
                profileIds: [...(formData.profileIds || []), selectedProfileId]
            });
            setSelectedProfileId('');
        }
    };

    const handleUnlinkProfile = (id) => {
        setFormData({
            ...formData,
            profileIds: (formData.profileIds || []).filter(pid => pid !== id)
        });
    };

    const updateStyleGuide = (field, value) => {
        setFormData(prev => ({
            ...prev,
            style_guide: { ...prev.style_guide, [field]: value }
        }));
    };

    const handleTagKeyDown = (field, e) => {
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            const raw = e.target.value.trim().replace(/,$/, '');
            if (raw) {
                // Support comma-separated paste: "word1, word2, word3"
                const newTags = raw.split(',').map(s => s.trim()).filter(Boolean);
                const current = formData.style_guide?.[field] || [];
                const merged = [...current, ...newTags.filter(t => !current.includes(t))];
                updateStyleGuide(field, merged);
                e.target.value = '';
            }
        }
    };

    const handleTagPaste = (field, e) => {
        const pasted = e.clipboardData.getData('text');
        if (pasted.includes(',')) {
            e.preventDefault();
            const newTags = pasted.split(',').map(s => s.trim()).filter(Boolean);
            const current = formData.style_guide?.[field] || [];
            const merged = [...current, ...newTags.filter(t => !current.includes(t))];
            updateStyleGuide(field, merged);
        }
    };

    const removeTag = (field, index) => {
        const current = formData.style_guide?.[field] || [];
        updateStyleGuide(field, current.filter((_, i) => i !== index));
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        try {
            // Validate all fields
            // Clean style_guide — remove empty fields
            const sg = formData.style_guide || {};
            const cleanedStyleGuide = {};
            if (sg.tone) cleanedStyleGuide.tone = sg.tone;
            if (sg.keywords?.length) cleanedStyleGuide.keywords = sg.keywords;
            if (sg.banned_words?.length) cleanedStyleGuide.banned_words = sg.banned_words;
            if (sg.pain_points?.length) cleanedStyleGuide.pain_points = sg.pain_points.filter(Boolean);
            if (sg.proof_points?.length) cleanedStyleGuide.proof_points = sg.proof_points.filter(Boolean);
            if (sg.cta_style) cleanedStyleGuide.cta_style = sg.cta_style;
            if (sg.example_copy) cleanedStyleGuide.example_copy = sg.example_copy;
            if (sg.notes) cleanedStyleGuide.notes = sg.notes;

            const validatedData = {
                ...formData,
                name: validateBrandName(formData.name),
                voice: validateBrandVoice(formData.voice),
                style_guide: Object.keys(cleanedStyleGuide).length > 0 ? cleanedStyleGuide : null,
                colors: {
                    primary: validateHexColor(formData.colors.primary),
                    secondary: validateHexColor(formData.colors.secondary),
                    highlight: validateHexColor(formData.colors.highlight || '#F59E0B')
                },
                products: formData.products || [],
                profileIds: formData.profileIds || []
            };
            onSave(validatedData);
        } catch (err) {
            showError(err.message);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center p-6 border-b border-gray-100">
                    <h2 className="text-xl font-bold text-gray-900">
                        {initialData ? 'Edit Brand' : 'Add New Brand'}
                    </h2>
                    <button onClick={onClose} className="text-gray-500 hover:bg-gray-100 p-2 rounded-full">
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-6">
                    {/* Basic Info */}
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Brand Name</label>
                            <input
                                required
                                type="text"
                                maxLength={100}
                                value={formData.name}
                                onChange={e => setFormData({ ...formData, name: e.target.value })}
                                className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                                placeholder="e.g. Acme Corp"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Brand Style Guide</label>
                            <textarea
                                value={formData.voice}
                                maxLength={2000}
                                onChange={e => setFormData({ ...formData, voice: e.target.value })}
                                className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                                rows="10"
                                placeholder={"Tone: Friendly, conversational, like talking to a neighbor\nBanned words: miracle, guaranteed, shocking, secret\nKey messaging: FDA-approved, clinically tested, 30-day guarantee\nPain points: foot pain, neuropathy, can't walk comfortably\nProof: 50,000+ customers, 4.8 star reviews"}
                            />
                            <p className="text-xs text-gray-400 mt-1">{formData.voice?.length || 0}/2000 — Used by AI Copy to match your brand's voice</p>
                        </div>
                    </div>

                    {/* Structured Style Guide */}
                    <div className="border border-amber-200 rounded-lg overflow-hidden">
                        <button
                            type="button"
                            onClick={() => setStyleGuideOpen(!styleGuideOpen)}
                            className="w-full flex items-center justify-between px-4 py-3 bg-amber-50 hover:bg-amber-100 transition-colors"
                        >
                            <span className="flex items-center gap-2 text-sm font-medium text-amber-800">
                                <BookOpen size={16} />
                                AI Style Guide (Structured)
                            </span>
                            {styleGuideOpen ? <ChevronDown size={16} className="text-amber-600" /> : <ChevronRight size={16} className="text-amber-600" />}
                        </button>
                        {styleGuideOpen && (
                            <div className="p-4 space-y-4 bg-white">
                                <p className="text-xs text-gray-500">These fields feed directly into AI copy generation prompts for this brand.</p>

                                {/* Tone */}
                                <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">Tone of Voice</label>
                                    <input
                                        type="text"
                                        value={formData.style_guide?.tone || ''}
                                        onChange={e => updateStyleGuide('tone', e.target.value)}
                                        className="w-full p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500"
                                        placeholder="e.g. Friendly, conversational, empathetic, like a trusted neighbor"
                                    />
                                </div>

                                {/* Keywords */}
                                <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">Keywords to Use</label>
                                    <div className="flex flex-wrap gap-1.5 mb-2">
                                        {(formData.style_guide?.keywords || []).map((kw, i) => (
                                            <span key={i} className="inline-flex items-center gap-1 px-2 py-1 bg-green-50 text-green-700 border border-green-200 rounded-full text-xs">
                                                {kw}
                                                <button type="button" onClick={() => removeTag('keywords', i)} className="hover:text-red-500">
                                                    <X size={12} />
                                                </button>
                                            </span>
                                        ))}
                                    </div>
                                    <input
                                        type="text"
                                        onKeyDown={e => handleTagKeyDown('keywords', e)}
                                        onPaste={e => handleTagPaste('keywords', e)}
                                        className="w-full p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500"
                                        placeholder="Type keywords separated by commas..."
                                    />
                                </div>

                                {/* Banned Words */}
                                <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">Banned Words</label>
                                    <div className="flex flex-wrap gap-1.5 mb-2">
                                        {(formData.style_guide?.banned_words || []).map((bw, i) => (
                                            <span key={i} className="inline-flex items-center gap-1 px-2 py-1 bg-red-50 text-red-700 border border-red-200 rounded-full text-xs">
                                                {bw}
                                                <button type="button" onClick={() => removeTag('banned_words', i)} className="hover:text-red-800">
                                                    <X size={12} />
                                                </button>
                                            </span>
                                        ))}
                                    </div>
                                    <input
                                        type="text"
                                        onKeyDown={e => handleTagKeyDown('banned_words', e)}
                                        onPaste={e => handleTagPaste('banned_words', e)}
                                        className="w-full p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500"
                                        placeholder="Type banned words separated by commas..."
                                    />
                                </div>

                                {/* Pain Points */}
                                <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">Audience Pain Points</label>
                                    <textarea
                                        value={(formData.style_guide?.pain_points || []).join('\n')}
                                        onChange={e => updateStyleGuide('pain_points', e.target.value.split('\n'))}
                                        className="w-full p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500"
                                        rows="3"
                                        placeholder={"Chronic foot pain that won't go away\nCan't walk or stand comfortably\nTried everything, nothing works"}
                                    />
                                    <p className="text-xs text-gray-400 mt-0.5">One per line</p>
                                </div>

                                {/* Proof Points */}
                                <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">Proof & Authority Signals</label>
                                    <textarea
                                        value={(formData.style_guide?.proof_points || []).join('\n')}
                                        onChange={e => updateStyleGuide('proof_points', e.target.value.split('\n'))}
                                        className="w-full p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500"
                                        rows="3"
                                        placeholder={"FDA-approved facility\n50,000+ happy customers\nRecommended by podiatrists\n4.8 star average rating"}
                                    />
                                    <p className="text-xs text-gray-400 mt-0.5">One per line</p>
                                </div>

                                {/* CTA Style */}
                                <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">CTA Style</label>
                                    <input
                                        type="text"
                                        value={formData.style_guide?.cta_style || ''}
                                        onChange={e => updateStyleGuide('cta_style', e.target.value)}
                                        className="w-full p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500"
                                        placeholder="e.g. Soft sell with urgency — 'Try it risk-free today' not 'BUY NOW!!!'"
                                    />
                                </div>

                                {/* Example Copy */}
                                <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">Example Winning Copy</label>
                                    <textarea
                                        value={formData.style_guide?.example_copy || ''}
                                        onChange={e => updateStyleGuide('example_copy', e.target.value)}
                                        className="w-full p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500"
                                        rows="4"
                                        placeholder="Paste your best-performing ad copy here. AI will match this style and energy."
                                    />
                                </div>

                                {/* Notes */}
                                <div>
                                    <label className="block text-xs font-medium text-gray-600 mb-1">Additional Notes</label>
                                    <textarea
                                        value={formData.style_guide?.notes || ''}
                                        onChange={e => updateStyleGuide('notes', e.target.value)}
                                        className="w-full p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500"
                                        rows="2"
                                        placeholder="Any other style rules for AI to follow..."
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Colors */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Brand Colors</label>
                        <div className="flex gap-4">
                            <div>
                                <label className="text-xs text-gray-500 block mb-1">Primary</label>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="color"
                                        value={formData.colors.primary}
                                        onChange={e => setFormData({ ...formData, colors: { ...formData.colors, primary: e.target.value } })}
                                        className="h-10 w-10 rounded cursor-pointer border-0"
                                    />
                                    <span className="text-sm text-gray-600 font-mono">{formData.colors.primary}</span>
                                </div>
                            </div>
                            <div>
                                <label className="text-xs text-gray-500 block mb-1">Secondary</label>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="color"
                                        value={formData.colors.secondary}
                                        onChange={e => setFormData({ ...formData, colors: { ...formData.colors, secondary: e.target.value } })}
                                        className="h-10 w-10 rounded cursor-pointer border-0"
                                    />
                                    <span className="text-sm text-gray-600 font-mono">{formData.colors.secondary}</span>
                                </div>
                            </div>
                            <div>
                                <label className="text-xs text-gray-500 block mb-1">Highlight</label>
                                <div className="flex items-center gap-2">
                                    <input
                                        type="color"
                                        value={formData.colors.highlight}
                                        onChange={e => setFormData({ ...formData, colors: { ...formData.colors, highlight: e.target.value } })}
                                        className="h-10 w-10 rounded cursor-pointer border-0"
                                    />
                                    <span className="text-sm text-gray-600 font-mono">{formData.colors.highlight}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Products */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Products</label>
                        <div className="bg-gray-50 p-4 rounded-lg space-y-3">
                            <div className="flex gap-2">
                                <select
                                    value={selectedProductId}
                                    onChange={(e) => setSelectedProductId(e.target.value)}
                                    className="flex-1 p-2 border border-gray-300 rounded-lg text-sm"
                                >
                                    <option value="">Select a product to assign...</option>
                                    {allProducts
                                        .filter(p => !formData.products.find(fp => fp.id === p.id))
                                        .map(product => (
                                            <option key={product.id} value={product.id}>
                                                {product.name} (currently in: {product.brandName})
                                            </option>
                                        ))
                                    }
                                </select>
                                <button
                                    type="button"
                                    onClick={handleLinkProduct}
                                    disabled={!selectedProductId}
                                    className="bg-blue-600 text-white p-2 rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                                >
                                    <LinkIcon size={20} />
                                </button>
                            </div>

                            {formData.products.length > 0 && (
                                <div className="space-y-2 mt-2">
                                    {formData.products.map(product => (
                                        <div key={product.id} className="flex items-center justify-between bg-white p-3 rounded border border-gray-200">
                                            <div>
                                                <div className="font-medium text-sm">{product.name}</div>
                                                <div className="text-xs text-gray-500">{product.description}</div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => removeProduct(product.id)}
                                                className="text-red-500 hover:bg-red-50 p-1 rounded"
                                                title="Remove Product"
                                            >
                                                <Unlink size={16} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {allProducts.length === 0 && (
                                <p className="text-xs text-gray-500 mt-1">
                                    No products available. Create them in the Products page first.
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Customer Profiles */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Linked Customer Profiles</label>
                        <div className="bg-gray-50 p-4 rounded-lg space-y-3">
                            <div className="flex gap-2">
                                <select
                                    value={selectedProfileId}
                                    onChange={(e) => setSelectedProfileId(e.target.value)}
                                    className="flex-1 p-2 border border-gray-300 rounded-lg text-sm"
                                >
                                    <option value="">Select a profile to link...</option>
                                    {customerProfiles
                                        .filter(p => !(formData.profileIds || []).includes(p.id))
                                        .map(profile => (
                                            <option key={profile.id} value={profile.id}>
                                                {profile.name}
                                            </option>
                                        ))
                                    }
                                </select>
                                <button
                                    type="button"
                                    onClick={handleLinkProfile}
                                    disabled={!selectedProfileId}
                                    className="bg-blue-600 text-white p-2 rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                                >
                                    <LinkIcon size={20} />
                                </button>
                            </div>

                            {(formData.profileIds || []).length > 0 && (
                                <div className="space-y-2 mt-2">
                                    {(formData.profileIds || []).map(profileId => {
                                        const profile = customerProfiles.find(p => p.id === profileId);
                                        if (!profile) return null;
                                        return (
                                            <div key={profile.id} className="flex items-center justify-between bg-white p-3 rounded border border-gray-200">
                                                <div>
                                                    <div className="font-medium text-sm">{profile.name}</div>
                                                    <div className="text-xs text-gray-500">{profile.demographics}</div>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => handleUnlinkProfile(profile.id)}
                                                    className="text-red-500 hover:bg-red-50 p-1 rounded"
                                                    title="Unlink Profile"
                                                >
                                                    <Unlink size={16} />
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                            {customerProfiles.length === 0 && (
                                <p className="text-xs text-gray-500 mt-1">
                                    No profiles available. Create them in the Customer Profiles page first.
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Research Docs */}
                    {initialData?.id && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                <FlaskConical size={14} className="inline mr-1.5 -mt-0.5" />
                                Product Research
                            </label>
                            <div className="bg-gray-50 p-4 rounded-lg space-y-2">
                                {researchDocs.length > 0 ? (
                                    <>
                                        {researchDocs.map(doc => (
                                            <div key={doc.id} className="bg-white p-3 rounded border border-gray-200">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex-1 min-w-0">
                                                        <div className="font-medium text-sm text-gray-900">{doc.name}</div>
                                                        {doc.description && <div className="text-xs text-gray-500 mt-0.5 truncate">{doc.description}</div>}
                                                    </div>
                                                    {doc.files?.length > 0 && (
                                                        <span className="text-xs text-gray-400 flex items-center gap-1 ml-2 flex-shrink-0">
                                                            <Paperclip size={12} /> {doc.files.length}
                                                        </span>
                                                    )}
                                                </div>
                                                {doc.files?.length > 0 && (
                                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                                        {doc.files.map((f, i) => (
                                                            <a key={i} href={f.url} target="_blank" rel="noopener noreferrer"
                                                                className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-600 rounded text-xs hover:bg-blue-100">
                                                                <ExternalLink size={10} /> {f.name}
                                                            </a>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                        <button
                                            type="button"
                                            onClick={() => { onClose(); navigate('/prompts?tab=research&brand=' + initialData.id); }}
                                            className="text-sm text-amber-600 hover:text-amber-700 hover:underline mt-1"
                                        >
                                            View all in Prompts & Docs →
                                        </button>
                                    </>
                                ) : (
                                    <div className="text-center py-2">
                                        <p className="text-xs text-gray-500 mb-2">No research docs attached to this brand yet.</p>
                                        <button
                                            type="button"
                                            onClick={() => { onClose(); navigate('/prompts?tab=research&brand=' + initialData.id); }}
                                            className="text-sm text-amber-600 hover:text-amber-700 hover:underline"
                                        >
                                            + Add Research Doc
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
                        >
                            Save Brand
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default BrandForm;
