import React, { useState, useEffect } from 'react';
import { ChevronRight, ChevronLeft, Check, Loader, Plus, Bookmark, Trash2, Tag, Shuffle } from 'lucide-react';
import { useCampaign } from '../context/CampaignContext';
import { useBrands } from '../context/BrandContext';
import { useToast } from '../context/ToastContext';
import { getCampaigns, createFacebookCampaign } from '../lib/facebookApi';
import { listTemplates, deleteTemplate } from '../api/campaignTemplates';

const CAMPAIGN_OBJECTIVES = [
    { value: 'OUTCOME_SALES', label: 'Sales - Drive purchases and conversions' },
    { value: 'OUTCOME_TRAFFIC', label: 'Traffic - Send people to your website' },
    { value: 'OUTCOME_LEADS', label: 'Leads - Collect leads for your business' },
    { value: 'OUTCOME_ENGAGEMENT', label: 'Engagement - Get more messages, video views, etc.' },
    { value: 'OUTCOME_AWARENESS', label: 'Awareness - Reach people near your business' },
    { value: 'OUTCOME_APP_PROMOTION', label: 'App Promotion - Get more app installs' }
];

const BID_STRATEGIES = [
    { value: 'LOWEST_COST_WITHOUT_CAP', label: 'Lowest Cost (Highest Volume or Value, No Cap)' },
    { value: 'LOWEST_COST_WITH_BID_CAP', label: 'Lowest Cost with Bid Cap' },
    { value: 'COST_CAP', label: 'Cost Cap (Cost Per Result Goal)' }
];

