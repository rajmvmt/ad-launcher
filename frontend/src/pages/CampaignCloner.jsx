import React, { useState, useEffect } from 'react';
import { Copy, ChevronRight, Loader2, CheckCircle, AlertCircle, ArrowRight, Plus, X } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { getConnections } from '../api/facebookConnections';
import { getAdAccounts, getCampaignInsights, getPages, getPixels, createPixel, cloneCampaignToAccount } from '../lib/facebookApi';

export default function CampaignCloner({ embedded = false }) {
    const { showSuccess, showError } = useToast();

    // Connections
    const [connections, setConnections] = useState([]);
    const [sourceConnection, setSourceConnection] = useState(null);
    const [targetConnection, setTargetConnection] = useState(null);

    // Source
    const [sourceAccounts, setSourceAccounts] = useState([]);
    const [sourceAccount, setSourceAccount] = useState(null);
    const [campaigns, setCampaigns] = useState([]);
    const [selectedCampaign, setSelectedCampaign] = useState(null);
    const [loadingCampaigns, setLoadingCampaigns] = useState(false);

    // Target
    const [targetAccounts, setTargetAccounts] = useState([]);
    const [targetAccount, setTargetAccount] = useState(null);
    const [targetPages, setTargetPages] = useState([]);
    const [targetPage, setTargetPage] = useState(null);
    const [targetPixels, setTargetPixels] = useState([]);
    const [targetPixel, setTargetPixel] = useState(null);

    // Create pixel
    const [showCreatePixel, setShowCreatePixel] = useState(false);
    const [newPixelName, setNewPixelName] = useState('');
    const [creatingPixel, setCreatingPixel] = useState(false);

    // Clone
    const [cloneName, setCloneName] = useState('');
    const [cloneAds, setCloneAds] = useState(true);
    const [cloning, setCloning] = useState(false);
    const [result, setResult] = useState(null);

    // Step tracker
    const currentStep = !selectedCampaign ? 1 : !targetAccount ? 2 : 3;

    // Load connections on mount
    useEffect(() => {
        const load = async () => {
            try {
                const conns = await getConnections();
                setConnections(conns);
                if (conns.length > 0) {
                    const defaultConn = conns.find(c => c.is_default) || conns[0];
                    setSourceConnection(defaultConn);
                    setTargetConnection(defaultConn);
                }
            } catch {}
        };
        load();
    }, []);

    // Load source accounts when connection changes
    useEffect(() => {
        if (!sourceConnection) return;
        const load = async () => {
            try {
                const accts = await getAdAccounts(sourceConnection.id);
                setSourceAccounts(accts);
            } catch {}
        };
        load();
    }, [sourceConnection?.id]);

    // Load target accounts when target connection changes
    useEffect(() => {
        if (!targetConnection) return;
        const load = async () => {
            try {
                const accts = await getAdAccounts(targetConnection.id);
                setTargetAccounts(accts);
            } catch {}
        };
        load();
    }, [targetConnection?.id]);

    // Load campaigns when source account selected
    useEffect(() => {
        if (!sourceAccount) { setCampaigns([]); return; }
        const load = async () => {
            setLoadingCampaigns(true);
            try {
                const data = await getCampaignInsights(sourceAccount.id, sourceConnection?.id);
                setCampaigns(data || []);
            } catch { setCampaigns([]); }
            setLoadingCampaigns(false);
        };
        load();
    }, [sourceAccount?.id]);

    // Load pages + pixels when target account selected
    useEffect(() => {
        if (!targetAccount) return;
        const load = async () => {
            try {
                const [pages, pixels] = await Promise.all([
                    getPages(targetAccount.id).catch(() => []),
                    getPixels(targetAccount.id).catch(() => []),
                ]);
                setTargetPages(pages);
                setTargetPixels(pixels);
                if (pages.length === 1) setTargetPage(pages[0]);
                if (pixels.length === 1) setTargetPixel(pixels[0]);
            } catch {}
        };
        load();
    }, [targetAccount?.id]);

    const handleCreatePixel = async () => {
        if (!newPixelName.trim() || !targetAccount) return;
        setCreatingPixel(true);
        try {
            const result = await createPixel(targetAccount.id, newPixelName.trim());
            showSuccess(`Pixel "${newPixelName.trim()}" created`);
            setNewPixelName('');
            setShowCreatePixel(false);
            const pixels = await getPixels(targetAccount.id).catch(() => []);
            setTargetPixels(pixels);
            const newPx = pixels.find(p => p.id === result.id);
            if (newPx) setTargetPixel(newPx);
        } catch (error) {
            showError(error.message || 'Failed to create pixel');
        } finally {
            setCreatingPixel(false);
        }
    };

    const handleClone = async () => {
        if (!selectedCampaign || !targetAccount) return;
        setCloning(true);
        setResult(null);
        try {
            const res = await cloneCampaignToAccount(
                selectedCampaign.id,
                targetAccount.id,
                sourceConnection?.id,
                {
                    newName: cloneName || undefined,
                    targetPageId: targetPage?.id,
                    targetPixelId: targetPixel?.id,
                    cloneAds,
                }
            );
            setResult(res);
            showSuccess(`Cloned! ${res.adsets_cloned} ad sets, ${res.ads_cloned || 0} ads created.`);
        } catch (err) {
            showError(err.message);
        }
        setCloning(false);
    };

    const formatBudget = (val) => {
        if (!val) return '-';
        return '$' + (parseFloat(val) / 100).toFixed(2) + '/day';
    };

    return (
        <div className={embedded ? "" : "max-w-5xl mx-auto"}>
            {!embedded && (
                <>
                    <div className="flex items-center gap-3 mb-6">
                        <Copy className="text-amber-600" size={28} />
                        <h1 className="text-2xl font-bold text-gray-900">Campaign Cloner</h1>
                    </div>
                    <p className="text-gray-500 text-sm mb-8">
                        Clone a winning campaign's full structure — campaign, ad sets, and ads with creatives — to a different ad account.
                    </p>
                </>
            )}

            {/* Step indicators */}
            <div className="flex items-center gap-2 mb-8">
                {[
                    { num: 1, label: 'Select Source Campaign' },
                    { num: 2, label: 'Select Target Account' },
                    { num: 3, label: 'Review & Clone' },
                ].map((step, i) => (
                    <React.Fragment key={step.num}>
                        {i > 0 && <ChevronRight size={16} className="text-gray-300" />}
                        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm ${
                            currentStep === step.num ? 'bg-amber-100 text-amber-800 font-medium' :
                            currentStep > step.num ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-400'
                        }`}>
                            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                                currentStep > step.num ? 'bg-green-500 text-white' :
                                currentStep === step.num ? 'bg-amber-500 text-white' : 'bg-gray-300 text-white'
                            }`}>{currentStep > step.num ? '✓' : step.num}</span>
                            {step.label}
                        </div>
                    </React.Fragment>
                ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* LEFT: Source */}
                <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
                    <h2 className="text-lg font-semibold text-gray-800 mb-4">Source</h2>

                    {/* Connection selector */}
                    {connections.length > 1 && (
                        <div className="mb-4">
                            <label className="block text-xs font-medium text-gray-500 mb-1">Connection</label>
                            <select
                                value={sourceConnection?.id || ''}
                                onChange={e => {
                                    const c = connections.find(c => c.id === e.target.value);
                                    setSourceConnection(c);
                                    setSourceAccount(null);
                                    setSelectedCampaign(null);
                                }}
                                className="w-full p-2 border border-gray-300 rounded-lg text-sm"
                            >
                                {connections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                        </div>
                    )}

                    {/* Ad Account */}
                    <div className="mb-4">
                        <label className="block text-xs font-medium text-gray-500 mb-1">Ad Account</label>
                        <select
                            value={sourceAccount?.id || ''}
                            onChange={e => {
                                const a = sourceAccounts.find(a => a.id === e.target.value);
                                setSourceAccount(a);
                                setSelectedCampaign(null);
                            }}
                            className="w-full p-2 border border-gray-300 rounded-lg text-sm"
                        >
                            <option value="">Select ad account...</option>
                            {sourceAccounts.map(a => (
                                <option key={a.id} value={a.id}>{a.name} ({a.accountId})</option>
                            ))}
                        </select>
                    </div>

                    {/* Campaign list */}
                    <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Campaign to Clone</label>
                        {loadingCampaigns ? (
                            <div className="flex items-center gap-2 py-8 justify-center text-gray-400">
                                <Loader2 size={18} className="animate-spin" /> Loading campaigns...
                            </div>
                        ) : campaigns.length > 0 ? (
                            <div className="space-y-2 max-h-96 overflow-y-auto">
                                {campaigns.map(c => (
                                    <button
                                        key={c.id}
                                        type="button"
                                        onClick={() => {
                                            setSelectedCampaign(c);
                                            setCloneName(c.name + ' (Clone)');
                                        }}
                                        className={`w-full text-left p-3 rounded-lg border transition-all ${
                                            selectedCampaign?.id === c.id
                                                ? 'border-amber-400 bg-amber-50 ring-1 ring-amber-300'
                                                : 'border-gray-200 hover:border-amber-300 hover:bg-amber-50/50'
                                        }`}
                                    >
                                        <div className="font-medium text-sm text-gray-900 truncate">{c.name}</div>
                                        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                                            <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                                                c.status === 'ACTIVE' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                                            }`}>{c.status}</span>
                                            <span>{c.objective}</span>
                                            {c.insights?.spend && <span>Spend: ${parseFloat(c.insights.spend).toFixed(2)}</span>}
                                            {c.insights?.results && <span>Results: {c.insights.results}</span>}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        ) : sourceAccount ? (
                            <p className="text-sm text-gray-400 py-4 text-center">No campaigns found</p>
                        ) : (
                            <p className="text-sm text-gray-400 py-4 text-center">Select an ad account first</p>
                        )}
                    </div>
                </div>

                {/* RIGHT: Target */}
                <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
                    <h2 className="text-lg font-semibold text-gray-800 mb-4">Target</h2>

                    {!selectedCampaign ? (
                        <div className="flex items-center justify-center py-16 text-gray-400 text-sm">
                            <ArrowRight size={16} className="mr-2" /> Select a source campaign first
                        </div>
                    ) : (
                        <>
                            {/* Connection selector */}
                            {connections.length > 1 && (
                                <div className="mb-4">
                                    <label className="block text-xs font-medium text-gray-500 mb-1">Connection</label>
                                    <select
                                        value={targetConnection?.id || ''}
                                        onChange={e => {
                                            const c = connections.find(c => c.id === e.target.value);
                                            setTargetConnection(c);
                                            setTargetAccount(null);
                                        }}
                                        className="w-full p-2 border border-gray-300 rounded-lg text-sm"
                                    >
                                        {connections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                    </select>
                                </div>
                            )}

                            {/* Target Ad Account */}
                            <div className="mb-4">
                                <label className="block text-xs font-medium text-gray-500 mb-1">Target Ad Account</label>
                                <select
                                    value={targetAccount?.id || ''}
                                    onChange={e => {
                                        const a = targetAccounts.find(a => a.id === e.target.value);
                                        setTargetAccount(a);
                                        setTargetPage(null);
                                        setTargetPixel(null);
                                    }}
                                    className="w-full p-2 border border-gray-300 rounded-lg text-sm"
                                >
                                    <option value="">Select target ad account...</option>
                                    {targetAccounts.map(a => (
                                        <option key={a.id} value={a.id}>{a.name} ({a.accountId})</option>
                                    ))}
                                </select>
                            </div>

                            {targetAccount && (
                                <>
                                    {/* Page */}
                                    <div className="mb-4">
                                        <label className="block text-xs font-medium text-gray-500 mb-1">Page</label>
                                        <select
                                            value={targetPage?.id || ''}
                                            onChange={e => setTargetPage(targetPages.find(p => p.id === e.target.value) || null)}
                                            className="w-full p-2 border border-gray-300 rounded-lg text-sm"
                                        >
                                            <option value="">Select page...</option>
                                            {targetPages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                        </select>
                                    </div>

                                    {/* Pixel */}
                                    <div className="mb-4">
                                        <label className="block text-xs font-medium text-gray-500 mb-1">Pixel</label>
                                        <div className="flex items-center gap-2">
                                            <select
                                                value={targetPixel?.id || ''}
                                                onChange={e => setTargetPixel(targetPixels.find(p => p.id === e.target.value) || null)}
                                                className="flex-1 p-2 border border-gray-300 rounded-lg text-sm"
                                            >
                                                <option value="">Select pixel (optional)...</option>
                                                {targetPixels.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                            </select>
                                            <button
                                                type="button"
                                                onClick={() => setShowCreatePixel(!showCreatePixel)}
                                                className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-600 hover:text-amber-600"
                                                title="Create new pixel"
                                            >
                                                <Plus size={16} />
                                            </button>
                                        </div>
                                        {showCreatePixel && (
                                            <div className="mt-2 flex items-center gap-2">
                                                <input
                                                    type="text"
                                                    value={newPixelName}
                                                    onChange={(e) => setNewPixelName(e.target.value)}
                                                    onKeyDown={(e) => e.key === 'Enter' && handleCreatePixel()}
                                                    placeholder="New pixel name..."
                                                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={handleCreatePixel}
                                                    disabled={creatingPixel || !newPixelName.trim()}
                                                    className="px-3 py-2 bg-amber-500 text-white rounded-lg text-sm hover:bg-amber-600 disabled:opacity-50"
                                                >
                                                    {creatingPixel ? <Loader2 className="animate-spin" size={14} /> : 'Create'}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => { setShowCreatePixel(false); setNewPixelName(''); }}
                                                    className="p-2 text-gray-400 hover:text-gray-600"
                                                >
                                                    <X size={16} />
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    {/* Clone name */}
                                    <div className="mb-4">
                                        <label className="block text-xs font-medium text-gray-500 mb-1">New Campaign Name</label>
                                        <input
                                            type="text"
                                            value={cloneName}
                                            onChange={e => setCloneName(e.target.value)}
                                            className="w-full p-2 border border-gray-300 rounded-lg text-sm"
                                            placeholder="Campaign name..."
                                        />
                                    </div>

                                    {/* Clone ads toggle */}
                                    <label className="flex items-center gap-3 mb-6 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={cloneAds}
                                            onChange={e => setCloneAds(e.target.checked)}
                                            className="w-4 h-4 text-amber-600 rounded"
                                        />
                                        <span className="text-sm text-gray-700">
                                            Clone ads & creatives (re-uploads images/videos)
                                        </span>
                                    </label>

                                    {/* Clone button */}
                                    <button
                                        onClick={handleClone}
                                        disabled={cloning || !targetAccount}
                                        className="w-full py-3 bg-amber-600 text-white rounded-xl font-medium hover:bg-amber-700 disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center justify-center gap-2 transition-colors"
                                    >
                                        {cloning ? (
                                            <>
                                                <Loader2 size={18} className="animate-spin" />
                                                Cloning... this may take a minute
                                            </>
                                        ) : (
                                            <>
                                                <Copy size={18} />
                                                Clone Campaign
                                            </>
                                        )}
                                    </button>
                                </>
                            )}
                        </>
                    )}

                    {/* Result */}
                    {result && (
                        <div className="mt-6 p-4 rounded-xl bg-green-50 border border-green-200">
                            <div className="flex items-center gap-2 text-green-700 font-medium mb-2">
                                <CheckCircle size={18} />
                                Clone Complete
                            </div>
                            <div className="text-sm text-green-800 space-y-1">
                                <p>Campaign: <strong>{result.name}</strong></p>
                                <p>Ad Sets Cloned: <strong>{result.adsets_cloned}</strong></p>
                                <p>Ads Cloned: <strong>{result.ads_cloned || 0}</strong></p>
                            </div>
                            {result.errors?.length > 0 && (
                                <div className="mt-3 p-3 bg-amber-50 rounded-lg border border-amber-200">
                                    <div className="flex items-center gap-1 text-amber-700 text-xs font-medium mb-1">
                                        <AlertCircle size={14} /> Some items had issues:
                                    </div>
                                    <ul className="text-xs text-amber-600 space-y-0.5">
                                        {result.errors.map((e, i) => <li key={i}>- {e}</li>)}
                                    </ul>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
