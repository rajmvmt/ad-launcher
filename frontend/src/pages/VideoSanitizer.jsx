import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Film, Upload, Download, AlertTriangle, CheckCircle, Loader2, Info, Zap, ShieldCheck, ShieldAlert, X, Eye, RotateCw, Target, Crosshair, Link as LinkIcon, ExternalLink, Flame, Music, Palette, Maximize2, Square } from 'lucide-react';
import { useToast } from '../context/ToastContext';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';
const POLL_INTERVAL_MS = 2000;

// Order matters — drives the UI button row + the FormData CSV order
const PLACEMENTS = [
  { ratio: '9:16', label: 'Vertical',   dims: '1080×1920', use: 'Reels, Stories, IG' },
  { ratio: '1:1',  label: 'Square',     dims: '1080×1080', use: 'Feed (legacy)' },
  { ratio: '4:5',  label: 'Portrait',   dims: '1080×1350', use: 'Mobile feed (highest CTR)' },
  { ratio: '16:9', label: 'Horizontal', dims: '1920×1080', use: 'Right column, in-stream' },
];
const ALL_RATIOS = PLACEMENTS.map((p) => p.ratio);

const LEVELS = [
  {
    id: 1,
    name: 'Light',
    subtitle: 'Quick Clean',
    icon: Zap,
    description: 'Strips container + stream metadata only. No re-encode, no pixel changes. Zero quality loss. Perfect for low-risk videos.',
    removes: [
      'FB-injected moov atom tags (com.facebook.*)',
      'Encoder strings + handler_name fields',
      'EXIF-style creation timestamps',
      'Chapter + side-data blobs',
    ],
    speed: '~2-5s',
  },
  {
    id: 2,
    name: 'Balanced',
    subtitle: 'Deep Clean',
    icon: ShieldCheck,
    description: 'Everything in Light + fresh H.264/AAC re-encode, tiny crop, color nudge, head/tail trim. Breaks FB perceptual hash.',
    removes: [
      'All metadata (same as Light)',
      'Perceptual-hash match (PDQ-style)',
      'Container-level fingerprints',
      'Simple encoding-signature watermarks',
    ],
    speed: '~20-90s per video',
  },
  {
    id: 3,
    name: 'Aggressive',
    subtitle: 'Full Scrub',
    icon: ShieldAlert,
    description: 'Everything in Balanced + grain overlay, speed shift, stronger color/crop, wider random ranges. Defeats AI watermarks (SynthID etc).',
    removes: [
      'Everything in Balanced',
      'Google SynthID (Veo, Gemini) — degraded',
      'Meta Stable Signature',
      'Runway / Kling / Pika hidden markers',
      'Near-duplicate detection',
    ],
    speed: '~30-180s per video',
  },
  {
    id: 4,
    name: 'Nuclear',
    subtitle: 'Annihilate',
    icon: Flame,
    description: 'Maximum aggression. Adds slight rotation, fps shift, two-pass re-encode, kinetic zoom, vignette, and widest color/crop/speed ranges. 2-3× stronger than Aggressive.',
    removes: [
      'Everything in Aggressive',
      'Temporal hash (frame rate + frame timing)',
      'Encoder byte-level signature (2x encode)',
      'Spatial hash via rotation + zoom drift',
      'Most stubborn neural watermarks',
    ],
    speed: '~60-300s per video',
  },
];

