import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Sparkles, Upload, Bookmark, ChevronDown, ChevronRight, Copy, Check, Loader2, ArrowLeft, ArrowRight, Image, Wand2, Star, AlertTriangle, Eye, Brain, Target, Shield, TrendingUp, Palette, MessageSquare, Users, Zap, BarChart3, RefreshCw } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { useBrands } from '../context/BrandContext';
import { deepAnalyzeSwipe, analyzeUpload, createSimilar, generateSimilarImages } from '../lib/aiAnalyzerApi';
import { getSwipes } from '../lib/swipeFileApi';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

// ── Score Badge ─────────────────────────────────────────────────────

function ScoreBadge({ label, score, size = 'md' }) {
    const color = score >= 8 ? 'text-green-600 bg-green-50 border-green-200'
        : score >= 6 ? 'text-amber-600 bg-amber-50 border-amber-200'
            : 'text-red-600 bg-red-50 border-red-200';
    const sz = size === 'lg' ? 'w-16 h-16 text-2xl' : 'w-12 h-12 text-lg';
    return (
        <div className="flex flex-col items-center gap-1">
            <div className={`${sz} rounded-full border-2 ${color} flex items-center justify-center font-bold`}>
                {score}
            </div>
            <span className="text-xs text-gray-500 text-center leading-tight">{label}</span>
        </div>
    );
}

// ── Collapsible Section ─────────────────────────────────────────────

