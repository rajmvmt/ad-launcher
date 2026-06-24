import React, { useState, useCallback, useRef } from 'react';
import { Shield, Upload, Trash2, Download, AlertTriangle, CheckCircle, Loader2, Info, Zap, ShieldCheck, ShieldAlert, X, Eye } from 'lucide-react';
import { useToast } from '../context/ToastContext';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

const LEVELS = [
  {
    id: 1,
    name: 'Quick Clean',
    icon: Zap,
    color: 'amber',
    description: 'Strips all metadata (EXIF, IPTC, XMP, C2PA, PNG chunks). No pixel changes — zero quality loss.',
    removes: ['EXIF data (camera, GPS, timestamps)', 'IPTC/XMP (creator info, edit history)', 'C2PA Content Credentials (AI labels)', 'PNG text chunks (AI prompts)', 'ICC profiles & comments'],
    speed: '< 100ms',
  },
  {
    id: 2,
    name: 'Deep Clean',
    icon: ShieldCheck,
    color: 'orange',
    description: 'Everything in Quick Clean + re-encodes pixels through fresh encoder. Breaks LSB steganography and simple watermarks.',
    removes: ['All metadata (same as Quick Clean)', 'LSB steganographic watermarks', 'Simple DCT/DWT watermarks', 'Stable Diffusion invisible-watermark', 'Encoding-specific fingerprints'],
    speed: '~200-500ms',
  },
  {
    id: 3,
    name: 'Full Scrub',
    icon: ShieldAlert,
    color: 'red',
    description: 'Nuclear option. Adds noise, resize cycle, blur+sharpen, and LSB quantization to degrade neural AI watermarks.',
    removes: ['Everything in Deep Clean', 'Google SynthID watermarks', 'Meta Stable Signature', 'Midjourney fingerprints', 'Spread-spectrum watermarks', 'Unknown neural watermarks'],
    speed: '~1-3 seconds',
  },
];

