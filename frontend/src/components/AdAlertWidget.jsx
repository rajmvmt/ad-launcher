import React, { useState, useEffect, useRef } from 'react';
import { AlertTriangle, X, ChevronUp, ChevronDown, ShieldAlert } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getAdAlerts } from '../lib/facebookApi';

export default function AdAlertWidget() {
    const { authFetch } = useAuth();
    const [alerts, setAlerts] = useState([]);
    const [minimized, setMinimized] = useState(true);
    const [dismissed, setDismissed] = useState(false);
    const lastAccountId = useRef(null);

    // Poll for disapproved ads every 60 seconds
    useEffect(() => {
        let interval;

        const checkAlerts = async () => {
            try {
                // Use the last selected account from Campaign Browser or Dashboard
                const accountId = localStorage.getItem('browser_last_account') || localStorage.getItem('dashboard_last_account');
                const connectionId = localStorage.getItem('browser_last_connection');
                if (!accountId) return;

                // Reset dismissed state if account changed
                if (accountId !== lastAccountId.current) {
                    lastAccountId.current = accountId;
                    setDismissed(false);
                }

                const data = await getAdAlerts(accountId, connectionId || null);
                if (data && data.count > 0) {
                    setAlerts(data.alerts);
                } else {
                    setAlerts([]);
                }
            } catch {
                // Ignore errors silently — don't break the app for monitoring
            }
        };

        // Initial check after 10 seconds (let the app load first)
        const initialTimer = setTimeout(() => {
            checkAlerts();
            interval = setInterval(checkAlerts, 60000);
        }, 10000);

        return () => {
            clearTimeout(initialTimer);
            if (interval) clearInterval(interval);
        };
    }, [authFetch]);

    // Don't render if no alerts or dismissed
    if (alerts.length === 0 || dismissed) return null;

    const rejectedCount = alerts.filter(a => a.status === 'DISAPPROVED').length;
    const issuesCount = alerts.filter(a => a.status === 'WITH_ISSUES').length;

    // Minimized view — red/orange pill
    if (minimized) {
        return (
            <div
                onClick={() => setMinimized(false)}
                className="fixed bottom-20 right-4 z-40 flex items-center gap-2 px-4 py-2 rounded-full shadow-lg cursor-pointer transition-all hover:scale-105 bg-red-600 text-white"
            >
                <ShieldAlert size={16} />
                <span className="text-sm font-medium">
                    {alerts.length} ad{alerts.length !== 1 ? 's' : ''} flagged
                </span>
                <ChevronUp size={14} />
            </div>
        );
    }

    return (
        <div className="fixed bottom-20 right-4 z-40 w-96 bg-white rounded-xl shadow-2xl border border-red-200 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-red-50 border-b border-red-100">
                <div className="flex items-center gap-2">
                    <ShieldAlert size={16} className="text-red-600" />
                    <span className="text-sm font-semibold text-gray-800">
                        Ad Alerts ({alerts.length})
                    </span>
                    {rejectedCount > 0 && (
                        <span className="px-1.5 py-0.5 text-xs font-medium bg-red-100 text-red-700 rounded">
                            {rejectedCount} rejected
                        </span>
                    )}
                    {issuesCount > 0 && (
                        <span className="px-1.5 py-0.5 text-xs font-medium bg-orange-100 text-orange-700 rounded">
                            {issuesCount} issues
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    <button onClick={() => setMinimized(true)} className="p-1 text-gray-400 hover:text-gray-600 rounded">
                        <ChevronDown size={16} />
                    </button>
                    <button onClick={() => setDismissed(true)} className="p-1 text-gray-400 hover:text-gray-600 rounded">
                        <X size={16} />
                    </button>
                </div>
            </div>

            {/* Alert List */}
            <div className="max-h-64 overflow-y-auto divide-y divide-gray-100">
                {alerts.map((alert, i) => (
                    <div key={alert.ad_id || i} className="px-4 py-3 hover:bg-gray-50">
                        <div className="flex items-start gap-2">
                            <AlertTriangle size={14} className={`mt-0.5 flex-shrink-0 ${alert.status === 'DISAPPROVED' ? 'text-red-500' : 'text-orange-500'}`} />
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-900 truncate" title={alert.ad_name}>
                                    {alert.ad_name}
                                </p>
                                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium mt-0.5 ${
                                    alert.status === 'DISAPPROVED'
                                        ? 'bg-red-100 text-red-700'
                                        : 'bg-orange-100 text-orange-700'
                                }`}>
                                    {alert.status === 'DISAPPROVED' ? 'Rejected' : 'Issues'}
                                </span>
                                {alert.reasons && alert.reasons.length > 0 && (
                                    <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                                        {alert.reasons.join('; ')}
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* Footer */}
            <div className="px-4 py-2 bg-gray-50 border-t border-gray-100">
                <a href="/reporting" className="text-xs text-amber-600 hover:text-amber-700 font-medium">
                    View in Campaign Browser →
                </a>
            </div>
        </div>
    );
}