function AnalysisSection({ title, icon: Icon, color, children, defaultOpen = false }) {
    const [open, setOpen] = useState(defaultOpen);
    const colors = {
        amber: 'bg-amber-50 border-amber-200 text-amber-800',
        red: 'bg-red-50 border-red-200 text-red-800',
        blue: 'bg-blue-50 border-blue-200 text-blue-800',
        green: 'bg-green-50 border-green-200 text-green-800',
        purple: 'bg-purple-50 border-purple-200 text-purple-800',
        teal: 'bg-teal-50 border-teal-200 text-teal-800',
        orange: 'bg-orange-50 border-orange-200 text-orange-800',
        indigo: 'bg-indigo-50 border-indigo-200 text-indigo-800',
    };
    return (
        <div className={`border rounded-lg overflow-hidden ${open ? '' : ''}`}>
            <button
                onClick={() => setOpen(!open)}
                className={`w-full flex items-center gap-2 px-4 py-3 font-semibold text-sm ${colors[color] || colors.amber}`}
            >
                <Icon size={16} />
                <span className="flex-1 text-left">{title}</span>
                {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
            {open && <div className="px-4 py-3 bg-white text-sm space-y-2">{children}</div>}
        </div>
    );
}

// ── Copy Button ─────────────────────────────────────────────────────

function CopyBtn({ text }) {
    const [copied, setCopied] = useState(false);
    const handleCopy = () => {
        navigator.clipboard.writeText(typeof text === 'object' ? JSON.stringify(text, null, 2) : text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };
    return (
        <button onClick={handleCopy} className="text-gray-400 hover:text-gray-600 ml-2 inline-flex items-center">
            {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
        </button>
    );
}

// ── Field Row ───────────────────────────────────────────────────────

function Field({ label, value }) {
    if (!value) return null;
    const display = Array.isArray(value) ? value.join(', ') : typeof value === 'object' ? JSON.stringify(value) : value;
    return (
        <div className="flex gap-2">
            <span className="font-medium text-gray-600 min-w-[140px] shrink-0">{label}:</span>
            <span className="text-gray-800 flex-1">{display}</span>
            <CopyBtn text={display} />
        </div>
    );
}


// ═══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════

export default function AiAnalyzer() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { showSuccess, showError } = useToast();
    const { brands, customerProfiles } = useBrands();

    // Phase state
    const [phase, setPhase] = useState(1); // 1=select, 2=analysis, 3=create similar

    // Phase 1: Select ad
    const [sourceTab, setSourceTab] = useState('swipe'); // swipe | upload
    const [swipes, setSwipes] = useState([]);
    const [swipesLoading, setSwipesLoading] = useState(false);
    const [swipeSearch, setSwipeSearch] = useState('');
    const [selectedSwipe, setSelectedSwipe] = useState(null);
    const [uploadFile, setUploadFile] = useState(null);
    const [uploadPreview, setUploadPreview] = useState(null);
    const [uploadCopy, setUploadCopy] = useState({ headline: '', primary_text: '', cta_text: '', description: '' });

    // Phase 2: Analysis
    const [analyzing, setAnalyzing] = useState(false);
    const [analysisPass, setAnalysisPass] = useState(''); // 'visual' | 'strategy'
    const [analysis, setAnalysis] = useState(null);

    // Phase 3: Create Similar
    const [selectedBrandId, setSelectedBrandId] = useState('');
    const [selectedProductId, setSelectedProductId] = useState('');
    const [selectedProfileId, setSelectedProfileId] = useState('');
    const [copyModel, setCopyModel] = useState('sonnet');
    const [variationCount, setVariationCount] = useState(3);
    const [generating, setGenerating] = useState(false);
    const [copyVariations, setCopyVariations] = useState([]);
    const [imagePrompt, setImagePrompt] = useState('');
    const [generatingImages, setGeneratingImages] = useState(false);
    const [generatedImages, setGeneratedImages] = useState([]);

    // Load swipes for picker
    const loadSwipes = useCallback(async () => {
        setSwipesLoading(true);
        try {
            const params = {};
            if (swipeSearch) params.search = swipeSearch;
            const data = await getSwipes(params);
            setSwipes(Array.isArray(data) ? data : data.items || []);
        } catch (e) {
            console.error('Failed to load swipes:', e);
        } finally {
            setSwipesLoading(false);
        }
    }, [swipeSearch]);

    useEffect(() => { loadSwipes(); }, [loadSwipes]);

    // Auto-select swipe from URL params
    useEffect(() => {
        const swipeId = searchParams.get('swipe_id');
        if (swipeId && swipes.length > 0) {
            const found = swipes.find(s => s.id === swipeId);
            if (found) {
                setSelectedSwipe(found);
                // If it already has deep_analysis, show it
                if (found.deep_analysis) {
                    setAnalysis(found.deep_analysis);
                    setPhase(2);
                }
            }
        }
    }, [searchParams, swipes]);

    // Upload file handler
    const handleFileUpload = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploadFile(file);
        setUploadPreview(URL.createObjectURL(file));
    };

    // ── Run Analysis ────────────────────────────────────────────────

    const runAnalysis = async () => {
        setAnalyzing(true);
        setAnalysisPass('visual');
        setAnalysis(null);
        setPhase(2);

        try {
            let result;
            if (sourceTab === 'swipe' && selectedSwipe) {
                setAnalysisPass('visual');
                setTimeout(() => setAnalysisPass('strategy'), 8000);
                result = await deepAnalyzeSwipe(selectedSwipe.id);
                setAnalysis(result.deep_analysis);
            } else if (uploadFile) {
                const formData = new FormData();
                formData.append('file', uploadFile);
                if (uploadCopy.headline) formData.append('headline', uploadCopy.headline);
                if (uploadCopy.primary_text) formData.append('primary_text', uploadCopy.primary_text);
                if (uploadCopy.cta_text) formData.append('cta_text', uploadCopy.cta_text);
                if (uploadCopy.description) formData.append('description', uploadCopy.description);
                setAnalysisPass('visual');
                setTimeout(() => setAnalysisPass('strategy'), 8000);
                result = await analyzeUpload(formData);
                setAnalysis(result.deep_analysis);
            } else {
                showError('Select an ad or upload a file first');
                setPhase(1);
                setAnalyzing(false);
                return;
            }
            showSuccess('Deep analysis complete');
        } catch (e) {
            showError(e.message || 'Analysis failed');
            setPhase(1);
        } finally {
            setAnalyzing(false);
            setAnalysisPass('');
        }
    };

    // ── Create Similar ──────────────────────────────────────────────

    const handleCreateSimilar = async () => {
        if (!selectedBrandId || !selectedProductId || !selectedProfileId) {
            showError('Select brand, product, and profile');
            return;
        }
        setGenerating(true);
        try {
            const payload = {
                brand_id: selectedBrandId,
                product_id: selectedProductId,
                profile_id: selectedProfileId,
                variation_count: variationCount,
                model: copyModel,
            };
            if (selectedSwipe) {
                payload.swipe_id = selectedSwipe.id;
            } else {
                payload.deep_analysis = analysis;
            }
            const result = await createSimilar(payload);
            setCopyVariations(result.copy_variations || []);
            setImagePrompt(result.image_prompt || '');
            showSuccess(`Generated ${result.copy_variations?.length || 0} copy variations`);
        } catch (e) {
            showError(e.message || 'Failed to generate similar copy');
        } finally {
            setGenerating(false);
        }
    };

    const handleGenerateImages = async () => {
        if (!imagePrompt.trim()) {
            showError('Image prompt is empty');
            return;
        }
        setGeneratingImages(true);
        try {
            const result = await generateSimilarImages({
                image_prompt: imagePrompt,
                count: 2,
                image_sizes: [
                    { width: 1080, height: 1080, name: '1:1 Square' },
                    { width: 1080, height: 1920, name: '9:16 Story' },
                ],
            });
            setGeneratedImages(result.images || []);
            showSuccess(`Generated ${result.images?.length || 0} images`);
        } catch (e) {
            showError(e.message || 'Image generation failed');
        } finally {
            setGeneratingImages(false);
        }
    };

    // ── Derived Data ────────────────────────────────────────────────

    const selectedBrand = brands.find(b => b.id === selectedBrandId);
    const products = selectedBrand?.products || [];
    const scores = analysis?.scores || {};
    const adPreviewUrl = selectedSwipe?.image_url || selectedSwipe?.thumbnail_url || uploadPreview;
    const isVideo = selectedSwipe?.video_url || (uploadFile && uploadFile.type?.startsWith('video/'));

    // ═════════════════════════════════════════════════════════════════
    // RENDER
    // ═════════════════════════════════════════════════════════════════

    return (
        <div className="max-w-7xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Sparkles className="text-amber-500" size={24} />
                        AI Analyzer
                    </h1>
                    <p className="text-sm text-gray-500 mt-1">Deep-analyze ad creatives, understand why they work, create similar for your brand</p>
                </div>
                {phase > 1 && (
                    <button onClick={() => { setPhase(1); setAnalysis(null); setCopyVariations([]); setGeneratedImages([]); }}
                        className="px-3 py-1.5 text-sm bg-gray-100 rounded-lg hover:bg-gray-200 flex items-center gap-1">
                        <ArrowLeft size={14} /> Start Over
                    </button>
                )}
            </div>

            {/* Phase indicator */}
            <div className="flex items-center gap-2 text-xs">
                {['Select Ad', 'Deep Analysis', 'Create Similar'].map((label, i) => (
                    <React.Fragment key={i}>
                        {i > 0 && <div className="w-8 h-px bg-gray-300" />}
                        <div className={`px-3 py-1 rounded-full font-medium ${phase === i + 1 ? 'bg-amber-100 text-amber-700' : phase > i + 1 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>
                            {i + 1}. {label}
                        </div>
                    </React.Fragment>
                ))}
            </div>

            {/* ─── PHASE 1: SELECT AD ──────────────────────────────── */}
            {phase === 1 && (
                <div className="space-y-4">
                    {/* Tabs */}
                    <div className="flex gap-2">
                        <button onClick={() => setSourceTab('swipe')}
                            className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 ${sourceTab === 'swipe' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                            <Bookmark size={14} /> From Swipe File
                        </button>
                        <button onClick={() => setSourceTab('upload')}
                            className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 ${sourceTab === 'upload' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                            <Upload size={14} /> Upload
                        </button>
                    </div>

                    {/* Swipe File Picker */}
                    {sourceTab === 'swipe' && (
                        <div className="space-y-3">
                            <input
                                type="text" placeholder="Search swipes..."
                                value={swipeSearch} onChange={e => setSwipeSearch(e.target.value)}
                                className="w-full px-3 py-2 border rounded-lg text-sm"
                            />
                            {swipesLoading ? (
                                <div className="flex items-center justify-center py-12 text-gray-400">
                                    <Loader2 size={20} className="animate-spin mr-2" /> Loading swipes...
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 max-h-[500px] overflow-y-auto">
                                    {swipes.map(swipe => (
                                        <div
                                            key={swipe.id}
                                            onClick={() => setSelectedSwipe(swipe)}
                                            className={`border rounded-lg overflow-hidden cursor-pointer transition-all hover:shadow-md ${selectedSwipe?.id === swipe.id ? 'ring-2 ring-amber-500 border-amber-500' : 'border-gray-200'}`}
                                        >
                                            <div className="aspect-square bg-gray-100 relative">
                                                {(swipe.image_url || swipe.thumbnail_url) ? (
                                                    <img src={swipe.image_url || swipe.thumbnail_url} alt="" className="w-full h-full object-cover" />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-gray-300">
                                                        <Image size={32} />
                                                    </div>
                                                )}
                                                {swipe.video_url && (
                                                    <div className="absolute top-2 left-2 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded">Video</div>
                                                )}
                                                {swipe.deep_analysis && (
                                                    <div className="absolute top-2 right-2 bg-amber-500 text-white text-xs px-1.5 py-0.5 rounded flex items-center gap-1">
                                                        <Sparkles size={10} /> Analyzed
                                                    </div>
                                                )}
                                            </div>
                                            <div className="p-2">
                                                <p className="text-xs font-medium text-gray-700 truncate">{swipe.advertiser_name || swipe.headline || 'Unnamed'}</p>
                                                {swipe.category && <span className="text-[10px] text-gray-400">{swipe.category}</span>}
                                            </div>
                                        </div>
                                    ))}
                                    {swipes.length === 0 && !swipesLoading && (
                                        <div className="col-span-full text-center py-8 text-gray-400 text-sm">No swipes found. Save some ads from the Ad Library first.</div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Upload */}
                    {sourceTab === 'upload' && (
                        <div className="space-y-4">
                            <div
                                className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-amber-400 transition-colors cursor-pointer"
                                onClick={() => document.getElementById('ai-analyzer-upload').click()}
                            >
                                {uploadPreview ? (
                                    <div className="space-y-2">
                                        {uploadFile?.type?.startsWith('video/') ? (
                                            <video src={uploadPreview} className="max-h-48 mx-auto rounded" controls />
                                        ) : (
                                            <img src={uploadPreview} alt="Preview" className="max-h-48 mx-auto rounded" />
                                        )}
                                        <p className="text-sm text-gray-500">{uploadFile?.name}</p>
                                    </div>
                                ) : (
                                    <>
                                        <Upload size={32} className="mx-auto text-gray-400 mb-2" />
                                        <p className="text-sm text-gray-500">Click to upload an image or video</p>
                                        <p className="text-xs text-gray-400 mt-1">JPG, PNG, WebP, MP4, MOV</p>
                                    </>
                                )}
                                <input id="ai-analyzer-upload" type="file" accept="image/*,video/*" className="hidden" onChange={handleFileUpload} />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <input type="text" placeholder="Headline (optional)" value={uploadCopy.headline}
                                    onChange={e => setUploadCopy(prev => ({ ...prev, headline: e.target.value }))}
                                    className="px-3 py-2 border rounded-lg text-sm" />
                                <input type="text" placeholder="CTA (optional)" value={uploadCopy.cta_text}
                                    onChange={e => setUploadCopy(prev => ({ ...prev, cta_text: e.target.value }))}
                                    className="px-3 py-2 border rounded-lg text-sm" />
                                <textarea placeholder="Primary text / body copy (optional)" value={uploadCopy.primary_text}
                                    onChange={e => setUploadCopy(prev => ({ ...prev, primary_text: e.target.value }))}
                                    className="col-span-2 px-3 py-2 border rounded-lg text-sm" rows={3} />
                            </div>
                        </div>
                    )}

                    {/* Analyze button */}
                    <div className="flex justify-end">
                        <button
                            onClick={runAnalysis}
                            disabled={sourceTab === 'swipe' ? !selectedSwipe : !uploadFile}
                            className="px-6 py-2.5 bg-amber-500 text-white rounded-lg font-medium hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            <Sparkles size={16} /> Deep Analyze
                        </button>
                    </div>
                </div>
            )}

            {/* ─── PHASE 2: ANALYSIS DISPLAY ───────────────────────── */}
            {phase === 2 && (
                <div className="space-y-4">
                    {/* Loading state */}
                    {analyzing && (
                        <div className="bg-white border rounded-xl p-12 text-center space-y-4">
                            <Loader2 size={40} className="animate-spin mx-auto text-amber-500" />
                            <div>
                                <p className="font-medium text-gray-700">
                                    {analysisPass === 'visual' ? 'Pass 1: Analyzing visuals with Gemini...' : 'Pass 2: Strategic analysis with Claude...'}
                                </p>
                                <p className="text-sm text-gray-400 mt-1">This takes 15-25 seconds</p>
                            </div>
                            <div className="flex justify-center gap-2">
                                <div className={`w-3 h-3 rounded-full ${analysisPass === 'visual' ? 'bg-amber-500 animate-pulse' : 'bg-green-500'}`} />
                                <div className={`w-3 h-3 rounded-full ${analysisPass === 'strategy' ? 'bg-amber-500 animate-pulse' : analysisPass === '' && analysis ? 'bg-green-500' : 'bg-gray-200'}`} />
                            </div>
                        </div>
                    )}

                    {/* Analysis results */}
                    {analysis && !analyzing && (
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                            {/* Left column: ad preview + scores */}
                            <div className="space-y-4">
                                {/* Ad preview */}
                                {adPreviewUrl && (
                                    <div className="border rounded-lg overflow-hidden">
                                        {isVideo ? (
                                            <video src={selectedSwipe?.video_url || uploadPreview} className="w-full" controls poster={adPreviewUrl} />
                                        ) : (
                                            <img src={adPreviewUrl} alt="Ad" className="w-full" />
                                        )}
                                    </div>
                                )}

                                {/* Scores */}
                                {scores.overall && (
                                    <div className="border rounded-lg p-4 space-y-3">
                                        <h3 className="font-semibold text-sm text-gray-700">Scores</h3>
                                        <div className="flex justify-center mb-2">
                                            <ScoreBadge label="Overall" score={scores.overall} size="lg" />
                                        </div>
                                        <div className="grid grid-cols-3 gap-3">
                                            <ScoreBadge label="Hook" score={scores.hook_strength} />
                                            <ScoreBadge label="Copy" score={scores.copy_quality} />
                                            <ScoreBadge label="Visual" score={scores.visual_impact} />
                                            <ScoreBadge label="Offer" score={scores.offer_strength} />
                                            <ScoreBadge label="Audience" score={scores.audience_match} />
                                            <ScoreBadge label="Compliance" score={scores.compliance_safety} />
                                        </div>
                                    </div>
                                )}

                                {/* Actions */}
                                <div className="space-y-2">
                                    <button onClick={() => setPhase(3)}
                                        className="w-full px-4 py-2.5 bg-amber-500 text-white rounded-lg font-medium hover:bg-amber-600 flex items-center justify-center gap-2">
                                        <Wand2 size={16} /> Create Similar
                                    </button>
                                    <button onClick={runAnalysis}
                                        className="w-full px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm hover:bg-gray-200 flex items-center justify-center gap-2">
                                        <RefreshCw size={14} /> Re-analyze
                                    </button>
                                </div>
                            </div>

                            {/* Right column: analysis sections */}
                            <div className="lg:col-span-2 space-y-3">
                                {/* Why It Works - always open */}
                                {analysis.why_it_works_summary && (
                                    <AnalysisSection title="Why It Works" icon={Star} color="amber" defaultOpen={true}>
                                        <div className="whitespace-pre-wrap text-gray-700 leading-relaxed">
                                            {analysis.why_it_works_summary}
                                        </div>
                                        <CopyBtn text={analysis.why_it_works_summary} />
                                    </AnalysisSection>
                                )}

                                {/* Hook Breakdown */}
                                {analysis.hook_analysis && (
                                    <AnalysisSection title="Hook Breakdown" icon={Zap} color="red" defaultOpen={true}>
                                        <Field label="Hook Text" value={analysis.hook_analysis.hook_text} />
                                        <Field label="Hook Type" value={analysis.hook_analysis.hook_type} />
                                        <Field label="Why It Works" value={analysis.hook_analysis.why_it_works} />
                                        <Field label="Strength" value={`${analysis.hook_analysis.hook_strength_score}/10`} />
                                        <Field label="Improvements" value={analysis.hook_analysis.improvement_suggestions} />
                                    </AnalysisSection>
                                )}

                                {/* Visual Strategy */}
                                {analysis.visual_strategy && (
                                    <AnalysisSection title="Visual Strategy" icon={Palette} color="blue">
                                        <Field label="Layout" value={analysis.visual_strategy.layout_type} />
                                        <Field label="Colors" value={analysis.visual_strategy.color_strategy} />
                                        <Field label="Focal Point" value={analysis.visual_strategy.focal_point} />
                                        <Field label="Text in Image" value={analysis.visual_strategy.text_in_image} />
                                        <Field label="Text Placement" value={analysis.visual_strategy.text_placement} />
                                        <Field label="Scroll Stop" value={analysis.visual_strategy.thumbnail_scroll_stop} />
                                        <Field label="Visual Hooks" value={analysis.visual_strategy.visual_hooks} />
                                        <Field label="Production" value={analysis.visual_strategy.production_quality} />
                                        <Field label="Subject" value={analysis.visual_strategy.subject_matter} />
                                    </AnalysisSection>
                                )}

                                {/* Copy Strategy */}
                                {analysis.copy_strategy && (
                                    <AnalysisSection title="Copy Strategy" icon={MessageSquare} color="green">
                                        <Field label="Framework" value={analysis.copy_strategy.framework_used} />
                                        <Field label="Breakdown" value={analysis.copy_strategy.framework_breakdown} />
                                        <Field label="Headline" value={analysis.copy_strategy.headline_analysis} />
                                        <Field label="Body Structure" value={analysis.copy_strategy.body_structure} />
                                        <Field label="CTA" value={analysis.copy_strategy.cta_analysis} />
                                        <Field label="Voice/Tone" value={analysis.copy_strategy.tone_voice} />
                                        <Field label="Power Words" value={analysis.copy_strategy.power_words_used} />
                                        <Field label="Length" value={analysis.copy_strategy.copy_length_assessment} />
                                    </AnalysisSection>
                                )}

                                {/* Psychological Triggers */}
                                {analysis.psychological_triggers && (
                                    <AnalysisSection title="Psychological Triggers" icon={Brain} color="purple">
                                        <Field label="Primary" value={analysis.psychological_triggers.primary_trigger} />
                                        <Field label="How Used" value={analysis.psychological_triggers.primary_trigger_explanation} />
                                        {analysis.psychological_triggers.secondary_triggers?.map((t, i) => (
                                            <Field key={i} label={t.trigger} value={t.how_used} />
                                        ))}
                                        <Field label="Sequence" value={analysis.psychological_triggers.persuasion_sequence} />
                                        <Field label="Objections" value={analysis.psychological_triggers.objection_handling} />
                                    </AnalysisSection>
                                )}

                                {/* Audience Signals */}
                                {analysis.audience_signals && (
                                    <AnalysisSection title="Audience Signals" icon={Users} color="teal">
                                        <Field label="Primary Audience" value={analysis.audience_signals.primary_audience} />
                                        <Field label="Age Range" value={analysis.audience_signals.age_range} />
                                        <Field label="Gender" value={analysis.audience_signals.gender_skew} />
                                        <Field label="Awareness" value={analysis.audience_signals.awareness_level} />
                                        <Field label="Pain Points" value={analysis.audience_signals.pain_points_targeted} />
                                        <Field label="Desires" value={analysis.audience_signals.desires_targeted} />
                                        <Field label="FB Targeting" value={analysis.audience_signals.targeting_suggestions} />
                                    </AnalysisSection>
                                )}

                                {/* Competitive Intel */}
                                {analysis.competitive_intel && (
                                    <AnalysisSection title="Competitive Intel" icon={TrendingUp} color="orange">
                                        <Field label="Niche" value={analysis.competitive_intel.estimated_niche} />
                                        <Field label="Category" value={analysis.competitive_intel.specific_category} />
                                        <Field label="Offer" value={analysis.competitive_intel.offer_structure} />
                                        <Field label="Funnel" value={analysis.competitive_intel.funnel_position} />
                                        <Field label="Compliance" value={analysis.competitive_intel.compliance_risk} />
                                        {analysis.competitive_intel.compliance_notes && (
                                            <Field label="Notes" value={analysis.competitive_intel.compliance_notes} />
                                        )}
                                    </AnalysisSection>
                                )}

                                {/* Video Analysis */}
                                {analysis.video_analysis && (
                                    <AnalysisSection title="Video Analysis" icon={Eye} color="indigo">
                                        <Field label="Duration" value={`${analysis.video_analysis.estimated_duration_seconds}s`} />
                                        <Field label="Hook Window" value={analysis.video_analysis.hook_window} />
                                        <Field label="Pacing" value={analysis.video_analysis.pacing_description} />
                                        <Field label="Audio" value={analysis.video_analysis.audio_description} />
                                        <Field label="Key Phrases" value={analysis.video_analysis.transcript_highlights} />
                                        <Field label="Retention" value={analysis.video_analysis.retention_techniques} />
                                    </AnalysisSection>
                                )}

                                {/* Recreation Blueprint */}
                                {analysis.recreation_blueprint && (
                                    <AnalysisSection title="Recreation Blueprint" icon={Target} color="amber">
                                        <Field label="Visual Prompt" value={analysis.recreation_blueprint.visual_prompt} />
                                        <Field label="Copy Template" value={analysis.recreation_blueprint.copy_template} />
                                        <Field label="Headlines" value={analysis.recreation_blueprint.headline_formulas} />
                                        <Field label="Keep" value={analysis.recreation_blueprint.key_elements_to_keep} />
                                        <Field label="Vary" value={analysis.recreation_blueprint.elements_to_vary} />
                                    </AnalysisSection>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ─── PHASE 3: CREATE SIMILAR ──────────────────────────── */}
            {phase === 3 && (
                <div className="space-y-6">
                    {/* Context selection */}
                    <div className="bg-white border rounded-lg p-4 space-y-4">
                        <h3 className="font-semibold text-gray-700">Select Your Brand Context</h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div>
                                <label className="text-xs font-medium text-gray-500 mb-1 block">Brand</label>
                                <select value={selectedBrandId} onChange={e => { setSelectedBrandId(e.target.value); setSelectedProductId(''); }}
                                    className="w-full px-3 py-2 border rounded-lg text-sm">
                                    <option value="">Select brand...</option>
                                    {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="text-xs font-medium text-gray-500 mb-1 block">Product</label>
                                <select value={selectedProductId} onChange={e => setSelectedProductId(e.target.value)}
                                    className="w-full px-3 py-2 border rounded-lg text-sm" disabled={!selectedBrandId}>
                                    <option value="">Select product...</option>
                                    {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="text-xs font-medium text-gray-500 mb-1 block">Customer Profile</label>
                                <select value={selectedProfileId} onChange={e => setSelectedProfileId(e.target.value)}
                                    className="w-full px-3 py-2 border rounded-lg text-sm">
                                    <option value="">Select profile...</option>
                                    {customerProfiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                </select>
                            </div>
                        </div>
                        <div className="flex items-center gap-4">
                            <div>
                                <label className="text-xs font-medium text-gray-500 mb-1 block">AI Model</label>
                                <select value={copyModel} onChange={e => setCopyModel(e.target.value)}
                                    className="px-3 py-2 border rounded-lg text-sm">
                                    <option value="sonnet">Claude Sonnet</option>
                                    <option value="haiku">Claude Haiku (faster)</option>
                                    <option value="group_voice">Group Voice</option>
                                    <option value="gemini">Gemini Flash</option>
                                </select>
                            </div>
                            <div>
                                <label className="text-xs font-medium text-gray-500 mb-1 block">Variations</label>
                                <select value={variationCount} onChange={e => setVariationCount(Number(e.target.value))}
                                    className="px-3 py-2 border rounded-lg text-sm">
                                    <option value={3}>3</option>
                                    <option value={5}>5</option>
                                    <option value={10}>10</option>
                                </select>
                            </div>
                            <div className="flex-1" />
                            <button onClick={() => setPhase(2)} className="px-4 py-2 bg-gray-100 rounded-lg text-sm hover:bg-gray-200 flex items-center gap-1">
                                <ArrowLeft size={14} /> Back to Analysis
                            </button>
                            <button onClick={handleCreateSimilar} disabled={generating || !selectedBrandId || !selectedProductId || !selectedProfileId}
                                className="px-6 py-2.5 bg-amber-500 text-white rounded-lg font-medium hover:bg-amber-600 disabled:opacity-50 flex items-center gap-2">
                                {generating ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
                                {generating ? 'Generating...' : 'Generate Copy'}
                            </button>
                        </div>
                    </div>

                    {/* Copy Variations */}
                    {copyVariations.length > 0 && (
                        <div className="space-y-3">
                            <h3 className="font-semibold text-gray-700">Generated Copy Variations</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {copyVariations.map((v, i) => (
                                    <div key={i} className="border rounded-lg p-4 space-y-3 bg-white">
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs font-medium text-gray-400">Variation {i + 1}</span>
                                            {v.angle && <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded">{v.angle}</span>}
                                        </div>
                                        <div className="bg-purple-50 p-2 rounded">
                                            <p className="text-xs text-purple-400 font-medium mb-0.5">Headline</p>
                                            <p className="text-sm font-semibold text-purple-800">{v.headline}</p>
                                            <CopyBtn text={v.headline} />
                                        </div>
                                        <div className="bg-blue-50 p-2 rounded">
                                            <p className="text-xs text-blue-400 font-medium mb-0.5">Body</p>
                                            <p className="text-sm text-blue-800 whitespace-pre-wrap">{v.body}</p>
                                            <CopyBtn text={v.body} />
                                        </div>
                                        <div className="bg-green-50 p-2 rounded">
                                            <p className="text-xs text-green-400 font-medium mb-0.5">CTA</p>
                                            <p className="text-sm font-medium text-green-800">{v.cta}</p>
                                            <CopyBtn text={v.cta} />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Image Generation */}
                    {imagePrompt && (
                        <div className="bg-white border rounded-lg p-4 space-y-3">
                            <h3 className="font-semibold text-gray-700 flex items-center gap-2">
                                <Image size={16} /> Generate Similar Images
                            </h3>
                            <textarea value={imagePrompt} onChange={e => setImagePrompt(e.target.value)}
                                className="w-full px-3 py-2 border rounded-lg text-sm font-mono" rows={4} />
                            <div className="flex justify-end">
                                <button onClick={handleGenerateImages} disabled={generatingImages}
                                    className="px-5 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 disabled:opacity-50 flex items-center gap-2">
                                    {generatingImages ? <Loader2 size={14} className="animate-spin" /> : <Image size={14} />}
                                    {generatingImages ? 'Generating...' : 'Generate Images'}
                                </button>
                            </div>
                            {generatedImages.length > 0 && (
                                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3">
                                    {generatedImages.map((img, i) => (
                                        <div key={i} className="border rounded-lg overflow-hidden">
                                            {img.url ? (
                                                <img src={img.url} alt={img.size} className="w-full" />
                                            ) : (
                                                <div className="p-4 text-center text-red-500 text-sm">
                                                    <AlertTriangle size={20} className="mx-auto mb-1" />
                                                    {img.error || 'Failed'}
                                                </div>
                                            )}
                                            <div className="p-2 text-center text-xs text-gray-500">{img.size}</div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Publish bridge */}
                    {(copyVariations.length > 0 || generatedImages.length > 0) && (
                        <div className="flex justify-end">
                            <button onClick={() => navigate('/facebook-campaigns')}
                                className="px-5 py-2.5 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 flex items-center gap-2">
                                <ArrowRight size={16} /> Go to Campaign Builder
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