export default function ImageSanitizer() {
  const { showSuccess, showError, showInfo } = useToast();
  const [images, setImages] = useState([]);
  const [level, setLevel] = useState(2);
  const [quality, setQuality] = useState(92);
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState([]);
  const [analyzeResult, setAnalyzeResult] = useState(null);
  const [analyzingIdx, setAnalyzingIdx] = useState(null);
  const fileInputRef = useRef(null);
  const dropRef = useRef(null);

  const handleFiles = useCallback((files) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    const valid = Array.from(files).filter(f => allowed.includes(f.type));
    if (valid.length < files.length) {
      showError(`${files.length - valid.length} file(s) skipped — only JPG, PNG, WebP, GIF allowed`);
    }
    const newImages = valid.map(f => ({
      file: f,
      name: f.name,
      size: f.size,
      preview: URL.createObjectURL(f),
    }));
    setImages(prev => [...prev, ...newImages]);
    setResults([]);
  }, [showError]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dropRef.current?.classList.remove('border-amber-500', 'bg-amber-50', 'dark:bg-amber-900/20');
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    dropRef.current?.classList.add('border-amber-500', 'bg-amber-50', 'dark:bg-amber-900/20');
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    dropRef.current?.classList.remove('border-amber-500', 'bg-amber-50', 'dark:bg-amber-900/20');
  }, []);

  const removeImage = (idx) => {
    setImages(prev => prev.filter((_, i) => i !== idx));
    setResults(prev => prev.filter((_, i) => i !== idx));
  };

  const analyzeImage = async (idx) => {
    const img = images[idx];
    setAnalyzingIdx(idx);
    setAnalyzeResult(null);
    try {
      const formData = new FormData();
      formData.append('file', img.file);
      const resp = await fetch(`${API_URL}/sanitizer/analyze`, { method: 'POST', body: formData });
      if (!resp.ok) throw new Error('Analysis failed');
      const data = await resp.json();
      setAnalyzeResult({ idx, data });
    } catch (err) {
      showError('Failed to analyze image');
    } finally {
      setAnalyzingIdx(null);
    }
  };

  const sanitizeAll = async () => {
    if (images.length === 0) return showError('Add images first');
    setProcessing(true);
    setResults([]);
    const newResults = [];

    for (let i = 0; i < images.length; i++) {
      try {
        const formData = new FormData();
        formData.append('file', images[i].file);
        formData.append('level', level);
        formData.append('quality', quality);
        formData.append('noise_sigma', '3.0');
        formData.append('save', 'true');

        const resp = await fetch(`${API_URL}/sanitizer/clean`, { method: 'POST', body: formData });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          throw new Error(err.detail || 'Sanitization failed');
        }
        const data = await resp.json();
        newResults.push({ success: true, ...data });
      } catch (err) {
        newResults.push({ success: false, error: err.message });
      }
    }

    setResults(newResults);
    setProcessing(false);
    const successCount = newResults.filter(r => r.success).length;
    if (successCount === images.length) {
      showSuccess(`All ${successCount} image(s) sanitized successfully`);
    } else if (successCount > 0) {
      showInfo(`${successCount}/${images.length} images sanitized`);
    } else {
      showError('All images failed to sanitize');
    }
  };

  const downloadResult = async (result, originalName) => {
    if (!result?.url) return;
    try {
      const url = result.url.startsWith('http') ? result.url : `${API_URL.replace('/api/v1', '')}${result.url}`;
      const resp = await fetch(url);
      const blob = await resp.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `clean_${originalName}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    } catch {
      showError('Download failed');
    }
  };

  const downloadAll = async () => {
    const ready = results
      .map((r, i) => ({ result: r, name: images[i]?.name }))
      .filter(({ result, name }) => result?.success && result?.url && name);
    if (ready.length === 0) {
      showError('Nothing to download yet — sanitize images first');
      return;
    }
    let ok = 0;
    for (const { result, name } of ready) {
      try {
        await downloadResult(result, name);
        ok += 1;
      } catch {
        // downloadResult already toasts on failure
      }
    }
    if (ok === ready.length) {
      showSuccess(`Downloaded ${ok} cleaned image${ok > 1 ? 's' : ''}`);
    } else if (ok > 0) {
      showInfo(`Downloaded ${ok}/${ready.length} — some failed`);
    }
  };

  const selectedLevel = LEVELS.find(l => l.id === level);

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-3 bg-amber-100 dark:bg-amber-900/30 rounded-xl">
          <Shield className="w-7 h-7 text-amber-600 dark:text-amber-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Image Sanitizer</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Strip metadata, fingerprints & AI watermarks from images</p>
        </div>
      </div>

      {/* Level Selector */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {LEVELS.map((l) => {
          const Icon = l.icon;
          const selected = level === l.id;
          return (
            <button
              key={l.id}
              onClick={() => setLevel(l.id)}
              className={`relative p-4 rounded-xl border-2 text-left transition-all ${
                selected
                  ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/20 shadow-lg shadow-amber-100 dark:shadow-amber-900/10'
                  : 'border-gray-200 dark:border-gray-700 hover:border-amber-300 dark:hover:border-amber-600 bg-white dark:bg-gray-800'
              }`}
            >
              {selected && (
                <div className="absolute top-2 right-2">
                  <CheckCircle className="w-5 h-5 text-amber-500" />
                </div>
              )}
              <div className="flex items-center gap-2 mb-2">
                <Icon className={`w-5 h-5 ${selected ? 'text-amber-600' : 'text-gray-400'}`} />
                <span className={`font-bold ${selected ? 'text-amber-900 dark:text-amber-100' : 'text-gray-700 dark:text-gray-300'}`}>
                  Level {l.id}: {l.name}
                </span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">{l.description}</p>
              <div className="space-y-1">
                {l.removes.map((r, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-xs text-gray-600 dark:text-gray-400">
                    <CheckCircle className="w-3 h-3 mt-0.5 text-green-500 flex-shrink-0" />
                    <span>{r}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 text-xs text-gray-400 dark:text-gray-500">Speed: {l.speed}</div>
            </button>
          );
        })}
      </div>

      {/* Quality slider (levels 2-3) */}
      {level >= 2 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">JPEG Quality</span>
            <span className="text-sm font-bold text-amber-600">{quality}%</span>
          </div>
          <input
            type="range"
            min="50"
            max="100"
            value={quality}
            onChange={(e) => setQuality(parseInt(e.target.value))}
            className="w-full accent-amber-500"
          />
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>More aggressive</span>
            <span>Higher quality</span>
          </div>
        </div>
      )}

      {/* Drop Zone */}
      <div
        ref={dropRef}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileInputRef.current?.click()}
        className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-8 text-center cursor-pointer hover:border-amber-400 dark:hover:border-amber-500 transition-colors bg-white dark:bg-gray-800"
      >
        <Upload className="w-10 h-10 mx-auto mb-3 text-gray-400" />
        <p className="text-gray-600 dark:text-gray-400 font-medium">Drop images here or click to upload</p>
        <p className="text-xs text-gray-400 mt-1">JPG, PNG, WebP, GIF — up to 25MB each</p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }}
        />
      </div>

      {/* Image Queue */}
      {images.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">{images.length} Image{images.length > 1 ? 's' : ''} Queued</h3>
            <div className="flex gap-2">
              <button
                onClick={() => { setImages([]); setResults([]); setAnalyzeResult(null); }}
                className="px-3 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
              >
                Clear All
              </button>
              {results.some(r => r?.success && r?.url) && (
                <button
                  onClick={downloadAll}
                  disabled={processing}
                  className="px-3 py-1.5 text-xs bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 font-medium"
                >
                  <Download className="w-3.5 h-3.5" /> Download All ({results.filter(r => r?.success && r?.url).length})
                </button>
              )}
              <button
                onClick={sanitizeAll}
                disabled={processing}
                className="px-4 py-1.5 text-xs bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 font-medium"
              >
                {processing ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Processing...</>
                ) : (
                  <><Shield className="w-3.5 h-3.5" /> Sanitize All — Level {level}</>
                )}
              </button>
            </div>
          </div>

          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {images.map((img, idx) => {
              const result = results[idx];
              return (
                <div key={idx} className="flex items-center gap-4 p-4">
                  {/* Thumbnail */}
                  <div className="w-16 h-16 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-700 flex-shrink-0">
                    <img src={img.preview} alt={img.name} className="w-full h-full object-cover" />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{img.name}</p>
                    <p className="text-xs text-gray-400">{(img.size / 1024).toFixed(1)} KB</p>
                    {result && result.success && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {result.report?.actions?.map((action, i) => (
                          <span key={i} className="inline-block px-1.5 py-0.5 text-[10px] bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded">
                            {action}
                          </span>
                        ))}
                      </div>
                    )}
                    {result && !result.success && (
                      <p className="text-xs text-red-500 mt-1">{result.error}</p>
                    )}
                  </div>

                  {/* Status / Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {processing && !result && (
                      <Loader2 className="w-5 h-5 text-amber-500 animate-spin" />
                    )}
                    {result?.success && (
                      <>
                        <CheckCircle className="w-5 h-5 text-green-500" />
                        <span className="text-xs text-gray-400">{result.report?.size_change}</span>
                        <button
                          onClick={() => downloadResult(result, img.name)}
                          className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                          title="Download cleaned image"
                        >
                          <Download className="w-4 h-4 text-amber-600" />
                        </button>
                      </>
                    )}
                    {result && !result.success && (
                      <AlertTriangle className="w-5 h-5 text-red-500" />
                    )}
                    <button
                      onClick={() => analyzeImage(idx)}
                      disabled={analyzingIdx === idx}
                      className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                      title="Analyze metadata"
                    >
                      {analyzingIdx === idx ? (
                        <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                      ) : (
                        <Eye className="w-4 h-4 text-blue-500" />
                      )}
                    </button>
                    <button
                      onClick={() => removeImage(idx)}
                      className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"
                    >
                      <X className="w-4 h-4 text-red-400" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Analysis Modal */}
      {analyzeResult && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-blue-200 dark:border-blue-700 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Info className="w-5 h-5 text-blue-500" />
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">Analysis: {images[analyzeResult.idx]?.name}</h3>
            </div>
            <button onClick={() => setAnalyzeResult(null)} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700">
              <X className="w-4 h-4 text-gray-400" />
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
              <div className="text-xs text-gray-400 mb-1">Format</div>
              <div className="font-medium text-gray-900 dark:text-gray-100">{analyzeResult.data.format}</div>
            </div>
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
              <div className="text-xs text-gray-400 mb-1">Dimensions</div>
              <div className="font-medium text-gray-900 dark:text-gray-100">{analyzeResult.data.dimensions}</div>
            </div>
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
              <div className="text-xs text-gray-400 mb-1">Size</div>
              <div className="font-medium text-gray-900 dark:text-gray-100">{(analyzeResult.data.size_bytes / 1024).toFixed(1)} KB</div>
            </div>
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
              <div className="text-xs text-gray-400 mb-1">C2PA / AI Label</div>
              <div className={`font-bold ${analyzeResult.data.c2pa_detected ? 'text-red-500' : 'text-green-500'}`}>
                {analyzeResult.data.c2pa_detected ? 'DETECTED' : 'None'}
              </div>
            </div>
          </div>

          {analyzeResult.data.metadata_found?.length > 0 ? (
            <div>
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Metadata Found ({analyzeResult.data.metadata_found.length} items)</div>
              <div className="flex flex-wrap gap-1.5">
                {analyzeResult.data.metadata_found.map((item, i) => (
                  <span key={i} className="px-2 py-1 text-xs rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 font-medium">
                    {item}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-green-600 dark:text-green-400 text-sm">
              <CheckCircle className="w-4 h-4" />
              <span>No metadata detected — image appears clean</span>
            </div>
          )}
        </div>
      )}

      {/* Info Footer */}
      <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-700 p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-amber-800 dark:text-amber-200 space-y-1">
            <p className="font-medium">How this works</p>
            <p><strong>Level 1</strong> strips file metadata without touching pixels — C2PA removal alone stops Facebook/Instagram from showing "AI Generated" labels.</p>
            <p><strong>Level 2</strong> re-encodes through a fresh pixel pipeline, breaking simple steganographic watermarks (LSB, Stable Diffusion's invisible-watermark).</p>
            <p><strong>Level 3</strong> applies noise injection, resize cycling, blur+sharpen, and LSB quantization to degrade neural watermarks like Google SynthID and Meta's Stable Signature. No tool can guarantee 100% removal of neural watermarks — this is an active arms race.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
