import React, { useState, useEffect } from 'react';
import { Sparkles, Loader2, RotateCcw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useBrands } from '../context/BrandContext';
import { useToast } from '../context/ToastContext';
import { getPersonas, generateModelComparison } from '../lib/personaApi';

const POST_TYPE_COLORS = {
  origin_story: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
  update: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
  milestone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  gratitude: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  for_anyone_struggling: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
};

function PostCard({ post, index }) {
  const typeColor = POST_TYPE_COLORS[post.post_type] || 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300';
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-3">
      <div className="flex items-center gap-2">
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${typeColor}`}>
          {post.post_type?.replace(/_/g, ' ')}
        </span>
        <span className="text-xs text-gray-400 dark:text-gray-500">#{index + 1}</span>
      </div>
      {post.headline && (
        <h4 className="font-semibold text-gray-900 dark:text-gray-100 text-base leading-snug">
          {post.headline}
        </h4>
      )}
      <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-line">
        {post.body_text}
      </p>
    </div>
  );
}

export default function ModelCompare() {
  const { authFetch } = useAuth();
  const { brands } = useBrands();
  const { showError } = useToast();

  const [selectedBrandId, setSelectedBrandId] = useState('');
  const [personas, setPersonas] = useState([]);
  const [selectedPersonaId, setSelectedPersonaId] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingPersonas, setLoadingPersonas] = useState(false);
  const [results, setResults] = useState(null);

  // Fetch personas when brand changes
  useEffect(() => {
    if (!selectedBrandId) {
      setPersonas([]);
      setSelectedPersonaId('');
      return;
    }
    let cancelled = false;
    setLoadingPersonas(true);
    getPersonas(authFetch, { brandId: selectedBrandId, isActive: true })
      .then((data) => {
        if (!cancelled) {
          setPersonas(data);
          setSelectedPersonaId('');
        }
      })
      .catch(() => {
        if (!cancelled) showError('Failed to load personas');
      })
      .finally(() => {
        if (!cancelled) setLoadingPersonas(false);
      });
    return () => { cancelled = true; };
  }, [selectedBrandId, authFetch]);

  const handleGenerate = async () => {
    if (!selectedPersonaId) return;
    setLoading(true);
    setResults(null);
    try {
      const data = await generateModelComparison(authFetch, selectedPersonaId);
      setResults(data);
    } catch (err) {
      showError(err.message || 'Generation failed');
    } finally {
      setLoading(false);
    }
  };

  const handleRunAnother = () => {
    setResults(null);
    setSelectedPersonaId('');
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center">
          <Sparkles size={20} className="text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Sonnet vs Opus</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Compare ad copy quality side by side</p>
        </div>
      </div>

      {/* Controls */}
      {!results && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Brand selector */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Brand</label>
              <select
                value={selectedBrandId}
                onChange={(e) => setSelectedBrandId(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                disabled={loading}
              >
                <option value="">Select a brand...</option>
                {(brands || []).map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>

            {/* Persona selector */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Persona</label>
              <select
                value={selectedPersonaId}
                onChange={(e) => setSelectedPersonaId(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                disabled={loading || !selectedBrandId || loadingPersonas}
              >
                <option value="">
                  {loadingPersonas ? 'Loading personas...' : !selectedBrandId ? 'Select a brand first...' : 'Select a persona...'}
                </option>
                {personas.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.age}, {p.location_city})</option>
                ))}
              </select>
            </div>
          </div>

          <button
            onClick={handleGenerate}
            disabled={loading || !selectedPersonaId}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 text-white font-medium rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
            {loading ? 'Generating...' : 'Generate Comparison'}
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-12 text-center space-y-4">
          <Loader2 size={40} className="animate-spin text-purple-500 mx-auto" />
          <div>
            <p className="text-lg font-medium text-gray-900 dark:text-gray-100">Generating with Sonnet, then Opus...</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">This takes about 30 seconds</p>
          </div>
        </div>
      )}

      {/* Results */}
      {results && (
        <div className="space-y-4">
          {/* Persona info + run another */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <div>
              <span className="text-sm text-gray-500 dark:text-gray-400">Persona:</span>{' '}
              <span className="font-semibold text-gray-900 dark:text-gray-100">{results.persona_name}</span>
              {results.persona_details?.brand_name && (
                <span className="ml-2 text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-full">
                  {results.persona_details.brand_name}
                </span>
              )}
              <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">
                {results.persona_details?.age}yo {results.persona_details?.gender} - {results.persona_details?.location}
              </span>
            </div>
            <button
              onClick={handleRunAnother}
              className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 font-medium rounded-lg transition-colors text-sm"
            >
              <RotateCcw size={16} />
              Run Another
            </button>
          </div>

          {/* Cost Breakdown */}
          {results.costs && (
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Cost Breakdown (this comparison)</h3>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
                <div className="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-3">
                  <div className="text-xs text-blue-600 dark:text-blue-400 font-medium mb-1">Sonnet</div>
                  <div className="text-lg font-bold text-gray-900 dark:text-gray-100">${results.costs.sonnet?.total_cost?.toFixed(4)}</div>
                  <div className="text-xs text-gray-500">{results.costs.sonnet?.input_tokens?.toLocaleString()} in / {results.costs.sonnet?.output_tokens?.toLocaleString()} out</div>
                </div>
                <div className="bg-purple-50 dark:bg-purple-950/30 rounded-lg p-3">
                  <div className="text-xs text-purple-600 dark:text-purple-400 font-medium mb-1">Opus</div>
                  <div className="text-lg font-bold text-gray-900 dark:text-gray-100">${results.costs.opus?.total_cost?.toFixed(4)}</div>
                  <div className="text-xs text-gray-500">{results.costs.opus?.input_tokens?.toLocaleString()} in / {results.costs.opus?.output_tokens?.toLocaleString()} out</div>
                </div>
                <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                  <div className="text-xs text-gray-600 dark:text-gray-400 font-medium mb-1">Opus costs</div>
                  <div className="text-lg font-bold text-gray-900 dark:text-gray-100">{results.costs.summary?.opus_multiplier}x more</div>
                  <div className="text-xs text-gray-500">+${results.costs.summary?.difference?.toFixed(4)} per persona</div>
                </div>
                <div className="bg-amber-50 dark:bg-amber-950/30 rounded-lg p-3">
                  <div className="text-xs text-amber-600 dark:text-amber-400 font-medium mb-1">At scale (44 personas)</div>
                  <div className="text-xs text-gray-700 dark:text-gray-300 mt-1">Sonnet: <strong>${results.costs.summary?.cost_per_44_personas_sonnet}</strong></div>
                  <div className="text-xs text-gray-700 dark:text-gray-300">Opus: <strong>${results.costs.summary?.cost_per_44_personas_opus}</strong></div>
                </div>
              </div>
            </div>
          )}

          {/* Two-column comparison */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Sonnet column */}
            <div className="space-y-3">
              <div className="bg-blue-50 dark:bg-blue-950/30 rounded-xl border border-blue-200 dark:border-blue-800 p-4">
                <h3 className="text-lg font-bold text-blue-700 dark:text-blue-300 flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-blue-500" />
                  Sonnet
                  <span className="text-xs font-normal text-blue-500 dark:text-blue-400 ml-1">claude-sonnet-4-5</span>
                </h3>
              </div>
              <div className="space-y-3">
                {(results.sonnet || []).map((post, i) => (
                  <div key={i} className="bg-blue-50/30 dark:bg-blue-950/10 rounded-xl p-1">
                    <PostCard post={post} index={i} />
                  </div>
                ))}
              </div>
            </div>

            {/* Opus column */}
            <div className="space-y-3">
              <div className="bg-purple-50 dark:bg-purple-950/30 rounded-xl border border-purple-200 dark:border-purple-800 p-4">
                <h3 className="text-lg font-bold text-purple-700 dark:text-purple-300 flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-purple-500" />
                  Opus
                  <span className="text-xs font-normal text-purple-500 dark:text-purple-400 ml-1">claude-opus-4-6</span>
                </h3>
              </div>
              <div className="space-y-3">
                {(results.opus || []).map((post, i) => (
                  <div key={i} className="bg-purple-50/30 dark:bg-purple-950/10 rounded-xl p-1">
                    <PostCard post={post} index={i} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
