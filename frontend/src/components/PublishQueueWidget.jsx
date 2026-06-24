import React, { useState, useEffect, useRef } from 'react';
import { Loader, CheckCircle2, AlertTriangle, X, ChevronUp, ChevronDown, Megaphone } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

export default function PublishQueueWidget() {
    const { authFetch } = useAuth();
    const [batch, setBatch] = useState(null);
    const [minimized, setMinimized] = useState(false);
    const [dismissed, setDismissed] = useState(false);
    const dismissedId = useRef(null);
    const handleDismissRef = useRef(null);

    // Poll for active batch. Fast (5s) while a batch is in-flight so progress
    // updates feel responsive; slow (30s) otherwise to preserve Facebook API quota.
    useEffect(() => {
        let interval;
        let inFlight = false;

        const checkBatch = async () => {
            if (inFlight) return;
            inFlight = true;
            try {
                const res = await authFetch(`${API_URL}/facebook/publish-batches/active`);
                if (res.ok) {
                    const data = await res.json();
                    if (data && data.id) {
                        if (data.id !== dismissedId.current) {
                            setDismissed(false);
                        }
                        setBatch(data);
                    } else {
                        setBatch(null);
                    }
                } else {
                    setBatch(null);
                }
            } catch {
                // Ignore errors silently
            } finally {
                inFlight = false;
            }
        };

        checkBatch();
        const pollMs = batch && batch.status === 'in_progress' ? 5000 : 30000;
        interval = setInterval(checkBatch, pollMs);

        return () => clearInterval(interval);
    }, [authFetch, batch?.status]);

    // Auto-dismiss successful batches after 15 seconds
    useEffect(() => {
        if (batch && batch.status === 'completed' && !dismissed) {
            const timer = setTimeout(() => {
                handleDismissRef.current?.();
            }, 15000);
            return () => clearTimeout(timer);
        }
    }, [batch?.status, batch?.id, dismissed]);

    // Don't render if no batch or dismissed
    if (!batch || dismissed) return null;

    const total = batch.total_ads || 0;
    const completed = batch.completed_ads || 0;
    const failed = batch.failed_ads || 0;
    const processed = completed + failed;
    const progress = total > 0 ? (processed / total) * 100 : 0;
    const isProcessing = batch.status === 'in_progress';
    const isDone = batch.status === 'completed';
    const isPartial = batch.status === 'partial';
    const campaignName = batch.campaign_data?.name || 'Campaign';

    // Find the currently in-flight ad (first one not yet created/failed) and its stage
    const STAGE_LABELS = {
        uploading_to_fb: 'Uploading video to Facebook',
        creating_creative: 'Creating ad creative',
        creating_ad: 'Creating ad',
    };
    const inFlightAd = isProcessing
        ? (batch.ads_data || []).find(a => a.publishStatus !== 'created' && a.publishStatus !== 'failed')
        : null;
    const stageLabel = inFlightAd?.stage ? STAGE_LABELS[inFlightAd.stage] || inFlightAd.stage : null;

    const handleDismiss = async () => {
        // Mark batch as discarded in DB so /active endpoint stops returning it
        dismissedId.current = batch.id;
        setDismissed(true);
        setBatch(null);
        try {
            await authFetch(`${API_URL}/facebook/publish-batches/${batch.id}`, {
                method: 'DELETE',
            });
        } catch { /* ignore */ }
    };
    handleDismissRef.current = handleDismiss;

    // Minimized view — just a small pill
    if (minimized) {
        return (
            <div
                onClick={() => setMinimized(false)}
                className={`fixed bottom-4 right-4 z-50 flex items-center gap-2 px-4 py-2 rounded-full shadow-lg cursor-pointer transition-all hover:scale-105 ${
                    isProcessing ? 'bg-amber-600 text-white' :
                    isDone ? 'bg-green-600 text-white' :
                    'bg-red-600 text-white'
                }`}
            >
                {isProcessing && <Loader size={16} className="animate-spin" />}
                {isDone && <CheckCircle2 size={16} />}
                {isPartial && <AlertTriangle size={16} />}
                <span className="text-sm font-medium">
                    {isProcessing ? `Publishing ${processed}/${total}` :
                     isDone ? `${total} ads published` :
                     `${completed}/${total} published`}
                </span>
                <ChevronUp size={14} />
            </div>
        );
    }

    return (
        <div className="fixed bottom-4 right-4 z-50 w-80 bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden">
            {/* Header */}
            <div className={`flex items-center justify-between px-4 py-3 ${
                isProcessing ? 'bg-amber-50 border-b border-amber-100' :
                isDone ? 'bg-green-50 border-b border-green-100' :
                'bg-red-50 border-b border-red-100'
            }`}>
                <div className="flex items-center gap-2">
                    <Megaphone size={16} className={
                        isProcessing ? 'text-amber-600' :
                        isDone ? 'text-green-600' :
                        'text-red-600'
                    } />
                    <span className="text-sm font-semibold text-gray-800">
                        {isProcessing ? 'Publishing Ads...' :
                         isDone ? 'All Ads Published!' :
                         'Publishing Complete'}
                    </span>
                </div>
                <div className="flex items-center gap-1">
                    <button onClick={() => setMinimized(true)} className="p-1 text-gray-400 hover:text-gray-600 rounded">
                        <ChevronDown size={16} />
                    </button>
                    {!isProcessing && (
                        <button onClick={handleDismiss} className="p-1 text-gray-400 hover:text-gray-600 rounded">
                            <X size={16} />
                        </button>
                    )}
                </div>
            </div>

            {/* Body */}
            <div className="p-4 space-y-3">
                <div className="text-xs text-gray-500 truncate">{campaignName}</div>

                {/* Progress Bar */}
                <div className="space-y-1">
                    <div className="flex justify-between text-xs text-gray-600">
                        <span>{processed} of {total} ads</span>
                        <span>{Math.round(progress)}%</span>
                    </div>
                    <div className="bg-gray-100 rounded-full h-2 overflow-hidden">
                        <div
                            className={`h-full rounded-full transition-all duration-500 ${
                                isProcessing ? 'bg-amber-500' :
                                isDone ? 'bg-green-500' :
                                'bg-red-500'
                            }`}
                            style={{ width: `${progress}%` }}
                        />
                    </div>
                </div>

                {/* Stats */}
                <div className="flex gap-3 text-xs">
                    {completed > 0 && (
                        <span className="flex items-center gap-1 text-green-600">
                            <CheckCircle2 size={12} /> {completed} created
                        </span>
                    )}
                    {failed > 0 && (
                        <span className="flex items-center gap-1 text-red-600">
                            <AlertTriangle size={12} /> {failed} failed
                        </span>
                    )}
                    {isProcessing && processed < total && (
                        <span className="flex items-center gap-1 text-amber-600">
                            <Loader size={12} className="animate-spin" /> Processing...
                        </span>
                    )}
                </div>

                {/* Current ad stage — visible while a video is uploading to FB / waiting for transcode */}
                {isProcessing && inFlightAd && (
                    <div className="bg-amber-50 border border-amber-100 rounded-lg p-2 text-xs">
                        <div className="font-medium text-amber-900 truncate" title={inFlightAd.name}>
                            Ad {(processed + 1)}: {inFlightAd.name}
                        </div>
                        <div className="text-amber-700 mt-0.5">
                            {stageLabel || 'Queued…'}
                        </div>
                    </div>
                )}

                {/* Error details */}
                {batch.error_log && batch.error_log.length > 0 && !isProcessing && (
                    <div className="bg-red-50 rounded-lg p-2 max-h-24 overflow-y-auto">
                        {batch.error_log.map((err, i) => (
                            <div key={i} className="text-xs text-red-700 py-0.5">
                                <span className="font-medium">{err.adName}:</span> {err.error}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
