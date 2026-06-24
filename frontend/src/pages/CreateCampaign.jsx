import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check, Target, Users, Image as ImageIcon, Zap, CheckCircle, CreditCard, Megaphone, CheckCircle2, ArrowRight, PlusCircle, AlertTriangle, Copy, Shield, Loader2 } from 'lucide-react';
import { CampaignProvider, useCampaign } from '../context/CampaignContext';
import { useAuth } from '../context/AuthContext';
import AdAccountStep from '../components/AdAccountStep';
import CampaignStep from '../components/CampaignStep';
import AdSetStep from '../components/AdSetStep';
import AdCreativeStep from '../components/AdCreativeStep';
import BulkAdCreation from '../components/BulkAdCreation';
import CampaignCloner from './CampaignCloner';
import SafeCampaignModal from '../components/SafeCampaignModal';
import { useToast } from '../context/ToastContext';
import { getAdAccounts } from '../lib/facebookApi';
import { getConnections } from '../api/facebookConnections';

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }
    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }
    componentDidCatch(error, errorInfo) {
        console.error('CreateCampaign crash:', error, errorInfo);
    }
    render() {
        if (this.state.hasError) {
            return (
                <div className="p-8 bg-red-50 border border-red-200 rounded-xl text-center">
                    <AlertTriangle className="mx-auto mb-4 text-red-500" size={48} />
                    <h2 className="text-xl font-bold text-red-800 mb-2">Something went wrong</h2>
                    <p className="text-red-600 text-sm mb-6">{this.state.error?.message}</p>
                    <button
                        onClick={() => { this.setState({ hasError: false, error: null }); }}
                        className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 mr-3"
                    >
                        Try Again
                    </button>
                    <button
                        onClick={() => window.location.reload()}
                        className="px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
                    >
                        Reload Page
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

const CreateCampaignContent = () => {
    const { resetWizard, setCampaignData, setAdsetData, setSelectedAdAccount, setSelectedConnection, hasDraft, clearDraft } = useCampaign();
    const { authFetch } = useAuth();
    const [searchParams] = useSearchParams();
    const preAccountId = searchParams.get('account_id');
    const preConnectionId = searchParams.get('connection_id');

    const [mode, setMode] = useState('create');
    const [currentStep, setCurrentStep] = useState(preAccountId ? 2 : 1);
    const [formData, setFormData] = useState({
        adAccountId: preAccountId || null,
        campaignId: null,
        adSetId: null,
        creativeId: null,
    });

    // When pre-selecting account via URL params, set it in CampaignContext so AdSetStep can fetch pixels
    useEffect(() => {
        if (preAccountId) {
            (async () => {
                try {
                    if (preConnectionId) {
                        const conns = await getConnections();
                        const conn = conns.find(c => c.id === preConnectionId);
                        if (conn) setSelectedConnection(conn);
                    }
                    const accounts = await getAdAccounts(preConnectionId);
                    const account = accounts.find(a => a.id === preAccountId);
                    if (account) setSelectedAdAccount(account);
                } catch (e) {
                    console.error('Failed to pre-load ad account:', e);
                }
            })();
        }
    }, [preAccountId, preConnectionId]);

    const handleAccountSelect = (id) => {
        if (id !== formData.adAccountId) {
            setCampaignData(prev => ({ ...prev, id: null, name: '', fbCampaignId: null, isExisting: false }));
            setAdsetData(prev => ({ ...prev, id: null, name: '', fbAdsetId: null, isExisting: false }));
            setFormData({ adAccountId: id, campaignId: null, adSetId: null, creativeId: null });
        } else {
            setFormData(prev => ({ ...prev, adAccountId: id }));
        }
    };

    // Auto-skip to Step 5 if there's an incomplete batch to resume
    useEffect(() => {
        const checkResumeBatch = async () => {
            try {
                const res = await authFetch(`${API_URL}/facebook/publish-batches/active`);
                if (res.ok) {
                    const batch = await res.json();
                    if (batch && batch.id) {
                        setCurrentStep(5);
                    }
                }
            } catch (e) { /* ignore */ }
        };
        checkResumeBatch();
    }, []);

    const handleCreateAnother = () => {
        resetWizard();
        setFormData({ adAccountId: null, campaignId: null, adSetId: null, creativeId: null });
        setCurrentStep(1);
    };

    const steps = [
        { id: 1, label: 'Ad Account', icon: CreditCard },
        { id: 2, label: 'Campaign', icon: Target },
        { id: 3, label: 'Ad Set', icon: Users },
        { id: 4, label: 'Creative', icon: ImageIcon },
        { id: 5, label: 'Bulk Ads', icon: Megaphone },
        { id: 6, label: 'Review & Launch', icon: CheckCircle2 },
    ];

    const handleNext = () => {
        if (currentStep < steps.length) {
            setCurrentStep(currentStep + 1);
        }
    };

    const handleBack = () => {
        if (currentStep > 1) {
            setCurrentStep(currentStep - 1);
        }
    };

    const isStepValid = () => {
        switch (currentStep) {
            case 1: return !!formData.adAccountId;
            case 2: return !!formData.campaignId;
            case 3: return !!formData.adSetId;
            case 4: return !!formData.creativeId;
            default: return true;
        }
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-xl sm:text-3xl font-bold text-gray-900 mb-2 flex items-center gap-3">
                    <Megaphone size={28} className="text-amber-600 sm:w-8 sm:h-8" />
                    Create Campaign
                </h1>
                <p className="text-gray-600 text-sm sm:text-base">Build a new Facebook ad campaign or clone an existing one</p>
            </div>

            {/* Resumed-from-draft banner */}
            {hasDraft && (
                <div className="flex items-center justify-between gap-3 px-4 py-2 bg-blue-50 border border-blue-200 rounded-lg text-sm">
                    <span className="text-blue-800">
                        Draft restored. Campaign / ad-set / page / copy fields are filled in — <strong>re-add any uploaded videos or images</strong> on the Creative step (media isn&rsquo;t saved across refreshes).
                    </span>
                    <button
                        onClick={() => { resetWizard(); setCurrentStep(1); }}
                        className="text-xs font-medium text-blue-700 hover:text-blue-900 underline whitespace-nowrap"
                    >
                        Discard draft
                    </button>
                </div>
            )}

            {/* Mode Toggle */}
            <div className="flex gap-2">
                <button
                    onClick={() => setMode('create')}
                    className={`flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold transition-all ${
                        mode === 'create'
                            ? 'bg-amber-600 text-white shadow-md'
                            : 'bg-white text-gray-600 border border-gray-200 hover:border-amber-300 hover:text-amber-700'
                    }`}
                >
                    <PlusCircle size={18} />
                    Create New
                </button>
                <button
                    onClick={() => setMode('clone')}
                    className={`flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold transition-all ${
                        mode === 'clone'
                            ? 'bg-amber-600 text-white shadow-md'
                            : 'bg-white text-gray-600 border border-gray-200 hover:border-amber-300 hover:text-amber-700'
                    }`}
                >
                    <Copy size={18} />
                    Clone Existing
                </button>
                <button
                    onClick={() => setMode('warmup')}
                    className={`flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold transition-all ${
                        mode === 'warmup'
                            ? 'bg-green-600 text-white shadow-md'
                            : 'bg-white text-gray-600 border border-gray-200 hover:border-green-300 hover:text-green-700'
                    }`}
                >
                    <Shield size={18} />
                    Safe Warmup
                </button>
            </div>

            {mode === 'create' && (
                /* Wizard Steps */
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3 sm:p-6">
                    <div className="flex justify-between items-center mb-6 sm:mb-8 relative overflow-x-auto">
                        {/* Progress Bar Background */}
                        <div className="absolute top-1/2 left-0 w-full h-1 bg-gray-100 -z-10 rounded-full" />

                        {/* Progress Bar Fill */}
                        <div
                            className="absolute top-1/2 left-0 h-1 bg-amber-600 -z-10 rounded-full transition-all duration-500 ease-in-out"
                            style={{ width: `${((currentStep - 1) / (steps.length - 1)) * 100}%` }}
                        />

                        {steps.map((step) => {
                            const isCompleted = step.id < currentStep;
                            const isCurrent = step.id === currentStep;

                            return (
                                <div key={step.id} className="flex flex-col items-center gap-1 sm:gap-2 bg-white px-1 sm:px-2 min-w-0">
                                    <div
                                        className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition-all duration-300 shrink-0 ${isCompleted || isCurrent
                                            ? 'bg-amber-600 text-white shadow-md scale-110'
                                            : 'bg-gray-100 text-gray-400'
                                            }`}
                                    >
                                        {isCompleted ? (
                                            <CheckCircle2 size={16} className="sm:w-5 sm:h-5" />
                                        ) : (
                                            <step.icon size={16} className="sm:w-5 sm:h-5" />
                                        )}
                                    </div>
                                    <span
                                        className={`text-[10px] sm:text-sm font-medium transition-colors duration-300 text-center leading-tight ${isCurrent ? 'text-amber-900' : 'text-gray-500'
                                            }`}
                                    >
                                        {step.label}
                                    </span>
                                </div>
                            );
                        })}
                    </div>

                    {/* Step Content */}
                    <div className="min-h-[400px]">
                        {currentStep === 1 && (
                            <AdAccountStep
                                selectedAccount={formData.adAccountId}
                                onAccountSelect={handleAccountSelect}
                                onNext={handleNext}
                            />
                        )}
                        {currentStep === 2 && (
                            <CampaignStep
                                adAccountId={formData.adAccountId}
                                selectedCampaign={formData.campaignId}
                                onCampaignSelect={(id) => setFormData({ ...formData, campaignId: id })}
                                onNext={handleNext}
                                onBack={handleBack}
                            />
                        )}
                        {currentStep === 3 && (
                            <AdSetStep
                                adAccountId={formData.adAccountId}
                                campaignId={formData.campaignId}
                                selectedAdSet={formData.adSetId}
                                onAdSetSelect={(id) => setFormData({ ...formData, adSetId: id })}
                                onNext={handleNext}
                                onBack={handleBack}
                            />
                        )}
                        {currentStep === 4 && (
                            <AdCreativeStep
                                adAccountId={formData.adAccountId}
                                selectedCreative={formData.creativeId}
                                onCreativeSelect={(id) => setFormData({ ...formData, creativeId: id })}
                                onNext={handleNext}
                                onBack={handleBack}
                            />
                        )}
                        {currentStep === 5 && (
                            <BulkAdCreation
                                onNext={handleNext}
                                onBack={handleBack}
                            />
                        )}
                        {currentStep === 6 && (
                            <div className="text-center py-12">
                                <CheckCircle2 className="mx-auto mb-4 text-green-500" size={64} />
                                <h2 className="text-3xl font-bold mb-4">Ads Queued for Publishing!</h2>
                                <p className="text-gray-600 mb-4">
                                    Your ads are being published in the background. You can start building another campaign right away.
                                </p>
                                <p className="text-gray-500 text-sm mb-8">
                                    Track progress in the publishing widget at the bottom right.
                                </p>
                                <button
                                    onClick={handleCreateAnother}
                                    className="inline-flex items-center gap-2 px-6 py-3 bg-amber-600 text-white rounded-lg font-medium hover:bg-amber-700 transition-colors"
                                >
                                    <PlusCircle size={20} />
                                    Create Another Campaign
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {mode === 'clone' && <CampaignCloner embedded />}

            {mode === 'warmup' && <SafeWarmupEmbed authFetch={authFetch} />}
        </div>
    );
};

const SafeWarmupEmbed = ({ authFetch }) => {
    const { showSuccess, showError } = useToast();
    const [accounts, setAccounts] = useState([]);
    const [pages, setPages] = useState([]);
    const [connections, setConnections] = useState([]);
    const [selectedAccount, setSelectedAccount] = useState('');
    const [selectedPage, setSelectedPage] = useState('');
    const [loading, setLoading] = useState(false);
    const [loadingAccounts, setLoadingAccounts] = useState(true);
    const [result, setResult] = useState(null);
    const [connectionId, setConnectionId] = useState('');

    const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

    useEffect(() => {
        const loadConns = async () => {
            try {
                const connRes = await authFetch(`${API_URL}/facebook-connections`);
                const conns = connRes.ok ? await connRes.json() : [];
                setConnections(conns);
                const activeConn = conns.find(c => c.is_active) || conns.find(c => c.is_default) || conns[0];
                if (activeConn) {
                    setConnectionId(activeConn.id);
                } else {
                    setLoadingAccounts(false);
                }
            } catch (e) {
                console.error('Failed to load connections:', e);
                setLoadingAccounts(false);
            }
        };
        loadConns();
    }, [authFetch]);

    useEffect(() => {
        if (!connectionId) return;
        const load = async () => {
            setLoadingAccounts(true);
            setSelectedAccount('');
            setSelectedPage('');
            try {
                const connParam = `?connection_id=${connectionId}`;
                const [acctRes, pagesRes] = await Promise.all([
                    authFetch(`${API_URL}/facebook/accounts${connParam}`),
                    authFetch(`${API_URL}/facebook/pages${connParam}`),
                ]);
                if (acctRes.ok) setAccounts(await acctRes.json());
                if (pagesRes.ok) {
                    const fbPages = await pagesRes.json();
                    setPages(fbPages.map(p => ({ id: p.id, fb_page_id: p.id, name: p.name })));
                }
            } catch (e) {
                console.error('Failed to load accounts:', e);
            } finally {
                setLoadingAccounts(false);
            }
        };
        load();
    }, [connectionId, authFetch]);

    const handleCreate = async () => {
        if (!selectedAccount || !selectedPage) {
            showError('Select an ad account and a page');
            return;
        }
        setLoading(true);
        setResult(null);
        try {
            const connParam = connectionId ? `?connection_id=${connectionId}` : '';
            const res = await authFetch(`${API_URL}/facebook/safe-engagement-campaign${connParam}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ad_account_id: selectedAccount,
                    page_id: selectedPage,
                    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || 'Failed to create campaign');
            }
            const data = await res.json();
            setResult(data);
            showSuccess('Safe warmup campaign created!');
        } catch (err) {
            showError(err.message);
        } finally {
            setLoading(false);
        }
    };

    if (loadingAccounts) {
        return (
            <div className="flex items-center justify-center h-48">
                <Loader2 size={24} className="text-green-500 animate-spin" />
            </div>
        );
    }

    return (
        <div className="space-y-6 max-w-2xl">
            {/* Connection Selector */}
            {connections.length > 0 && (
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Connection (BM)</label>
                    <select
                        value={connectionId}
                        onChange={(e) => setConnectionId(e.target.value)}
                        className="w-full p-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white"
                    >
                        {connections.map(c => (
                            <option key={c.id} value={c.id}>
                                {c.name || c.id}{c.is_active ? ' (active)' : ''}
                            </option>
                        ))}
                    </select>
                </div>
            )}

            {/* Safe Conversion Campaign (AI-powered) */}
            <SafeCampaignModal
                authFetch={authFetch}
                accounts={accounts}
                pages={pages}
                connectionId={connectionId}
            />

            {/* Quick Engagement Warmup */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                        <Shield size={20} className="text-green-600" />
                    </div>
                    <div>
                        <h2 className="text-lg font-semibold text-gray-900">Quick Engagement Warmup</h2>
                        <p className="text-xs text-gray-500">Creates a $5/day engagement campaign with page profile pic + safe copy. Auto-pauses at midnight.</p>
                    </div>
                </div>

                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Ad Account</label>
                            <select
                                value={selectedAccount}
                                onChange={(e) => setSelectedAccount(e.target.value)}
                                className="w-full p-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white"
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
                            <label className="block text-sm font-medium text-gray-700 mb-1">FB Page</label>
                            <select
                                value={selectedPage}
                                onChange={(e) => setSelectedPage(e.target.value)}
                                className="w-full p-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white"
                            >
                                <option value="">Select a page...</option>
                                {pages.map(p => (
                                    <option key={p.id} value={p.fb_page_id}>
                                        {p.name || p.fb_page_id}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <button
                        onClick={handleCreate}
                        disabled={loading || !selectedAccount || !selectedPage}
                        className="w-full py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {loading ? (
                            <>
                                <Loader2 size={16} className="animate-spin" />
                                Creating Campaign...
                            </>
                        ) : (
                            <>
                                <Shield size={16} />
                                Launch Quick Warmup ($5/day, auto-pause at midnight)
                            </>
                        )}
                    </button>

                    {result && (
                        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                            <div className="flex items-center gap-2 mb-2">
                                <CheckCircle2 size={18} className="text-green-600" />
                                <span className="font-semibold text-green-900">Campaign Created!</span>
                            </div>
                            <p className="text-sm text-green-800">Campaign: <strong>{result.campaign_name}</strong></p>
                            {result.auto_pause_time && (
                                <p className="text-sm text-green-700 mt-1">Auto-pause scheduled at {result.auto_pause_time}</p>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const CreateCampaign = () => (
    <ErrorBoundary>
        <CampaignProvider>
            <CreateCampaignContent />
        </CampaignProvider>
    </ErrorBoundary>
);

export default CreateCampaign;
