import React, { useState, useEffect } from 'react';
import { Shield, Loader2, CheckCircle2, X, ChevronDown, Sparkles, Image as ImageIcon } from 'lucide-react';
import { useToast } from '../context/ToastContext';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

const CONVERSION_EVENTS = [
    { value: 'PURCHASE', label: 'Purchase' },
    { value: 'LEAD', label: 'Lead' },
    { value: 'COMPLETE_REGISTRATION', label: 'Complete Registration' },
    { value: 'ADD_TO_CART', label: 'Add to Cart' },
    { value: 'INITIATE_CHECKOUT', label: 'Initiate Checkout' },
];

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

const SafeCampaignModal = ({ onClose, authFetch, accounts, pages, connectionId }) => {
    const { showError, showSuccess } = useToast();

    // Form state
    const [selectedAccount, setSelectedAccount] = useState('');
    const [selectedPage, setSelectedPage] = useState('');
    const [pixelId, setPixelId] = useState('');
    const [niche, setNiche] = useState('foot_care');
    const [conversionEvent, setConversionEvent] = useState('PURCHASE');
    const [dailyBudget, setDailyBudget] = useState(20);
    const [numAds, setNumAds] = useState(5);
    const [websiteUrl, setWebsiteUrl] = useState('');
    const [campaignName, setCampaignName] = useState('');

    // Data
    const [pixels, setPixels] = useState([]);
    const [productUrls, setProductUrls] = useState([]);
    const [showUrlDropdown, setShowUrlDropdown] = useState(false);
    const [loadingPixels, setLoadingPixels] = useState(false);

    // Phase: config → generating → done
    const [phase, setPhase] = useState('config');
    const [result, setResult] = useState(null);
    const [batchProgress, setBatchProgress] = useState(null);

    // Fetch product URLs on mount
    useEffect(() => {
        const loadProductUrls = async () => {
            try {
                const connParam = connectionId ? `?connection_id=${connectionId}` : '';
                const res = await authFetch(`${API_URL}/facebook/product-urls${connParam}`);
                if (res.ok) setProductUrls(await res.json());
            } catch (e) {
                console.error('Failed to load product URLs:', e);
            }
        };
        loadProductUrls();
    }, [authFetch, connectionId]);

    // Fetch pixels when account changes
    useEffect(() => {
        if (!selectedAccount) return;
        const loadPixels = async () => {
            setLoadingPixels(true);
            try {
                const connParam = connectionId ? `&connection_id=${connectionId}` : '';
                const res = await authFetch(`${API_URL}/facebook/pixels?ad_account_id=${selectedAccount}${connParam}`);
                if (res.ok) {
                    const data = await res.json();
                    setPixels(data);
                    if (data.length > 0) setPixelId(data[0].id);
                }
            } catch (e) {
                console.error('Failed to load pixels:', e);
            } finally {
                setLoadingPixels(false);
            }
        };
        loadPixels();
    }, [selectedAccount, authFetch, connectionId]);

    // Poll batch progress
    useEffect(() => {
        if (!result?.batch_id || phase !== 'generating') return;
        const interval = setInterval(async () => {
            try {
                const connParam = connectionId ? `?connection_id=${connectionId}` : '';
                const res = await authFetch(`${API_URL}/facebook/publish-batches/${result.batch_id}${connParam}`);
                if (res.ok) {
                    const data = await res.json();
                    setBatchProgress(data);
                    if (data.status === 'completed' || data.status === 'partial') {
                        setPhase('done');
                        clearInterval(interval);
                    }
                }
            } catch (e) {
                console.error('Poll error:', e);
            }
        }, 3000);
        return () => clearInterval(interval);
    }, [result, phase, authFetch, connectionId]);

    const handleGenerate = async () => {
        if (!selectedAccount) { showError('Select an ad account'); return; }
        if (!selectedPage) { showError('Select a Facebook Page'); return; }
        if (!pixelId) { showError('Select a Pixel'); return; }
        if (!websiteUrl) { showError('Enter a landing page URL'); return; }

        setPhase('generating');
        try {
            const connParam = connectionId ? `?connection_id=${connectionId}` : '';
            const res = await authFetch(`${API_URL}/facebook/generate-safe-campaign${connParam}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ad_account_id: selectedAccount,
                    page_id: selectedPage,
                    pixel_id: pixelId,
                    niche: niche,
                    conversion_event: conversionEvent,
                    daily_budget: dailyBudget,
                    num_ads: numAds,
                    website_url: websiteUrl,
                    campaign_name: campaignName || undefined,
                    connection_id: connectionId || null,
                }),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || 'Generation failed');
            }

            const data = await res.json();
            setResult(data);
            showSuccess(`Safe campaign queued: ${data.num_ads} ads generating...`);
        } catch (e) {
            showError(e.message);
            setPhase('config');
        }
    };

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center">
                        <Sparkles size={20} className="text-emerald-600" />
                    </div>
                    <div>
                        <h2 className="text-lg font-semibold text-gray-900">Safe Conversion Campaign</h2>
                        <p className="text-xs text-gray-500">AI-generated images + copy, PAUSED from start. Boosts approved ad count.</p>
                    </div>
                </div>
                {onClose && (
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <X size={20} />
                    </button>
                )}
            </div>

            {/* Config Phase */}
            {phase === 'config' && (
                <div className="space-y-4">
                    {/* Two-column: Account + Niche */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Ad Account</label>
                            <select
                                value={selectedAccount}
                                onChange={(e) => setSelectedAccount(e.target.value)}
                                className="w-full p-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent bg-white"
                            >
                                <option value="">Select an ad account...</option>
                                {accounts.map(a => (
                                    <option key={a.id || a.account_id} value={a.id || a.account_id}>
                                        {a.name || a.id || a.account_id}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Niche</label>
                            <select
                                value={niche}
                                onChange={(e) => setNiche(e.target.value)}
                                className="w-full p-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent bg-white"
                            >
                                {NICHES.map(n => (
                                    <option key={n.value} value={n.value}>{n.label}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Two-column: Page + Pixel */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Facebook Page</label>
                            <select
                                value={selectedPage}
                                onChange={(e) => setSelectedPage(e.target.value)}
                                className="w-full p-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent bg-white"
                            >
                                <option value="">Select a page...</option>
                                {pages.map(p => (
                                    <option key={p.id} value={p.fb_page_id || p.id}>
                                        {p.name || p.fb_page_id}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Pixel {loadingPixels && <Loader2 size={12} className="inline animate-spin ml-1" />}
                            </label>
                            <select
                                value={pixelId}
                                onChange={(e) => setPixelId(e.target.value)}
                                disabled={!selectedAccount || loadingPixels}
                                className="w-full p-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent bg-white disabled:opacity-50"
                            >
                                <option value="">Select a pixel...</option>
                                {pixels.map(p => (
                                    <option key={p.id} value={p.id}>
                                        {p.name || p.id}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Landing Page URL */}
                    <div className="relative">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Landing Page URL</label>
                        <div className="flex gap-2">
                            <input
                                type="url"
                                value={websiteUrl}
                                onChange={(e) => setWebsiteUrl(e.target.value)}
                                placeholder="https://example.com/product"
                                className="flex-1 p-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                            />
                            {productUrls.length > 0 && (
                                <button
                                    onClick={() => setShowUrlDropdown(!showUrlDropdown)}
                                    className="px-3 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm text-gray-600"
                                    title="Pick from existing product URLs"
                                >
                                    <ChevronDown size={16} />
                                </button>
                            )}
                        </div>
                        {showUrlDropdown && productUrls.length > 0 && (
                            <div className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                                {productUrls.map(p => (
                                    <button
                                        key={p.id}
                                        onClick={() => { setWebsiteUrl(p.url); setShowUrlDropdown(false); }}
                                        className="w-full text-left px-3 py-2 hover:bg-emerald-50 text-sm border-b border-gray-100 last:border-0"
                                    >
                                        <span className="font-medium text-gray-800">{p.name}</span>
                                        {p.brand_name && <span className="text-gray-400 ml-1">({p.brand_name})</span>}
                                        <div className="text-xs text-gray-500 truncate">{p.url}</div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Three-column: Event, Budget, Num Ads */}
                    <div className="grid grid-cols-3 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Conversion Event</label>
                            <select
                                value={conversionEvent}
                                onChange={(e) => setConversionEvent(e.target.value)}
                                className="w-full p-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent bg-white"
                            >
                                {CONVERSION_EVENTS.map(e => (
                                    <option key={e.value} value={e.value}>{e.label}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Daily Budget ($)</label>
                            <input
                                type="number"
                                min={1}
                                max={10000}
                                value={dailyBudget}
                                onChange={(e) => setDailyBudget(Number(e.target.value))}
                                className="w-full p-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Number of Ads</label>
                            <input
                                type="number"
                                min={1}
                                max={20}
                                value={numAds}
                                onChange={(e) => setNumAds(Math.min(20, Math.max(1, Number(e.target.value))))}
                                className="w-full p-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                            />
                        </div>
                    </div>

                    {/* Campaign Name */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Campaign Name <span className="text-gray-400 font-normal">(optional — auto-generated if blank)</span></label>
                        <input
                            type="text"
                            value={campaignName}
                            onChange={(e) => setCampaignName(e.target.value)}
                            placeholder={`Safe - ${(NICHES.find(n => n.value === niche)?.label || 'Lifestyle').split('/')[0].trim()} - ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`}
                            className="w-full p-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                        />
                    </div>

                    {/* Info Box */}
                    <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-800">
                        <p className="font-medium mb-1">What this creates:</p>
                        <ul className="list-disc list-inside space-y-0.5 text-xs text-emerald-700">
                            <li>Sales/Conversion campaign (PAUSED - never turns on)</li>
                            <li>CBO ${dailyBudget}/day, Lowest Cost bid strategy</li>
                            <li>Broad US targeting, ages 18-65, all genders</li>
                            <li>{numAds} AI-generated lifestyle images (Fal.ai)</li>
                            <li>{numAds} ultra-safe copy variations (Gemini Flash)</li>
                            <li>All ads set to LEARN_MORE CTA</li>
                        </ul>
                    </div>

                    {/* Generate Button */}
                    <button
                        onClick={handleGenerate}
                        disabled={!selectedAccount || !selectedPage || !pixelId || !websiteUrl}
                        className="w-full py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors font-medium flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Sparkles size={16} />
                        Generate & Publish Safe Campaign ({numAds} ads)
                    </button>
                </div>
            )}

            {/* Generating Phase */}
            {phase === 'generating' && (
                <div className="text-center py-8">
                    <div className="relative mx-auto w-16 h-16 mb-4">
                        <div className="absolute inset-0 rounded-full border-4 border-emerald-100"></div>
                        <div className="absolute inset-0 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin"></div>
                        <div className="absolute inset-0 flex items-center justify-center">
                            <ImageIcon size={20} className="text-emerald-600" />
                        </div>
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-1">Generating Safe Campaign</h3>
                    <p className="text-sm text-gray-500 mb-4">
                        Creating {result?.num_ads || numAds} AI images + copy, then publishing to Facebook...
                    </p>
                    {batchProgress && (
                        <div className="max-w-xs mx-auto">
                            <div className="flex justify-between text-xs text-gray-500 mb-1">
                                <span>Ads created</span>
                                <span>{(batchProgress.completed_ads || 0) + (batchProgress.failed_ads || 0)} / {batchProgress.total_ads || result?.num_ads}</span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-2">
                                <div
                                    className="bg-emerald-500 h-2 rounded-full transition-all duration-500"
                                    style={{ width: `${Math.round(((batchProgress.completed_ads || 0) / (batchProgress.total_ads || 1)) * 100)}%` }}
                                />
                            </div>
                            {batchProgress.failed_ads > 0 && (
                                <p className="text-xs text-red-500 mt-1">{batchProgress.failed_ads} failed</p>
                            )}
                        </div>
                    )}
                    <p className="text-xs text-gray-400 mt-4">This may take 1-3 minutes depending on number of ads</p>
                </div>
            )}

            {/* Done Phase */}
            {phase === 'done' && (
                <div className="text-center py-6">
                    <CheckCircle2 size={48} className="mx-auto mb-3 text-emerald-500" />
                    <h3 className="text-lg font-semibold text-gray-900 mb-1">Safe Campaign Created</h3>
                    <p className="text-sm text-gray-500 mb-4">
                        {batchProgress?.completed_ads || result?.num_ads} ads published (PAUSED) to Facebook
                    </p>
                    {batchProgress?.failed_ads > 0 && (
                        <p className="text-sm text-red-500 mb-4">{batchProgress.failed_ads} ads failed to create</p>
                    )}
                    <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-800 max-w-md mx-auto mb-4">
                        <p><span className="font-medium">Campaign:</span> {result?.campaign_name}</p>
                        <p className="text-xs text-emerald-600 mt-1">All ads are PAUSED and will go through Facebook review. Check Ads Manager for approval status.</p>
                    </div>
                    <button
                        onClick={() => { setPhase('config'); setResult(null); setBatchProgress(null); }}
                        className="px-4 py-2 bg-emerald-100 text-emerald-700 rounded-lg hover:bg-emerald-200 transition-colors text-sm font-medium"
                    >
                        Create Another
                    </button>
                </div>
            )}
        </div>
    );
};

export default SafeCampaignModal;
