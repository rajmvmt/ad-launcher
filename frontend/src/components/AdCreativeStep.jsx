import { useToast } from '../context/ToastContext';
import React, { useState, useEffect, useCallback } from 'react';
import { ChevronRight, ChevronLeft, Upload, X, Loader, Trash2, Film, Image, Sparkles, Play, Check, Link, Eye, Target, Users, Maximize2, RotateCcw, MessageCircle, Copy, Bookmark, Save, Camera, Zap } from 'lucide-react';
import { getHeadlinePresets, createHeadlinePreset, deleteHeadlinePreset } from '../lib/headlinePresetsApi';
import AdPreview, { FeedPreview, StoryPreview } from './AdPreview';
import { useCampaign } from '../context/CampaignContext';
import { useAuth } from '../context/AuthContext';
import { getPages, getPageInfo, extractVideoFrames } from '../lib/facebookApi';
import { uploadFileWithProgress } from '../lib/uploadFile';
import { useBrands } from '../context/BrandContext';
import { expandExistingPostCreatives } from './adCreativeHelpers';

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm'];

// Facebook CTA types - confirmed working
const CTA_OPTIONS = [
    'NO_BUTTON',
    'LEARN_MORE',
    'SHOP_NOW',
    'SIGN_UP',
    'CONTACT_US',
    'DOWNLOAD',
    'BOOK_NOW',
    'BUY_TICKETS',
    'GET_QUOTE',
    'DONATE_NOW',
];

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';
const API_ORIGIN = API_URL.replace(/\/api\/v1$/, '');

// Backend-relative /uploads/... paths need the API origin prefixed before they
// can be rendered by the frontend (which is served from a different host).
const resolveUploadUrl = (url) => {
    if (!url) return url;
    if (/^(https?:|blob:|data:)/.test(url)) return url;
    if (url.startsWith('/')) return `${API_ORIGIN}${url}`;
    return url;
};