function DelogoModal({ video, initial, onSave, onClose }) {
  const videoRef = useRef(null);
  const overlayRef = useRef(null);
  const [nativeSize, setNativeSize] = useState(null);      // {w, h} intrinsic
  const [renderedRect, setRenderedRect] = useState(null); // getBoundingClientRect of video element
  const [box, setBox] = useState(null);                    // in rendered (css) pixels: {x, y, w, h}
  const [dragStart, setDragStart] = useState(null);

  // On metadata load, capture intrinsic dimensions and translate `initial` (native coords) into rendered coords.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const onMeta = () => {
      const w = el.videoWidth;
      const h = el.videoHeight;
      setNativeSize({ w, h });
      const rect = el.getBoundingClientRect();
      setRenderedRect({ w: rect.width, h: rect.height });
      if (initial && w && h) {
        const sx = rect.width / w;
        const sy = rect.height / h;
        setBox({
          x: initial.x * sx,
          y: initial.y * sy,
          w: initial.w * sx,
          h: initial.h * sy,
        });
      }
      // Seek to 0.1s to ensure a frame is visible
      try { el.currentTime = 0.1; } catch { /* some sources can't seek immediately */ }
    };
    el.addEventListener('loadedmetadata', onMeta);
    return () => el.removeEventListener('loadedmetadata', onMeta);
  }, [initial]);

  const toLocal = (e) => {
    const rect = overlayRef.current.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: Math.max(0, Math.min(rect.width, clientX - rect.left)),
      y: Math.max(0, Math.min(rect.height, clientY - rect.top)),
    };
  };

  const onDown = (e) => {
    e.preventDefault();
    const p = toLocal(e);
    setDragStart(p);
    setBox({ x: p.x, y: p.y, w: 0, h: 0 });
  };

  const onMove = (e) => {
    if (!dragStart) return;
    const p = toLocal(e);
    setBox({
      x: Math.min(dragStart.x, p.x),
      y: Math.min(dragStart.y, p.y),
      w: Math.abs(p.x - dragStart.x),
      h: Math.abs(p.y - dragStart.y),
    });
  };

  const onUp = () => setDragStart(null);

  const clear = () => { setBox(null); setDragStart(null); };

  const save = () => {
    if (!box || !nativeSize || !renderedRect || box.w < 4 || box.h < 4) {
      clear();
      onSave(null);
      onClose();
      return;
    }
    // Translate rendered coords -> native video coords
    const sx = nativeSize.w / renderedRect.w;
    const sy = nativeSize.h / renderedRect.h;
    onSave({
      x: Math.round(box.x * sx),
      y: Math.round(box.y * sy),
      w: Math.round(box.w * sx),
      h: Math.round(box.h * sy),
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-xl p-5 max-w-3xl w-full space-y-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Crosshair className="w-5 h-5 text-red-500" />
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">Mark watermark region — {video.name}</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700">
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        <p className="text-xs text-gray-500 dark:text-gray-400">
          Drag a box over the watermark / logo (Kling, Runway, TikTok, etc). The sanitizer will apply an ffmpeg delogo filter over that region. Leave empty to disable.
        </p>

        <div className="relative inline-block max-w-full" style={{ userSelect: 'none' }}>
          <video
            ref={videoRef}
            src={video.preview}
            className="max-w-full max-h-[60vh] rounded-lg bg-black"
            muted
            playsInline
            preload="metadata"
          />
          <div
            ref={overlayRef}
            className="absolute inset-0 cursor-crosshair"
            onMouseDown={onDown}
            onMouseMove={onMove}
            onMouseUp={onUp}
            onMouseLeave={onUp}
            onTouchStart={onDown}
            onTouchMove={onMove}
            onTouchEnd={onUp}
          >
            {box && (
              <div
                className="absolute border-2 border-red-500 bg-red-500/20 pointer-events-none"
                style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
              />
            )}
          </div>
        </div>

        {nativeSize && box && box.w >= 4 && box.h >= 4 && (
          <div className="text-xs text-gray-500 dark:text-gray-400 font-mono">
            Native region: x={Math.round(box.x * (nativeSize.w / renderedRect.w))}, y={Math.round(box.y * (nativeSize.h / renderedRect.h))}, w={Math.round(box.w * (nativeSize.w / renderedRect.w))}, h={Math.round(box.h * (nativeSize.h / renderedRect.h))}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={clear} className="px-3 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600">
            Clear
          </button>
          <button onClick={onClose} className="px-3 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600">
            Cancel
          </button>
          <button onClick={save} className="px-4 py-1.5 text-xs bg-red-500 text-white rounded-lg hover:bg-red-600 font-medium">
            Save region
          </button>
        </div>
      </div>
    </div>
  );
}

function LevelCard({ level, selected, onClick }) {
  const Icon = level.icon;
  return (
    <button
      onClick={onClick}
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
          {level.name}
        </span>
        <span className="text-xs text-gray-400">({level.subtitle})</span>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">{level.description}</p>
      <div className="space-y-1">
        {level.removes.map((r, i) => (
          <div key={i} className="flex items-start gap-1.5 text-xs text-gray-600 dark:text-gray-400">
            <CheckCircle className="w-3 h-3 mt-0.5 text-green-500 flex-shrink-0" />
            <span>{r}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 text-xs text-gray-400 dark:text-gray-500">Speed: {level.speed}</div>
    </button>
  );
}

export default function VideoSanitizer() {
  const { showSuccess, showError, showInfo } = useToast();
  const [videos, setVideos] = useState([]);
  const [level, setLevel] = useState(2);
  const [flipHorizontal, setFlipHorizontal] = useState(false);
  const [pitchShift, setPitchShift] = useState(false);
  const [colorspaceRoundtrip, setColorspaceRoundtrip] = useState(false);
  const [resizeRatios, setResizeRatios] = useState(() => new Set());
  const [letterboxHorizontal, setLetterboxHorizontal] = useState(true);
  const [jobs, setJobs] = useState({});                  // job_id -> job state
  const [jobsByVideoIdx, setJobsByVideoIdx] = useState({}); // idx -> job_id
  const [analyzing, setAnalyzing] = useState({});        // idx -> bool
  const [analysis, setAnalysis] = useState(null);        // { idx, data }
  const [submitting, setSubmitting] = useState(false);
  const [delogoByIdx, setDelogoByIdx] = useState({});    // idx -> {x,y,w,h}
  const [expandedActions, setExpandedActions] = useState({}); // idx -> bool
  const [delogoModalIdx, setDelogoModalIdx] = useState(null);
  const fileInputRef = useRef(null);
  const dropRef = useRef(null);

  const activeJobIds = Object.values(jobsByVideoIdx);

  // Poll for job status until every active job is terminal
  useEffect(() => {
    if (activeJobIds.length === 0) return;
    const pending = activeJobIds.filter(
      (jid) => !['completed', 'failed'].includes(jobs[jid]?.status)
    );
    if (pending.length === 0) return;

    const intervalId = setInterval(async () => {
      const updates = {};
      await Promise.all(
        pending.map(async (jid) => {
          try {
            const resp = await fetch(`${API_URL}/video-sanitizer/jobs/${jid}`);
            if (resp.ok) {
              const data = await resp.json();
              updates[jid] = data;
            }
          } catch {
            /* ignore transient poll errors */
          }
        })
      );
      if (Object.keys(updates).length > 0) {
        setJobs((prev) => ({ ...prev, ...updates }));
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, [activeJobIds, jobs]);

  // Toast when all jobs finish
  useEffect(() => {
    if (activeJobIds.length === 0 || submitting) return;
    const allDone = activeJobIds.every((jid) => ['completed', 'failed'].includes(jobs[jid]?.status));
    if (!allDone) return;
    const completed = activeJobIds.filter((jid) => jobs[jid]?.status === 'completed').length;
    const failed = activeJobIds.length - completed;
    if (failed === 0 && completed > 0) {
      showSuccess(`All ${completed} video(s) sanitized`);
    } else if (completed > 0) {
      showInfo(`${completed}/${activeJobIds.length} sanitized — ${failed} failed`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs]);

  const handleFiles = useCallback(
    (files) => {
      const allowed = ['video/mp4', 'video/quicktime', 'video/x-m4v', 'video/webm', 'video/x-msvideo', 'video/x-matroska'];
      const allowedExt = /\.(mp4|mov|m4v|webm|avi|mkv)$/i;
      const valid = Array.from(files).filter((f) => allowed.includes(f.type) || allowedExt.test(f.name));
      if (valid.length < files.length) {
        showError(`${files.length - valid.length} file(s) skipped — only MP4, MOV, M4V, WebM, AVI, MKV allowed`);
      }
      const newVideos = valid.map((f) => ({
        file: f,
        name: f.name,
        size: f.size,
        preview: URL.createObjectURL(f),
      }));
      setVideos((prev) => [...prev, ...newVideos]);
    },
    [showError]
  );

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropRef.current?.classList.remove('border-amber-500', 'bg-amber-50', 'dark:bg-amber-900/20');
      if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    dropRef.current?.classList.add('border-amber-500', 'bg-amber-50', 'dark:bg-amber-900/20');
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    dropRef.current?.classList.remove('border-amber-500', 'bg-amber-50', 'dark:bg-amber-900/20');
  }, []);

  // Global clipboard paste — accept actual video files from the OS clipboard.
  // Skipped if focus is inside a text input so paste into fields still works.
  useEffect(() => {
    const onPaste = (e) => {
      const target = e.target;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return;

      const items = e.clipboardData?.items;
      if (!items || items.length === 0) return;

      const files = [];
      for (const item of items) {
        if (item.kind !== 'file') continue;
        const file = item.getAsFile();
        if (file && file.type.startsWith('video/')) files.push(file);
      }
      if (files.length === 0) return;

      e.preventDefault();
      handleFiles(files);
      showInfo(`Pasted ${files.length} video${files.length > 1 ? 's' : ''} from clipboard`);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [handleFiles, showInfo]);

  const removeVideo = (idx) => {
    setVideos((prev) => prev.filter((_, i) => i !== idx));
    setJobsByVideoIdx((prev) => {
      const next = { ...prev };
      delete next[idx];
      return next;
    });
    setDelogoByIdx((prev) => {
      const next = { ...prev };
      delete next[idx];
      return next;
    });
  };

  const clearAll = () => {
    setVideos([]);
    setJobsByVideoIdx({});
    setJobs({});
    setAnalysis(null);
    setDelogoByIdx({});
    setExpandedActions({});
  };

  const analyzeVideo = async (idx) => {
    const vid = videos[idx];
    setAnalyzing((prev) => ({ ...prev, [idx]: true }));
    setAnalysis(null);
    try {
      const formData = new FormData();
      formData.append('file', vid.file);
      const resp = await fetch(`${API_URL}/video-sanitizer/analyze`, { method: 'POST', body: formData });
      if (!resp.ok) throw new Error('Analysis failed');
      const data = await resp.json();
      setAnalysis({ idx, data });
    } catch {
      showError('Failed to analyze video');
    } finally {
      setAnalyzing((prev) => ({ ...prev, [idx]: false }));
    }
  };

  const sanitizeAll = async () => {
    if (videos.length === 0) {
      showError('Add videos first');
      return;
    }
    setSubmitting(true);
    try {
      // Submit each as individual job so one bad file doesn't kill the whole batch
      const nextMapping = {};
      const nextJobs = {};
      for (let i = 0; i < videos.length; i++) {
        const formData = new FormData();
        formData.append('file', videos[i].file);
        formData.append('level', String(level));
        formData.append('flip_horizontal', String(flipHorizontal));
        formData.append('pitch_shift', String(pitchShift));
        formData.append('colorspace_roundtrip', String(colorspaceRoundtrip));
        if (delogoByIdx[i]) {
          formData.append('delogo', JSON.stringify(delogoByIdx[i]));
        }
        if (resizeRatios.size > 0) {
          // Submit ratios in canonical PLACEMENTS order, not insertion order
          const csv = ALL_RATIOS.filter((r) => resizeRatios.has(r)).join(',');
          formData.append('resize_ratios', csv);
          formData.append('fit_mode', 'crop');
          if (letterboxHorizontal) formData.append('horizontal_fit_mode', 'letterbox');
        }
        try {
          const resp = await fetch(`${API_URL}/video-sanitizer/clean`, { method: 'POST', body: formData });
          if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.detail || 'Upload failed');
          }
          const data = await resp.json();
          nextMapping[i] = data.job_id;
          nextJobs[data.job_id] = { ...data, original_name: videos[i].name };
        } catch (err) {
          nextMapping[i] = `failed-${i}`;
          nextJobs[`failed-${i}`] = { status: 'failed', error: err.message, original_name: videos[i].name };
        }
      }
      setJobsByVideoIdx(nextMapping);
      setJobs((prev) => ({ ...prev, ...nextJobs }));
    } finally {
      setSubmitting(false);
    }
  };

  const downloadResult = async (job) => {
    if (!job?.url) return;
    try {
      const url = job.url.startsWith('http') ? job.url : `${API_URL.replace('/api/v1', '')}${job.url}`;
      const resp = await fetch(url);
      const blob = await resp.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const base = (job.original_name || 'video').replace(/\.[^.]+$/, '');
      a.download = `clean_${base}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch {
      showError('Download failed');
    }
  };

  const copyLink = async (job) => {
    if (!job?.url) return;
    const url = job.url.startsWith('http') ? job.url : `${window.location.origin}${job.url}`;
    try {
      await navigator.clipboard.writeText(url);
      showSuccess('R2 link copied');
    } catch {
      // Fallback for non-secure contexts (should not happen on Railway)
      const ta = document.createElement('textarea');
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); showSuccess('R2 link copied'); } catch { showError('Copy failed'); }
      document.body.removeChild(ta);
    }
  };

  const downloadVariant = async (job, ratio, variant) => {
    if (!variant?.url) return;
    try {
      const url = variant.url.startsWith('http') ? variant.url : `${API_URL.replace('/api/v1', '')}${variant.url}`;
      const resp = await fetch(url);
      const blob = await resp.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const base = (job.original_name || 'video').replace(/\.[^.]+$/, '');
      const slug = ratio.replace(':', 'x');
      a.download = `clean_${base}_${slug}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch {
      showError(`Download failed for ${ratio}`);
    }
  };

  const downloadAll = async () => {
    const done = videos
      .map((_, idx) => jobs[jobsByVideoIdx[idx]])
      .filter((j) => j?.status === 'completed');
    for (const job of done) {
      if (job.url) {
        await downloadResult(job);
        await new Promise((r) => setTimeout(r, 300));
      }
      if (job.variants) {
        for (const ratio of ALL_RATIOS) {
          const v = job.variants[ratio];
          if (v?.url) {
            await downloadVariant(job, ratio, v);
            await new Promise((r) => setTimeout(r, 300));
          }
        }
      }
    }
  };

  const completedCount = videos.filter((_, idx) => jobs[jobsByVideoIdx[idx]]?.status === 'completed').length;
  const processingCount = videos.filter((_, idx) => ['queued', 'processing'].includes(jobs[jobsByVideoIdx[idx]]?.status)).length;
  const failedCount = videos.filter((_, idx) => jobs[jobsByVideoIdx[idx]]?.status === 'failed').length;

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-3 bg-amber-100 dark:bg-amber-900/30 rounded-xl">
          <Film className="w-7 h-7 text-amber-600 dark:text-amber-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Video Sanitizer</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Strip metadata, fingerprints & AI watermarks from videos — safe re-upload to FB ads</p>
        </div>
      </div>

      {/* Level selector */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {LEVELS.map((l) => (
          <LevelCard key={l.id} level={l} selected={level === l.id} onClick={() => setLevel(l.id)} />
        ))}
      </div>

      {/* Advanced options */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="pr-4">
            <div className="flex items-center gap-2">
              <RotateCw className="w-4 h-4 text-gray-400" />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Horizontal flip</span>
              <span className="text-xs text-red-500 font-semibold">(nuclear)</span>
            </div>
            <p className="text-xs text-gray-400 mt-1">Mirror the video left-to-right. Defeats most duplicate detection but breaks any on-screen text or readable logos.</p>
          </div>
          <button
            onClick={() => setFlipHorizontal((v) => !v)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${flipHorizontal ? 'bg-red-500' : 'bg-gray-300 dark:bg-gray-600'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${flipHorizontal ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>

        <div className="flex items-center justify-between border-t border-gray-100 dark:border-gray-700 pt-4">
          <div className="pr-4">
            <div className="flex items-center gap-2">
              <Music className="w-4 h-4 text-gray-400" />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Audio pitch shift</span>
              <span className="text-xs text-amber-500 font-semibold">(opt-in)</span>
            </div>
            <p className="text-xs text-gray-400 mt-1">Shifts audio pitch ±1-2 semitones without changing tempo. Defeats FB's audio fingerprint. Noticeable on voiceover — leave off for talking videos.</p>
          </div>
          <button
            onClick={() => setPitchShift((v) => !v)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${pitchShift ? 'bg-amber-500' : 'bg-gray-300 dark:bg-gray-600'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${pitchShift ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>

        <div className="flex items-center justify-between border-t border-gray-100 dark:border-gray-700 pt-4">
          <div className="pr-4">
            <div className="flex items-center gap-2">
              <Palette className="w-4 h-4 text-gray-400" />
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Colorspace roundtrip</span>
              <span className="text-xs text-amber-500 font-semibold">(opt-in)</span>
            </div>
            <p className="text-xs text-gray-400 mt-1">Forces chroma subsample roundtrip (yuv444p → yuv420p). Extra pixel-level perturbation; very subtle color shift on deep reds.</p>
          </div>
          <button
            onClick={() => setColorspaceRoundtrip((v) => !v)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${colorspaceRoundtrip ? 'bg-amber-500' : 'bg-gray-300 dark:bg-gray-600'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${colorspaceRoundtrip ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
      </div>

      {/* FB Placement Variants */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <Maximize2 className="w-4 h-4 text-blue-500" />
              <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">FB Placement Variants</span>
              <span className="text-xs text-blue-500 font-semibold">(optional)</span>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Generate exact-ratio variants for each FB placement. Off-ratio uploads trigger
              "won't show on certain placements" — these variants make every placement eligible.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setResizeRatios(new Set(ALL_RATIOS))}
              className="px-2.5 py-1 text-[11px] bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded-md hover:bg-blue-200 dark:hover:bg-blue-900/50"
            >
              All FB sizes
            </button>
            {resizeRatios.size > 0 && (
              <button
                onClick={() => setResizeRatios(new Set())}
                className="px-2.5 py-1 text-[11px] bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {PLACEMENTS.map((p) => {
            const selected = resizeRatios.has(p.ratio);
            return (
              <button
                key={p.ratio}
                onClick={() => setResizeRatios((prev) => {
                  const next = new Set(prev);
                  if (next.has(p.ratio)) next.delete(p.ratio); else next.add(p.ratio);
                  return next;
                })}
                className={`relative p-3 rounded-lg border-2 text-left transition-all ${
                  selected
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-700 bg-white dark:bg-gray-800'
                }`}
              >
                {selected && (
                  <CheckCircle className="absolute top-1.5 right-1.5 w-4 h-4 text-blue-500" />
                )}
                <div className="flex items-center gap-1.5 mb-1">
                  <Square className={`w-3.5 h-3.5 ${selected ? 'text-blue-600' : 'text-gray-400'}`} />
                  <span className={`text-xs font-bold ${selected ? 'text-blue-900 dark:text-blue-100' : 'text-gray-700 dark:text-gray-300'}`}>
                    {p.ratio}
                  </span>
                  <span className="text-[10px] text-gray-400">{p.label}</span>
                </div>
                <div className="text-[10px] text-gray-500 dark:text-gray-400 font-mono">{p.dims}</div>
                <div className="text-[10px] text-gray-400 mt-0.5">{p.use}</div>
              </button>
            );
          })}
        </div>

        {resizeRatios.has('16:9') && (
          <div className="flex items-center justify-between border-t border-gray-100 dark:border-gray-700 pt-3">
            <div className="pr-4">
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">Letterbox 16:9 (blurred fill)</span>
              <p className="text-[11px] text-gray-400 mt-0.5">
                Vertical → 16:9 with center crop chops headlines and CTAs. Letterbox preserves
                the full frame and fills the sides with a blurred copy. Recommended.
              </p>
            </div>
            <button
              onClick={() => setLetterboxHorizontal((v) => !v)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${letterboxHorizontal ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${letterboxHorizontal ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
        )}
      </div>

      {/* Drop zone */}
      <div
        ref={dropRef}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileInputRef.current?.click()}
        className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-8 text-center cursor-pointer hover:border-amber-400 dark:hover:border-amber-500 transition-colors bg-white dark:bg-gray-800"
      >
        <Upload className="w-10 h-10 mx-auto mb-3 text-gray-400" />
        <p className="text-gray-600 dark:text-gray-400 font-medium">Drop, paste, or click to upload</p>
        <p className="text-xs text-gray-400 mt-1">MP4, MOV, M4V, WebM, AVI, MKV — up to 500MB each, 20 per batch</p>
        <p className="text-[10px] text-gray-400 mt-1">Tip: copy a video file (⌘/Ctrl+C in Finder/Explorer) then press ⌘/Ctrl+V anywhere on this page</p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="video/*,.mp4,.mov,.m4v,.webm,.avi,.mkv"
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {/* Queue */}
      {videos.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-gray-200 dark:border-gray-700">
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                {videos.length} Video{videos.length > 1 ? 's' : ''} Queued
              </h3>
              {(processingCount > 0 || completedCount > 0 || failedCount > 0) && (
                <p className="text-xs text-gray-400 mt-1">
                  {processingCount > 0 && <span className="mr-2"><Loader2 className="w-3 h-3 inline animate-spin mr-0.5" />{processingCount} processing</span>}
                  {completedCount > 0 && <span className="mr-2 text-green-500">✓ {completedCount} done</span>}
                  {failedCount > 0 && <span className="text-red-500">✗ {failedCount} failed</span>}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={clearAll}
                className="px-3 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
              >
                Clear All
              </button>
              {completedCount > 1 && (
                <button
                  onClick={downloadAll}
                  className="px-3 py-1.5 text-xs bg-blue-500 text-white rounded-lg hover:bg-blue-600 flex items-center gap-1"
                >
                  <Download className="w-3.5 h-3.5" /> Download All
                </button>
              )}
              <button
                onClick={sanitizeAll}
                disabled={submitting || processingCount > 0}
                className="px-4 py-1.5 text-xs bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 font-medium"
              >
                {submitting || processingCount > 0 ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Processing…</>
                ) : (
                  <>Sanitize All — {LEVELS.find((l) => l.id === level)?.name}</>
                )}
              </button>
            </div>
          </div>

          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {videos.map((vid, idx) => {
              const jobId = jobsByVideoIdx[idx];
              const job = jobId ? jobs[jobId] : null;
              const isProcessing = job && ['queued', 'processing'].includes(job.status);
              const isDone = job?.status === 'completed';
              const isFailed = job?.status === 'failed';
              const delogo = delogoByIdx[idx];
              const isExpanded = expandedActions[idx];
              const metadataStripped = job?.report?.probe?.metadata_count ?? 0;
              const suspiciousCount = job?.report?.probe?.suspicious_tags?.length ?? 0;
              const sanitizedUrl = job?.url
                ? (job.url.startsWith('http') ? job.url : `${API_URL.replace('/api/v1', '')}${job.url}`)
                : null;
              return (
                <div key={idx} className="flex flex-col md:flex-row md:items-center gap-4 p-4">
                  {/* Original thumbnail */}
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <div className="relative">
                      <div className="w-24 h-16 rounded-lg overflow-hidden bg-black">
                        <video src={vid.preview} className="w-full h-full object-cover" muted preload="metadata" />
                      </div>
                      <div className="absolute -bottom-1 -right-1 text-[9px] bg-gray-700 text-white px-1 rounded shadow">orig</div>
                    </div>
                    {sanitizedUrl && (
                      <>
                        <div className="text-gray-300 dark:text-gray-600">→</div>
                        <div className="relative">
                          <div className="w-24 h-16 rounded-lg overflow-hidden bg-black">
                            <video src={sanitizedUrl} className="w-full h-full object-cover" muted preload="metadata" />
                          </div>
                          <div className="absolute -bottom-1 -right-1 text-[9px] bg-green-600 text-white px-1 rounded shadow">clean</div>
                        </div>
                      </>
                    )}
                    {isDone && job?.variants && Object.keys(job.variants).length > 0 && (
                      <>
                        <div className="text-gray-300 dark:text-gray-600">+</div>
                        <div className="flex flex-wrap gap-1.5">
                          {ALL_RATIOS.filter((r) => job.variants[r]).map((ratio) => {
                            const v = job.variants[ratio];
                            const variantUrl = v.url.startsWith('http') ? v.url : `${API_URL.replace('/api/v1', '')}${v.url}`;
                            return (
                              <button
                                key={ratio}
                                onClick={() => downloadVariant(job, ratio, v)}
                                title={`${v.width}×${v.height} (${v.fit_mode}) — click to download`}
                                className="group relative"
                              >
                                <div className="w-14 h-14 rounded-md overflow-hidden bg-black border border-blue-300 dark:border-blue-700 group-hover:border-blue-500 transition-colors">
                                  <video src={variantUrl} className="w-full h-full object-cover" muted preload="metadata" />
                                </div>
                                <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[9px] bg-blue-600 text-white px-1 rounded shadow whitespace-nowrap">
                                  {ratio}
                                </div>
                                <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 rounded-md transition-colors">
                                  <Download className="w-4 h-4 text-white opacity-0 group-hover:opacity-100" />
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{vid.name}</p>
                    <p className="text-xs text-gray-400">
                      {(vid.size / (1024 * 1024)).toFixed(1)} MB
                      {delogo && (
                        <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400">
                          <Crosshair className="w-3 h-3" /> delogo {delogo.w}×{delogo.h} @ {delogo.x},{delogo.y}
                        </span>
                      )}
                    </p>
                    {isDone && job.report && (
                      <>
                        <div className="mt-1.5 flex flex-wrap gap-1 items-center">
                          {/* Metadata diff pill — the headline number the user cares about */}
                          {metadataStripped > 0 && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded">
                              <CheckCircle className="w-3 h-3" /> Stripped {metadataStripped} metadata tag{metadataStripped !== 1 ? 's' : ''}
                            </span>
                          )}
                          {suspiciousCount > 0 && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded">
                              <AlertTriangle className="w-3 h-3" /> Removed {suspiciousCount} suspicious tag{suspiciousCount !== 1 ? 's' : ''}
                            </span>
                          )}
                          {(isExpanded ? job.report.actions : job.report.actions?.slice(0, 3))?.map((a, i) => (
                            <span key={i} className="inline-block px-1.5 py-0.5 text-[10px] bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded">
                              {a}
                            </span>
                          ))}
                          {job.report.actions?.length > 3 && (
                            <button
                              onClick={() => setExpandedActions((prev) => ({ ...prev, [idx]: !isExpanded }))}
                              className="inline-block px-1.5 py-0.5 text-[10px] bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                            >
                              {isExpanded ? '− collapse' : `+${job.report.actions.length - 3} more`}
                            </button>
                          )}
                        </div>
                        {job.elapsed_s != null && (
                          <p className="text-[10px] text-gray-400 mt-1">Took {job.elapsed_s}s · size change {job.report.size_change}</p>
                        )}
                      </>
                    )}
                    {isFailed && <p className="text-xs text-red-500 mt-1">{job.error}</p>}
                    {isProcessing && <p className="text-xs text-amber-500 mt-1 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> {job.status}</p>}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {isDone && sanitizedUrl && (
                      <>
                        <a
                          href={sanitizedUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                          title="Open R2 link in new tab"
                        >
                          <ExternalLink className="w-4 h-4 text-green-500" />
                        </a>
                        <button
                          onClick={() => copyLink(job)}
                          className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                          title="Copy R2 link"
                        >
                          <LinkIcon className="w-4 h-4 text-blue-500" />
                        </button>
                        <button
                          onClick={() => downloadResult(job)}
                          className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                          title="Download sanitized video"
                        >
                          <Download className="w-4 h-4 text-amber-600" />
                        </button>
                      </>
                    )}
                    {isFailed && <AlertTriangle className="w-5 h-5 text-red-500" />}
                    <button
                      onClick={() => setDelogoModalIdx(idx)}
                      className={`p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 ${delogo ? 'bg-red-50 dark:bg-red-900/20' : ''}`}
                      title={delogo ? 'Edit watermark region' : 'Mark watermark region'}
                    >
                      <Target className={`w-4 h-4 ${delogo ? 'text-red-500' : 'text-gray-400'}`} />
                    </button>
                    <button
                      onClick={() => analyzeVideo(idx)}
                      disabled={analyzing[idx]}
                      className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                      title="Analyze metadata"
                    >
                      {analyzing[idx] ? (
                        <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                      ) : (
                        <Eye className="w-4 h-4 text-blue-500" />
                      )}
                    </button>
                    <button
                      onClick={() => removeVideo(idx)}
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

      {/* Analysis panel */}
      {analysis && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-blue-200 dark:border-blue-700 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Info className="w-5 h-5 text-blue-500" />
              <h3 className="font-semibold text-gray-900 dark:text-gray-100">Analysis: {videos[analysis.idx]?.name}</h3>
            </div>
            <button onClick={() => setAnalysis(null)} className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700">
              <X className="w-4 h-4 text-gray-400" />
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
              <div className="text-xs text-gray-400 mb-1">Codec</div>
              <div className="font-medium text-gray-900 dark:text-gray-100">{analysis.data.video_codec || '—'} / {analysis.data.audio_codec || '—'}</div>
            </div>
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
              <div className="text-xs text-gray-400 mb-1">Dimensions</div>
              <div className="font-medium text-gray-900 dark:text-gray-100">{analysis.data.width}×{analysis.data.height}</div>
            </div>
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
              <div className="text-xs text-gray-400 mb-1">Duration</div>
              <div className="font-medium text-gray-900 dark:text-gray-100">{analysis.data.duration_s?.toFixed(1)}s</div>
            </div>
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
              <div className="text-xs text-gray-400 mb-1">Size</div>
              <div className="font-medium text-gray-900 dark:text-gray-100">{(analysis.data.size_bytes / (1024 * 1024)).toFixed(1)} MB</div>
            </div>
          </div>

          {analysis.data.suspicious_tags?.length > 0 && (
            <div>
              <div className="text-xs font-medium text-red-500 mb-2 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                Suspicious tags found ({analysis.data.suspicious_tags.length})
              </div>
              <div className="flex flex-wrap gap-1.5">
                {analysis.data.suspicious_tags.map((t, i) => (
                  <span key={i} className="px-2 py-1 text-xs rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 font-medium">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}

          {analysis.data.metadata_found?.length > 0 ? (
            <div>
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
                Metadata found ({analysis.data.metadata_found.length} items)
              </div>
              <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
                {analysis.data.metadata_found.map((item, i) => (
                  <span key={i} className="px-2 py-1 text-xs rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 font-mono">
                    {item}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-green-600 dark:text-green-400 text-sm">
              <CheckCircle className="w-4 h-4" />
              <span>No metadata detected — video appears clean</span>
            </div>
          )}
        </div>
      )}

      {/* Delogo modal */}
      {delogoModalIdx !== null && videos[delogoModalIdx] && (
        <DelogoModal
          video={videos[delogoModalIdx]}
          initial={delogoByIdx[delogoModalIdx]}
          onSave={(region) => {
            setDelogoByIdx((prev) => {
              const next = { ...prev };
              if (region) next[delogoModalIdx] = region;
              else delete next[delogoModalIdx];
              return next;
            });
          }}
          onClose={() => setDelogoModalIdx(null)}
        />
      )}

      {/* Info footer */}
      <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-700 p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-amber-800 dark:text-amber-200 space-y-1">
            <p className="font-medium">How this works</p>
            <p><strong>Light</strong> rewrites the MP4 container without re-encoding. Strips FB-injected UUIDs, `com.facebook.*` tags, encoder strings, and handler names. Video quality is identical to the source.</p>
            <p><strong>Balanced</strong> re-encodes H.264/AAC with fresh encoder state, crops 1-2.5% off each edge (biggest perceptual-hash breaker), applies tiny color shifts, trims head/tail. Safe for any video with on-screen text.</p>
            <p><strong>Aggressive</strong> adds grain overlay, speed shift, wider color ranges. Best for videos previously flagged as duplicates. Every parameter is randomized per job — sanitizing the same source twice produces different fingerprints, so the transforms themselves can't become a fingerprint.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