const CampaignStep = ({ onNext, onBack }) => {
    const { campaignData, setCampaignData, adsetData, setAdsetData, selectedAdAccount, setSelectedAdAccount } = useCampaign();
    const { brands, activeBrand } = useBrands();
    const { showError, showWarning, showSuccess } = useToast();

    // Auto-set brand from activeBrand (e.g. when coming from Wizard flow)
    useEffect(() => {
        if (activeBrand && !campaignData.brandId) {
            setCampaignData(prev => ({ ...prev, brandId: activeBrand.id }));
        }
    }, [activeBrand]);
    const [mode, setMode] = useState('new'); // 'new', 'existing', or 'template'
    const [existingCampaigns, setExistingCampaigns] = useState([]);
    const [selectedCampaign, setSelectedCampaign] = useState(null);
    const [loading, setLoading] = useState(false);
    const [loadingCampaigns, setLoadingCampaigns] = useState(false);
    const [templates, setTemplates] = useState([]);
    const [loadingTemplates, setLoadingTemplates] = useState(false);

    useEffect(() => {
        // Fetch campaigns when switching to existing mode
        if (mode === 'existing' && selectedAdAccount) {
            fetchExistingCampaigns();
        }
    }, [mode, selectedAdAccount]);

    const fetchExistingCampaigns = async () => {
        if (!selectedAdAccount) return;

        setLoadingCampaigns(true);
        try {
            const campaigns = await getCampaigns(selectedAdAccount.id);
            setExistingCampaigns(campaigns);
        } catch (error) {
            console.error('Error fetching campaigns:', error);
            showError(`Error fetching campaigns: ${error.message}`);
        } finally {
            setLoadingCampaigns(false);
        }
    };

    const handleSelectExisting = (campaign) => {
        setSelectedCampaign(campaign);

        const dailyBudget = campaign.dailyBudget ? parseInt(campaign.dailyBudget) / 100 : 0;
        const lifetimeBudget = campaign.lifetimeBudget ? parseInt(campaign.lifetimeBudget) / 100 : 0;

        // CBO campaigns have budget set at campaign level
        // ABO campaigns have budget set at ad set level (campaign budget is 0 or null)
        const isCBO = dailyBudget > 0 || lifetimeBudget > 0;

        setCampaignData({
            ...campaign,
            budgetType: isCBO ? 'CBO' : 'ABO',
            dailyBudget: dailyBudget,
            bidStrategy: campaign.bid_strategy || '',
            fbCampaignId: campaign.id,
            isExisting: true
        });
    };

    const handleInputChange = (field, value) => {
        setCampaignData(prev => ({
            ...prev,
            [field]: value,
            isExisting: false
        }));
    };

    const handleNext = async () => {
        if (mode === 'existing' && !selectedCampaign) {
            showWarning('Please select a campaign');
            return;
        }

        if (mode === 'existing') {
            // For existing CBO campaigns with a bid-cap strategy, FB requires bid_amount
            // on each new ad set (subcode 1815857). The cap value is per-adset, not on the
            // campaign — so we collect it here and pass it through to the AdSet creation.
            const needsCap =
                campaignData.budgetType === 'CBO' &&
                (campaignData.bidStrategy === 'LOWEST_COST_WITH_BID_CAP' ||
                    campaignData.bidStrategy === 'COST_CAP');
            if (needsCap && (!campaignData.bidAmount || campaignData.bidAmount <= 0)) {
                showWarning(
                    `This campaign uses ${campaignData.bidStrategy === 'COST_CAP' ? 'Cost Cap' : 'Bid Cap'}. Enter a value before continuing.`
                );
                return;
            }
        }

        if (mode === 'new') {
            if (!campaignData.name || !campaignData.objective) {
                showWarning('Please fill in all required fields');
                return;
            }

            if (campaignData.budgetType === 'CBO' && (!campaignData.dailyBudget || campaignData.dailyBudget <= 0)) {
                showWarning('Please enter a valid Daily Budget for CBO campaign');
                return;
            }

            // Validate Bid Amount if strategy requires it (for CBO campaigns)
            if (campaignData.budgetType === 'CBO' &&
                (campaignData.bidStrategy === 'LOWEST_COST_WITH_BID_CAP' || campaignData.bidStrategy === 'COST_CAP') &&
                (!campaignData.bidAmount || campaignData.bidAmount <= 0)) {
                showWarning('Please enter a valid Bid Amount for the selected bid strategy');
                return;
            }

            // For new campaigns, we just prepare the data
            // The actual creation happens in the final step (BulkAdCreation)
            const id = `camp_${Date.now()}`;
            setCampaignData(prev => ({ ...prev, id }));
        }

        onNext();
    };

    return (
        <div>
            <h2 className="text-2xl font-bold mb-6">Campaign Setup</h2>

            {/* Mode Toggle */}
            <div className="flex gap-4 mb-6">
                <button
                    onClick={() => {
                        setMode('new');
                        setCampaignData(prev => ({
                            ...prev,
                            isExisting: false,
                            fbCampaignId: null
                        }));
                    }}
                    className={`flex-1 p-4 rounded-xl border-2 transition-all ${mode === 'new'
                        ? 'border-amber-600 bg-amber-50'
                        : 'border-gray-200 hover:border-amber-300'
                        }`}
                >
                    <Plus className="mx-auto mb-2" size={24} />
                    <div className="font-semibold">Create New Campaign</div>
                </button>
                <button
                    onClick={() => setMode('existing')}
                    className={`flex-1 p-4 rounded-xl border-2 transition-all ${mode === 'existing'
                        ? 'border-amber-600 bg-amber-50'
                        : 'border-gray-200 hover:border-amber-300'
                        }`}
                >
                    <Check className="mx-auto mb-2" size={24} />
                    <div className="font-semibold">Use Existing Campaign</div>
                </button>
                <button
                    onClick={() => {
                        setMode('template');
                        setLoadingTemplates(true);
                        listTemplates().then(setTemplates).catch(() => showError('Failed to load templates')).finally(() => setLoadingTemplates(false));
                    }}
                    className={`flex-1 p-4 rounded-xl border-2 transition-all ${mode === 'template'
                        ? 'border-amber-600 bg-amber-50'
                        : 'border-gray-200 hover:border-amber-300'
                        }`}
                >
                    <Bookmark className="mx-auto mb-2" size={24} />
                    <div className="font-semibold">From Template</div>
                </button>
            </div>

            {/* Template list */}
            {mode === 'template' && (
                <div className="space-y-2 mb-6">
                    <h3 className="font-semibold text-gray-700 mb-3">Choose a Template</h3>
                    {loadingTemplates ? (
                        <div className="flex items-center justify-center py-8 text-gray-500">
                            <Loader className="animate-spin mr-2" size={20} /> Loading templates...
                        </div>
                    ) : templates.length === 0 ? (
                        <p className="text-gray-500 text-center py-8">No templates saved yet. Create a campaign and save it as a template from the Ad Set step.</p>
                    ) : (
                        templates.map(t => (
                            <div
                                key={t.id}
                                onClick={() => {
                                    setCampaignData(prev => ({
                                        ...prev,
                                        name: '',
                                        objective: t.campaign_config.objective || 'OUTCOME_SALES',
                                        budgetType: t.campaign_config.budgetType || 'ABO',
                                        dailyBudget: t.campaign_config.dailyBudget || 0,
                                        bidStrategy: t.campaign_config.bidStrategy || '',
                                        bidAmount: t.campaign_config.bidAmount || 0,
                                        isExisting: false,
                                        fbCampaignId: null,
                                    }));
                                    setAdsetData(prev => ({
                                        ...prev,
                                        ...t.adset_config,
                                        name: '',
                                        isExisting: false,
                                        fbAdsetId: null,
                                    }));
                                    setMode('new');
                                    showSuccess(`Template "${t.name}" loaded`);
                                }}
                                className="p-4 rounded-xl border-2 border-gray-200 hover:border-amber-300 cursor-pointer transition-all group"
                            >
                                <div className="flex justify-between items-center">
                                    <div>
                                        <div className="font-bold text-gray-900">{t.name}</div>
                                        <div className="text-sm text-gray-500 mt-1">
                                            {t.campaign_config?.budgetType || 'ABO'} &middot; {(t.campaign_config?.objective || '').replace('OUTCOME_', '')}
                                            {t.adset_config?.dailyBudget > 0 ? ` · $${t.adset_config.dailyBudget}/day` : ''}
                                            {t.adset_config?.targeting?.geo_locations?.countries?.length > 0 ? ` · ${t.adset_config.targeting.geo_locations.countries.join(', ')}` : ''}
                                        </div>
                                    </div>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            deleteTemplate(t.id).then(() => {
                                                setTemplates(prev => prev.filter(x => x.id !== t.id));
                                                showSuccess('Template deleted');
                                            }).catch(() => showError('Failed to delete'));
                                        }}
                                        className="p-2 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            )}

            {/* Existing Campaigns List */}
            {mode === 'existing' && (
                <div className="space-y-4 mb-6">
                    {/* Existing Campaigns */}
                    <div>
                        <h3 className="font-semibold text-gray-700 mb-3">Select a Campaign</h3>
                        {loadingCampaigns ? (
                            <div className="flex items-center justify-center gap-2 text-gray-500 py-8">
                                <Loader className="animate-spin" size={20} />
                                <span>Loading campaigns from Facebook...</span>
                            </div>
                        ) : existingCampaigns.length === 0 ? (
                            <p className="text-gray-500 text-center py-8">No campaigns found in this ad account.</p>
                        ) : (
                            existingCampaigns.map(campaign => (
                                <div
                                    key={campaign.id}
                                    onClick={() => handleSelectExisting(campaign)}
                                    className={`p-4 rounded-xl border-2 cursor-pointer transition-all mb-2 ${selectedCampaign?.id === campaign.id
                                        ? 'border-amber-600 bg-amber-50'
                                        : 'border-gray-200 hover:border-amber-300'
                                        }`}
                                >
                                    <div className="flex justify-between items-start">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2">
                                                <div className="font-bold text-gray-900">{campaign.name}</div>
                                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${campaign.status === 'ACTIVE' ? 'bg-green-100 text-green-700' :
                                                    campaign.status === 'PAUSED' ? 'bg-yellow-100 text-yellow-700' :
                                                        'bg-gray-100 text-gray-700'
                                                    }`}>
                                                    {campaign.status}
                                                </span>
                                            </div>
                                            <div className="text-sm text-gray-500 mt-1">
                                                <span className="font-medium text-gray-700">
                                                    {(campaign.dailyBudget || campaign.lifetimeBudget) ? 'CBO' : 'ABO'}
                                                </span>
                                                {' • '}{campaign.objective}
                                                {campaign.dailyBudget && ` • Daily: $${(parseInt(campaign.dailyBudget) / 100).toFixed(2)}`}
                                                {campaign.lifetimeBudget && ` • Lifetime: $${(parseInt(campaign.lifetimeBudget) / 100).toFixed(2)}`}
                                            </div>
                                        </div>
                                        {selectedCampaign?.id === campaign.id && (
                                            <Check className="text-amber-600" size={20} />
                                        )}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>

                    {/* Bid cap input for selected existing CBO campaigns with cap strategy.
                        FB rejects new adsets without bid_amount when campaign uses
                        LOWEST_COST_WITH_BID_CAP or COST_CAP (subcode 1815857). */}
                    {selectedCampaign &&
                        campaignData.budgetType === 'CBO' &&
                        (campaignData.bidStrategy === 'LOWEST_COST_WITH_BID_CAP' ||
                            campaignData.bidStrategy === 'COST_CAP') && (
                            <div className="p-4 bg-amber-50 border-2 border-amber-200 rounded-xl">
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    {campaignData.bidStrategy === 'COST_CAP'
                                        ? 'Cost Cap Amount (USD)'
                                        : 'Bid Cap Amount (USD)'}{' '}
                                    *
                                </label>
                                <div className="relative">
                                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
                                    <input
                                        type="number"
                                        step="0.01"
                                        min="0.01"
                                        value={campaignData.bidAmount || ''}
                                        onChange={(e) =>
                                            setCampaignData((prev) => ({
                                                ...prev,
                                                bidAmount: parseFloat(e.target.value) || 0,
                                            }))
                                        }
                                        placeholder="85.00"
                                        className="w-full pl-8 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                                    />
                                </div>
                                <p className="text-xs text-gray-600 mt-2">
                                    This campaign uses{' '}
                                    {campaignData.bidStrategy === 'COST_CAP' ? 'Cost Cap' : 'Bid Cap'}. Facebook
                                    requires this value on every new ad set under it.
                                </p>
                            </div>
                        )}
                </div>
            )}

            {/* New Campaign Form */}
            {mode === 'new' && (
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Campaign Name *
                        </label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={campaignData.name}
                                onChange={(e) => handleInputChange('name', e.target.value)}
                                placeholder="Summer Sale Campaign"
                                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                            />
                            <button
                                type="button"
                                onClick={() => handleInputChange('name', Array.from(crypto.getRandomValues(new Uint8Array(8))).map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 12).toUpperCase())}
                                className="px-3 py-2 bg-amber-100 text-amber-700 border border-amber-300 rounded-lg hover:bg-amber-200 transition-colors flex items-center gap-1.5 text-sm whitespace-nowrap"
                                title="Generate random name"
                            >
                                <Shuffle size={14} />
                                Random
                            </button>
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            <Tag size={14} className="inline mr-1" />
                            Brand
                        </label>
                        <select
                            value={campaignData.brandId || ''}
                            onChange={(e) => setCampaignData(prev => ({ ...prev, brandId: e.target.value || null }))}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                        >
                            <option value="">No brand</option>
                            {brands.map(b => (
                                <option key={b.id} value={b.id}>{b.name}</option>
                            ))}
                        </select>
                        <p className="text-xs text-gray-400 mt-1">Tag this campaign with a brand for Dashboard filtering</p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Campaign Objective *
                        </label>
                        <select
                            value={campaignData.objective}
                            onChange={(e) => handleInputChange('objective', e.target.value)}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                        >
                            <option value="">Select objective...</option>
                            {CAMPAIGN_OBJECTIVES.map(obj => (
                                <option key={obj.value} value={obj.value}>{obj.label}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Budget Type *
                        </label>
                        <div className="grid grid-cols-2 gap-4">
                            <button
                                type="button"
                                onClick={() => handleInputChange('budgetType', 'ABO')}
                                className={`p-3 rounded-lg border-2 transition-all ${campaignData.budgetType === 'ABO'
                                    ? 'border-amber-600 bg-amber-50'
                                    : 'border-gray-200 hover:border-amber-300'
                                    }`}
                            >
                                <div className="font-semibold">ABO</div>
                                <div className="text-xs text-gray-500">Ad Set Budget</div>
                            </button>
                            <button
                                type="button"
                                onClick={() => handleInputChange('budgetType', 'CBO')}
                                className={`p-3 rounded-lg border-2 transition-all ${campaignData.budgetType === 'CBO'
                                    ? 'border-amber-600 bg-amber-50'
                                    : 'border-gray-200 hover:border-amber-300'
                                    }`}
                            >
                                <div className="font-semibold">CBO</div>
                                <div className="text-xs text-gray-500">Campaign Budget</div>
                            </button>
                        </div>
                    </div>

                    {campaignData.budgetType === 'CBO' && (
                        <>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Daily Budget (USD)
                                </label>
                                <div className="relative">
                                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                        <span className="text-gray-500">$</span>
                                    </div>
                                    <input
                                        type="number"
                                        value={campaignData.dailyBudget || ''}
                                        onChange={(e) => handleInputChange('dailyBudget', parseInt(e.target.value) || 0)}
                                        placeholder="100"
                                        min="1"
                                        step="1"
                                        className="w-full pl-7 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Bid Strategy
                                </label>
                                <select
                                    value={campaignData.bidStrategy}
                                    onChange={(e) => handleInputChange('bidStrategy', e.target.value)}
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                                >
                                    <option value="">Select bid strategy...</option>
                                    {BID_STRATEGIES.map(strategy => (
                                        <option key={strategy.value} value={strategy.value}>{strategy.label}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Bid Amount - Required for Cost Cap and Bid Cap strategies */}
                            {(campaignData.bidStrategy === 'COST_CAP' || campaignData.bidStrategy === 'LOWEST_COST_WITH_BID_CAP') && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        {campaignData.bidStrategy === 'COST_CAP' ? 'Cost Cap Amount (USD)' : 'Bid Cap Amount (USD)'} *
                                    </label>
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                            <span className="text-gray-500">$</span>
                                        </div>
                                        <input
                                            type="number"
                                            value={campaignData.bidAmount || ''}
                                            onChange={(e) => handleInputChange('bidAmount', parseFloat(e.target.value) || 0)}
                                            placeholder="10.00"
                                            min="0.01"
                                            step="0.01"
                                            className="w-full pl-7 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                                        />
                                    </div>
                                    <p className="text-xs text-gray-500 mt-1">
                                        {campaignData.bidStrategy === 'COST_CAP'
                                            ? 'Maximum average cost per result you want to maintain'
                                            : 'Maximum bid amount for each auction'}
                                    </p>
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}

            {/* Navigation */}
            <div className="mt-8 flex justify-between">
                {onBack && (
                    <button
                        onClick={onBack}
                        className="px-6 py-3 text-gray-600 hover:text-gray-800 font-medium"
                    >
                        Back
                    </button>
                )}
                <button
                    onClick={handleNext}
                    disabled={loading}
                    className="ml-auto flex items-center gap-2 px-6 py-3 bg-amber-600 text-white rounded-lg font-medium hover:bg-amber-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                    {loading ? 'Saving...' : 'Next Step'} <ChevronRight size={20} />
                </button>
            </div>
        </div>
    );
};

export default CampaignStep;