const AdCreativeStep = ({ onNext, onBack }) => {
    const { showWarning, showError, showSuccess } = useToast();
    const { authFetch } = useAuth();
    const { creativeData, setCreativeData, selectedAdAccount, selectedConnection, selectedProduct, adsetData, campaignData, addingNewAd, setAddingNewAd } = useCampaign();
    const [pages, setPages] = useState([]);
    const [loadingPages, setLoadingPages] = useState(false);
    const [analyzingVideoId, setAnalyzingVideoId] = useState(null);
    const [analyzingProvider, setAnalyzingProvider] = useState(null);
    const [providerMenuId, setProviderMenuId] = useState(null);

    // Multi-post support: existingPostId holds raw textarea content.
    // IDs are separated by newline OR comma; one ad is created per ID under the same ad set.
    const parsePostIds = (raw) => (raw || '')
        .split(/[\n,]+/)
        .map(s => s.trim())
        .filter(Boolean);

    const [postPreviews, setPostPreviews] = useState([]); // [{ id, thumbnail, message, type, permalink, isDarkPost, previewNote, error? }]
    const [postPreviewLoading, setPostPreviewLoading] = useState(false);
    const [postPreviewError, setPostPreviewError] = useState('');

    const fetchPostPreview = useCallback(async () => {
        const ids = parsePostIds(creativeData.existingPostId);
        if (ids.length === 0) { setPostPreviews([]); setPostPreviewError(''); return; }
        if (!creativeData.pageId) { setPostPreviewError('Select a Facebook Page above first'); return; }
        setPostPreviewLoading(true);
        setPostPreviewError('');
        try {
            const params = new URLSearchParams({ page_id: creativeData.pageId });
            const uniqueIds = Array.from(new Set(ids));
            const fetched = await Promise.all(uniqueIds.map(async (postId) => {
                try {
                    const res = await authFetch(`${API_URL}/facebook/posts/${encodeURIComponent(postId)}/preview?${params}`);
                    if (!res.ok) {
                        const err = await res.json().catch(() => ({}));
                        return { id: postId, error: err.detail || 'Could not fetch post' };
                    }
                    const data = await res.json();
                    return {
                        id: postId,
                        thumbnail: data.full_picture || data.picture || null,
                        message: data.message || '',
                        type: data.type,
                        permalink: data.permalink_url,
                        isDarkPost: !!data.is_dark_post,
                        previewNote: data.preview_note || '',
                    };
                } catch (e) {
                    return { id: postId, error: e.message || 'Failed to load' };
                }
            }));
            const byId = Object.fromEntries(fetched.map(p => [p.id, p]));
            const previews = ids.map(id => byId[id]);
            setPostPreviews(previews);
            // Stash first valid preview for legacy single-post rendering elsewhere (BulkAdCreation summary)
            const first = previews.find(p => !p.error);
            if (first) {
                setCreativeData(prev => ({
                    ...prev,
                    existingPostThumbnail: first.thumbnail,
                    existingPostMessage: first.message,
                }));
            }
        } finally {
            setPostPreviewLoading(false);
        }
    }, [creativeData.existingPostId, creativeData.pageId, authFetch, setCreativeData]);

    const [manualPageEntry, setManualPageEntry] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [playingVideo, setPlayingVideo] = useState(null);
    const [previewCreative, setPreviewCreative] = useState(null);
    const [fullsizeImage, setFullsizeImage] = useState(null);
    const [inlinePreviewPlacement, setInlinePreviewPlacement] = useState('feed');

    // Thumbnail picker state
    const [thumbPickerCreative, setThumbPickerCreative] = useState(null); // creative object being picked for
    const [thumbFrames, setThumbFrames] = useState([]); // extracted frame URLs
    const [thumbOpeningCount, setThumbOpeningCount] = useState(0); // number of leading "opening" hook frames in thumbFrames
    const [extractingThumbs, setExtractingThumbs] = useState(false);

    // Mass AI analysis
    const [massAnalyzing, setMassAnalyzing] = useState(false);
    const [massAnalysisProgress, setMassAnalysisProgress] = useState({ current: 0, total: 0, provider: '' });
    const [showMassProviderMenu, setShowMassProviderMenu] = useState(false);
    const [aiLanguage, setAiLanguage] = useState(() => localStorage.getItem('adCreativeStep_aiLanguage') || 'English');

    useEffect(() => {
        localStorage.setItem('adCreativeStep_aiLanguage', aiLanguage);
    }, [aiLanguage]);

    // Per-creative mode
    const [currentCreativeIndex, setCurrentCreativeIndex] = useState(0);

    // Headline presets
    const [presets, setPresets] = useState([]);
    const [showSavePreset, setShowSavePreset] = useState(false);
    const [presetName, setPresetName] = useState('');
    const [presetOffer, setPresetOffer] = useState('');
    const [savingPreset, setSavingPreset] = useState(false);

    const { brands, activeBrand } = useBrands();

    // When coming from "Add Another Ad", reset the flag
    useEffect(() => {
        if (addingNewAd) {
            setAddingNewAd(false);
        }
    }, [addingNewAd]);

    // Load headline presets on mount
    useEffect(() => {
        getHeadlinePresets(authFetch).then(setPresets).catch(() => {});
    }, [authFetch]);

    const handleApplyPreset = (preset) => {
        const updates = { headlines: [...preset.headlines] };
        if (preset.primary_texts && preset.primary_texts.length > 0) {
            updates.bodies = [...preset.primary_texts];
        }
        if (preset.description) {
            updates.description = preset.description;
        }
        setCreativeData(prev => ({ ...prev, ...updates }));
        showSuccess(`Applied preset "${preset.name}"`);
    };

    const handleApplyPresetPerCreative = (preset) => {
        const updated = [...(creativeData.creatives || [])];
        if (updated[currentCreativeIndex]) {
            updated[currentCreativeIndex] = {
                ...updated[currentCreativeIndex],
                headlines: [...preset.headlines],
                ...(preset.primary_texts?.length > 0 ? { bodies: [...preset.primary_texts] } : {}),
                ...(preset.description ? { description: preset.description } : {}),
            };
            setCreativeData(prev => ({ ...prev, creatives: updated }));
            showSuccess(`Applied preset "${preset.name}"`);
        }
    };

    const handleSavePreset = async () => {
        if (!presetName.trim() || !presetOffer.trim()) {
            showError('Name and offer are required');
            return;
        }
        setSavingPreset(true);
        try {
            const isPerCreative = creativeData.creativeMode === 'per_creative';
            const currentCreative = isPerCreative ? creativeData.creatives?.[currentCreativeIndex] : null;
            const headlines = isPerCreative
                ? (currentCreative?.headlines || []).filter(Boolean)
                : (creativeData.headlines || []).filter(Boolean);
            const bodies = isPerCreative
                ? (currentCreative?.bodies || []).filter(Boolean)
                : (creativeData.bodies || []).filter(Boolean);
            const desc = isPerCreative
                ? currentCreative?.description
                : creativeData.description;

            if (headlines.length === 0) {
                showError('Enter at least one headline before saving');
                setSavingPreset(false);
                return;
            }

            const saved = await createHeadlinePreset(authFetch, {
                name: presetName.trim(),
                offer: presetOffer.trim().toLowerCase(),
                headlines,
                primary_texts: bodies.length > 0 ? bodies : null,
                description: desc || null,
            });
            setPresets(prev => [...prev, saved]);
            setShowSavePreset(false);
            setPresetName('');
            setPresetOffer('');
            showSuccess(`Saved preset "${saved.name}"`);
        } catch (err) {
            showError(err.message || 'Failed to save preset');
        } finally {
            setSavingPreset(false);
        }
    };

    const handleDeletePreset = async (presetId) => {
        try {
            await deleteHeadlinePreset(authFetch, presetId);
            setPresets(prev => prev.filter(p => p.id !== presetId));
            showSuccess('Preset deleted');
        } catch (err) {
            showError('Failed to delete preset');
        }
    };

    const handleDragEnter = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    };

    const handleDragOver = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    };

    const handleDragLeave = (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Only set dragging to false if leaving the drop zone entirely
        if (e.currentTarget.contains(e.relatedTarget)) return;
        setIsDragging(false);
    };

    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);

        const files = Array.from(e.dataTransfer.files);
        if (files.length === 0) return;

        // Filter for images and videos
        const mediaFiles = files.filter(file =>
            ALLOWED_IMAGE_TYPES.includes(file.type) || ALLOWED_VIDEO_TYPES.includes(file.type)
        );

        if (mediaFiles.length === 0) {
            showWarning('Please drop image or video files only');
            return;
        }

        const newCreatives = mediaFiles.map(file => {
            const isVideo = ALLOWED_VIDEO_TYPES.includes(file.type);
            return {
                id: `creative_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                file,
                previewUrl: URL.createObjectURL(file),
                name: file.name,
                mediaType: isVideo ? 'video' : 'image'
            };
        });

        setCreativeData(prev => {
            const updated = {
                ...prev,
                creatives: [...(prev.creatives || []), ...newCreatives]
            };
            // Auto-fill Creative Name from file name if empty or just the adset name
            if (!prev.creativeName || prev.creativeName === adsetData?.name) {
                const baseName = mediaFiles[0].name.replace(/\.[^/.]+$/, '');
                if (mediaFiles.length === 1) {
                    updated.creativeName = baseName;
                } else {
                    updated.creativeName = `${baseName} (+${mediaFiles.length - 1} more)`;
                }
            }
            return updated;
        });
    };

    const handlePaste = (e) => {
        const items = Array.from(e.clipboardData?.items || []);
        const mediaFiles = items
            .filter(item => ALLOWED_IMAGE_TYPES.includes(item.type) || ALLOWED_VIDEO_TYPES.includes(item.type))
            .map(item => item.getAsFile())
            .filter(Boolean);

        if (mediaFiles.length === 0) return;

        e.preventDefault();

        const newCreatives = mediaFiles.map(file => {
            const isVideo = ALLOWED_VIDEO_TYPES.includes(file.type);
            const ext = file.type.split('/')[1] || 'png';
            const name = `pasted_${Date.now()}.${ext}`;
            return {
                id: `creative_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                file,
                previewUrl: URL.createObjectURL(file),
                name,
                mediaType: isVideo ? 'video' : 'image'
            };
        });

        setCreativeData(prev => ({
            ...prev,
            creatives: [...(prev.creatives || []), ...newCreatives]
        }));
        showSuccess(`Pasted ${newCreatives.length} image${newCreatives.length > 1 ? 's' : ''}`);
    };

    // Global paste listener so Ctrl+V works anywhere on the creative step
    useEffect(() => {
        const onGlobalPaste = (e) => {
            // Don't intercept if user is typing in an input/textarea
            const tag = e.target?.tagName?.toLowerCase();
            if (tag === 'input' || tag === 'textarea') return;

            const items = Array.from(e.clipboardData?.items || []);
            const hasMedia = items.some(item =>
                ALLOWED_IMAGE_TYPES.includes(item.type) || ALLOWED_VIDEO_TYPES.includes(item.type)
            );
            if (hasMedia) handlePaste(e);
        };
        document.addEventListener('paste', onGlobalPaste);
        return () => document.removeEventListener('paste', onGlobalPaste);
    }, []);

    // Prepopulate Creative Name with Ad Set Name if empty
    useEffect(() => {
        if (adsetData?.name && !creativeData.creativeName) {
            handleInputChange('creativeName', adsetData.name);
        }
    }, [adsetData?.name]);

    // Load last used page ID on mount
    useEffect(() => {
        const lastUsedPageId = localStorage.getItem('lastUsedPageId');
        if (lastUsedPageId && !creativeData.pageId) {
            handleInputChange('pageId', lastUsedPageId);
        }
    }, []);

    // Load default URL from local storage for this ad account
    useEffect(() => {
        if (selectedAdAccount && !creativeData.websiteUrl) {
            const savedUrl = localStorage.getItem(`defaultUrl_${selectedAdAccount.id}`);
            if (savedUrl) {
                handleInputChange('websiteUrl', savedUrl);
            }
        }
    }, [selectedAdAccount]);

    // Fetch pages when ad account or connection is selected
    useEffect(() => {
        if (selectedAdAccount) {
            fetchPages();
        }
    }, [selectedAdAccount, selectedConnection]);

    const loadSavedManualPages = () => {
        try {
            const saved = localStorage.getItem('savedManualPages');
            return saved ? JSON.parse(saved) : [];
        } catch { return []; }
    };

    const mergePages = async (fetchedPages) => {
        const savedPages = loadSavedManualPages();
        const fetchedIds = new Set(fetchedPages.map(p => p.id));

        // Update saved pages with real names - from fetched list or individual lookup
        let needsSave = false;
        const updatedSaved = await Promise.all(savedPages.map(async (sp) => {
            if (sp.name && !/^\d+$/.test(sp.name) && !sp.name.startsWith('Page ')) return sp; // already has real name

            // Check fetched pages first
            const fetched = fetchedPages.find(fp => fp.id === sp.id);
            if (fetched) {
                needsSave = true;
                return { ...sp, name: fetched.name };
            }

            // Look up individually via Graph API
            try {
                const info = await getPageInfo(sp.id);
                if (info?.name) {
                    needsSave = true;
                    return { ...sp, name: info.name };
                }
            } catch (e) { /* keep generic name */ }
            return sp;
        }));

        if (needsSave) {
            localStorage.setItem('savedManualPages', JSON.stringify(updatedSaved));
        }

        const uniqueSaved = updatedSaved.filter(p => !fetchedIds.has(p.id));
        return [...fetchedPages, ...uniqueSaved];
    };

    const handleSaveManualPage = async () => {
        const pageId = creativeData.pageId?.trim();
        if (!pageId) return;
        const savedPages = loadSavedManualPages();
        if (savedPages.some(p => p.id === pageId)) {
            showWarning('This Page ID is already saved');
            return;
        }

        // Fetch the real page name from Facebook Graph API
        let pageName = pageId;
        try {
            const pageInfo = await getPageInfo(pageId);
            if (pageInfo?.name) pageName = pageInfo.name;
        } catch (e) {
            // Fall back to generic name if lookup fails
            console.warn('Could not look up page name:', e);
        }

        const updated = [...savedPages, { id: pageId, name: pageName }];
        localStorage.setItem('savedManualPages', JSON.stringify(updated));
        setPages(prev => {
            if (prev.some(p => p.id === pageId)) return prev;
            return [...prev, { id: pageId, name: pageName }];
        });
        showSuccess(`Saved: ${pageName}`);
    };

    const fetchPages = async () => {
        setLoadingPages(true);
        try {
            const connParam = selectedConnection?.id ? `?connection_id=${selectedConnection.id}` : '';
            const pagesRes = await authFetch(`${API_URL}/facebook/pages${connParam}`);
            let rawPages = [];
            if (pagesRes.ok) {
                rawPages = await pagesRes.json();
            }
            const fetchedPages = rawPages.map(p => ({ id: p.id, name: p.name, accessToken: p.access_token, category: p.category }));
            const combined = await mergePages(fetchedPages);
            setPages(combined);

            // If no page is selected and we have pages, select the first one (or the last used one if it exists in the list)
            if (combined.length > 0 && !creativeData.pageId) {
                const lastUsedPageId = localStorage.getItem('lastUsedPageId');
                const pageToSelect = combined.find(p => p.id === lastUsedPageId) || combined[0];
                handlePageSelection(pageToSelect.id, combined);
            } else if (combined.length === 0) {
                // If no pages found, default to manual entry so user isn't blocked
                setManualPageEntry(true);
            }
        } catch (error) {
            console.error('Error fetching pages:', error);
            // Still load saved manual pages even if fetch fails
            const savedPages = loadSavedManualPages();
            if (savedPages.length > 0) {
                setPages(savedPages);
            }
            showError('Failed to load Facebook Pages. You can enter Page ID manually.');
            setManualPageEntry(true); // Auto-switch to manual entry
        } finally {
            setLoadingPages(false);
        }
    };

    const handlePageSelection = (pageId, currentPages = pages) => {
        const selectedPage = currentPages.find(p => p.id === pageId);
        setCreativeData(prev => ({
            ...prev,
            pageId,
            instagramId: selectedPage ? selectedPage.instagramId : null
        }));
        localStorage.setItem('lastUsedPageId', pageId);
    };

    // Load saved creative fields from local storage for this ad account
    useEffect(() => {
        if (selectedAdAccount) {
            const savedHeadlines = localStorage.getItem(`defaultHeadlines_${selectedAdAccount.id}`);
            const savedBodies = localStorage.getItem(`defaultBodies_${selectedAdAccount.id}`);
            const savedDescription = localStorage.getItem(`defaultDescription_${selectedAdAccount.id}`);
            const savedCta = localStorage.getItem(`defaultCta_${selectedAdAccount.id}`);

            if (savedHeadlines && !(creativeData.headlines || [])[0]) {
                try {
                    const parsedHeadlines = JSON.parse(savedHeadlines);
                    if (Array.isArray(parsedHeadlines) && parsedHeadlines.length > 0) {
                        setCreativeData(prev => ({ ...prev, headlines: parsedHeadlines }));
                    }
                } catch (e) { console.error('Error parsing saved headlines', e); }
            }

            if (savedBodies && !(creativeData.bodies || [])[0]) {
                try {
                    const parsedBodies = JSON.parse(savedBodies);
                    if (Array.isArray(parsedBodies) && parsedBodies.length > 0) {
                        setCreativeData(prev => ({ ...prev, bodies: parsedBodies }));
                    }
                } catch (e) { console.error('Error parsing saved bodies', e); }
            }

            if (savedDescription && !creativeData.description) {
                setCreativeData(prev => ({ ...prev, description: savedDescription }));
            }

            if (savedCta && !creativeData.cta) {
                setCreativeData(prev => ({ ...prev, cta: savedCta }));
            }
        }
    }, [selectedAdAccount]);

    const handleInputChange = (field, value) => {
        setCreativeData(prev => ({
            ...prev,
            [field]: value,
            // When manually entering a Page ID, clear the instagramId to prevent using Page ID as IG ID
            ...(field === 'pageId' ? { instagramId: null } : {})
        }));

        // Persist page ID
        if (field === 'pageId') {
            localStorage.setItem('lastUsedPageId', value);
        }

        // Persist description
        if (field === 'description' && selectedAdAccount) {
            localStorage.setItem(`defaultDescription_${selectedAdAccount.id}`, value);
        }

        // Persist CTA
        if (field === 'cta' && selectedAdAccount) {
            localStorage.setItem(`defaultCta_${selectedAdAccount.id}`, value);
        }
    };

    const handleBodyChange = (index, value) => {
        const newBodies = [...(creativeData.bodies || [''])];
        newBodies[index] = value;
        setCreativeData(prev => ({
            ...prev,
            bodies: newBodies
        }));

        if (selectedAdAccount) {
            localStorage.setItem(`defaultBodies_${selectedAdAccount.id}`, JSON.stringify(newBodies));
        }
    };

    const handleHeadlineChange = (index, value) => {
        const newHeadlines = [...(creativeData.headlines || [''])];
        newHeadlines[index] = value;
        setCreativeData(prev => ({
            ...prev,
            headlines: newHeadlines
        }));

        if (selectedAdAccount) {
            localStorage.setItem(`defaultHeadlines_${selectedAdAccount.id}`, JSON.stringify(newHeadlines));
        }
    };

    const addBodyField = () => {
        if ((creativeData.bodies || []).length < 6) {
            setCreativeData(prev => ({
                ...prev,
                bodies: [...(prev.bodies || ['']), '']
            }));
        }
    };

    const addHeadlineField = () => {
        if ((creativeData.headlines || []).length < 6) {
            setCreativeData(prev => ({
                ...prev,
                headlines: [...(prev.headlines || ['']), '']
            }));
        }
    };

    const removeBodyField = (index) => {
        if ((creativeData.bodies || []).length > 1) {
            const newBodies = (creativeData.bodies || []).filter((_, i) => i !== index);
            setCreativeData(prev => ({
                ...prev,
                bodies: newBodies
            }));
        }
    };

    const removeHeadlineField = (index) => {
        if ((creativeData.headlines || []).length > 1) {
            const newHeadlines = (creativeData.headlines || []).filter((_, i) => i !== index);
            setCreativeData(prev => ({
                ...prev,
                headlines: newHeadlines
            }));
        }
    };

    // Per-creative mode helpers
    const isPerCreative = creativeData.creativeMode === 'per_creative';
    const currentCreative = creativeData.creatives?.[currentCreativeIndex];

    const updateCreativeField = (creativeIndex, field, value) => {
        setCreativeData(prev => {
            const newCreatives = [...prev.creatives];
            newCreatives[creativeIndex] = { ...newCreatives[creativeIndex], [field]: value };
            return { ...prev, creatives: newCreatives };
        });
    };

    const handlePerCreativeBodyChange = (bodyIndex, value) => {
        const bodies = [...(currentCreative?.bodies || [''])];
        bodies[bodyIndex] = value;
        updateCreativeField(currentCreativeIndex, 'bodies', bodies);
    };

    const handlePerCreativeHeadlineChange = (headlineIndex, value) => {
        const headlines = [...(currentCreative?.headlines || [''])];
        headlines[headlineIndex] = value;
        updateCreativeField(currentCreativeIndex, 'headlines', headlines);
    };

    const addPerCreativeBody = () => {
        const bodies = currentCreative?.bodies || [''];
        if (bodies.length < 6) {
            updateCreativeField(currentCreativeIndex, 'bodies', [...bodies, '']);
        }
    };

    const addPerCreativeHeadline = () => {
        const headlines = currentCreative?.headlines || [''];
        if (headlines.length < 6) {
            updateCreativeField(currentCreativeIndex, 'headlines', [...headlines, '']);
        }
    };

    const removePerCreativeBody = (index) => {
        const bodies = currentCreative?.bodies || [''];
        if (bodies.length > 1) {
            updateCreativeField(currentCreativeIndex, 'bodies', bodies.filter((_, i) => i !== index));
        }
    };

    const removePerCreativeHeadline = (index) => {
        const headlines = currentCreative?.headlines || [''];
        if (headlines.length > 1) {
            updateCreativeField(currentCreativeIndex, 'headlines', headlines.filter((_, i) => i !== index));
        }
    };

    // Initialize per-creative fields when switching to per-creative mode
    React.useEffect(() => {
        if (isPerCreative && creativeData.creatives.length > 0) {
            const needsInit = creativeData.creatives.some(c => !c.headlines);
            if (needsInit) {
                setCreativeData(prev => ({
                    ...prev,
                    creatives: prev.creatives.map(c =>
                        !c.headlines ? { ...c, headlines: [''], bodies: [''], description: '', cta: 'LEARN_MORE' } : c
                    )
                }));
            }
        }
    }, [isPerCreative, creativeData.creatives.length]);

    // Upload a video's local file/blob to the server so the backend has a reachable URL.
    // Returns the server URL (e.g. /uploads/abc.mp4 or an R2 URL).
    const ensureServerVideoUrl = async (creative) => {
        // Already a server/http URL that's not a blob? Use as-is.
        const existing = creative.videoUrl || creative.previewUrl;
        if (existing && !existing.startsWith('blob:')) return existing;

        // No usable source? This typically happens after a page refresh — File
        // objects and blob: URLs don't survive across reloads. The user has to
        // re-upload the media.
        if (!creative.file && (!existing || existing.startsWith('blob:'))) {
            throw new Error('This video was not uploaded to the server yet. After a page refresh, local files are lost — please remove this creative and re-upload the video.');
        }

        // Need to upload. Fetch blob (from File or blob URL), POST to /uploads.
        // The backend validates magic bytes against the file extension, so we
        // detect the real format from the first bytes of the blob and pick a
        // matching extension. MIME-based mapping is the fallback only.
        const MIME_TO_EXT = {
            'video/mp4': 'mp4',
            'video/quicktime': 'mov',
            'video/x-msvideo': 'avi',
            'video/avi': 'avi',
            'video/webm': 'webm',
            'image/jpeg': 'jpg',
            'image/jpg': 'jpg',
            'image/png': 'png',
            'image/gif': 'gif',
            'image/webp': 'webp',
        };
        const safeExtFromMime = (mime) => {
            if (!mime) return null;
            const base = mime.split(';')[0].trim().toLowerCase();
            return MIME_TO_EXT[base] || null;
        };
        const ALLOWED_EXTS = new Set(['mp4','mov','avi','webm','jpg','jpeg','png','gif','webp']);

        const detectExtFromMagic = async (b) => {
            try {
                // Read first 64 bytes — some MP4s have wide/skip/free boxes before ftyp.
                const head = new Uint8Array(await b.slice(0, 64).arrayBuffer());

                // Scan for 'ftyp' marker anywhere in first 64 bytes (handles wide/skip prefix boxes)
                for (let i = 0; i <= head.length - 12; i++) {
                    if (head[i] === 0x66 && head[i+1] === 0x74 && head[i+2] === 0x79 && head[i+3] === 0x70) {
                        const brand = String.fromCharCode(head[i+4], head[i+5], head[i+6], head[i+7]);
                        // qt → mov, everything else (isom, mp42, M4V, 3gp4, dash, etc.) → mp4
                        return brand.startsWith('qt') ? 'mov' : 'mp4';
                    }
                }
                // EBML — webm/mkv.
                if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return 'webm';
                // RIFF container — avi or webp.
                if (head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46) {
                    const sig = String.fromCharCode(head[8], head[9], head[10], head[11]);
                    if (sig === 'AVI ') return 'avi';
                    if (sig === 'WEBP') return 'webp';
                }
                // JPEG / PNG / GIF
                if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpg';
                if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'png';
                if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) return 'gif';

                // Stash the first bytes so the error message can include them for debugging
                const hex = Array.from(head.slice(0, 16)).map(x => x.toString(16).padStart(2, '0')).join(' ');
                const ascii = Array.from(head.slice(0, 16)).map(x => (x >= 0x20 && x < 0x7f) ? String.fromCharCode(x) : '.').join('');
                console.warn('[picker] unrecognized format. First 16 bytes:', hex, '|', ascii);
                return { unknown: true, hex, ascii };
            } catch (e) {
                console.warn('[picker] magic byte read failed:', e);
                return null;
            }
        };

        let blob;
        if (creative.file) {
            blob = creative.file;
        } else {
            const resp = await fetch(existing);
            blob = await resp.blob();
        }

        // Pick extension: magic bytes > original filename ext > MIME > error
        let ext = null;
        const detected = await detectExtFromMagic(blob);
        if (typeof detected === 'string') ext = detected;

        if (!ext && creative.file?.name) {
            const dot = creative.file.name.lastIndexOf('.');
            const origExt = dot >= 0 ? creative.file.name.slice(dot + 1).toLowerCase() : '';
            if (ALLOWED_EXTS.has(origExt)) ext = origExt;
        }
        if (!ext) ext = safeExtFromMime(creative.file?.type || blob.type);
        if (!ext) {
            const dbg = (detected && detected.unknown) ? ` (got: ${detected.hex} / ${detected.ascii})` : '';
            const mime = creative.file?.type || blob.type || 'unknown';
            throw new Error(`Unsupported video format. MIME=${mime}${dbg}. Please re-encode to MP4, MOV, AVI, or WebM.`);
        }
        const filename = `upload.${ext}`;

        // Use the chunked-multipart uploader so big videos in the AI flow
        // get the same resumable behavior as the bulk-publish flow.
        const fileForUpload = (creative.file instanceof File)
            ? creative.file
            : new File([blob], filename, { type: blob.type });
        const { url } = await uploadFileWithProgress(fileForUpload, authFetch);
        // Cache it on the creative so we don't re-upload next time.
        const idx = creativeData.creatives.findIndex(c => c.id === creative.id);
        if (idx !== -1) updateCreativeField(idx, 'videoUrl', url);
        return url;
    };

    const handlePickThumbnail = async (creative) => {
        setExtractingThumbs(true);
        setThumbPickerCreative(creative);
        setThumbFrames([]);
        setThumbOpeningCount(0);
        try {
            const serverUrl = await ensureServerVideoUrl(creative);
            const { frames, opening_count } = await extractVideoFrames(serverUrl, 12);
            setThumbFrames(frames || []);
            setThumbOpeningCount(opening_count || 0);
            if (!frames || frames.length === 0) {
                showWarning('No frames were extracted. Try re-uploading the video.');
            }
        } catch (err) {
            console.error('[picker] extract failed:', err);
            showError(err.message || 'Failed to extract thumbnails');
            setThumbPickerCreative(null);
        } finally {
            setExtractingThumbs(false);
        }
    };

    const handleSelectThumbnail = (frameUrl) => {
        if (!thumbPickerCreative) return;
        const idx = creativeData.creatives.findIndex(c => c.id === thumbPickerCreative.id);
        if (idx !== -1) {
            updateCreativeField(idx, 'thumbnailUrl', frameUrl);
            showSuccess('Thumbnail selected');
        }
        setThumbPickerCreative(null);
        setThumbFrames([]);
        setThumbOpeningCount(0);
    };

    // Fast path: capture frame 0 client-side via <video> + <canvas>, upload JPEG.
    // Does NOT wait for the video to be on the server — pulls the frame from
    // whichever local source we have (File object > blob: URL > existing server
    // URL). Only the small JPEG is uploaded.
    const handleUseFirstFrame = async (creative) => {
        if (extractingThumbs) return;
        setExtractingThumbs(true);
        setThumbPickerCreative(creative);
        let videoEl = null;
        let localUrl = null;
        try {
            // Source priority: File > existing blob:/http: URL > error.
            // The local File / blob loads instantly — no network round-trip.
            let videoSrc;
            if (creative.file instanceof File) {
                localUrl = URL.createObjectURL(creative.file);
                videoSrc = localUrl;
            } else {
                const existing = creative.videoUrl || creative.previewUrl;
                if (!existing) throw new Error('No video source available — re-upload the video');
                videoSrc = existing.startsWith('blob:') ? existing : resolveUploadUrl(existing);
            }

            videoEl = document.createElement('video');
            videoEl.crossOrigin = 'anonymous';
            videoEl.preload = 'auto';
            videoEl.muted = true;
            videoEl.playsInline = true;
            videoEl.src = videoSrc;

            await new Promise((resolve, reject) => {
                videoEl.addEventListener('loadeddata', resolve, { once: true });
                videoEl.addEventListener('error', () => reject(new Error('Could not load video for frame capture')), { once: true });
            });

            // Seek a hair past 0 — some encodes have a black opening frame at t=0.
            await new Promise((resolve, reject) => {
                videoEl.addEventListener('seeked', resolve, { once: true });
                videoEl.addEventListener('error', () => reject(new Error('Seek failed')), { once: true });
                videoEl.currentTime = 0.05;
            });

            const canvas = document.createElement('canvas');
            canvas.width = videoEl.videoWidth || 1080;
            canvas.height = videoEl.videoHeight || 1920;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);

            const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.9));
            if (!blob) throw new Error('Failed to encode first frame as JPEG');

            const formData = new FormData();
            formData.append('file', new File([blob], 'first-frame.jpg', { type: 'image/jpeg' }));
            const resp = await authFetch(`${API_URL}/uploads/`, { method: 'POST', body: formData });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw new Error(err.detail || 'Failed to upload first frame');
            }
            const { url } = await resp.json();

            const idx = creativeData.creatives.findIndex(c => c.id === creative.id);
            if (idx !== -1) updateCreativeField(idx, 'thumbnailUrl', url);
            showSuccess('First frame set as thumbnail');
        } catch (err) {
            console.error('[first-frame]', err);
            showError(err.message || 'Failed to capture first frame');
        } finally {
            if (videoEl) videoEl.src = '';
            if (localUrl) URL.revokeObjectURL(localUrl);
            setExtractingThumbs(false);
            setThumbPickerCreative(null);
        }
    };

    const handleMediaUpload = (e) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        const newCreatives = files.map(file => {
            const isVideo = ALLOWED_VIDEO_TYPES.includes(file.type);
            return {
                id: `creative_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                file,
                previewUrl: URL.createObjectURL(file),
                name: file.name,
                mediaType: isVideo ? 'video' : 'image'
            };
        });

        setCreativeData(prev => {
            const updated = {
                ...prev,
                creatives: [...(prev.creatives || []), ...newCreatives]
            };
            // Auto-fill Creative Name from file name if empty or just the adset name
            if (!prev.creativeName || prev.creativeName === adsetData?.name) {
                const baseName = files[0].name.replace(/\.[^/.]+$/, ''); // strip extension
                if (files.length === 1) {
                    updated.creativeName = baseName;
                } else {
                    updated.creativeName = `${baseName} (+${files.length - 1} more)`;
                }
            }
            return updated;
        });
    };

    const removeCreative = (id) => {
        setCreativeData(prev => ({
            ...prev,
            creatives: prev.creatives.filter(c => c.id !== id)
        }));
    };

    const handleAnalyzeVideo = async (creative, provider = 'gemini') => {
        const videoUrl = creative.videoUrl || creative.previewUrl;
        if (!creative.file && !videoUrl) {
            showWarning('No video file or URL available');
            return;
        }

        setAnalyzingVideoId(creative.id);
        setAnalyzingProvider(provider);
        setProviderMenuId(null);
        try {
            const formData = new FormData();
            if (creative.file) {
                formData.append('file', creative.file);
            } else {
                formData.append('url', videoUrl);
            }

            const brandParam = activeBrand?.id || '';
            const response = await authFetch(`${API_URL}/video-analysis/analyze?provider=${provider}&language=${encodeURIComponent(aiLanguage)}${brandParam ? `&brand_id=${brandParam}` : ''}`, {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err.detail || 'Video analysis failed');
            }

            const data = await response.json();
            const newBodies = (data.bodies || []).filter(b => b && b.trim());
            const newHeadlines = (data.headlines || []).filter(h => h && h.trim());

            if (newBodies.length === 0 && newHeadlines.length === 0) {
                showWarning('AI returned no ad copy. Try a different provider or re-upload the video.');
                return;
            }

            if (isPerCreative) {
                // In per-creative mode, put copy on the specific creative
                const idx = creativeData.creatives.findIndex(c => c.id === creative.id);
                if (idx !== -1) {
                    setCreativeData(prev => {
                        const updated = [...prev.creatives];
                        const existing = updated[idx];
                        if (!existing) return prev;
                        const existingBodies = (existing.bodies || []).filter(b => b && b.trim());
                        const existingHeadlines = (existing.headlines || []).filter(h => h && h.trim());
                        updated[idx] = {
                            ...existing,
                            bodies: [...existingBodies, ...newBodies].slice(0, 6),
                            headlines: [...existingHeadlines, ...newHeadlines].slice(0, 6),
                        };
                        if (updated[idx].bodies.length === 0) updated[idx].bodies = [''];
                        if (updated[idx].headlines.length === 0) updated[idx].headlines = [''];
                        return { ...prev, creatives: updated };
                    });
                    setCurrentCreativeIndex(idx);
                }
            } else {
                setCreativeData(prev => {
                    const existingBodies = (prev.bodies || []).filter(b => b && b.trim());
                    const existingHeadlines = (prev.headlines || []).filter(h => h && h.trim());
                    const mergedBodies = [...existingBodies, ...newBodies].slice(0, 6);
                    const mergedHeadlines = [...existingHeadlines, ...newHeadlines].slice(0, 6);
                    if (mergedBodies.length === 0) mergedBodies.push('');
                    if (mergedHeadlines.length === 0) mergedHeadlines.push('');
                    return { ...prev, bodies: mergedBodies, headlines: mergedHeadlines };
                });

                if (selectedAdAccount) {
                    const existingBodies = (creativeData.bodies || []).filter(b => b && b.trim());
                    const existingHeadlines = (creativeData.headlines || []).filter(h => h && h.trim());
                    const allBodies = [...existingBodies, ...newBodies].slice(0, 6);
                    const allHeadlines = [...existingHeadlines, ...newHeadlines].slice(0, 6);
                    localStorage.setItem(`defaultBodies_${selectedAdAccount.id}`, JSON.stringify(allBodies));
                    localStorage.setItem(`defaultHeadlines_${selectedAdAccount.id}`, JSON.stringify(allHeadlines));
                }
            }

            const providerNames = { 'gemini': 'Gemini', 'safe': 'Safe Copy', 'sonnet': 'Claude Sonnet', 'haiku': 'Claude Haiku', 'claude': 'Claude Sonnet', 'transcribe_haiku': 'Transcribe + Sonnet', 'group_voice': 'FB Group Voice' };
            showSuccess(`${providerNames[provider] || provider} ad copy appended (${newBodies.length} bodies, ${newHeadlines.length} headlines)`);
        } catch (error) {
            console.error('Video analysis error:', error);
            showError(error.message || 'Failed to analyze video');
        } finally {
            setAnalyzingVideoId(null);
            setAnalyzingProvider(null);
        }
    };

    const handleAnalyzeImage = async (creative, provider = 'sonnet') => {
        const imageUrl = creative.imageUrl || creative.previewUrl;
        if (!creative.file && !imageUrl) {
            showWarning('No image file or URL available');
            return;
        }

        setAnalyzingVideoId(creative.id);
        setAnalyzingProvider(provider);
        setProviderMenuId(null);
        try {
            const formData = new FormData();

            if (creative.file) {
                formData.append('file', creative.file);
            } else {
                formData.append('url', imageUrl);
            }

            const brandParam = activeBrand?.id || '';
            const response = await authFetch(`${API_URL}/video-analysis/analyze-image?provider=${provider}&language=${encodeURIComponent(aiLanguage)}${brandParam ? `&brand_id=${brandParam}` : ''}`, {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err.detail || 'Image analysis failed');
            }

            const data = await response.json();
            const newBodies = (data.bodies || []).filter(b => b && b.trim());
            const newHeadlines = (data.headlines || []).filter(h => h && h.trim());

            if (isPerCreative) {
                // In per-creative mode, put copy on the specific creative
                const idx = creativeData.creatives.findIndex(c => c.id === creative.id);
                if (idx !== -1) {
                    setCreativeData(prev => {
                        const updated = [...prev.creatives];
                        const existing = updated[idx];
                        if (!existing) return prev;
                        const existingBodies = (existing.bodies || []).filter(b => b && b.trim());
                        const existingHeadlines = (existing.headlines || []).filter(h => h && h.trim());
                        updated[idx] = {
                            ...existing,
                            bodies: [...existingBodies, ...newBodies].slice(0, 6),
                            headlines: [...existingHeadlines, ...newHeadlines].slice(0, 6),
                        };
                        if (updated[idx].bodies.length === 0) updated[idx].bodies = [''];
                        if (updated[idx].headlines.length === 0) updated[idx].headlines = [''];
                        return { ...prev, creatives: updated };
                    });
                    setCurrentCreativeIndex(idx);
                }
            } else {
                // Standard mode: merge into global copy fields
                setCreativeData(prev => {
                    const existingBodies = (prev.bodies || []).filter(b => b && b.trim());
                    const existingHeadlines = (prev.headlines || []).filter(h => h && h.trim());
                    const mergedBodies = [...existingBodies, ...newBodies].slice(0, 6);
                    const mergedHeadlines = [...existingHeadlines, ...newHeadlines].slice(0, 6);
                    if (mergedBodies.length === 0) mergedBodies.push('');
                    if (mergedHeadlines.length === 0) mergedHeadlines.push('');
                    return { ...prev, bodies: mergedBodies, headlines: mergedHeadlines };
                });

                if (selectedAdAccount) {
                    const existingBodies = (creativeData.bodies || []).filter(b => b && b.trim());
                    const existingHeadlines = (creativeData.headlines || []).filter(h => h && h.trim());
                    localStorage.setItem(`defaultBodies_${selectedAdAccount.id}`, JSON.stringify([...existingBodies, ...newBodies].slice(0, 6)));
                    localStorage.setItem(`defaultHeadlines_${selectedAdAccount.id}`, JSON.stringify([...existingHeadlines, ...newHeadlines].slice(0, 6)));
                }
            }

            const providerNames = { 'gemini': 'Gemini', 'safe': 'Safe Copy', 'sonnet': 'Claude Sonnet', 'haiku': 'Claude Haiku', 'claude': 'Claude Sonnet', 'group_voice': 'FB Group Voice' };
            showSuccess(`${providerNames[provider] || provider} ad copy generated (${newBodies.length} bodies, ${newHeadlines.length} headlines)`);
        } catch (error) {
            console.error('Image analysis error:', error);
            showError(error.message || 'Failed to analyze image');
        } finally {
            setAnalyzingVideoId(null);
            setAnalyzingProvider(null);
        }
    };

    // Mass AI copy generation — runs provider on all creatives sequentially
    const handleMassAnalyze = async (provider) => {
        setShowMassProviderMenu(false);
        const creatives = creativeData.creatives || [];
        if (creatives.length === 0) {
            showWarning('No creatives to analyze');
            return;
        }

        const providerNames = {
            'sonnet': 'Claude Sonnet',
            'haiku': 'Claude Haiku',
            'gemini': 'Gemini Flash',
            'safe': 'Safe Copy',
            'transcribe_haiku': 'Transcribe + Sonnet',
            'claude': 'Claude Sonnet',
            'group_voice': 'FB Group Voice',
        };

        setMassAnalyzing(true);
        setMassAnalysisProgress({ current: 0, total: creatives.length, provider: providerNames[provider] || provider });

        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < creatives.length; i++) {
            const creative = creatives[i];
            setMassAnalysisProgress(prev => ({ ...prev, current: i + 1 }));
            setCurrentCreativeIndex(i);

            try {
                const isVideo = creative.mediaType === 'video';
                const url = isVideo ? (creative.videoUrl || creative.previewUrl) : (creative.imageUrl || creative.previewUrl);
                const endpoint = isVideo ? 'video-analysis/analyze' : 'video-analysis/analyze-image';
                // 'claude' provider is video-only (key frames); fall back to 'sonnet' for images
                const effectiveProvider = (!isVideo && provider === 'claude') ? 'sonnet' : provider;

                const formData = new FormData();
                if (creative.file) {
                    formData.append('file', creative.file);
                } else {
                    formData.append('url', url);
                }

                const brandParam = activeBrand?.id || '';
                const response = await authFetch(`${API_URL}/${endpoint}?provider=${effectiveProvider}&language=${encodeURIComponent(aiLanguage)}${brandParam ? `&brand_id=${brandParam}` : ''}`, {
                    method: 'POST',
                    body: formData,
                });

                if (!response.ok) {
                    const err = await response.json().catch(() => ({}));
                    throw new Error(err.detail || 'Analysis failed');
                }

                const data = await response.json();
                const newBodies = (data.bodies || []).filter(b => b && b.trim());
                const newHeadlines = (data.headlines || []).filter(h => h && h.trim());

                if (newBodies.length > 0 || newHeadlines.length > 0) {
                    setCreativeData(prev => {
                        const updated = [...prev.creatives];
                        const existing = updated[i];
                        if (!existing) return prev; // guard against index mismatch
                        const existingBodies = (existing.bodies || []).filter(b => b && b.trim());
                        const existingHeadlines = (existing.headlines || []).filter(h => h && h.trim());
                        updated[i] = {
                            ...existing,
                            bodies: [...existingBodies, ...newBodies].slice(0, 6),
                            headlines: [...existingHeadlines, ...newHeadlines].slice(0, 6),
                        };
                        if (updated[i].bodies.length === 0) updated[i].bodies = [''];
                        if (updated[i].headlines.length === 0) updated[i].headlines = [''];
                        return { ...prev, creatives: updated };
                    });
                    successCount++;
                } else {
                    failCount++;
                }
            } catch (error) {
                console.error(`Mass analyze error for creative ${i + 1}:`, error);
                failCount++;
            }

            // Small delay between requests to avoid rate limits
            if (i < creatives.length - 1) {
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        setMassAnalyzing(false);
        if (failCount === 0) {
            showSuccess(`Generated copy for all ${successCount} creatives`);
        } else {
            showWarning(`Generated copy for ${successCount} of ${creatives.length} creatives (${failCount} failed)`);
        }
    };

    // Restore copy from the most recent failed/partial publish batch
    const [restoringCopy, setRestoringCopy] = useState(false);
    const handleRestoreCopy = async () => {
        if (!creativeData.creatives || creativeData.creatives.length === 0) {
            showWarning('Upload images first, then restore copy');
            return;
        }
        setRestoringCopy(true);
        try {
            // Fetch recent batches
            const res = await authFetch(`${API_URL}/facebook/publish-batches/recent`);
            if (!res.ok) throw new Error('Failed to fetch batches');
            const batches = await res.json();
            if (!batches || batches.length === 0) {
                showWarning('No recent publish batches found');
                return;
            }
            // Find the most recent batch with creative data
            const batch = batches.find(b => b.creative_data?.creatives?.length > 0);
            if (!batch) {
                showWarning('No batch with copy data found');
                return;
            }
            const batchCreatives = batch.creative_data.creatives;
            // Match by filename and restore copy
            let matched = 0;
            setCreativeData(prev => {
                const updated = prev.creatives.map(c => {
                    const batchMatch = batchCreatives.find(bc => bc.name === c.name);
                    if (batchMatch && ((batchMatch.bodies || []).some(b => b?.trim()) || (batchMatch.headlines || []).some(h => h?.trim()))) {
                        matched++;
                        return {
                            ...c,
                            bodies: batchMatch.bodies || c.bodies,
                            headlines: batchMatch.headlines || c.headlines,
                            description: batchMatch.description || c.description,
                            cta: batchMatch.cta || c.cta,
                        };
                    }
                    return c;
                });
                return { ...prev, creatives: updated };
            });
            if (matched > 0) {
                showSuccess(`Restored copy for ${matched} of ${creativeData.creatives.length} creatives`);
            } else {
                showWarning('No matching filenames found in the last batch. Make sure file names match.');
            }
        } catch (e) {
            showError('Failed to restore copy: ' + e.message);
        } finally {
            setRestoringCopy(false);
        }
    };

    const handleNext = () => {
        // Validate required fields
        if (!creativeData.creativeName) {
            showWarning('Please enter a creative name');
            return;
        }

        // Existing-post mode: short-circuit media/copy validation.
        // Accept multiple post IDs (newline- or comma-separated) → one ad per ID in the same ad set.
        if (creativeData.useExistingPost) {
            const ids = parsePostIds(creativeData.existingPostId);
            if (ids.length === 0) {
                showWarning('Please enter at least one existing post ID');
                return;
            }
            if (!creativeData.pageId) {
                showWarning('Please select or enter a Facebook Page');
                return;
            }
            const copies = Math.max(1, Math.min(25, parseInt(creativeData.existingPostCopies, 10) || 1));
            const totalAds = ids.length * copies;
            if (totalAds > 250) {
                showWarning(`Max 250 ads per submission. Currently ${ids.length} × ${copies} = ${totalAds}. Reduce post IDs or copies.`);
                return;
            }
            const previewById = Object.fromEntries(postPreviews.map(p => [p.id, p]));
            const ts = Date.now();
            setCreativeData(prev => ({
                ...prev,
                creatives: expandExistingPostCreatives(ids, copies, {
                    ts,
                    previewById,
                    creativeName: prev.creativeName,
                    fallbackThumbnail: prev.existingPostThumbnail,
                }),
            }));
            onNext();
            return;
        }

        if (!creativeData.creatives || creativeData.creatives.length === 0) {
            showWarning('Please upload at least one image or video');
            return;
        }

        if (isPerCreative) {
            // Per-creative mode: each creative must have at least 1 non-empty headline and body
            for (let i = 0; i < creativeData.creatives.length; i++) {
                const c = creativeData.creatives[i];
                const hasBody = (c.bodies || []).some(b => b && b.trim());
                const hasHeadline = (c.headlines || []).some(h => h && h.trim());
                if (!hasBody) {
                    setCurrentCreativeIndex(i);
                    showWarning(`Creative ${i + 1} ("${c.name}") needs at least one primary text`);
                    return;
                }
                if (!hasHeadline) {
                    setCurrentCreativeIndex(i);
                    showWarning(`Creative ${i + 1} ("${c.name}") needs at least one headline`);
                    return;
                }
            }
        } else {
            // Standard mode: validate global copy fields
            if (!(creativeData.bodies || [])[0] || !(creativeData.bodies || [])[0].trim()) {
                showWarning('Please provide primary text');
                return;
            }
            if (!(creativeData.headlines || [])[0] || !(creativeData.headlines || [])[0].trim()) {
                showWarning('Please provide a headline');
                return;
            }
        }

        if (!creativeData.websiteUrl) {
            showWarning('Please enter a website URL');
            return;
        }

        // Validate URL format
        try {
            const url = new URL(creativeData.websiteUrl);
            if (!url.protocol.startsWith('http')) {
                showWarning('Please enter a valid URL starting with http:// or https://');
                return;
            }
        } catch (e) {
            showWarning('Please enter a valid URL (e.g., https://example.com)');
            return;
        }

        if (!creativeData.pageId) {
            showWarning('Please enter a Facebook Page ID');
            return;
        }

        // Save URL to local storage for this ad account
        if (selectedAdAccount && creativeData.websiteUrl) {
            localStorage.setItem(`defaultUrl_${selectedAdAccount.id}`, creativeData.websiteUrl);
        }

        onNext();
    };

    return (
        <div>
            <h2 className="text-2xl font-bold mb-4">Ad Creative</h2>

            {/* Campaign & Ad Set Context Bar */}
            {(campaignData?.name || adsetData?.name) && (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 mb-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
                    {campaignData?.name && (
                        <div className="flex items-center gap-1.5 text-gray-600">
                            <Target size={14} className="text-amber-600" />
                            <span className="font-medium text-gray-800">Campaign:</span>
                            <span className="font-mono text-xs text-gray-500">{campaignData.fbCampaignId || campaignData.id || campaignData.name}</span>
                            <button
                                onClick={() => { navigator.clipboard.writeText(campaignData.fbCampaignId || campaignData.id || campaignData.name); showSuccess('Campaign ID copied'); }}
                                className="p-0.5 text-gray-400 hover:text-amber-600 transition-colors"
                                title="Copy Campaign ID"
                            >
                                <Copy size={12} />
                            </button>
                        </div>
                    )}
                    {adsetData?.name && (
                        <div className="flex items-center gap-1.5 text-gray-600">
                            <Users size={14} className="text-amber-600" />
                            <span className="font-medium text-gray-800">Ad Set:</span>
                            <span className="font-mono text-xs text-gray-500">{adsetData.fbAdsetId || adsetData.id || adsetData.name}</span>
                            <button
                                onClick={() => { navigator.clipboard.writeText(adsetData.fbAdsetId || adsetData.id || adsetData.name); showSuccess('Ad Set ID copied'); }}
                                className="p-0.5 text-gray-400 hover:text-amber-600 transition-colors"
                                title="Copy Ad Set ID"
                            >
                                <Copy size={12} />
                            </button>
                        </div>
                    )}
                    {selectedAdAccount && (
                        <div className="flex items-center gap-1.5 text-gray-600">
                            <span className="font-medium text-gray-800">Account:</span>
                            <span className="font-mono text-xs text-gray-500">{selectedAdAccount.id}</span>
                            <button
                                onClick={() => { navigator.clipboard.writeText(selectedAdAccount.id); showSuccess('Account ID copied'); }}
                                className="p-0.5 text-gray-400 hover:text-amber-600 transition-colors"
                                title="Copy Account ID"
                            >
                                <Copy size={12} />
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* Mode Toggle — hidden for now, default to per_creative. Unhide by removing the hidden class */}
            <div className="hidden items-center gap-1 bg-gray-100 p-1 rounded-lg mb-6 w-fit">
                <button
                    onClick={() => setCreativeData(prev => ({ ...prev, creativeMode: 'standard' }))}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                        !isPerCreative
                            ? 'bg-white text-gray-900 shadow-sm'
                            : 'text-gray-500 hover:text-gray-700'
                    }`}
                >
                    Standard (Bulk)
                </button>
                <button
                    onClick={() => setCreativeData(prev => ({ ...prev, creativeMode: 'per_creative' }))}
                    className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                        isPerCreative
                            ? 'bg-white text-gray-900 shadow-sm'
                            : 'text-gray-500 hover:text-gray-700'
                    }`}
                >
                    Per Creative
                </button>
            </div>

            <p className="text-gray-600 mb-6">
                {isPerCreative
                    ? 'Each image/video gets its own dedicated copy. Step through creatives one at a time.'
                    : 'Create standard ads with shared copy across all media. We will create permutations of each image × headline × body.'}
            </p>

            <div className="space-y-6">
                {/* Creative Name */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                        Creative Name *
                    </label>
                    <input
                        type="text"
                        value={creativeData.creativeName}
                        onChange={(e) => handleInputChange('creativeName', e.target.value)}
                        placeholder="Summer Sale Dynamic Creative"
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                    />
                </div>

                {/* Facebook Page Selection */}
                <div>
                    <div className="flex justify-between items-center mb-2">
                        <label className="block text-sm font-medium text-gray-700">
                            Facebook Page *
                        </label>
                        <button
                            onClick={() => setManualPageEntry(!manualPageEntry)}
                            className="text-xs text-amber-600 hover:text-amber-800 underline"
                        >
                            {manualPageEntry ? 'Select from list' : 'Enter Page ID manually'}
                        </button>
                    </div>

                    {manualPageEntry ? (
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={creativeData.pageId}
                                onChange={(e) => handleInputChange('pageId', e.target.value)}
                                placeholder="Enter Facebook Page ID (e.g., 933995649786806)"
                                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                            />
                            {creativeData.pageId?.trim() && (
                                <button
                                    onClick={handleSaveManualPage}
                                    className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 text-sm font-medium whitespace-nowrap"
                                >
                                    Save
                                </button>
                            )}
                        </div>
                    ) : loadingPages ? (
                        <div className="flex items-center gap-2 text-gray-500 py-2">
                            <Loader className="animate-spin" size={20} />
                            <span>Loading pages...</span>
                        </div>
                    ) : (
                        <select
                            value={creativeData.pageId}
                            onChange={(e) => handlePageSelection(e.target.value)}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                        >
                            <option value="">Select a Facebook Page...</option>
                            {pages.map(page => (
                                <option key={page.id} value={page.id}>
                                    {page.name} - {page.id}
                                </option>
                            ))}
                        </select>
                    )}

                    {!manualPageEntry && pages.length === 0 && !loadingPages && (
                        <div className="mt-2">
                            <p className="text-xs text-red-500 mb-1">
                                No pages found. Please make sure your ad account has access to at least one Facebook Page.
                            </p>
                            <button
                                onClick={() => setManualPageEntry(true)}
                                className="text-xs text-amber-600 font-medium hover:underline"
                            >
                                Enter Page ID manually instead
                            </button>
                        </div>
                    )}
                </div>

                {/* Use Existing Post toggle */}
                <div className="border border-blue-200 bg-blue-50 rounded-lg p-4">
                    <label className="flex items-start gap-3 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={!!creativeData.useExistingPost}
                            onChange={(e) => handleInputChange('useExistingPost', e.target.checked)}
                            className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <div>
                            <div className="text-sm font-medium text-gray-800">Use existing post (carry over likes / comments / shares)</div>
                            <div className="text-xs text-gray-500 mt-0.5">Reference a published Facebook post by ID. Skips media upload and copy — the post's existing creative is used.</div>
                        </div>
                    </label>

                    {creativeData.useExistingPost && (
                        <div className="mt-3">
                            {(() => {
                                const idCount = parsePostIds(creativeData.existingPostId).length;
                                const copies = Math.max(1, Math.min(25, parseInt(creativeData.existingPostCopies, 10) || 1));
                                const totalAds = idCount * copies;
                                return (
                                    <>
                                        <label className="block text-xs font-medium text-gray-700 mb-1">
                                            Existing Post ID(s) *
                                            {idCount > 0 && (
                                                <span className="ml-2 text-blue-600">
                                                    ({idCount} post{idCount === 1 ? '' : 's'}
                                                    {copies > 1 ? ` × ${copies} copies` : ''}
                                                    {' → '}
                                                    {totalAds} ad{totalAds === 1 ? '' : 's'} in this ad set)
                                                </span>
                                            )}
                                        </label>
                                        <div className="flex gap-2 items-start">
                                            <textarea
                                                rows={3}
                                                value={creativeData.existingPostId || ''}
                                                onChange={(e) => handleInputChange('existingPostId', e.target.value)}
                                                onBlur={fetchPostPreview}
                                                placeholder={"One ID per line, or comma-separated:\n122134499684981797\n120239876543210123"}
                                                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm font-mono"
                                            />
                                            <button
                                                type="button"
                                                onClick={fetchPostPreview}
                                                disabled={postPreviewLoading || !creativeData.existingPostId?.trim()}
                                                className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50"
                                            >
                                                {postPreviewLoading ? <Loader size={14} className="animate-spin" /> : 'Load'}
                                            </button>
                                        </div>

                                        <div className="mt-3 flex items-center gap-3">
                                            <label className="text-xs font-medium text-gray-700 whitespace-nowrap">
                                                Copies per post ID:
                                            </label>
                                            <input
                                                type="number"
                                                min={1}
                                                max={25}
                                                value={creativeData.existingPostCopies ?? 1}
                                                onChange={(e) => {
                                                    const raw = parseInt(e.target.value, 10);
                                                    const clamped = Math.max(1, Math.min(25, Number.isFinite(raw) ? raw : 1));
                                                    handleInputChange('existingPostCopies', clamped);
                                                }}
                                                className="w-20 px-2 py-1 border border-gray-300 rounded text-sm"
                                            />
                                            <span className="text-[11px] text-gray-500">(1–25; same post duplicated)</span>
                                        </div>

                                        <p className="text-[11px] text-gray-500 mt-1">
                                            Paste one or many post IDs (one per line, or comma-separated). Format: <code className="bg-white px-1 rounded">pageId_postId</code> or just <code className="bg-white px-1 rounded">postId</code>. Each ID is duplicated by the copies count above.
                                        </p>

                                        {totalAds > 20 && totalAds <= 250 && (
                                            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-2">
                                                ⚠ {totalAds} ads is a large batch — backend will pace automatically to avoid Meta rate limits (~{Math.ceil(totalAds * 1.2)}s).
                                            </p>
                                        )}
                                        {totalAds > 250 && (
                                            <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1 mt-2">
                                                ✗ Max 250 ads per submission. Reduce post IDs or copies. (Currently: {idCount} × {copies} = {totalAds})
                                            </p>
                                        )}
                                    </>
                                );
                            })()}

                            {postPreviewError && (
                                <p className="text-[11px] text-red-600 mt-2">{postPreviewError}</p>
                            )}
                            {postPreviews.length > 0 && (
                                <div className="mt-3 space-y-2">
                                    {postPreviews.map((p, idx) => (
                                        <div key={`${p.id}-${idx}`} className="flex gap-3 p-3 bg-white border border-gray-200 rounded-lg">
                                            {p.error ? (
                                                <div className="w-20 h-20 bg-red-50 border border-red-200 rounded flex items-center justify-center text-xs text-red-500 flex-shrink-0">error</div>
                                            ) : p.thumbnail ? (
                                                <img src={p.thumbnail} alt="Post thumbnail" className="w-20 h-20 object-cover rounded flex-shrink-0" />
                                            ) : (
                                                <div className="w-20 h-20 bg-gray-100 rounded flex items-center justify-center text-xs text-gray-400 flex-shrink-0">No image</div>
                                            )}
                                            <div className="flex-1 min-w-0">
                                                <div className="text-[11px] text-gray-400 font-mono mb-0.5">{p.id}</div>
                                                <div className="text-xs text-gray-500 mb-1">
                                                    {p.error ? 'failed to load' : p.isDarkPost ? 'dark / unpublished post' : (p.type || 'post')}
                                                </div>
                                                {p.error ? (
                                                    <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">{p.error}</div>
                                                ) : p.isDarkPost ? (
                                                    <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                                                        {p.previewNote || 'Preview unavailable, but post ID is valid for ad creation.'}
                                                    </div>
                                                ) : (
                                                    <div className="text-sm text-gray-800 line-clamp-3">{p.message || <span className="text-gray-400 italic">(no caption)</span>}</div>
                                                )}
                                                {p.permalink && (
                                                    <a href={p.permalink} target="_blank" rel="noopener noreferrer" className="text-[11px] text-blue-600 hover:underline mt-1 inline-block">View on Facebook ↗</a>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Media Upload (Images + Videos) — hidden when using existing post */}
                {!creativeData.useExistingPost && (<>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                        Ad Media (Images or Videos) *
                    </label>

                    {/* Upload Area */}
                    <div
                        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors mb-4 ${isDragging ? 'border-amber-500 bg-amber-50' : 'border-gray-300 hover:border-amber-500'
                            }`}
                        onDragEnter={handleDragEnter}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                        onPaste={handlePaste}
                        tabIndex={0}
                    >
                        <input
                            type="file"
                            accept="image/*,video/*"
                            multiple
                            onChange={handleMediaUpload}
                            className="hidden"
                            id="ad-media-upload"
                        />
                        <label htmlFor="ad-media-upload" className="cursor-pointer flex flex-col items-center">
                            <div className="flex gap-2 mb-2">
                                <Image className={`${isDragging ? 'text-amber-500' : 'text-gray-400'}`} size={28} />
                                <Film className={`${isDragging ? 'text-amber-500' : 'text-gray-400'}`} size={28} />
                            </div>
                            <span className={`font-medium ${isDragging ? 'text-amber-700' : 'text-gray-600'}`}>
                                {isDragging ? 'Drop files here' : 'Click to upload images or videos'}
                            </span>
                            <span className="text-sm text-gray-400 mt-1">or drag and drop, or paste (Ctrl+V)</span>
                            <span className="text-xs text-amber-500 mt-2 bg-amber-50 px-2 py-1 rounded">Supports multiple files • Videos up to 500MB</span>
                        </label>
                    </div>

                    {/* Actions row */}
                    <div className="flex items-center gap-3 mb-4">
                        {/* Restore Copy from Last Batch */}
                        {creativeData.creatives && creativeData.creatives.length > 0 && (
                            <button
                                onClick={handleRestoreCopy}
                                disabled={restoringCopy}
                                className="flex items-center gap-2 px-4 py-2 bg-green-50 text-green-700 rounded-lg hover:bg-green-100 border border-green-200 font-medium text-sm disabled:opacity-50"
                                title="Restore headlines & primary text from the last publish batch"
                            >
                                {restoringCopy ? <Loader size={18} className="animate-spin" /> : <RotateCcw size={18} />}
                                Restore Copy
                            </button>
                        )}

                        {/* AI Output Language */}
                        {creativeData.creatives && creativeData.creatives.length > 0 && (
                            <div className="flex items-center gap-2">
                                <label className="text-xs font-medium text-gray-600 whitespace-nowrap">Copy language:</label>
                                <select
                                    value={aiLanguage}
                                    onChange={(e) => setAiLanguage(e.target.value)}
                                    disabled={massAnalyzing || analyzingVideoId !== null}
                                    className={`px-2 py-1.5 border rounded-md text-sm focus:ring-2 focus:ring-amber-500 focus:border-transparent disabled:opacity-50 ${aiLanguage !== 'English' ? 'border-amber-400 bg-amber-50 text-amber-800 font-medium' : 'border-gray-300 bg-white text-gray-700'}`}
                                    title="AI-generated copy will be written in this language"
                                >
                                    <option value="English">English</option>
                                    <option value="German">German (Deutsch)</option>
                                    <option value="Spanish">Spanish (Español)</option>
                                    <option value="French">French (Français)</option>
                                    <option value="Italian">Italian (Italiano)</option>
                                    <option value="Portuguese">Portuguese (Português)</option>
                                    <option value="Dutch">Dutch (Nederlands)</option>
                                    <option value="Polish">Polish (Polski)</option>
                                    <option value="Swedish">Swedish (Svenska)</option>
                                    <option value="Norwegian">Norwegian (Norsk)</option>
                                    <option value="Danish">Danish (Dansk)</option>
                                </select>
                            </div>
                        )}

                        {/* Mass AI Copy Generation */}
                        {creativeData.creatives && creativeData.creatives.length > 0 && (
                            <div className="relative">
                                <button
                                    onClick={() => setShowMassProviderMenu(!showMassProviderMenu)}
                                    disabled={massAnalyzing || analyzingVideoId !== null}
                                    className="flex items-center gap-2 px-4 py-2 bg-amber-50 text-amber-700 rounded-lg hover:bg-amber-100 border border-amber-200 font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                                    title="Generate AI copy for all creatives at once"
                                >
                                    <Sparkles size={18} />
                                    AI Copy All ({creativeData.creatives.length})
                                </button>
                                {showMassProviderMenu && (
                                    <div className="absolute top-full left-0 mt-2 bg-white rounded-lg shadow-xl border border-gray-200 py-1 w-56 z-50">
                                        <div className="px-3 py-1.5 text-xs text-gray-400 font-medium uppercase">Generate copy for all {creativeData.creatives.length} creatives</div>
                                        <button
                                            onClick={() => handleMassAnalyze('sonnet')}
                                            className="w-full px-3 py-2 text-left text-sm hover:bg-purple-50 flex items-center gap-2"
                                        >
                                            <Sparkles size={14} className="text-purple-500" />
                                            <div>
                                                <div className="font-medium text-gray-800">Claude Sonnet</div>
                                                <div className="text-xs text-gray-500">Best for images</div>
                                            </div>
                                        </button>
                                        <button
                                            onClick={() => handleMassAnalyze('claude')}
                                            className="w-full px-3 py-2 text-left text-sm hover:bg-violet-50 flex items-center gap-2"
                                        >
                                            <Sparkles size={14} className="text-violet-500" />
                                            <div>
                                                <div className="font-medium text-gray-800">Claude Sonnet (Key Frames)</div>
                                                <div className="text-xs text-gray-500">Videos only — frames, no audio</div>
                                            </div>
                                        </button>
                                        <button
                                            onClick={() => handleMassAnalyze('gemini')}
                                            className="w-full px-3 py-2 text-left text-sm hover:bg-amber-50 flex items-center gap-2"
                                        >
                                            <Sparkles size={14} className="text-amber-500" />
                                            <div>
                                                <div className="font-medium text-gray-800">Gemini Flash</div>
                                                <div className="text-xs text-gray-500">Images + videos with audio</div>
                                            </div>
                                        </button>
                                        <button
                                            onClick={() => handleMassAnalyze('transcribe_haiku')}
                                            className="w-full px-3 py-2 text-left text-sm hover:bg-green-50 flex items-center gap-2"
                                        >
                                            <Sparkles size={14} className="text-green-500" />
                                            <div>
                                                <div className="font-medium text-gray-800">Transcribe + Sonnet</div>
                                                <div className="text-xs text-gray-500">Best for videos with speech</div>
                                            </div>
                                        </button>
                                        <button
                                            onClick={() => handleMassAnalyze('group_voice')}
                                            className="w-full px-3 py-2 text-left text-sm hover:bg-emerald-50 flex items-center gap-2"
                                        >
                                            <MessageCircle size={14} className="text-emerald-500" />
                                            <div>
                                                <div className="font-medium text-gray-800">FB Group Voice</div>
                                                <div className="text-xs text-gray-500">Sounds like real people, not ads</div>
                                            </div>
                                        </button>
                                        <div className="border-t border-gray-100 my-1"></div>
                                        <button
                                            onClick={() => handleMassAnalyze('safe')}
                                            className="w-full px-3 py-2 text-left text-sm hover:bg-blue-50 flex items-center gap-2"
                                        >
                                            <Sparkles size={14} className="text-blue-500" />
                                            <div>
                                                <div className="font-medium text-gray-800">Safe Copy</div>
                                                <div className="text-xs text-gray-500">Policy-friendly, low-risk</div>
                                            </div>
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Mass AI Analysis Progress */}
                    {massAnalyzing && (
                        <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
                            <Loader className="animate-spin text-amber-600" size={20} />
                            <div className="flex-1">
                                <p className="text-amber-800 font-medium">
                                    Generating copy with {massAnalysisProgress.provider}... ({massAnalysisProgress.current} of {massAnalysisProgress.total})
                                </p>
                                <div className="mt-2 bg-amber-200 rounded-full h-2 overflow-hidden">
                                    <div
                                        className="bg-amber-600 h-full rounded-full transition-all duration-500"
                                        style={{ width: `${(massAnalysisProgress.current / massAnalysisProgress.total) * 100}%` }}
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Media Grid */}
                    {creativeData.creatives && creativeData.creatives.length > 0 && (
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
                            {creativeData.creatives.map((creative, idx) => (
                                <div
                                    key={creative.id}
                                    className={`relative group border-2 rounded-lg aspect-square bg-gray-100 overflow-visible cursor-pointer transition-all ${
                                        isPerCreative && idx === currentCreativeIndex
                                            ? 'border-amber-500 ring-2 ring-amber-300 shadow-lg'
                                            : 'border-gray-200 hover:border-gray-300'
                                    }`}
                                    onClick={() => { if (isPerCreative) setCurrentCreativeIndex(idx); }}
                                >
                                  <div className="absolute inset-0 overflow-hidden rounded-lg">
                                    {creative.mediaType === 'video' ? (
                                        creative.thumbnailUrl ? (
                                            <img
                                                src={resolveUploadUrl(creative.thumbnailUrl)}
                                                alt={creative.name}
                                                className="w-full h-full object-cover"
                                            />
                                        ) : (
                                            <video
                                                src={creative.previewUrl}
                                                className="w-full h-full object-cover"
                                                muted
                                                playsInline
                                                poster={resolveUploadUrl(creative.thumbnailUrl) || undefined}
                                                onMouseEnter={(e) => e.target.play().catch(() => {})}
                                                onMouseLeave={(e) => { e.target.pause(); e.target.currentTime = 0; }}
                                            />
                                        )
                                    ) : (
                                        <img
                                            src={creative.previewUrl}
                                            alt={creative.name}
                                            className="w-full h-full object-cover"
                                        />
                                    )}
                                  </div>
                                    {/* Media type badge */}
                                    <div className="absolute top-2 left-2 flex flex-col gap-1">
                                        {creative.mediaType === 'video' ? (
                                            <span className="bg-purple-600 text-white text-xs px-2 py-1 rounded flex items-center gap-1">
                                                <Film size={12} /> Video
                                            </span>
                                        ) : (
                                            <span className="bg-blue-600 text-white text-xs px-2 py-1 rounded flex items-center gap-1">
                                                <Image size={12} /> Image
                                            </span>
                                        )}
                                        {creative.variants && Object.keys(creative.variants).length > 0 && (
                                            <span className="bg-purple-600/90 text-white text-xs px-2 py-0.5 rounded">
                                                {Object.keys(creative.variants).join(' + ')}
                                            </span>
                                        )}
                                    </div>
                                    {/* Number badge + copy status (per-creative mode) */}
                                    {isPerCreative && (
                                        <div className="absolute top-2 right-2 flex items-center gap-1">
                                            {(() => {
                                                const hasBody = (creative.bodies || []).some(b => b && b.trim());
                                                const hasHeadline = (creative.headlines || []).some(h => h && h.trim());
                                                const hasCopy = hasBody || hasHeadline;
                                                return (
                                                    <span className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center ${
                                                        idx === currentCreativeIndex
                                                            ? 'bg-amber-500 text-white'
                                                            : hasCopy
                                                                ? 'bg-green-500 text-white'
                                                                : 'bg-gray-700/70 text-white'
                                                    }`}>
                                                        {idx + 1}
                                                    </span>
                                                );
                                            })()}
                                        </div>
                                    )}
                                    <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-30 transition-all flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100"
                                        onClick={(e) => e.stopPropagation()}>
                                        {/* AI Analyze Button — works for both images and videos */}
                                        <div className="relative">
                                            <button
                                                onClick={() => setProviderMenuId(providerMenuId === creative.id ? null : creative.id)}
                                                disabled={analyzingVideoId !== null}
                                                className="p-2 bg-amber-500 text-white rounded-full hover:bg-amber-600 transform scale-90 hover:scale-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                                title={`Generate ad copy with AI`}
                                            >
                                                <Sparkles size={16} />
                                            </button>
                                            {providerMenuId === creative.id && (
                                                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 bg-white rounded-lg shadow-xl border border-gray-200 py-1 w-52 z-50">
                                                    {creative.mediaType === 'video' ? (
                                                        <>
                                                            <button
                                                                onClick={() => handleAnalyzeVideo(creative, 'transcribe_haiku')}
                                                                className="w-full px-3 py-2 text-left text-sm hover:bg-green-50 flex items-center gap-2"
                                                            >
                                                                <Sparkles size={14} className="text-green-500" />
                                                                <div>
                                                                    <div className="font-medium text-gray-800">Transcribe + Sonnet</div>
                                                                    <div className="text-xs text-gray-500">Gemini transcribes → Sonnet writes copy</div>
                                                                </div>
                                                            </button>
                                                            <button
                                                                onClick={() => handleAnalyzeVideo(creative, 'claude')}
                                                                className="w-full px-3 py-2 text-left text-sm hover:bg-purple-50 flex items-center gap-2"
                                                            >
                                                                <Sparkles size={14} className="text-purple-500" />
                                                                <div>
                                                                    <div className="font-medium text-gray-800">Claude Sonnet</div>
                                                                    <div className="text-xs text-gray-500">Frames only (no audio)</div>
                                                                </div>
                                                            </button>
                                                            <div className="border-t border-gray-100 my-1"></div>
                                                            <button
                                                                onClick={() => handleAnalyzeVideo(creative, 'gemini')}
                                                                className="w-full px-3 py-2 text-left text-sm hover:bg-amber-50 flex items-center gap-2"
                                                            >
                                                                <Sparkles size={14} className="text-amber-500" />
                                                                <div>
                                                                    <div className="font-medium text-gray-800">Gemini 2.0 Flash</div>
                                                                    <div className="text-xs text-gray-500">Analyzes video + audio</div>
                                                                </div>
                                                            </button>
                                                            <div className="border-t border-gray-100 my-1"></div>
                                                            <button
                                                                onClick={() => handleAnalyzeVideo(creative, 'safe')}
                                                                className="w-full px-3 py-2 text-left text-sm hover:bg-blue-50 flex items-center gap-2"
                                                            >
                                                                <Sparkles size={14} className="text-blue-500" />
                                                                <div>
                                                                    <div className="font-medium text-gray-800">Safe Copy</div>
                                                                    <div className="text-xs text-gray-500">Policy-friendly, low-risk copy</div>
                                                                </div>
                                                            </button>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <button
                                                                onClick={() => handleAnalyzeImage(creative, 'sonnet')}
                                                                className="w-full px-3 py-2 text-left text-sm hover:bg-purple-50 flex items-center gap-2"
                                                            >
                                                                <Sparkles size={14} className="text-purple-500" />
                                                                <div>
                                                                    <div className="font-medium text-gray-800">Claude Sonnet</div>
                                                                    <div className="text-xs text-gray-500">Analyzes image + generates DR copy</div>
                                                                </div>
                                                            </button>
                                                            <button
                                                                onClick={() => handleAnalyzeImage(creative, 'gemini')}
                                                                className="w-full px-3 py-2 text-left text-sm hover:bg-amber-50 flex items-center gap-2"
                                                            >
                                                                <Sparkles size={14} className="text-amber-500" />
                                                                <div>
                                                                    <div className="font-medium text-gray-800">Gemini 2.0 Flash</div>
                                                                    <div className="text-xs text-gray-500">Analyzes image + generates DR copy</div>
                                                                </div>
                                                            </button>
                                                            <button
                                                                onClick={() => handleAnalyzeImage(creative, 'group_voice')}
                                                                className="w-full px-3 py-2 text-left text-sm hover:bg-emerald-50 flex items-center gap-2"
                                                            >
                                                                <MessageCircle size={14} className="text-emerald-500" />
                                                                <div>
                                                                    <div className="font-medium text-gray-800">FB Group Voice</div>
                                                                    <div className="text-xs text-gray-500">Sounds like real people, not ads</div>
                                                                </div>
                                                            </button>
                                                            <div className="border-t border-gray-100 my-1"></div>
                                                            <button
                                                                onClick={() => handleAnalyzeImage(creative, 'safe')}
                                                                className="w-full px-3 py-2 text-left text-sm hover:bg-blue-50 flex items-center gap-2"
                                                            >
                                                                <Sparkles size={14} className="text-blue-500" />
                                                                <div>
                                                                    <div className="font-medium text-gray-800">Safe Copy</div>
                                                                    <div className="text-xs text-gray-500">Policy-friendly, low-risk copy</div>
                                                                </div>
                                                            </button>
                                                        </>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                        {creative.mediaType === 'video' && (
                                            <button
                                                onClick={() => setPlayingVideo(creative)}
                                                className="p-2 bg-blue-500 text-white rounded-full hover:bg-blue-600 transform scale-90 hover:scale-100 transition-all"
                                                title="Play video"
                                            >
                                                <Play size={16} />
                                            </button>
                                        )}
                                        {creative.mediaType === 'video' && (
                                            <button
                                                onClick={() => handleUseFirstFrame(creative)}
                                                disabled={extractingThumbs}
                                                className="p-2 bg-amber-500 hover:bg-amber-600 text-white rounded-full transform scale-90 hover:scale-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                                title="Use first frame as thumbnail (instant)"
                                            >
                                                {extractingThumbs && thumbPickerCreative?.id === creative.id
                                                    ? <Loader size={16} className="animate-spin" />
                                                    : <Zap size={16} />}
                                            </button>
                                        )}
                                        {creative.mediaType === 'video' && (
                                            <button
                                                onClick={() => handlePickThumbnail(creative)}
                                                disabled={extractingThumbs}
                                                className={`p-2 rounded-full transform scale-90 hover:scale-100 transition-all text-white ${
                                                    creative.thumbnailUrl ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-purple-500 hover:bg-purple-600'
                                                } disabled:opacity-50 disabled:cursor-not-allowed`}
                                                title={creative.thumbnailUrl ? 'Change thumbnail (AI-ranked picker)' : 'Pick thumbnail (AI-ranked picker)'}
                                            >
                                                {extractingThumbs && thumbPickerCreative?.id === creative.id
                                                    ? <Loader size={16} className="animate-spin" />
                                                    : <Camera size={16} />}
                                            </button>
                                        )}
                                        <button
                                            onClick={() => removeCreative(creative.id)}
                                            className="p-2 bg-red-500 text-white rounded-full hover:bg-red-600 transform scale-90 hover:scale-100 transition-all"
                                            title="Remove media"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                    <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-50 text-white text-xs p-1 truncate">
                                        {creative.name}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* AI Analysis Loading Banner */}
                    {analyzingVideoId && (
                        <div className={`flex items-center gap-3 ${
                            analyzingProvider === 'safe' ? 'bg-blue-50 border-blue-200'
                            : analyzingProvider === 'group_voice' ? 'bg-emerald-50 border-emerald-200'
                            : analyzingProvider === 'transcribe_haiku' ? 'bg-green-50 border-green-200'
                            : analyzingProvider === 'sonnet' || analyzingProvider === 'haiku' || analyzingProvider === 'claude' ? 'bg-purple-50 border-purple-200'
                            : 'bg-amber-50 border-amber-200'
                        } border rounded-lg p-4 mb-4`}>
                            <Loader className={`animate-spin ${
                                analyzingProvider === 'safe' ? 'text-blue-600'
                                : analyzingProvider === 'transcribe_haiku' ? 'text-green-600'
                                : analyzingProvider === 'sonnet' || analyzingProvider === 'haiku' || analyzingProvider === 'claude' ? 'text-purple-600'
                                : 'text-amber-600'
                            }`} size={20} />
                            <div>
                                <p className={`${
                                    analyzingProvider === 'safe' ? 'text-blue-800'
                                    : analyzingProvider === 'transcribe_haiku' ? 'text-green-800'
                                    : analyzingProvider === 'sonnet' || analyzingProvider === 'haiku' || analyzingProvider === 'claude' ? 'text-purple-800'
                                    : 'text-amber-800'
                                } font-medium`}>
                                    {analyzingProvider === 'safe'
                                        ? 'Generating safe, policy-friendly copy...'
                                        : analyzingProvider === 'transcribe_haiku'
                                        ? 'Transcribing audio + generating copy with Sonnet...'
                                        : analyzingProvider === 'sonnet' || analyzingProvider === 'haiku'
                                        ? 'Analyzing image with Claude Sonnet...'
                                        : analyzingProvider === 'claude'
                                        ? 'Analyzing video with Claude Sonnet...'
                                        : 'Analyzing with Gemini 2.0 Flash...'}
                                </p>
                                <p className={`${
                                    analyzingProvider === 'safe' ? 'text-blue-600'
                                    : analyzingProvider === 'transcribe_haiku' ? 'text-green-600'
                                    : analyzingProvider === 'sonnet' || analyzingProvider === 'haiku' || analyzingProvider === 'claude' ? 'text-purple-600'
                                    : 'text-amber-600'
                                } text-sm`}>
                                    {analyzingProvider === 'safe'
                                        ? 'Clean copy optimized for ad approval. This may take 10-15 seconds.'
                                        : analyzingProvider === 'transcribe_haiku'
                                        ? 'Step 1: Gemini transcribes audio → Step 2: Sonnet writes DR copy. This may take 60-90 seconds.'
                                        : analyzingProvider === 'sonnet' || analyzingProvider === 'haiku'
                                        ? 'Generating direct-response ad copy from your image. This may take 10-20 seconds.'
                                        : analyzingProvider === 'claude'
                                        ? 'Extracting key frames and generating ad copy. This may take 30-60 seconds.'
                                        : 'Generating ad copy. This may take 15-30 seconds.'}
                                </p>
                            </div>
                        </div>
                    )}

                    {/* URL Input (Optional fallback) */}
                    <div className="mt-2">
                        <p className="text-sm text-gray-500 mb-1">Or paste a media URL (image or video):</p>
                        <input
                            type="text"
                            placeholder="https://example.com/image.jpg or https://example.com/video.mp4"
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent text-sm"
                            onBlur={(e) => {
                                if (e.target.value) {
                                    const url = e.target.value.toLowerCase();
                                    const isVideo = url.endsWith('.mp4') || url.endsWith('.mov') || url.endsWith('.webm') || url.endsWith('.avi');
                                    const newCreative = {
                                        id: `creative_url_${Date.now()}`,
                                        previewUrl: e.target.value,
                                        imageUrl: isVideo ? undefined : e.target.value,
                                        videoUrl: isVideo ? e.target.value : undefined,
                                        name: isVideo ? 'Video from URL' : 'Image from URL',
                                        mediaType: isVideo ? 'video' : 'image'
                                    };
                                    setCreativeData(prev => ({
                                        ...prev,
                                        creatives: [...(prev.creatives || []), newCreative]
                                    }));
                                    e.target.value = ''; // Clear input
                                }
                            }}
                        />
                    </div>
                </div>

                {/* Copy Fields - Standard or Per Creative */}
                {isPerCreative ? (
                    /* ===== PER CREATIVE MODE ===== */
                    creativeData.creatives.length > 0 ? (
                        <div className="border border-gray-200 rounded-xl overflow-hidden">
                            {/* Creative Navigation Header */}
                            <div className="bg-gray-50 px-6 py-4 flex items-center justify-between border-b border-gray-200">
                                <button
                                    onClick={() => setCurrentCreativeIndex(Math.max(0, currentCreativeIndex - 1))}
                                    disabled={currentCreativeIndex === 0}
                                    className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-lg disabled:opacity-30 disabled:cursor-not-allowed text-gray-700 hover:bg-gray-200 transition-colors"
                                >
                                    <ChevronLeft size={16} /> Previous
                                </button>
                                <span className="text-sm font-semibold text-gray-800">
                                    Creative {currentCreativeIndex + 1} of {creativeData.creatives.length}
                                </span>
                                <button
                                    onClick={() => setCurrentCreativeIndex(Math.min(creativeData.creatives.length - 1, currentCreativeIndex + 1))}
                                    disabled={currentCreativeIndex === creativeData.creatives.length - 1}
                                    className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-lg disabled:opacity-30 disabled:cursor-not-allowed text-gray-700 hover:bg-gray-200 transition-colors"
                                >
                                    Next <ChevronRight size={16} />
                                </button>
                            </div>

                            {/* Creative dots / tabs */}
                            <div className="bg-gray-50 px-6 pb-3 flex items-center gap-2 flex-wrap">
                                {creativeData.creatives.map((c, idx) => {
                                    const hasBody = (c.bodies || []).some(b => b && b.trim());
                                    const hasHeadline = (c.headlines || []).some(h => h && h.trim());
                                    const isComplete = hasBody && hasHeadline;
                                    return (
                                        <button
                                            key={c.id}
                                            onClick={() => setCurrentCreativeIndex(idx)}
                                            className={`w-8 h-8 rounded-full text-xs font-bold transition-all ${
                                                idx === currentCreativeIndex
                                                    ? 'bg-amber-600 text-white scale-110 shadow'
                                                    : isComplete
                                                        ? 'bg-green-100 text-green-700 border border-green-300'
                                                        : 'bg-gray-200 text-gray-500 hover:bg-gray-300'
                                            }`}
                                            title={c.name}
                                        >
                                            {idx + 1}
                                        </button>
                                    );
                                })}
                            </div>

                            {/* Current Creative Preview + Fields */}
                            {currentCreative && (
                                <div className="p-6 space-y-5">
                                    {/* Thumbnail + Name + Actions */}
                                    <div className="flex items-center gap-4">
                                        <div
                                            className="w-20 h-20 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0 cursor-pointer relative group/thumb"
                                            onClick={() => setFullsizeImage(currentCreative)}
                                            title="Click to view full size"
                                        >
                                            {currentCreative.mediaType === 'video' ? (
                                                currentCreative.thumbnailUrl ? (
                                                    <img src={resolveUploadUrl(currentCreative.thumbnailUrl)} alt={currentCreative.name} className="w-full h-full object-cover" />
                                                ) : (
                                                    <video src={currentCreative.previewUrl} className="w-full h-full object-cover" muted />
                                                )
                                            ) : (
                                                <img src={currentCreative.previewUrl} alt={currentCreative.name} className="w-full h-full object-cover" />
                                            )}
                                            <div className="absolute inset-0 bg-black/0 group-hover/thumb:bg-black/30 transition-all flex items-center justify-center opacity-0 group-hover/thumb:opacity-100">
                                                <Maximize2 size={16} className="text-white" />
                                            </div>
                                        </div>
                                        <div className="flex-1">
                                            <p className="font-semibold text-gray-900">{currentCreative.name}</p>
                                            <span className={`text-xs px-2 py-0.5 rounded ${currentCreative.mediaType === 'video' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                                                {currentCreative.mediaType === 'video' ? 'Video' : 'Image'}
                                            </span>
                                        </div>
                                        <button
                                            onClick={() => setPreviewCreative(currentCreative)}
                                            className="flex items-center gap-1.5 px-3 py-2 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 border border-blue-200 text-sm font-medium transition-colors"
                                            title="Preview how this ad will look on Facebook"
                                        >
                                            <Eye size={16} />
                                            Preview Ad
                                        </button>
                                    </div>

                                    {/* Per-creative Primary Text */}
                                    <div>
                                        <div className="flex items-center justify-between mb-2">
                                            <label className="block text-sm font-medium text-gray-700">Primary Text *</label>
                                            {(currentCreative.bodies || ['']).length < 6 && (
                                                <button type="button" onClick={addPerCreativeBody}
                                                    className="text-sm text-amber-600 hover:text-amber-700 font-medium flex items-center gap-1">
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                                    </svg>
                                                    Add Body Copy
                                                </button>
                                            )}
                                        </div>
                                        <div className="space-y-3">
                                            {(currentCreative.bodies || ['']).map((body, index) => (
                                                <div key={index} className="relative">
                                                    <textarea
                                                        value={body}
                                                        onChange={(e) => handlePerCreativeBodyChange(index, e.target.value)}
                                                        placeholder={`Body copy ${index + 1}...`}
                                                        rows="3"
                                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                                                    />
                                                    {(currentCreative.bodies || ['']).length > 1 && (
                                                        <button type="button" onClick={() => removePerCreativeBody(index)}
                                                            className="absolute top-2 right-2 text-red-500 hover:text-red-700" title="Remove">
                                                            <X size={16} />
                                                        </button>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Per-creative Headlines */}
                                    <div>
                                        {/* Preset dropdown for per-creative */}
                                        {presets.length > 0 && (
                                            <div className="mb-3 flex items-center gap-2">
                                                <Bookmark size={14} className="text-amber-500 shrink-0" />
                                                <select
                                                    onChange={(e) => {
                                                        const preset = presets.find(p => p.id === e.target.value);
                                                        if (preset) handleApplyPresetPerCreative(preset);
                                                        e.target.value = '';
                                                    }}
                                                    className="flex-1 text-sm border border-amber-200 rounded-lg px-3 py-1.5 bg-amber-50 text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-400"
                                                    defaultValue=""
                                                >
                                                    <option value="" disabled>Load a saved preset...</option>
                                                    {presets.map(p => (
                                                        <option key={p.id} value={p.id}>{p.name} ({p.offer}) — {p.headlines[0]}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}
                                        <div className="flex items-center justify-between mb-2">
                                            <label className="block text-sm font-medium text-gray-700">Headline *</label>
                                            {(currentCreative.headlines || ['']).length < 6 && (
                                                <button type="button" onClick={addPerCreativeHeadline}
                                                    className="text-sm text-amber-600 hover:text-amber-700 font-medium flex items-center gap-1">
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                                    </svg>
                                                    Add Headline
                                                </button>
                                            )}
                                        </div>
                                        <div className="space-y-3">
                                            {(currentCreative.headlines || ['']).map((headline, index) => (
                                                <div key={index} className="relative">
                                                    <input
                                                        type="text"
                                                        value={headline}
                                                        onChange={(e) => handlePerCreativeHeadlineChange(index, e.target.value)}
                                                        placeholder={`Headline ${index + 1}...`}
                                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                                                    />
                                                    {(currentCreative.headlines || ['']).length > 1 && (
                                                        <button type="button" onClick={() => removePerCreativeHeadline(index)}
                                                            className="absolute top-2 right-2 text-red-500 hover:text-red-700" title="Remove">
                                                            <X size={16} />
                                                        </button>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Per-creative Description */}
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
                                        <input
                                            type="text"
                                            value={currentCreative.description || ''}
                                            onChange={(e) => updateCreativeField(currentCreativeIndex, 'description', e.target.value)}
                                            placeholder="Shop now and save!"
                                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                                        />
                                    </div>

                                    {/* Per-creative CTA */}
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-2">Call to Action *</label>
                                        <select
                                            value={currentCreative.cta || creativeData.cta}
                                            onChange={(e) => updateCreativeField(currentCreativeIndex, 'cta', e.target.value)}
                                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                                        >
                                            {CTA_OPTIONS.map(cta => (
                                                <option key={cta} value={cta}>{cta.replace(/_/g, ' ')}</option>
                                            ))}
                                        </select>
                                    </div>

                                    {/* First Comment — only shown with NO_BUTTON CTA */}
                                    {(currentCreative.cta || creativeData.cta) === 'NO_BUTTON' && (
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                                First Comment <span className="text-gray-400 font-normal">(posted as your Page after ad goes live)</span>
                                            </label>
                                            <input
                                                type="text"
                                                value={currentCreative.first_comment || ''}
                                                onChange={(e) => updateCreativeField(currentCreativeIndex, 'first_comment', e.target.value)}
                                                placeholder="e.g. For those asking, here's the article: https://your-link.com"
                                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                                            />
                                        </div>
                                    )}

                                    {/* Inline Ad Preview */}
                                    <div className="border-t border-gray-200 pt-5">
                                        <div className="flex items-center justify-between mb-3">
                                            <label className="block text-sm font-medium text-gray-700">Ad Preview</label>
                                            <div className="flex gap-1 bg-gray-100 p-0.5 rounded-lg">
                                                <button
                                                    onClick={() => setInlinePreviewPlacement('feed')}
                                                    className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                                                        inlinePreviewPlacement === 'feed'
                                                            ? 'bg-white text-gray-900 shadow-sm'
                                                            : 'text-gray-500 hover:text-gray-700'
                                                    }`}
                                                >
                                                    Feed
                                                </button>
                                                <button
                                                    onClick={() => setInlinePreviewPlacement('story')}
                                                    className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                                                        inlinePreviewPlacement === 'story'
                                                            ? 'bg-white text-gray-900 shadow-sm'
                                                            : 'text-gray-500 hover:text-gray-700'
                                                    }`}
                                                >
                                                    Story / Reel
                                                </button>
                                            </div>
                                        </div>
                                        <div className="flex justify-center bg-gray-50 rounded-lg p-4">
                                            {inlinePreviewPlacement === 'feed' ? (
                                                <FeedPreview
                                                    pageName={pages.find(p => p.id === creativeData.pageId)?.name || 'Your Page'}
                                                    primaryText={(currentCreative.bodies || [''])[0] || ''}
                                                    headline={(currentCreative.headlines || [''])[0] || ''}
                                                    description={currentCreative.description || ''}
                                                    cta={currentCreative.cta || creativeData.cta || 'LEARN_MORE'}
                                                    mediaUrl={resolveUploadUrl(currentCreative.mediaType === 'video' ? (currentCreative.thumbnailUrl || currentCreative.previewUrl) : currentCreative.previewUrl)}
                                                    mediaType={currentCreative.mediaType}
                                                    websiteUrl={creativeData.websiteUrl}
                                                />
                                            ) : (
                                                <StoryPreview
                                                    pageName={pages.find(p => p.id === creativeData.pageId)?.name || 'Your Page'}
                                                    primaryText={(currentCreative.bodies || [''])[0] || ''}
                                                    cta={currentCreative.cta || creativeData.cta || 'LEARN_MORE'}
                                                    mediaUrl={resolveUploadUrl(currentCreative.mediaType === 'video' ? (currentCreative.thumbnailUrl || currentCreative.previewUrl) : currentCreative.previewUrl)}
                                                    mediaType={currentCreative.mediaType}
                                                />
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Per-creative Ad Counter */}
                            <div className="px-6 pb-4">
                                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                                    <div className="flex items-center gap-2 text-amber-800">
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        <span className="font-medium">
                                            {(() => {
                                                let totalAds = 0;
                                                creativeData.creatives.forEach(c => {
                                                    const h = (c.headlines || []).filter(x => x && x.trim()).length || 1;
                                                    const b = (c.bodies || []).filter(x => x && x.trim()).length || 1;
                                                    totalAds += h * b;
                                                });
                                                return `${totalAds} ad${totalAds !== 1 ? 's' : ''} will be created (1 per creative × headlines × bodies)`;
                                            })()}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="text-center py-8 text-gray-400 border-2 border-dashed border-gray-200 rounded-lg">
                            Upload media above, then configure copy for each creative here.
                        </div>
                    )
                ) : (
                    /* ===== STANDARD (BULK) MODE ===== */
                    <>
                        {/* Body Text */}
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <label className="block text-sm font-medium text-gray-700">
                                    Primary Text *
                                </label>
                                {(creativeData.bodies || []).length < 6 && (
                                    <button
                                        type="button"
                                        onClick={addBodyField}
                                        className="text-sm text-amber-600 hover:text-amber-700 font-medium flex items-center gap-1"
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                        </svg>
                                        Add Body Copy
                                    </button>
                                )}
                            </div>
                            <div className="space-y-3">
                                {(creativeData.bodies || ['']).map((body, index) => (
                                    <div key={index} className="relative">
                                        <textarea
                                            value={body}
                                            onChange={(e) => handleBodyChange(index, e.target.value)}
                                            placeholder={`Body copy ${index + 1}...`}
                                            rows="3"
                                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                                        />
                                        {index >= 1 && (
                                            <button
                                                type="button"
                                                onClick={() => removeBodyField(index)}
                                                className="absolute top-2 right-2 text-red-500 hover:text-red-700"
                                                title="Remove this body copy"
                                            >
                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                </svg>
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Headline Presets + Headline */}
                        <div>
                            {/* Preset dropdown */}
                            {presets.length > 0 && (
                                <div className="mb-3 flex items-center gap-2">
                                    <Bookmark size={14} className="text-amber-500 shrink-0" />
                                    <select
                                        onChange={(e) => {
                                            const preset = presets.find(p => p.id === e.target.value);
                                            if (preset) handleApplyPreset(preset);
                                            e.target.value = '';
                                        }}
                                        className="flex-1 text-sm border border-amber-200 rounded-lg px-3 py-1.5 bg-amber-50 text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-400"
                                        defaultValue=""
                                    >
                                        <option value="" disabled>Load a saved preset...</option>
                                        {presets.map(p => (
                                            <option key={p.id} value={p.id}>{p.name} ({p.offer}) — {p.headlines[0]}</option>
                                        ))}
                                    </select>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const id = prompt('Enter preset name to delete (or cancel):');
                                            if (!id) return;
                                            const match = presets.find(p => p.name.toLowerCase() === id.toLowerCase());
                                            if (match) handleDeletePreset(match.id);
                                        }}
                                        className="text-xs text-gray-400 hover:text-red-500"
                                        title="Delete a preset"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            )}

                            <div className="flex items-center justify-between mb-2">
                                <label className="block text-sm font-medium text-gray-700">
                                    Headline *
                                </label>
                                <div className="flex items-center gap-3">
                                    <button
                                        type="button"
                                        onClick={() => { setShowSavePreset(!showSavePreset); setPresetOffer(activeBrand?.name?.toLowerCase() || ''); }}
                                        className="text-sm text-gray-500 hover:text-amber-600 font-medium flex items-center gap-1"
                                        title="Save current headlines as a preset"
                                    >
                                        <Save size={14} />
                                        Save Preset
                                    </button>
                                    {(creativeData.headlines || []).length < 6 && (
                                        <button
                                            type="button"
                                            onClick={addHeadlineField}
                                            className="text-sm text-amber-600 hover:text-amber-700 font-medium flex items-center gap-1"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                            </svg>
                                            Add Headline
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Save preset inline form */}
                            {showSavePreset && (
                                <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-2">
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            value={presetName}
                                            onChange={(e) => setPresetName(e.target.value)}
                                            placeholder="Preset name (e.g. Belly Fat Tea)"
                                            className="flex-1 text-sm px-3 py-1.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                                        />
                                        <input
                                            type="text"
                                            value={presetOffer}
                                            onChange={(e) => setPresetOffer(e.target.value)}
                                            placeholder="Offer (akemi, patch...)"
                                            className="w-32 text-sm px-3 py-1.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                                        />
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            type="button"
                                            onClick={handleSavePreset}
                                            disabled={savingPreset}
                                            className="px-3 py-1 text-xs font-medium bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50"
                                        >
                                            {savingPreset ? 'Saving...' : 'Save Headlines + Body as Preset'}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setShowSavePreset(false)}
                                            className="px-3 py-1 text-xs font-medium bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            )}

                            <div className="space-y-3">
                                {(creativeData.headlines || ['']).map((headline, index) => (
                                    <div key={index} className="relative">
                                        <input
                                            type="text"
                                            value={headline}
                                            onChange={(e) => handleHeadlineChange(index, e.target.value)}
                                            placeholder={`Headline ${index + 1}...`}
                                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                                        />
                                        {index >= 1 && (
                                            <button
                                                type="button"
                                                onClick={() => removeHeadlineField(index)}
                                                className="absolute top-2 right-2 text-red-500 hover:text-red-700"
                                                title="Remove this headline"
                                            >
                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                </svg>
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Description */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Description
                            </label>
                            <input
                                type="text"
                                value={creativeData.description}
                                onChange={(e) => handleInputChange('description', e.target.value)}
                                placeholder="Shop now and save!"
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                            />
                        </div>

                        {/* Ad Permutation Counter */}
                        {creativeData.creatives && creativeData.creatives.length > 0 && (
                            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                                <div className="flex items-center gap-2 text-amber-800">
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    <span className="font-medium">
                                        {(() => {
                                            const validHeadlines = (creativeData.headlines || []).filter(h => h && h.trim() !== '').length;
                                            const validBodies = (creativeData.bodies || []).filter(b => b && b.trim() !== '').length;
                                            const totalAds = creativeData.creatives.length * validHeadlines * validBodies;
                                            const imageCount = creativeData.creatives.filter(c => c.mediaType !== 'video').length;
                                            const videoCount = creativeData.creatives.filter(c => c.mediaType === 'video').length;
                                            const mediaDesc = [];
                                            if (imageCount > 0) mediaDesc.push(`${imageCount} image${imageCount !== 1 ? 's' : ''}`);
                                            if (videoCount > 0) mediaDesc.push(`${videoCount} video${videoCount !== 1 ? 's' : ''}`);
                                            return (
                                                <>
                                                    {totalAds} ad{totalAds !== 1 ? 's' : ''} will be created
                                                    <span className="text-sm font-normal ml-2">
                                                        ({mediaDesc.join(' + ')} × {validHeadlines} headline{validHeadlines !== 1 ? 's' : ''} × {validBodies} bod{validBodies !== 1 ? 'ies' : 'y'})
                                                    </span>
                                                </>
                                            );
                                        })()}
                                    </span>
                                </div>
                            </div>
                        )}

                        {/* Call to Action */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Call to Action *
                            </label>
                            <select
                                value={creativeData.cta}
                                onChange={(e) => handleInputChange('cta', e.target.value)}
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                            >
                                {CTA_OPTIONS.map(cta => (
                                    <option key={cta} value={cta}>{cta.replace(/_/g, ' ')}</option>
                                ))}
                            </select>
                        </div>
                    </>
                )}

                {/* Website URL */}
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <label className="block text-sm font-medium text-gray-700">
                            Default Website URL (Landing Page) *
                            <span className="ml-2 text-xs font-normal text-gray-500">Can be overridden per ad in the next step</span>
                        </label>
                        {creativeData.websiteUrl && (
                            <a
                                href={creativeData.websiteUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm text-amber-600 hover:text-amber-700 font-medium flex items-center gap-1"
                            >
                                <Link size={14} />
                                Test Link
                            </a>
                        )}
                    </div>
                    <input
                        type="url"
                        value={creativeData.websiteUrl}
                        onChange={(e) => handleInputChange('websiteUrl', e.target.value)}
                        placeholder="https://yourwebsite.com/landing"
                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                    />
                </div>
                </>)}
            </div>

            {/* Navigation */}
            <div className="mt-8 flex justify-between">
                <button
                    onClick={onBack}
                    className="px-6 py-3 text-gray-600 hover:text-gray-800 font-medium"
                >
                    Back
                </button>
                <button
                    onClick={handleNext}
                    className="flex items-center gap-2 px-6 py-3 bg-amber-600 text-white rounded-lg font-medium hover:bg-amber-700"
                >
                    Next Step <ChevronRight size={20} />
                </button>
            </div>

            {/* Video Playback Modal */}
            {playingVideo && (
                <div
                    className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
                    onClick={() => setPlayingVideo(null)}
                >
                    <div className="relative w-full max-w-4xl" onClick={(e) => e.stopPropagation()}>
                        <button
                            onClick={() => setPlayingVideo(null)}
                            className="absolute -top-10 right-0 text-white hover:text-gray-300 transition-colors"
                            title="Close"
                        >
                            <X size={28} />
                        </button>
                        <video
                            src={playingVideo.previewUrl}
                            controls
                            autoPlay
                            className="w-full rounded-lg"
                        />
                    </div>
                </div>
            )}

            {/* Full-size Image Modal */}
            {fullsizeImage && (
                <div
                    className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
                    onClick={() => setFullsizeImage(null)}
                >
                    <div className="relative max-w-4xl max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
                        <button
                            onClick={() => setFullsizeImage(null)}
                            className="absolute -top-10 right-0 text-white hover:text-gray-300 transition-colors"
                            title="Close"
                        >
                            <X size={28} />
                        </button>
                        {fullsizeImage.mediaType === 'video' ? (
                            <video
                                src={fullsizeImage.previewUrl}
                                controls
                                autoPlay
                                className="max-w-full max-h-[85vh] rounded-lg"
                            />
                        ) : (
                            <img
                                src={fullsizeImage.previewUrl}
                                alt={fullsizeImage.name}
                                className="max-w-full max-h-[85vh] rounded-lg object-contain"
                            />
                        )}
                        <p className="text-white text-center text-sm mt-2">{fullsizeImage.name}</p>
                    </div>
                </div>
            )}

            {/* Thumbnail Picker Modal */}
            {thumbPickerCreative && (
                <div
                    className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
                    onClick={() => { if (!extractingThumbs) { setThumbPickerCreative(null); setThumbFrames([]); setThumbOpeningCount(0); } }}
                >
                    <div
                        className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between p-5 border-b border-gray-200">
                            <div>
                                <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                                    <Camera size={20} className="text-purple-600" />
                                    Pick a thumbnail
                                </h3>
                                <p className="text-sm text-gray-500 mt-0.5">
                                    {thumbPickerCreative.name} · AI-ranked for ad-thumbnail quality (faces · emotion · scroll-stop)
                                </p>
                            </div>
                            <button
                                onClick={() => { setThumbPickerCreative(null); setThumbFrames([]); setThumbOpeningCount(0); }}
                                disabled={extractingThumbs}
                                className="p-2 hover:bg-gray-100 rounded-lg disabled:opacity-50"
                                title="Close"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div className="p-5">
                            {extractingThumbs ? (
                                <div className="py-16 flex flex-col items-center justify-center gap-3 text-gray-500">
                                    <Loader className="animate-spin text-purple-600" size={32} />
                                    <p className="text-sm">Extracting frames + AI-ranking for ad-thumbnail quality…</p>
                                    <p className="text-xs text-gray-400">This may take 20-30 seconds</p>
                                </div>
                            ) : thumbFrames.length === 0 ? (
                                <div className="py-16 text-center text-gray-500 text-sm">
                                    No frames available.
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                                    {thumbFrames.map((frame, i) => {
                                        const isSelected = thumbPickerCreative.thumbnailUrl === frame;
                                        const isOpening = i < thumbOpeningCount;
                                        // Build a URL that loads through the backend host (frames are served under /uploads/...)
                                        const imgSrc = frame.startsWith('http')
                                            ? frame
                                            : `${API_URL.replace(/\/api\/v1$/, '')}${frame}`;
                                        return (
                                            <button
                                                key={frame}
                                                onClick={() => handleSelectThumbnail(frame)}
                                                className={`relative group rounded-lg overflow-hidden border-2 transition-all ${
                                                    isSelected ? 'border-emerald-500 ring-2 ring-emerald-300' : 'border-gray-200 hover:border-purple-400'
                                                }`}
                                                title={isOpening ? `Opening frame (first ~${(i * 0.15).toFixed(2)}s)` : `Frame ${i + 1 - thumbOpeningCount}`}
                                            >
                                                <img
                                                    src={imgSrc}
                                                    alt={isOpening ? `Opening frame ${i + 1}` : `Frame ${i + 1 - thumbOpeningCount}`}
                                                    className="w-full h-32 object-cover bg-gray-100"
                                                    loading="lazy"
                                                />
                                                <div className={`absolute top-1 left-1 text-white text-xs px-1.5 py-0.5 rounded ${isOpening ? 'bg-purple-600' : 'bg-black/60'}`}>
                                                    {isOpening ? 'Opening' : i + 1 - thumbOpeningCount}
                                                </div>
                                                {isSelected && (
                                                    <div className="absolute top-1 right-1 bg-emerald-500 text-white rounded-full p-1">
                                                        <Check size={12} />
                                                    </div>
                                                )}
                                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        <div className="p-4 border-t border-gray-200 flex items-center justify-between text-xs text-gray-500">
                            <span>Click a frame to set it as the ad thumbnail.</span>
                            {thumbPickerCreative.thumbnailUrl && (
                                <button
                                    onClick={() => {
                                        const idx = creativeData.creatives.findIndex(c => c.id === thumbPickerCreative.id);
                                        if (idx !== -1) updateCreativeField(idx, 'thumbnailUrl', null);
                                        setThumbPickerCreative(null);
                                        setThumbFrames([]);
                                        showSuccess('Custom thumbnail cleared — Facebook will auto-pick.');
                                    }}
                                    className="text-red-600 hover:underline"
                                >
                                    Clear selection
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Ad Preview Modal */}
            {previewCreative && (
                <AdPreview
                    pageName={pages.find(p => p.id === creativeData.pageId)?.name || 'Your Page'}
                    primaryText={(previewCreative.bodies || creativeData.bodies || [''])[0] || ''}
                    headline={(previewCreative.headlines || creativeData.headlines || [''])[0] || ''}
                    description={previewCreative.description || creativeData.description || ''}
                    cta={previewCreative.cta || creativeData.cta || 'LEARN_MORE'}
                    mediaUrl={resolveUploadUrl(previewCreative.mediaType === 'video' ? (previewCreative.thumbnailUrl || previewCreative.previewUrl) : previewCreative.previewUrl)}
                    mediaType={previewCreative.mediaType}
                    websiteUrl={creativeData.websiteUrl}
                    onClose={() => setPreviewCreative(null)}
                />
            )}
        </div>
    );
};

export default AdCreativeStep;
