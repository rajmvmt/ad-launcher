import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import React, { useState } from 'react';
import { ChevronRight, Plus, Trash2, Loader, Film, Image, Shield, CheckCircle, XCircle, RefreshCw, Eye, AlertTriangle, RotateCcw, Link as LinkIcon } from 'lucide-react';
import AdPreview from './AdPreview';
import { useCampaign } from '../context/CampaignContext';
import { createFacebookCampaign, createFacebookAdSet, runPreflightCheck } from '../lib/facebookApi';
import { uploadFileWithProgress } from '../lib/uploadFile';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

const BulkAdCreation = ({ onNext, onBack }) => {
    const { showWarning, showError } = useToast();
    const { authFetch } = useAuth();
    const { campaignData, setCampaignData, adsetData, setAdsetData, creativeData, setCreativeData, adsData, setAdsData, selectedAdAccount, selectedConnection, setAddingNewAd } = useCampaign();
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState({ current: 0, total: 0, status: '' });
    const [errors, setErrors] = useState([]);
    const [preflightResults, setPreflightResults] = useState(null); // { passed, checks }
    const [preflightLoading, setPreflightLoading] = useState(false);
    const [previewingAd, setPreviewingAd] = useState(null); // ad object being previewed
    const [pageName, setPageName] = useState('');
    const [pageAvatarUrl, setPageAvatarUrl] = useState('');
    const [batchId, setBatchId] = useState(null);
    const [activeBatch, setActiveBatch] = useState(null);
    const [adStatuses, setAdStatuses] = useState({}); // { adId: 'pending'|'creating'|'created'|'failed' }
    const [uploadPct, setUploadPct] = useState({}); // { creativeId: 0..100 }
    const [uploadStats, setUploadStats] = useState({}); // { creativeId: { loaded, total, lastTickAt, startedAt, stalled } }

    // Upload helper imported from ../lib/uploadFile — chunked multipart with
    // automatic fallback to single-POST when /uploads/multipart/* is missing.

    // Tick once per second to recompute stalled state for in-flight uploads
    React.useEffect(() => {
        const inflight = Object.keys(uploadPct).some(id => uploadPct[id] >= 0 && uploadPct[id] < 100);
        if (!inflight) return;
        const t = setInterval(() => {
            setUploadStats(prev => {
                const now = Date.now();
                const next = { ...prev };
                let changed = false;
                Object.keys(prev).forEach(id => {
                    const s = prev[id];
                    if (!s || s.loaded >= s.total) return;
                    const stalled = now - s.ts > 15000; // 15s without bytes
                    if (stalled !== s.stalled) {
                        next[id] = { ...s, stalled };
                        changed = true;
                    }
                });
                return changed ? next : prev;
            });
        }, 1000);
        return () => clearInterval(t);
    }, [uploadPct]);


    // Fetch page name and avatar for preview
    React.useEffect(() => {
        if (creativeData.pageId) {
            import('../lib/facebookApi').then(({ getPageInfo, getPagePicture }) => {
                getPageInfo(creativeData.pageId)
                    .then(info => setPageName(info.name || ''))
                    .catch(() => {});
                getPagePicture(creativeData.pageId)
                    .then(data => setPageAvatarUrl(data.url || ''))
                    .catch(() => {});
            });
        }
    }, [creativeData.pageId]);

    // Check for active (incomplete) batch on mount — restore wizard context
    React.useEffect(() => {
        const checkActiveBatch = async () => {
            try {
                const res = await authFetch(`${API_URL}/facebook/publish-batches/active`);
                if (res.ok) {
                    const batch = await res.json();
                    if (batch && batch.id) {
                        setActiveBatch(batch);
                        // Populate wizard context from batch so Back navigation works
                        if (batch.campaign_data) {
                            setCampaignData(prev => ({
                                ...prev,
                                ...batch.campaign_data,
                                fbCampaignId: batch.fb_campaign_id || batch.campaign_data.fbCampaignId || prev.fbCampaignId,
                                isExisting: !!batch.fb_campaign_id,
                            }));
                        }
                        if (batch.adset_data) {
                            setAdsetData(prev => ({
                                ...prev,
                                ...batch.adset_data,
                                fbAdsetId: batch.fb_adset_id || batch.adset_data.fbAdsetId || prev.fbAdsetId,
                                isExisting: !!batch.fb_adset_id,
                            }));
                        }
                        if (batch.creative_data) {
                            setCreativeData(prev => ({ ...prev, ...batch.creative_data }));
                        }
                        if (batch.ads_data) {
                            setAdsData(batch.ads_data);
                        }
                    }
                }
            } catch (e) {
                console.error('Error checking active batch:', e);
            }
        };
        checkActiveBatch();
    }, []);

    const discardBatch = async () => {
        if (activeBatch) {
            try {
                await authFetch(`${API_URL}/facebook/publish-batches/${activeBatch.id}`, { method: 'DELETE' });
            } catch (e) { console.error(e); }
            setActiveBatch(null);
        }
    };

    const resumeBatch = async () => {
        if (!activeBatch) return;
        const batch = activeBatch;
        setActiveBatch(null);
        setLoading(true);
        setErrors([]);

        try {
            // Reset failed ads back to pending so the backend retries them
            const batchAds = batch.ads_data || [];
            const hasFailedAds = batchAds.some(a => a.publishStatus === 'failed');
            if (hasFailedAds) {
                const resetAds = batchAds.map(a =>
                    a.publishStatus === 'failed' ? { ...a, publishStatus: 'pending', error: undefined } : a
                );
                await authFetch(`${API_URL}/facebook/publish-batches/${batch.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ads_data: resetAds,
                        failed_ads: 0,
                        error_log: [],
                        status: 'in_progress'
                    })
                });
            }

            // Kick off background processing
            const processRes = await authFetch(`${API_URL}/facebook/publish-batches/${batch.id}/process`, {
                method: 'POST',
            });

            if (!processRes.ok) {
                const err = await processRes.json().catch(() => ({}));
                throw new Error(err.detail || 'Failed to resume background publishing');
            }

            setLoading(false);
            onNext();
        } catch (error) {
            console.error('Resume batch error:', error);
            showError(`Resume failed: ${error.message}`);
            setLoading(false);
        }
    };

    // Initialize ads based on creatives - generate all permutations
    React.useEffect(() => {
        if (creativeData.creatives && creativeData.creatives.length > 0) {
            const permutations = [];

            if (creativeData.creativeMode === 'per_creative') {
                // Per-creative mode: each creative has its own headlines/bodies
                creativeData.creatives.forEach((creative, creativeIndex) => {
                    const isExistingPost = !!creative.existing_post_id;
                    const isVideo = creative.mediaType === 'video';
                    const mediaLabel = isExistingPost ? 'Post' : (isVideo ? 'Video' : 'Image');

                    if (isExistingPost) {
                        // Existing-post creative: one ad, no copy permutations
                        permutations.push({
                            id: `ad_${Date.now()}_${creativeIndex}_post`,
                            name: creative.name || `Post ${creativeIndex + 1}`,
                            creativeId: creative.id,
                            headlineIndex: 0,
                            bodyIndex: 0,
                            mediaType: 'existing',
                            useDefaultCreative: true,
                            perCreative: true,
                            websiteUrl: ''
                        });
                        return;
                    }

                    const validHeadlines = (creative.headlines || ['']).filter(h => h && h.trim() !== '');
                    const validBodies = (creative.bodies || ['']).filter(b => b && b.trim() !== '');

                    validHeadlines.forEach((headline, hIndex) => {
                        validBodies.forEach((body, bIndex) => {
                            permutations.push({
                                id: `ad_${Date.now()}_${creativeIndex}_${hIndex}_${bIndex}`,
                                name: `${creative.name || `${mediaLabel} ${creativeIndex + 1}`}${validHeadlines.length > 1 || validBodies.length > 1 ? ` - H${hIndex + 1}B${bIndex + 1}` : ''}`,
                                creativeId: creative.id,
                                headlineIndex: hIndex,
                                bodyIndex: bIndex,
                                mediaType: creative.mediaType || 'image',
                                useDefaultCreative: true,
                                perCreative: true,
                                websiteUrl: ''
                            });
                        });
                    });
                });
            } else {
                // Standard mode: shared headlines/bodies across all creatives
                const validHeadlines = (creativeData.headlines || []).filter(h => h && h.trim() !== '');
                const validBodies = (creativeData.bodies || []).filter(b => b && b.trim() !== '');

                creativeData.creatives.forEach((creative, creativeIndex) => {
                    const isExistingPost = !!creative.existing_post_id;
                    if (isExistingPost) {
                        permutations.push({
                            id: `ad_${Date.now()}_${creativeIndex}_post`,
                            name: creative.name || `Post ${creativeIndex + 1}`,
                            creativeId: creative.id,
                            headlineIndex: 0,
                            bodyIndex: 0,
                            mediaType: 'existing',
                            useDefaultCreative: true,
                            websiteUrl: ''
                        });
                        return;
                    }
                    validHeadlines.forEach((headline, hIndex) => {
                        validBodies.forEach((body, bIndex) => {
                            const isVideo = creative.mediaType === 'video';
                            const mediaLabel = isVideo ? 'Video' : 'Image';
                            permutations.push({
                                id: `ad_${Date.now()}_${creativeIndex}_${hIndex}_${bIndex}`,
                                name: `${creative.name || `${mediaLabel} ${creativeIndex + 1}`} - H${hIndex + 1}B${bIndex + 1}`,
                                creativeId: creative.id,
                                headlineIndex: hIndex,
                                bodyIndex: bIndex,
                                mediaType: creative.mediaType || 'image',
                                useDefaultCreative: true,
                                websiteUrl: ''
                            });
                        });
                    });
                });
            }

            setAdsData(permutations);
        } else {
            setAdsData([]);
        }
    }, [creativeData.creatives, creativeData.headlines, creativeData.bodies, creativeData.creativeMode]);

    const addAd = () => {
        // Clone from the last ad's creative or fall back to the first creative
        const lastAd = adsData[adsData.length - 1];
        const creative = creativeData.creatives?.find(c => c.id === lastAd?.creativeId) || creativeData.creatives?.[0];
        const isPerCreative = creativeData.creativeMode === 'per_creative';

        setAdsData(prev => [
            ...prev,
            {
                id: `ad_${Date.now()}_${prev.length}`,
                name: `${creative?.name || 'Ad'} ${prev.length + 1}`,
                creativeId: creative?.id,
                headlineIndex: 0,
                bodyIndex: 0,
                mediaType: creative?.mediaType || 'image',
                useDefaultCreative: true,
                websiteUrl: '',
                ...(isPerCreative ? { perCreative: true } : {})
            }
        ]);
    };

    const removeAd = (index) => {
        setAdsData(prev => prev.filter((_, i) => i !== index));
    };

    const updateAdName = (index, name) => {
        setAdsData(prev => prev.map((ad, i) => i === index ? { ...ad, name } : ad));
    };

    const updateAdUrl = (index, websiteUrl) => {
        setAdsData(prev => prev.map((ad, i) => i === index ? { ...ad, websiteUrl } : ad));
    };

    const handlePreflight = async () => {
        setPreflightLoading(true);
        setPreflightResults(null);
        try {
            const results = await runPreflightCheck(creativeData.pageId, selectedAdAccount?.accountId, selectedConnection?.id);
            setPreflightResults(results);
            return results.passed;
        } catch (error) {
            console.error('Pre-flight check failed:', error);
            setPreflightResults({
                passed: false,
                checks: [{
                    name: 'connection',
                    label: 'Backend connection',
                    passed: false,
                    detail: error.message
                }]
            });
            return false;
        } finally {
            setPreflightLoading(false);
        }
    };


    const handleSubmit = async () => {
        if (adsData.length === 0) {
            showWarning('Please add at least one ad');
            return;
        }

        // Run pre-flight check first
        setLoading(true);
        setErrors([]);
        setProgress({ current: 0, total: adsData.length, status: 'Running pre-flight checks...' });

        const passed = await handlePreflight();
        if (!passed) {
            setLoading(false);
            showError('Pre-flight checks failed. Fix the issues above before publishing.');
            return;
        }

        setProgress({ current: 0, total: adsData.length, status: 'Starting...' });

        // Initialize all ad statuses to pending
        const initialStatuses = {};
        adsData.forEach(ad => { initialStatuses[ad.id] = 'pending'; });
        setAdStatuses(initialStatuses);

        try {
            // Step 1: Create Facebook Campaign (if new)
            let fbCampaignId = campaignData.fbCampaignId;
            if (!campaignData.isExisting) {
                setProgress(prev => ({ ...prev, status: 'Creating campaign on Facebook...' }));
                fbCampaignId = await createFacebookCampaign(campaignData, selectedAdAccount.accountId, selectedConnection?.id);
            }

            // Save Campaign Locally (Ensure it exists in DB for FK constraints)
            try {
                const saveCampRes = await authFetch(`${API_URL}/facebook/campaigns/save`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ...campaignData,
                        fbCampaignId: fbCampaignId,
                        // Ensure budget fields are numbers
                        dailyBudget: Number(campaignData.dailyBudget)
                    })
                });
                if (!saveCampRes.ok) {
                    const err = await saveCampRes.json();
                    throw new Error(`Failed to save campaign locally: ${err.detail || err.message}`);
                }
            } catch (err) {
                console.error('Error saving campaign locally:', err);
                throw err; // Stop execution
            }

            // Step 2: Create Facebook Ad Set (if new)
            let fbAdsetId = adsetData.fbAdsetId;
            if (!adsetData.isExisting) {
                setProgress(prev => ({ ...prev, status: 'Creating ad set on Facebook...' }));

                // For CBO campaigns, pass the bid strategy and bid amount from campaign level
                const adsetPayload = {
                    ...adsetData,
                    // Override bid strategy and amount with campaign-level values for CBO
                    ...(campaignData.budgetType === 'CBO' && {
                        bidStrategy: campaignData.bidStrategy,
                        bidAmount: campaignData.bidAmount
                    })
                };

                fbAdsetId = await createFacebookAdSet(adsetPayload, fbCampaignId, selectedAdAccount.accountId, campaignData.budgetType, selectedConnection?.id);
            }

            // Save Ad Set Locally (Ensure it exists in DB for FK constraints)
            try {
                const saveAdSetRes = await authFetch(`${API_URL}/facebook/adsets/save`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        ...adsetData,
                        campaignId: campaignData.id, // Use the ID we have in context (local or FB)
                        fbAdsetId: fbAdsetId,
                        // Ensure numeric fields
                        dailyBudget: adsetData.dailyBudget ? Number(adsetData.dailyBudget) : null,
                        bidAmount: adsetData.bidAmount ? Number(adsetData.bidAmount) : null
                    })
                });
                if (!saveAdSetRes.ok) {
                    const err = await saveAdSetRes.json();
                    throw new Error(`Failed to save ad set locally: ${err.detail || err.message}`);
                }
            } catch (err) {
                console.error('Error saving ad set locally:', err);
                throw err; // Stop execution
            }

            // Step 2.5: Upload local files (blob URLs) to R2 before creating batch
            const isBlobUrl = (url) => url && url.startsWith('blob:');
            const needsUpload = (c) => c.file && (isBlobUrl(c.previewUrl) || isBlobUrl(c.imageUrl) || isBlobUrl(c.videoUrl));
            const toUpload = (creativeData.creatives || []).filter(needsUpload);
            const stuckBlob = (creativeData.creatives || []).filter(c => !c.file && (isBlobUrl(c.previewUrl) || isBlobUrl(c.imageUrl) || isBlobUrl(c.videoUrl)));
            if (stuckBlob.length > 0) {
                throw new Error(`${stuckBlob.length} creative(s) lost their file after a refresh. Remove and re-upload: ${stuckBlob.map(c => c.name).join(', ')}`);
            }

            setProgress({ current: 0, total: toUpload.length, status: 'Uploading media files...' });
            const uploadResults = new Map();
            const uploadFailures = [];
            // Sequential per-video: each file already saturates upstream via 4
            // parallel parts, and a stall only blocks the current file.
            for (let i = 0; i < toUpload.length; i++) {
                const c = toUpload[i];
                setUploadPct(prev => ({ ...prev, [c.id]: 0 }));
                setUploadStats(prev => ({ ...prev, [c.id]: { loaded: 0, total: c.file.size, ts: Date.now(), stalled: false } }));
                try {
                    const { url } = await uploadFileWithProgress(c.file, authFetch, {
                        onProgress: (pct) => setUploadPct(prev => ({ ...prev, [c.id]: pct })),
                        onStats: ({ loaded, total, ts }) => setUploadStats(prev => ({ ...prev, [c.id]: { loaded, total, ts, stalled: false } })),
                    });
                    uploadResults.set(c.id, url);
                } catch (e) {
                    console.warn(`Upload error for ${c.name}:`, e);
                    setUploadPct(prev => ({ ...prev, [c.id]: -1 }));
                    uploadFailures.push(`${c.name}: ${e.message}`);
                    break; // Don't keep uploading after a failure
                } finally {
                    setProgress(prev => ({ ...prev, current: i + 1 }));
                }
            }
            if (uploadFailures.length > 0) {
                throw new Error(`Upload failed for ${uploadFailures.length} of ${toUpload.length} files. ${uploadFailures.join('; ')}`);
            }
            const uploadedCreatives = (creativeData.creatives || []).map((c) => {
                const url = uploadResults.get(c.id);
                if (!url) return c;
                const isVideo = c.mediaType === 'video';
                return {
                    ...c,
                    previewUrl: url,
                    imageUrl: isVideo ? c.imageUrl : url,
                    videoUrl: isVideo ? url : c.videoUrl,
                };
            });

            // Serialize creatives without blob File objects (not JSON-safe)
            const serializableCreativeData = {
                ...creativeData,
                websiteUrl: creativeData.websiteUrl,
                creatives: uploadedCreatives.map(c => ({
                    id: c.id,
                    name: c.name,
                    mediaType: c.mediaType,
                    previewUrl: c.previewUrl,
                    imageUrl: c.imageUrl,
                    videoUrl: c.videoUrl,
                    thumbnailUrl: c.thumbnailUrl || null,
                    headlines: c.headlines,
                    bodies: c.bodies,
                    description: c.description,
                    cta: c.cta,
                    variants: c.variants || null,
                    first_comment: c.first_comment || null,
                    existing_post_id: c.existing_post_id || null
                }))
            };
            const batchAdsSnapshot = adsData.map(ad => ({
                ...ad,
                publishStatus: 'pending'
            }));

            let currentBatchId = null;
            try {
                const batchRes = await authFetch(`${API_URL}/facebook/publish-batches`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        fb_campaign_id: fbCampaignId,
                        fb_adset_id: fbAdsetId,
                        campaign_data: campaignData,
                        adset_data: adsetData,
                        creative_data: serializableCreativeData,
                        ads_data: batchAdsSnapshot,
                        connection_id: selectedConnection?.id || null,
                        ad_account_id: selectedAdAccount?.accountId,
                        total_ads: adsData.length
                    })
                });
                if (batchRes.ok) {
                    const batchResult = await batchRes.json();
                    currentBatchId = batchResult.id;
                    setBatchId(currentBatchId);
                }
            } catch (e) {
                console.warn('Failed to create batch snapshot (non-fatal):', e);
            }

            // Step 3: Submit to background queue — no more blocking the UI
            if (!currentBatchId) {
                throw new Error('Failed to create publish batch. Cannot proceed.');
            }

            setProgress({ current: 0, total: adsData.length, status: 'Submitting to publish queue...' });

            const processRes = await authFetch(`${API_URL}/facebook/publish-batches/${currentBatchId}/process`, {
                method: 'POST',
            });

            if (!processRes.ok) {
                const err = await processRes.json().catch(() => ({}));
                throw new Error(err.detail || 'Failed to start background publishing');
            }

            // Ads are now publishing in the background — advance to completion
            setLoading(false);
            onNext();

        } catch (error) {
            console.error('Error in bulk ad creation:', error);
            showError(`Error: ${error.message}`);
            setLoading(false);
        }
    };

    return (
        <div>
            <h2 className="text-2xl font-bold mb-6">Bulk Ad Creation</h2>
            <p className="text-gray-600 mb-6">
                Add multiple ads to be created with the same creative structure. Each ad will use the dynamic creative you configured.
            </p>

            {/* Summary */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                <h3 className="font-semibold text-blue-900 mb-2">Summary</h3>
                <div className="text-sm text-blue-800 space-y-1">
                    <div><strong>Campaign:</strong> {campaignData.name}</div>
                    {campaignData.budgetType === 'CBO' && (
                        <div><strong>Campaign Budget:</strong> ${Number(campaignData.dailyBudget).toFixed(2)} / day</div>
                    )}
                    <div><strong>Ad Set:</strong> {adsetData.name}</div>
                    {campaignData.budgetType === 'ABO' && (
                        <div><strong>Ad Set Budget:</strong> ${Number(adsetData.dailyBudget).toFixed(2)} / day</div>
                    )}
                    <div><strong>Creative Name:</strong> {creativeData.creativeName}</div>
                    <div>
                        <strong>Media:</strong>{' '}
                        {(() => {
                            const images = creativeData.creatives?.filter(c => c.mediaType !== 'video').length || 0;
                            const videos = creativeData.creatives?.filter(c => c.mediaType === 'video').length || 0;
                            const parts = [];
                            if (images > 0) parts.push(`${images} image${images !== 1 ? 's' : ''}`);
                            if (videos > 0) parts.push(`${videos} video${videos !== 1 ? 's' : ''}`);
                            return parts.join(', ') || '0 files';
                        })()}
                    </div>
                    <div><strong>Ad Copy:</strong> {creativeData.creativeMode === 'per_creative' ? 'Per Creative (unique copy per media)' : 'Standard (shared copy across all media)'}</div>
                </div>
            </div>

            {/* Resume Banner — shown when an incomplete batch exists */}
            {activeBatch && !loading && (
                <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 mb-6">
                    <div className="flex items-start gap-3">
                        <AlertTriangle className="text-amber-600 mt-0.5 flex-shrink-0" size={22} />
                        <div className="flex-1">
                            <h3 className="font-semibold text-amber-900 mb-1">Incomplete Publish Detected</h3>
                            <p className="text-sm text-amber-800 mb-3">
                                A previous publish was interrupted.{' '}
                                <strong>{activeBatch.completed_ads || 0}</strong> of <strong>{activeBatch.total_ads || 0}</strong> ads
                                were created{activeBatch.failed_ads > 0 && (<>, <strong className="text-red-600">{activeBatch.failed_ads} failed</strong></>)}.
                                Campaign: <strong>{activeBatch.campaign_data?.name || 'Unknown'}</strong>
                            </p>
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={resumeBatch}
                                    className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg font-medium hover:bg-amber-700 text-sm"
                                >
                                    <RotateCcw size={16} />
                                    Resume Publishing
                                </button>
                                <button
                                    onClick={discardBatch}
                                    className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 text-sm"
                                >
                                    <Trash2 size={16} />
                                    Discard &amp; Start Fresh
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Pre-flight Results Panel */}
            {preflightResults && !loading && (
                <div className={`border rounded-lg p-4 mb-6 ${preflightResults.passed ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <Shield size={20} className={preflightResults.passed ? 'text-green-600' : 'text-red-600'} />
                            <h3 className={`font-semibold ${preflightResults.passed ? 'text-green-900' : 'text-red-900'}`}>
                                Pre-flight {preflightResults.passed ? 'Passed' : 'Failed'}
                            </h3>
                        </div>
                        <button
                            onClick={handlePreflight}
                            disabled={preflightLoading}
                            className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-800"
                        >
                            <RefreshCw size={14} className={preflightLoading ? 'animate-spin' : ''} />
                            Re-run
                        </button>
                    </div>
                    <div className="space-y-2">
                        {preflightResults.checks.map((check) => (
                            <div key={check.name} className="flex items-start gap-2">
                                {check.passed ? (
                                    <CheckCircle size={18} className="text-green-600 mt-0.5 flex-shrink-0" />
                                ) : (
                                    <XCircle size={18} className="text-red-600 mt-0.5 flex-shrink-0" />
                                )}
                                <div>
                                    <span className={`text-sm ${check.passed ? 'text-green-800' : 'text-red-800'}`}>
                                        {check.label}
                                    </span>
                                    {check.detail && (
                                        <p className="text-xs text-red-600 mt-0.5">{check.detail}</p>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {!loading ? (
                <>
                    {/* Ads List */}
                    <div className="space-y-2 mb-4">
                        {adsData.map((ad, index) => {
                            const creative = creativeData.creatives?.find(c => c.id === ad.creativeId);
                            const isVideo = creative?.mediaType === 'video';
                            return (
                                <div key={ad.id} className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200">
                                    {/* Thumbnail */}
                                    {creative && (
                                        <div className="w-12 h-12 rounded overflow-hidden bg-gray-200 flex-shrink-0 relative">
                                            {creative.mediaType === 'existing' ? (
                                                creative.previewUrl ? (
                                                    <>
                                                        <img src={creative.previewUrl} alt="Post thumbnail" className="w-full h-full object-cover" />
                                                        <div className="absolute bottom-0 right-0 bg-blue-700 text-white text-[8px] font-bold px-1 rounded-tl">POST</div>
                                                    </>
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center bg-blue-50 text-[10px] text-blue-700 font-medium">POST</div>
                                                )
                                            ) : isVideo ? (
                                                <>
                                                    <video
                                                        src={creative.previewUrl}
                                                        className="w-full h-full object-cover"
                                                        muted
                                                    />
                                                    <div className="absolute bottom-0 right-0 bg-purple-600 text-white p-0.5 rounded-tl">
                                                        <Film size={10} />
                                                    </div>
                                                </>
                                            ) : (
                                                <>
                                                    <img
                                                        src={creative.previewUrl}
                                                        alt="Thumbnail"
                                                        className="w-full h-full object-cover"
                                                    />
                                                    <div className="absolute bottom-0 right-0 bg-blue-600 text-white p-0.5 rounded-tl">
                                                        <Image size={10} />
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    )}
                                    <div className="flex-1 space-y-2">
                                        <input
                                            type="text"
                                            value={ad.name}
                                            onChange={(e) => updateAdName(index, e.target.value)}
                                            placeholder={`Ad ${index + 1} name`}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                        />
                                        <div className="flex items-center gap-2">
                                            <LinkIcon size={14} className="text-gray-400 flex-shrink-0" />
                                            <input
                                                type="url"
                                                value={ad.websiteUrl || ''}
                                                onChange={(e) => updateAdUrl(index, e.target.value)}
                                                placeholder={creativeData.websiteUrl ? `Override URL (default: ${creativeData.websiteUrl})` : 'Per-ad URL (optional — uses default if blank)'}
                                                className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent bg-white"
                                            />
                                            {ad.websiteUrl && (
                                                <a
                                                    href={ad.websiteUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-xs text-amber-600 hover:text-amber-700 font-medium whitespace-nowrap"
                                                >
                                                    Test
                                                </a>
                                            )}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => setPreviewingAd(ad)}
                                        className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                        title="Preview ad"
                                    >
                                        <Eye size={20} />
                                    </button>
                                    <button
                                        onClick={() => removeAd(index)}
                                        className="p-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                                    >
                                        <Trash2 size={20} />
                                    </button>
                                </div>
                            );
                        })}
                    </div>

                    {/* Add Ad Button — goes back to Ad Creative to add more media/copy */}
                    <button
                        onClick={() => { setAddingNewAd(true); onBack(); }}
                        className="w-full p-4 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-amber-500 hover:text-amber-600 transition-colors flex items-center justify-center gap-2"
                    >
                        <Plus size={20} />
                        Add Another Ad
                    </button>

                    {/* Errors */}
                    {errors.length > 0 && (
                        <div className="mt-6 bg-red-50 border border-red-200 rounded-lg p-4">
                            <h3 className="font-semibold text-red-900 mb-2">Errors</h3>
                            <ul className="text-sm text-red-800 space-y-1">
                                {errors.map((error, index) => (
                                    <li key={index}>• {error}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Navigation */}
                    <div className="mt-8 flex justify-between">
                        <button
                            onClick={onBack}
                            className="px-6 py-3 text-gray-600 hover:text-gray-800 font-medium"
                        >
                            Back
                        </button>
                        <div className="flex items-center gap-3">
                            <button
                                onClick={handlePreflight}
                                disabled={preflightLoading}
                                className="flex items-center gap-2 px-4 py-3 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 disabled:opacity-50"
                            >
                                {preflightLoading ? (
                                    <Loader className="animate-spin" size={16} />
                                ) : (
                                    <Shield size={16} />
                                )}
                                Pre-flight Check
                            </button>
                            <button
                                onClick={handleSubmit}
                                disabled={adsData.length === 0 || (preflightResults && !preflightResults.passed)}
                                className="flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                                title={preflightResults && !preflightResults.passed ? 'Fix pre-flight issues before publishing' : ''}
                            >
                                Create {adsData.length} Ad{adsData.length !== 1 ? 's' : ''} on Facebook
                            </button>
                        </div>
                    </div>
                </>
            ) : (
                <>
                    {/* Progress Indicator */}
                    <div className="text-center py-8">
                        <Loader className="animate-spin mx-auto mb-4 text-blue-600" size={48} />
                        <h3 className="text-xl font-semibold mb-2">{progress.status}</h3>
                        <div className="w-full max-w-md mx-auto bg-gray-200 rounded-full h-3 mb-2">
                            <div
                                className="bg-blue-600 h-3 rounded-full transition-all duration-300"
                                style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }}
                            />
                        </div>
                        <p className="text-gray-600">
                            {progress.current} of {progress.total} {progress.status === 'Uploading media files...' ? 'files' : 'ads'}
                        </p>
                    </div>

                    {/* Per-file upload progress (visible during media upload phase) */}
                    {Object.keys(uploadPct).length > 0 && progress.status === 'Uploading media files...' && (
                        <div className="space-y-2 mt-2 max-w-md mx-auto">
                            {(creativeData.creatives || []).filter(c => c.id in uploadPct).map((c) => {
                                const pct = uploadPct[c.id];
                                const stats = uploadStats[c.id];
                                const failed = pct === -1;
                                const done = pct === 100;
                                const stalled = stats?.stalled && !done && !failed;
                                const fmtMB = (n) => `${(n / 1048576).toFixed(1)}MB`;
                                return (
                                    <div key={c.id} className="text-left">
                                        <div className="flex justify-between text-xs text-gray-600 mb-1">
                                            <span className="truncate pr-2">{c.name || c.file?.name || 'media'}</span>
                                            <span className={failed ? 'text-red-600' : done ? 'text-green-600' : stalled ? 'text-amber-600' : ''}>
                                                {failed ? 'failed' : stalled ? `stalled @ ${pct}%` : `${pct}%`}
                                                {stats && !failed ? ` (${fmtMB(stats.loaded)}/${fmtMB(stats.total)})` : ''}
                                            </span>
                                        </div>
                                        <div className="w-full bg-gray-200 rounded-full h-1.5">
                                            <div
                                                className={`h-1.5 rounded-full transition-all duration-200 ${failed ? 'bg-red-500' : done ? 'bg-green-500' : stalled ? 'bg-amber-500' : 'bg-blue-500'}`}
                                                style={{ width: `${failed ? 100 : pct}%` }}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Per-ad status list during publishing */}
                    {Object.keys(adStatuses).length > 0 && (
                        <div className="space-y-2 mt-4">
                            {adsData.map((ad) => {
                                const status = adStatuses[ad.id] || 'pending';
                                const creative = creativeData.creatives?.find(c => c.id === ad.creativeId);
                                const isVideo = creative?.mediaType === 'video';
                                return (
                                    <div key={ad.id} className={`flex items-center gap-3 p-3 rounded-lg border ${
                                        status === 'created' ? 'bg-green-50 border-green-200' :
                                        status === 'failed' ? 'bg-red-50 border-red-200' :
                                        status === 'creating' ? 'bg-blue-50 border-blue-200' :
                                        'bg-gray-50 border-gray-200'
                                    }`}>
                                        {/* Thumbnail */}
                                        {creative && (
                                            <div className="w-10 h-10 rounded overflow-hidden bg-gray-200 flex-shrink-0 relative">
                                                {isVideo ? (
                                                    <video src={creative.previewUrl} className="w-full h-full object-cover" muted />
                                                ) : (
                                                    <img src={creative.previewUrl} alt="" className="w-full h-full object-cover" />
                                                )}
                                            </div>
                                        )}
                                        <div className="flex-1 min-w-0">
                                            <span className="text-sm font-medium text-gray-900 truncate block">{ad.name}</span>
                                        </div>
                                        {/* Status badge */}
                                        {status === 'pending' && (
                                            <span className="flex items-center gap-1 text-xs font-medium text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                                                Pending
                                            </span>
                                        )}
                                        {status === 'creating' && (
                                            <span className="flex items-center gap-1 text-xs font-medium text-blue-600 bg-blue-100 px-2 py-1 rounded-full">
                                                <Loader className="animate-spin" size={12} /> Creating...
                                            </span>
                                        )}
                                        {status === 'created' && (
                                            <span className="flex items-center gap-1 text-xs font-medium text-green-700 bg-green-100 px-2 py-1 rounded-full">
                                                <CheckCircle size={12} /> Created
                                            </span>
                                        )}
                                        {status === 'failed' && (
                                            <span className="flex items-center gap-1 text-xs font-medium text-red-700 bg-red-100 px-2 py-1 rounded-full" title={errors.find(e => e.includes(ad.name)) || 'Failed'}>
                                                <XCircle size={12} /> Failed
                                            </span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Errors during publish */}
                    {errors.length > 0 && (
                        <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-4">
                            <h3 className="font-semibold text-red-900 mb-2">Errors</h3>
                            <ul className="text-sm text-red-800 space-y-1">
                                {errors.map((error, index) => (
                                    <li key={index}>• {error}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                </>
            )}

            {/* Ad Preview Modal */}
            {previewingAd && (() => {
                const ad = previewingAd;
                const specificCreative = creativeData.creatives?.find(c => c.id === ad.creativeId);
                let previewHeadline, previewBody;
                if (ad.perCreative && specificCreative) {
                    const cHeadlines = (specificCreative.headlines || []).filter(h => h && h.trim());
                    const cBodies = (specificCreative.bodies || []).filter(b => b && b.trim());
                    previewHeadline = cHeadlines[ad.headlineIndex] || cHeadlines[0] || '';
                    previewBody = cBodies[ad.bodyIndex] || cBodies[0] || '';
                } else {
                    previewHeadline = creativeData.headlines?.[ad.headlineIndex] || '';
                    previewBody = creativeData.bodies?.[ad.bodyIndex] || '';
                }
                return (
                    <AdPreview
                        pageName={pageName}
                        pageAvatarUrl={pageAvatarUrl}
                        primaryText={previewBody}
                        headline={previewHeadline}
                        description={ad.perCreative ? (specificCreative?.description || creativeData.description) : creativeData.description}
                        cta={ad.perCreative ? (specificCreative?.cta || creativeData.cta) : creativeData.cta}
                        mediaUrl={specificCreative?.previewUrl || specificCreative?.imageUrl || specificCreative?.videoUrl}
                        mediaType={specificCreative?.mediaType || 'image'}
                        websiteUrl={creativeData.websiteUrl}
                        onClose={() => setPreviewingAd(null)}
                    />
                );
            })()}
        </div>
    );
};

export default BulkAdCreation;
