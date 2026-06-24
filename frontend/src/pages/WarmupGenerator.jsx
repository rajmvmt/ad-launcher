import React, { useState } from 'react';
import { Shield, Loader2, Copy, CheckCircle2, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

const NICHES = [
    { value: 'foot_care', label: 'Foot Care / Neuropathy' },
    { value: 'weight_loss', label: 'Weight Loss / Fitness' },
    { value: 'skincare', label: 'Skincare / Anti-Aging' },
    { value: 'supplements', label: 'Supplements / Vitamins' },
    { value: 'hair_care', label: 'Hair Care / Hair Growth' },
    { value: 'cbd_wellness', label: 'CBD / Hemp Wellness' },
    { value: 'dental_care', label: 'Dental / Oral Care' },
    { value: 'telehealth', label: 'Telehealth / Online Doctor' },
    { value: 'general_wellness', label: 'General Wellness / Lifestyle' },
    { value: 'home_refinance', label: 'Home Refinance / Mortgage' },
    { value: 'educational_grants', label: 'Educational Grants / Scholarships' },
];

export default function WarmupGenerator() {
    const { authFetch } = useAuth();
    const { showSuccess, showError } = useToast();

    const [niche, setNiche] = useState('general_wellness');
    const [numAds, setNumAds] = useState(5);
    const [loading, setLoading] = useState(false);
    const [ads, setAds] = useState([]);
    const [copiedField, setCopiedField] = useState(null);

    const handleGenerate = async () => {
        setLoading(true);
        setAds([]);
        try {
            const res = await authFetch(`${API_URL}/facebook/generate-warmup-content`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ niche, num_ads: numAds }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || 'Generation failed');
            }
            const data = await res.json();
            setAds(data.ads || []);
            showSuccess(`Generated ${data.ads?.length || 0} warmup ads for ${data.niche_label}`);
        } catch (e) {
            showError(e.message || 'Failed to generate warmup content');
        } finally {
            setLoading(false);
        }
    };

    const copyToClipboard = async (text, fieldId) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedField(fieldId);
            setTimeout(() => setCopiedField(null), 2000);
        } catch {
            showError('Failed to copy to clipboard');
        }
    };

    const copyAll = async (ad, index) => {
        const text = `PRIMARY TEXT:\n${ad.primary_text}\n\nHEADLINE:\n${ad.headline}\n\nIMAGE SUGGESTION:\n${ad.image_suggestion}`;
        try {
            await navigator.clipboard.writeText(text);
            setCopiedField(`all-${index}`);
            showSuccess('All ad content copied to clipboard');
            setTimeout(() => setCopiedField(null), 2000);
        } catch {
            showError('Failed to copy to clipboard');
        }
    };

    return (
        <div className="max-w-5xl mx-auto">
            {/* Header */}
            <div className="mb-6">
                <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-900/30 rounded-xl flex items-center justify-center">
                        <Shield size={22} className="text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Warmup Ad Generator</h1>
                        <p className="text-sm text-gray-500 dark:text-gray-400">Generate safe engagement ad content to copy/paste into Facebook Ads Manager</p>
                    </div>
                </div>
            </div>

            {/* Form */}
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-6 mb-6">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Niche</label>
                        <select
                            value={niche}
                            onChange={(e) => setNiche(e.target.value)}
                            className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                        >
                            {NICHES.map((n) => (
                                <option key={n.value} value={n.value}>{n.label}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Number of Ads</label>
                        <select
                            value={numAds}
                            onChange={(e) => setNumAds(Number(e.target.value))}
                            className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                        >
                            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                                <option key={n} value={n}>{n}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <button
                            onClick={handleGenerate}
                            disabled={loading}
                            className="w-full px-6 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                        >
                            {loading ? (
                                <>
                                    <Loader2 size={18} className="animate-spin" />
                                    Generating...
                                </>
                            ) : (
                                <>
                                    <Sparkles size={18} />
                                    Generate
                                </>
                            )}
                        </button>
                    </div>
                </div>
                <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">
                    Generates safe, engagement-focused ad copy and image suggestions. No Facebook API connection required.
                </p>
            </div>

            {/* Results */}
            {loading && (
                <div className="flex items-center justify-center py-16">
                    <div className="text-center">
                        <Loader2 size={36} className="animate-spin text-emerald-500 mx-auto mb-3" />
                        <p className="text-gray-500 dark:text-gray-400">Generating warmup ad content...</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">This may take 15-30 seconds</p>
                    </div>
                </div>
            )}

            {!loading && ads.length > 0 && (
                <div className="space-y-4">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                        Generated Ads ({ads.length})
                    </h2>
                    {ads.map((ad, index) => (
                        <div
                            key={index}
                            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-5"
                        >
                            <div className="flex items-center justify-between mb-4">
                                <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                                    Ad {index + 1}
                                </span>
                                <button
                                    onClick={() => copyAll(ad, index)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 rounded-lg hover:bg-emerald-100 dark:hover:bg-emerald-900/30 transition-colors"
                                >
                                    {copiedField === `all-${index}` ? (
                                        <>
                                            <CheckCircle2 size={14} />
                                            Copied
                                        </>
                                    ) : (
                                        <>
                                            <Copy size={14} />
                                            Copy All
                                        </>
                                    )}
                                </button>
                            </div>

                            {/* Primary Text */}
                            <div className="mb-4">
                                <div className="flex items-center justify-between mb-1">
                                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Primary Text</label>
                                    <button
                                        onClick={() => copyToClipboard(ad.primary_text, `primary-${index}`)}
                                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                                        title="Copy primary text"
                                    >
                                        {copiedField === `primary-${index}` ? <CheckCircle2 size={14} className="text-emerald-500" /> : <Copy size={14} />}
                                    </button>
                                </div>
                                <p className="text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-sm leading-relaxed">
                                    {ad.primary_text}
                                </p>
                            </div>

                            {/* Headline */}
                            <div className="mb-4">
                                <div className="flex items-center justify-between mb-1">
                                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Headline</label>
                                    <button
                                        onClick={() => copyToClipboard(ad.headline, `headline-${index}`)}
                                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                                        title="Copy headline"
                                    >
                                        {copiedField === `headline-${index}` ? <CheckCircle2 size={14} className="text-emerald-500" /> : <Copy size={14} />}
                                    </button>
                                </div>
                                <p className="text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-sm font-medium">
                                    {ad.headline}
                                </p>
                            </div>

                            {/* Image Suggestion */}
                            <div>
                                <div className="flex items-center justify-between mb-1">
                                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Image Suggestion</label>
                                    <button
                                        onClick={() => copyToClipboard(ad.image_suggestion, `image-${index}`)}
                                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                                        title="Copy image suggestion"
                                    >
                                        {copiedField === `image-${index}` ? <CheckCircle2 size={14} className="text-emerald-500" /> : <Copy size={14} />}
                                    </button>
                                </div>
                                <p className="text-gray-600 dark:text-gray-400 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/30 rounded-lg p-3 text-sm italic">
                                    {ad.image_suggestion}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {!loading && ads.length === 0 && (
                <div className="text-center py-16 text-gray-400 dark:text-gray-500">
                    <Shield size={48} className="mx-auto mb-4 opacity-30" />
                    <p className="text-lg font-medium mb-1">No ads generated yet</p>
                    <p className="text-sm">Choose a niche and click Generate to create warmup ad content</p>
                </div>
            )}
        </div>
    );
}
