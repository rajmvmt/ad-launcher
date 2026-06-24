// Facebook Marketing API Integration Service
// Now proxies through our backend with authentication

const API_BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1') + '/facebook';
const REPORTING_BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1') + '/reporting';

// Helper to get auth headers from localStorage
const getAuthHeaders = () => {
    const token = localStorage.getItem('accessToken');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
};

// Authenticated fetch wrapper
const authFetch = async (url, options = {}) => {
    const response = await fetch(url, {
        ...options,
        headers: {
            ...options.headers,
            ...getAuthHeaders(),
        },
    });
    return response;
};

/**
 * Get all ad accounts accessible by the access token
 */
export async function getAdAccounts(connectionId = null) {
    try {
        const params = connectionId ? `?connection_id=${connectionId}` : '';
        const response = await authFetch(`${API_BASE_URL}/accounts${params}`);
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to fetch ad accounts');
        }
        const accounts = await response.json();

        // Map backend response to frontend expected format if necessary
        // Backend returns raw FB data list
        return accounts.map(account => ({
            id: account.id,
            accountId: account.account_id,
            name: account.name,
            status: account.account_status,
            currency: account.currency,
            timezone: account.timezone_name,
            balance: account.balance,
            amountSpent: account.amount_spent,
            spendCap: account.spend_cap,
            businessName: account.business_name,
            fundingSource: account.funding_source_details,
            minDailyBudget: account.min_daily_budget,
            age: account.age,
            disableReason: account.disable_reason
        }));
    } catch (error) {
        console.error('Error fetching ad accounts:', error);
        throw error;
    }
}

/**
 * Get all campaigns for a specific ad account
 */
export async function getCampaigns(adAccountId) {
    try {
        // Backend service currently fetches all campaigns for the connected account
        // It doesn't filter by adAccountId in the service call yet, but assumes the env var account
        // For now, we'll just call the endpoint
        const response = await authFetch(`${API_BASE_URL}/campaigns?ad_account_id=${adAccountId}`);
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to fetch campaigns');
        }
        const campaigns = await response.json();

        return campaigns.map(campaign => ({
            id: campaign.id,
            name: campaign.name,
            objective: campaign.objective,
            status: campaign.status,
            dailyBudget: campaign.daily_budget,
            lifetimeBudget: campaign.lifetime_budget,
            budgetRemaining: campaign.budget_remaining,
            bid_strategy: campaign.bid_strategy,
            createdTime: campaign.created_time,
            updatedTime: campaign.updated_time,
            isCBO: campaign.is_adset_budget_sharing_enabled
        }));
    } catch (error) {
        console.error('Error fetching campaigns:', error);
        throw error;
    }
}

/**
 * Get custom audiences (custom + lookalike) for an ad account
 */
export async function getAudiences(adAccountId, connectionId = null) {
    try {
        let url = `${API_BASE_URL}/audiences?ad_account_id=${adAccountId}`;
        if (connectionId) url += `&connection_id=${connectionId}`;
        const response = await authFetch(url);
        if (!response.ok) throw new Error('Failed to fetch audiences');
        return response.json();
    } catch (error) {
        console.error('Error fetching audiences:', error);
        throw error;
    }
}

/**
 * Get all pixels for a specific ad account
 */
export async function getPixels(adAccountId, connectionId = null, forceRefresh = false) {
    try {
        let url = `${API_BASE_URL}/pixels?ad_account_id=${adAccountId}`;
        if (connectionId) url += `&connection_id=${connectionId}`;
        if (forceRefresh) url += `&force_refresh=true`;
        const response = await authFetch(url);
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to fetch pixels');
        }
        const pixels = await response.json();

        return pixels.map(pixel => ({
            id: pixel.id,
            name: pixel.name,
            code: pixel.code,
            isUnavailable: pixel.is_unavailable
        }));
    } catch (error) {
        console.error('Error fetching pixels:', error);
        throw error;
    }
}


/**
 * Create a new pixel for a specific ad account
 */
export async function createPixel(adAccountId, name) {
    const response = await authFetch(`${API_BASE_URL}/pixels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ad_account_id: adAccountId, name }),
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to create pixel');
    }
    return response.json();
}

/**
 * Get all promotable pages for a specific ad account
 */
export async function getPages(adAccountId) {
    try {
        const response = await authFetch(`${API_BASE_URL}/pages`);
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to fetch pages');
        }
        const pages = await response.json();

        return pages.map(page => ({
            id: page.id,
            name: page.name,
            accessToken: page.access_token,
            category: page.category
        }));
    } catch (error) {
        console.error('Error fetching pages:', error);
        throw error;
    }
}


export async function getPageInfo(pageId) {
    const response = await authFetch(`${API_BASE_URL}/pages/${pageId}`);
    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || 'Failed to fetch page info');
    }
    return response.json();
}

export const getAdSets = async (campaignId, adAccountId) => {
    try {
        let url = `${API_BASE_URL}/adsets?`;
        if (campaignId) {
            url += `campaign_id=${campaignId}`;
        } else if (adAccountId) {
            url += `ad_account_id=${adAccountId}`;
        }

        const response = await authFetch(url);
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to fetch ad sets');
        }
        const adSets = await response.json();
        return adSets;
    } catch (error) {
        console.error('Error fetching ad sets:', error);
        throw error;
    }
};

export const searchGeoLocations = async (query, adAccountId) => {
    try {
        return await searchLocations(query, 'country,region,city,geo_market,zip', adAccountId);
    } catch (error) {
        console.error('Error searching geo locations:', error);
        return [];
    }
};


/**
 * Upload video to Facebook
 * @param {string} videoUrl - URL of the video to upload
 * @param {string} adAccountId - Facebook ad account ID
 * @param {boolean} waitForReady - Whether to wait for video processing (default true)
 * @param {number} timeout - Max seconds to wait for processing (default 600)
 * @returns {Promise<{video_id: string, status: string, thumbnails: string[]}>}
 */
export async function uploadVideoToFacebook(videoUrl, adAccountId, waitForReady = true, timeout = 600, connectionId = null) {
    try {
        let finalVideoUrl = videoUrl;

        // If it's a blob URL, upload to our server first (R2/local storage)
        if (videoUrl.startsWith('blob:')) {
            console.log('[uploadVideo] Converting blob URL to server upload...');
            const blobResponse = await fetch(videoUrl);
            const blob = await blobResponse.blob();

            const formData = new FormData();
            const extension = blob.type.split('/')[1] || 'mp4';
            formData.append('file', blob, `upload.${extension}`);

            const uploadResponse = await authFetch((import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1') + '/uploads/', {
                method: 'POST',
                body: formData
            });

            if (!uploadResponse.ok) {
                const err = await uploadResponse.json().catch(() => ({}));
                throw new Error(err.detail || 'Failed to upload video to server');
            }

            const uploadResult = await uploadResponse.json();
            finalVideoUrl = uploadResult.url;

            // Ensure we have a full URL (not a relative path)
            if (finalVideoUrl && !finalVideoUrl.startsWith('http')) {
                // It's a relative path — prepend the R2 public URL or API base
                const r2Base = import.meta.env.VITE_R2_PUBLIC_URL;
                if (r2Base) {
                    finalVideoUrl = `${r2Base.replace(/\/$/, '')}/${finalVideoUrl.replace(/^\//, '')}`;
                }
            }
            console.log(`[uploadVideo] Server upload result URL: ${finalVideoUrl}`);
        }

        console.log(`[uploadVideo] Sending to Facebook: ${finalVideoUrl?.substring(0, 100)}... wait=${waitForReady}, timeout=${timeout}`);

        const vidParams = new URLSearchParams({ ad_account_id: adAccountId });
        if (connectionId) vidParams.append('connection_id', connectionId);
        const response = await authFetch(`${API_BASE_URL}/upload-video?${vidParams}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                video_url: finalVideoUrl,
                wait_for_ready: waitForReady,
                timeout: timeout
            })
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ detail: `HTTP ${response.status}` }));
            console.error('[uploadVideo] Upload failed:', error);
            throw new Error(error.detail || 'Failed to upload video to Facebook');
        }

        const result = await response.json();
        console.log(`[uploadVideo] Upload response: video_id=${result.video_id}, status=${result.status}`);
        return result;
    } catch (error) {
        console.error('Error uploading video:', error);
        throw error;
    }
}

/**
 * Get video processing status
 * @param {string} videoId - Facebook video ID
 * @returns {Promise<{status: string, video_id: string, length?: number}>}
 */
export async function getVideoStatus(videoId) {
    try {
        const response = await authFetch(`${API_BASE_URL}/video-status/${videoId}`);
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to get video status');
        }
        return await response.json();
    } catch (error) {
        console.error('Error getting video status:', error);
        throw error;
    }
}

/**
 * Get video thumbnails
 * @param {string} videoId - Facebook video ID
 * @returns {Promise<{thumbnails: string[]}>}
 */
export async function getVideoThumbnails(videoId) {
    try {
        const response = await authFetch(`${API_BASE_URL}/video-thumbnails/${videoId}`);
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to get video thumbnails');
        }
        return await response.json();
    } catch (error) {
        console.error('Error getting video thumbnails:', error);
        throw error;
    }
}

/**
 * Extract candidate thumbnail frames from a video via backend ffmpeg.
 * Accepts a server-side URL (http(s) or /uploads/...); NOT blob:.
 * @param {string} videoUrl
 * @param {number} n - Number of AI-ranked frames (default 8). Forced opening
 *                     frames (first ~0.5s of video) are appended on top.
 * @returns {Promise<{frames: string[], opening_count: number}>}
 *          frames are relative /uploads/thumbnails/... URLs. The first
 *          `opening_count` entries are unranked hook-frame candidates.
 */
export async function extractVideoFrames(videoUrl, n = 8) {
    if (!videoUrl || videoUrl.startsWith('blob:')) {
        throw new Error('extractVideoFrames requires a server-side URL, not blob:. Upload to /uploads first.');
    }
    const response = await authFetch(`${API_BASE_URL}/video-frames/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_url: videoUrl, n }),
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: `HTTP ${response.status}` }));
        throw new Error(error.detail || 'Failed to extract frames');
    }
    return await response.json();
}

/**
 * Upload image to Facebook
 */
export async function uploadImageToFacebook(imageUrl, adAccountId, connectionId = null) {
    try {
        let finalImageUrl = imageUrl;

        // If it's a blob URL, we need to upload it to our server first
        if (imageUrl.startsWith('blob:')) {
            // 1. Fetch the blob
            const blobResponse = await fetch(imageUrl);
            const blob = await blobResponse.blob();

            // 2. Create FormData
            const formData = new FormData();
            // Use a default filename or try to guess extension
            const filename = 'upload.jpg';
            formData.append('file', blob, filename);

            // 3. Upload to our backend
            const uploadResponse = await authFetch((import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1') + '/uploads/', {
                method: 'POST',
                body: formData
            });

            if (!uploadResponse.ok) {
                throw new Error('Failed to upload image to server');
            }

            const uploadResult = await uploadResponse.json();
            // The backend returns { url: "/uploads/filename.ext" }
            // We need to remove the leading slash to make it a relative path for the python script
            // or keep it if the python script handles absolute paths.
            // The python script runs in 'backend/', and uploads are in 'backend/uploads/'
            // So 'uploads/filename.ext' should work.
            finalImageUrl = uploadResult.url.startsWith('/') ? uploadResult.url.substring(1) : uploadResult.url;
        }

        const imgParams = new URLSearchParams({ ad_account_id: adAccountId });
        if (connectionId) imgParams.append('connection_id', connectionId);
        const response = await authFetch(`${API_BASE_URL}/upload-image?${imgParams}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ image_url: finalImageUrl })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to upload image to Facebook');
        }

        const data = await response.json();
        return data.image_hash;
    } catch (error) {
        console.error('Error uploading image:', error);
        throw error;
    }
}

/**
 * Upload multiple image variants to Facebook (for placement customization)
 * @param {Object} variantUrls - {aspect_ratio: image_url}, e.g. {"1:1": "https://...", "9:16": "https://..."}
 * @param {string} adAccountId - Facebook ad account ID
 * @returns {Promise<Object>} - {aspect_ratio: image_hash}, e.g. {"1:1": "abc123", "9:16": "def456"}
 */
export async function uploadImagesToFacebook(variantUrls, adAccountId, connectionId = null) {
    try {
        console.log(`[uploadImagesToFacebook] Uploading ${Object.keys(variantUrls).length} variants: ${Object.keys(variantUrls).join(', ')}`);
        const imgsParams = new URLSearchParams({ ad_account_id: adAccountId });
        if (connectionId) imgsParams.append('connection_id', connectionId);
        const response = await authFetch(`${API_BASE_URL}/upload-images?${imgsParams}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ variant_urls: variantUrls })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to upload image variants to Facebook');
        }

        const data = await response.json();
        console.log(`[uploadImagesToFacebook] Got hashes:`, data.image_hashes);
        return data.image_hashes;
    } catch (error) {
        console.error('Error uploading image variants:', error);
        throw error;
    }
}

/**
 * Create Facebook Campaign
 */
export async function createFacebookCampaign(campaignData, adAccountId, connectionId = null) {
    try {
        const params = new URLSearchParams({ ad_account_id: adAccountId });
        if (connectionId) params.append('connection_id', connectionId);
        const response = await authFetch(`${API_BASE_URL}/campaigns?${params}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(campaignData)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to create campaign');
        }

        const data = await response.json();
        return data.id;
    } catch (error) {
        console.error('Error creating campaign:', error);
        throw error;
    }
}

/**
 * Create Facebook Ad Set
 */
export async function createFacebookAdSet(adsetData, campaignId, adAccountId, budgetType, connectionId = null) {
    try {
        // Prepare payload for backend
        const payload = {
            ...adsetData,
            campaign_id: campaignId,
            budget_type: budgetType, // CBO or ABO - tells backend whether to set budget at adset level
            daily_budget: adsetData.dailyBudget, // Map camelCase to snake_case if needed, or handle in backend
            optimization_goal: adsetData.optimizationGoal,
            bid_strategy: adsetData.bidStrategy,
            bid_amount: adsetData.bidAmount,
            start_time: adsetData.startTime ? new Date(adsetData.startTime).toISOString() : null,
            targeting: adsetData.targeting
        };

        const adsetParams = new URLSearchParams({ ad_account_id: adAccountId });
        if (connectionId) adsetParams.append('connection_id', connectionId);
        const response = await authFetch(`${API_BASE_URL}/adsets?${adsetParams}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to create ad set');
        }

        const data = await response.json();
        return data.id;
    } catch (error) {
        console.error('Error creating ad set:', error);
        throw error;
    }
}

/**
 * Create Facebook Ad Creative (supports single image, multi-image placement, and video)
 * @param {Object} creativeData - Creative data including bodies, headlines, websiteUrl
 * @param {string|null} imageHash - Image hash for image ads (null for video or multi-image)
 * @param {string} pageId - Facebook page ID
 * @param {string} adAccountId - Facebook ad account ID
 * @param {Object|null} videoData - Video data: { video_id, thumbnail_url } for video ads
 * @param {Object|null} imageHashes - {"1:1": "hash1", "9:16": "hash2"} for placement customization
 */
export async function createFacebookCreative(creativeData, imageHash, pageId, adAccountId, videoData = null, imageHashes = null, connectionId = null) {
    try {
        const payload = {
            ...creativeData,
            page_id: pageId,
            primary_text: (creativeData.bodies || [''])[0],
            headline: (creativeData.headlines || [''])[0],
            website_url: creativeData.websiteUrl
        };

        // Add image or video data
        if (videoData && videoData.video_id) {
            payload.video_id = videoData.video_id;
            if (videoData.thumbnail_url) {
                payload.thumbnail_url = videoData.thumbnail_url;
            }
        } else if (imageHashes && Object.keys(imageHashes).length > 1) {
            // Multi-image placement customization
            payload.image_hashes = imageHashes;
        } else if (imageHash) {
            payload.image_hash = imageHash;
        }

        const creativeParams = new URLSearchParams({ ad_account_id: adAccountId });
        if (connectionId) creativeParams.append('connection_id', connectionId);
        const response = await authFetch(`${API_BASE_URL}/creatives?${creativeParams}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to create creative');
        }

        const data = await response.json();
        return data.id;
    } catch (error) {
        console.error('Error creating creative:', error);
        throw error;
    }
}

/**
 * Create Facebook Ad
 */
export async function createFacebookAd(adData, adsetId, creativeId, adAccountId, connectionId = null) {
    try {
        const payload = {
            ...adData,
            adset_id: adsetId,
            creative_id: creativeId
        };

        const adParams = new URLSearchParams({ ad_account_id: adAccountId });
        if (connectionId) adParams.append('connection_id', connectionId);
        const response = await authFetch(`${API_BASE_URL}/ads?${adParams}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to create ad');
        }

        const data = await response.json();
        return data.id;
    } catch (error) {
        console.error('Error creating ad:', error);
        throw error;
    }
}

/**
 * Search for locations
 */
export async function searchLocations(query, type = 'city', adAccountId) {
    try {
        const response = await authFetch(`${API_BASE_URL}/locations/search?q=${encodeURIComponent(query)}&type=${type}&ad_account_id=${adAccountId}`);
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to search locations');
        }
        return await response.json();
    } catch (error) {
        console.error('Error searching locations:', error);
        throw error;
    }
}


/**
 * Complete workflow: Upload media (image or video), create creative, and create ad
 * @param {string} campaignId - Campaign ID
 * @param {Object} adsetData - Ad set data with fbAdsetId
 * @param {Object} creativeData - Creative data with imageUrl or videoUrl
 * @param {Object} adData - Ad data
 * @param {string} pageId - Facebook page ID
 * @param {string} adAccountId - Facebook ad account ID
 * @param {string} budgetType - Budget type (CBO or ABO)
 */
export async function createCompleteAd(campaignId, adsetData, creativeData, adData, pageId, adAccountId, budgetType) {
    try {
        let imageHash = null;
        let imageHashes = null;
        let videoData = null;

        // Determine if this is a video or image ad
        const isVideo = creativeData.mediaType === 'video' ||
                        (creativeData.videoUrl && !creativeData.imageUrl);

        if (isVideo) {
            // Validate video URL exists
            if (!creativeData.videoUrl) {
                throw new Error('Video URL is missing — cannot upload to Facebook. Check that the video was imported correctly.');
            }

            // 1. Upload video (DON'T wait for processing — return video_id fast)
            console.log(`[createCompleteAd] Uploading video to Facebook: ${creativeData.videoUrl?.substring(0, 80)}...`);
            const videoResult = await uploadVideoToFacebook(
                creativeData.videoUrl,
                adAccountId,
                false, // DON'T wait — we'll poll from frontend instead
                60     // short timeout for upload only
            );

            console.log(`[createCompleteAd] Video uploaded: ${videoResult.video_id}, status: ${videoResult.status}`);

            // 2. Poll for video readiness from frontend (avoids server timeout)
            if (videoResult.status !== 'ready') {
                console.log('[createCompleteAd] Waiting for video processing...');
                const maxWait = 600000; // 10 minutes in ms
                const pollInterval = 8000; // 8 seconds
                const startTime = Date.now();

                while (Date.now() - startTime < maxWait) {
                    await new Promise(resolve => setTimeout(resolve, pollInterval));
                    const statusResult = await getVideoStatus(videoResult.video_id);
                    console.log(`[createCompleteAd] Video status: ${statusResult.status}`);

                    if (statusResult.status === 'ready') {
                        break;
                    } else if (statusResult.status === 'error') {
                        throw new Error(`Video processing failed: ${statusResult.error || 'Unknown error'}`);
                    }
                    // Still processing — keep polling
                }

                // Final check
                const finalStatus = await getVideoStatus(videoResult.video_id);
                if (finalStatus.status !== 'ready') {
                    throw new Error('Video processing timed out after 10 minutes');
                }
            }

            // 3. Get thumbnails now that video is ready
            let thumbnailUrl = creativeData.thumbnailUrl;
            if (!thumbnailUrl) {
                try {
                    const thumbResult = await getVideoThumbnails(videoResult.video_id);
                    thumbnailUrl = thumbResult.thumbnails?.[0] || null;
                } catch (e) {
                    console.warn('Could not fetch thumbnails:', e);
                }
            }

            videoData = {
                video_id: videoResult.video_id,
                thumbnail_url: thumbnailUrl
            };
        } else {
            // Check for multi-aspect-ratio variants (e.g., {"1:1": "url", "9:16": "url"})
            const variants = creativeData.variants;
            if (variants && typeof variants === 'object' && Object.keys(variants).length > 1) {
                console.log(`[createCompleteAd] Uploading ${Object.keys(variants).length} image variants for placement customization`);
                imageHashes = await uploadImagesToFacebook(variants, adAccountId);
            } else {
                // Single image (existing flow)
                imageHash = await uploadImageToFacebook(creativeData.imageUrl, adAccountId);
            }
        }

        // 4. Create ad creative (supports single image, multi-image, and video)
        const creativeId = await createFacebookCreative(
            creativeData,
            imageHash,
            pageId,
            adAccountId,
            videoData,
            imageHashes
        );

        // 5. Create ad
        const adId = await createFacebookAd(adData, adsetData.fbAdsetId, creativeId, adAccountId);

        return {
            imageHash,
            imageHashes,
            videoId: videoData?.video_id || null,
            creativeId,
            adId
        };
    } catch (error) {
        console.error('Error in complete ad creation:', error);
        throw error;
    }
}

/**
 * Get page profile picture URL (proxied through backend)
 * @param {string} pageId - Facebook Page ID
 * @returns {Promise<{url: string}>}
 */
export async function getPagePicture(pageId) {
    const response = await authFetch(`${API_BASE_URL}/pages/${pageId}/picture`);
    if (!response.ok) return { url: '' };
    return response.json();
}

/**
 * Run pre-flight checks before publishing ads
 * @param {string} pageId - Facebook Page ID
 * @param {string} adAccountId - Ad Account ID
 * @returns {Promise<{passed: boolean, checks: Array}>}
 */
// ── Insights / Campaign Browser ──────────────────────────────────

/**
 * Get campaigns with performance insights for an ad account
 */
export async function getCampaignInsights(adAccountId, connectionId = null, since = null, until = null, brandId = null) {
    let url = `${API_BASE_URL}/insights/campaigns?ad_account_id=${adAccountId}`;
    if (connectionId) url += `&connection_id=${connectionId}`;
    if (since) url += `&since=${since}`;
    if (until) url += `&until=${until}`;
    if (brandId) url += `&brand_id=${brandId}`;
    const response = await authFetch(url);
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to fetch campaign insights');
    }
    return response.json();
}

export async function getDailyInsights(adAccountId, connectionId = null, since = null, until = null, brandId = null) {
    let url = `${API_BASE_URL}/insights/daily?ad_account_id=${adAccountId}`;
    if (connectionId) url += `&connection_id=${connectionId}`;
    if (since) url += `&since=${since}`;
    if (until) url += `&until=${until}`;
    if (brandId) url += `&brand_id=${brandId}`;
    const response = await authFetch(url);
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to fetch daily insights');
    }
    return response.json();
}

export async function getCampaignBrandMap(connectionId = null) {
    let url = `${API_BASE_URL}/campaigns/brand-map`;
    if (connectionId) url += `?connection_id=${connectionId}`;
    const response = await authFetch(url);
    if (!response.ok) return {};
    return response.json();
}

export async function tagCampaignBrand(fbCampaignId, brandId, name = '', objective = '') {
    const response = await authFetch(`${API_BASE_URL}/campaigns/${fbCampaignId}/brand`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand_id: brandId || null, name, objective }),
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to tag campaign brand');
    }
    return response.json();
}

export async function getAdAlerts(adAccountId, connectionId = null) {
    let url = `${API_BASE_URL}/ad-alerts?ad_account_id=${adAccountId}`;
    if (connectionId) url += `&connection_id=${connectionId}`;
    const response = await authFetch(url);
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to fetch ad alerts');
    }
    return response.json();
}

/**
 * Get ad sets with performance insights for a campaign
 */
export async function getAdSetInsights(campaignId, connectionId = null, adAccountId = null, since = null, until = null) {
    let url = `${API_BASE_URL}/insights/adsets/${campaignId}?`;
    const params = [];
    if (connectionId) params.push(`connection_id=${connectionId}`);
    if (adAccountId) params.push(`ad_account_id=${adAccountId}`);
    if (since) params.push(`since=${since}`);
    if (until) params.push(`until=${until}`);
    url += params.join('&');
    const response = await authFetch(url);
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to fetch ad set insights');
    }
    return response.json();
}

/**
 * Get ads with performance insights for an ad set
 */
export async function getAdInsights(adsetId, connectionId = null, adAccountId = null, since = null, until = null) {
    let url = `${API_BASE_URL}/insights/ads/${adsetId}?`;
    const params = [];
    if (connectionId) params.push(`connection_id=${connectionId}`);
    if (adAccountId) params.push(`ad_account_id=${adAccountId}`);
    if (since) params.push(`since=${since}`);
    if (until) params.push(`until=${until}`);
    url += params.join('&');
    const response = await authFetch(url);
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to fetch ad insights');
    }
    return response.json();
}

/**
 * Get ALL ads across all campaigns for an ad account
 */
export async function getAllAdInsights(connectionId = null, adAccountId = null, since = null, until = null) {
    let url = `${API_BASE_URL}/insights/all-ads?`;
    const params = [];
    if (connectionId) params.push(`connection_id=${connectionId}`);
    if (adAccountId) params.push(`ad_account_id=${adAccountId}`);
    if (since) params.push(`since=${since}`);
    if (until) params.push(`until=${until}`);
    url += params.join('&');
    const response = await authFetch(url);
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to fetch all ads');
    }
    return response.json();
}

/**
 * Get ALL ad sets across all campaigns for an ad account
 */
export async function getAllAdSetInsights(connectionId = null, adAccountId = null, since = null, until = null) {
    let url = `${API_BASE_URL}/insights/all-adsets?`;
    const params = [];
    if (connectionId) params.push(`connection_id=${connectionId}`);
    if (adAccountId) params.push(`ad_account_id=${adAccountId}`);
    if (since) params.push(`since=${since}`);
    if (until) params.push(`until=${until}`);
    url += params.join('&');
    const response = await authFetch(url);
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to fetch all ad sets');
    }
    return response.json();
}

/**
 * Get brand IDs assigned to an ad account
 */
export async function getAccountBrands(adAccountId) {
    const response = await authFetch(`${API_BASE_URL}/account-brands?ad_account_id=${encodeURIComponent(adAccountId)}`);
    if (!response.ok) return [];
    return response.json();
}

/**
 * Set brand assignments for an ad account
 */
export async function setAccountBrands(adAccountId, brandIds) {
    const response = await authFetch(`${API_BASE_URL}/account-brands`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ad_account_id: adAccountId, brand_ids: brandIds }),
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to set account brands');
    }
    return response.json();
}

/**
 * Get mapping of all ad accounts -> brand IDs
 */
export async function getAccountBrandMap() {
    const response = await authFetch(`${API_BASE_URL}/account-brands/map`);
    if (!response.ok) return {};
    return response.json();
}

/**
 * Toggle status of a campaign, ad set, or ad
 */
export async function updateObjectStatus(objectId, objectType, status, connectionId = null) {
    let url = `${API_BASE_URL}/status`;
    if (connectionId) url += `?connection_id=${connectionId}`;
    const response = await authFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ object_id: objectId, object_type: objectType, status }),
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to update status');
    }
    return response.json();
}

/**
 * Bulk update status of multiple campaigns/adsets/ads
 */
export async function bulkUpdateStatus(items, status, connectionId = null) {
    let url = `${API_BASE_URL}/bulk-status`;
    if (connectionId) url += `?connection_id=${connectionId}`;
    const response = await authFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, status }),
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to bulk update status');
    }
    return response.json();
}

/**
 * Delete a campaign, ad set, or ad (sets DELETED status on Facebook)
 */
export async function deleteObject(objectId, objectType, connectionId = null) {
    let url = `${API_BASE_URL}/delete-object`;
    if (connectionId) url += `?connection_id=${connectionId}`;
    const response = await authFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ object_id: objectId, object_type: objectType }),
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to delete');
    }
    return response.json();
}

/**
 * Get Facebook-rendered ad preview HTML
 */
export async function getAdPreview(adId, adFormat = 'DESKTOP_FEED_STANDARD', connectionId = null) {
    let url = `${API_BASE_URL}/ad-preview/${adId}?ad_format=${adFormat}`;
    if (connectionId) url += `&connection_id=${connectionId}`;
    const response = await authFetch(url);
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to get ad preview');
    }
    return response.json();
}

/**
 * Duplicate an ad (same creative, new ad, starts PAUSED)
 */
export async function duplicateAd(adId, adAccountId, connectionId = null, newName = null) {
    let url = `${API_BASE_URL}/duplicate-ad`;
    if (connectionId) url += `?connection_id=${connectionId}`;
    const response = await authFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ad_id: adId, ad_account_id: adAccountId, new_name: newName }),
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to duplicate ad');
    }
    return response.json();
}

/**
 * Duplicate a campaign and all its ad sets + ads (starts PAUSED)
 */
export async function duplicateCampaign(campaignId, adAccountId, connectionId = null, newName = null) {
    let url = `${API_BASE_URL}/duplicate-campaign`;
    if (connectionId) url += `?connection_id=${connectionId}`;
    const response = await authFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_id: campaignId, ad_account_id: adAccountId, new_name: newName }),
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to duplicate campaign');
    }
    return response.json();
}

/**
 * Clone a campaign's structure (campaign + ad sets) to a different ad account.
 * No ads/creatives copied — those are account-specific.
 */
export async function cloneCampaignToAccount(campaignId, targetAccountId, connectionId = null, {
    newName = null, targetPageId = null, targetPixelId = null, cloneAds = true
} = {}) {
    let url = `${API_BASE_URL}/clone-campaign`;
    if (connectionId) url += `?connection_id=${connectionId}`;
    const response = await authFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            campaign_id: campaignId,
            target_account_id: targetAccountId,
            new_name: newName,
            target_page_id: targetPageId,
            target_pixel_id: targetPixelId,
            clone_ads: cloneAds,
        }),
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to clone campaign');
    }
    return response.json();
}

/**
 * Duplicate an ad set and all its ads (starts PAUSED)
 */
export async function duplicateAdSet(adsetId, adAccountId, connectionId = null, newName = null) {
    let url = `${API_BASE_URL}/duplicate-adset`;
    if (connectionId) url += `?connection_id=${connectionId}`;
    const response = await authFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adset_id: adsetId, ad_account_id: adAccountId, new_name: newName }),
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to duplicate ad set');
    }
    return response.json();
}

/**
 * Rename a campaign, ad set, or ad
 */
export async function renameObject(objectId, objectType, newName, connectionId = null) {
    let url = `${API_BASE_URL}/rename`;
    if (connectionId) url += `?connection_id=${connectionId}`;
    const response = await authFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ object_id: objectId, object_type: objectType, name: newName }),
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to rename');
    }
    return response.json();
}

/**
 * Rename an ad (backward compat)
 */
export async function renameAd(adId, newName, connectionId = null) {
    return renameObject(adId, 'ad', newName, connectionId);
}

/**
 * Edit an ad's creative (creates new creative, updates ad to use it)
 */
export async function editAdCreative(data, connectionId = null) {
    let url = `${API_BASE_URL}/edit-creative`;
    if (connectionId) url += `?connection_id=${connectionId}`;
    const response = await authFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to edit creative');
    }
    return response.json();
}

export async function runPreflightCheck(pageId, adAccountId, connectionId = null) {
    const params = connectionId ? `?connection_id=${connectionId}` : '';
    const response = await authFetch(`${API_BASE_URL}/preflight${params}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page_id: pageId, ad_account_id: adAccountId })
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Pre-flight check failed');
    }
    return response.json();
}


// ── Scheduled Budget Changes ────────────────────────────────────────

export async function scheduleBudgetChange(objectId, objectType, newBudgetDollars, adAccountId, connectionId, scheduledForISO) {
    let url = `${API_BASE_URL}/schedule-budget`;
    if (connectionId) url += `?connection_id=${connectionId}`;
    const body = {
        object_id: objectId,
        object_type: objectType,
        new_budget_cents: Math.round(newBudgetDollars * 100),
        ad_account_id: adAccountId,
        connection_id: connectionId,
    };
    if (scheduledForISO) body.scheduled_for = scheduledForISO;
    const response = await authFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to schedule budget change');
    }
    return response.json();
}

export async function getScheduledBudgets(adAccountId, connectionId) {
    let url = `${API_BASE_URL}/scheduled-budgets?ad_account_id=${adAccountId}`;
    if (connectionId) url += `&connection_id=${connectionId}`;
    const response = await authFetch(url);
    if (!response.ok) return [];
    return response.json();
}

export async function cancelScheduledBudget(changeId, connectionId) {
    let url = `${API_BASE_URL}/scheduled-budgets/${changeId}`;
    if (connectionId) url += `?connection_id=${connectionId}`;
    const response = await authFetch(url, { method: 'DELETE' });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to cancel');
    }
    return response.json();
}


// ── Auto-Safe Log ───────────────────────────────────────────────────

export async function getAutoSafeLog(adAccountId, connectionId) {
    let url = `${API_BASE_URL}/auto-safe-log?ad_account_id=${adAccountId}`;
    if (connectionId) url += `&connection_id=${connectionId}`;
    const response = await authFetch(url);
    if (!response.ok) return [];
    return response.json();
}


// ── Quick Create Ad Set ───────────────────────────────────────────

export async function quickCreateAdSet(data, connectionId) {
    let url = `${API_BASE_URL}/quick-create-adset`;
    if (connectionId) url += `?connection_id=${connectionId}`;
    const response = await authFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to create ad set');
    }
    return response.json();
}


// ── Quick Create Ad ───────────────────────────────────────────────

export async function quickCreateAd(data, connectionId) {
    let url = `${API_BASE_URL}/quick-create-ad`;
    if (connectionId) url += `?connection_id=${connectionId}`;
    const response = await authFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to create ad');
    }
    return response.json();
}


// ── Budget Scheduling (FB Native) ─────────────────────────────────

export async function getBudgetSchedules(objectId, objectType = 'campaign', connectionId) {
    let url = `${API_BASE_URL}/budget-schedules/${objectId}?object_type=${objectType}`;
    if (connectionId) url += `&connection_id=${connectionId}`;
    const response = await authFetch(url);
    if (!response.ok) return [];
    return response.json();
}

export async function createBudgetSchedule(objectId, data, connectionId) {
    let url = `${API_BASE_URL}/budget-schedules/${objectId}`;
    if (connectionId) url += `?connection_id=${connectionId}`;
    const response = await authFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to create budget schedule');
    }
    return response.json();
}

export async function deleteBudgetScheduleApi(scheduleId, connectionId) {
    let url = `${API_BASE_URL}/budget-schedules/${scheduleId}`;
    if (connectionId) url += `?connection_id=${connectionId}`;
    const response = await authFetch(url, { method: 'DELETE' });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to delete budget schedule');
    }
    return response.json();
}


// ── Edit Campaign ─────────────────────────────────────────────────

export async function updateCampaign(campaignId, data, connectionId) {
    let url = `${API_BASE_URL}/campaign/${campaignId}`;
    if (connectionId) url += `?connection_id=${connectionId}`;
    const response = await authFetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to update campaign');
    }
    return response.json();
}


// ── Edit Ad Set ───────────────────────────────────────────────────

export async function updateAdSet(adsetId, data, connectionId) {
    let url = `${API_BASE_URL}/adset/${adsetId}`;
    if (connectionId) url += `?connection_id=${connectionId}`;
    const response = await authFetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to update ad set');
    }
    return response.json();
}


// ── Quick Bid Edit (live, not scheduled) ──────────────────────────

export async function quickUpdateBid({ objectId, objectType, bidAmountCents, connectionId, force = false }) {
    let url = `${API_BASE_URL}/quick-bid`;
    if (connectionId) url += `?connection_id=${connectionId}`;
    const response = await authFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            object_id: objectId,
            object_type: objectType,
            bid_amount_cents: bidAmountCents,
            force,
        }),
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || 'Failed to update bid');
    }
    return response.json();
}


// ── Budget Surfing ─────────────────────────────────────────────────

export async function createBudgetSurf(data) {
    const response = await authFetch(`${API_BASE_URL}/budget-surf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to create surf config');
    }
    return response.json();
}

export async function getBudgetSurfConfigs(adAccountId, connectionId) {
    let url = `${API_BASE_URL}/budget-surf?ad_account_id=${adAccountId}`;
    if (connectionId) url += `&connection_id=${connectionId}`;
    const response = await authFetch(url);
    if (!response.ok) return [];
    return response.json();
}

export async function updateBudgetSurf(configId, data) {
    const response = await authFetch(`${API_BASE_URL}/budget-surf/${configId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to update surf config');
    }
    return response.json();
}

export async function deleteBudgetSurf(configId) {
    const response = await authFetch(`${API_BASE_URL}/budget-surf/${configId}`, {
        method: 'DELETE',
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to delete surf config');
    }
    return response.json();
}

export async function getBudgetSurfLogs(configId) {
    const response = await authFetch(`${API_BASE_URL}/budget-surf/${configId}/logs`);
    if (!response.ok) return [];
    return response.json();
}


// ── Dayparting ──────────────────────────────────────────────────────

export async function getDaypartSchedules(adAccountId, connectionId) {
    let url = `${API_BASE_URL}/daypart?ad_account_id=${adAccountId}`;
    if (connectionId) url += `&connection_id=${connectionId}`;
    const response = await authFetch(url);
    if (!response.ok) return [];
    return response.json();
}

export async function upsertDaypartSchedule(data) {
    const response = await authFetch(`${API_BASE_URL}/daypart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to save daypart schedule');
    }
    return response.json();
}

export async function deleteDaypartSchedule(scheduleId) {
    const response = await authFetch(`${API_BASE_URL}/daypart/${scheduleId}`, {
        method: 'DELETE',
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to delete daypart schedule');
    }
    return response.json();
}

export async function toggleDaypartSchedule(scheduleId) {
    const response = await authFetch(`${API_BASE_URL}/daypart/${scheduleId}/toggle`, {
        method: 'PATCH',
    });
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to toggle daypart schedule');
    }
    return response.json();
}

// ── Bid Schedules (recurring bid-cap changes by hour) ───────────────────────

export async function getBidSchedules({ fbObjectId, adAccountId } = {}) {
    const params = new URLSearchParams();
    if (fbObjectId) params.set('fb_object_id', fbObjectId);
    if (adAccountId) params.set('ad_account_id', adAccountId);
    const q = params.toString();
    const url = `${API_BASE_URL}/bid-schedules${q ? '?' + q : ''}`;
    const response = await authFetch(url);
    if (!response.ok) return [];
    return response.json();
}

export async function createBidSchedule(data) {
    const response = await authFetch(`${API_BASE_URL}/bid-schedules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || 'Failed to create bid schedule');
    }
    return response.json();
}

export async function updateBidSchedule(scheduleId, data) {
    const response = await authFetch(`${API_BASE_URL}/bid-schedules/${scheduleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || 'Failed to update bid schedule');
    }
    return response.json();
}

export async function deleteBidSchedule(scheduleId) {
    const response = await authFetch(`${API_BASE_URL}/bid-schedules/${scheduleId}`, {
        method: 'DELETE',
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || 'Failed to delete bid schedule');
    }
    return response.json();
}

export async function runBidScheduleNow(scheduleId) {
    const response = await authFetch(`${API_BASE_URL}/bid-schedules/${scheduleId}/run-now`, {
        method: 'POST',
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.detail || 'Failed to run bid schedule');
    }
    return data;
}

// ── Bid Schedule Presets ────────────────────────────────────────────────────

export async function getBidSchedulePresets() {
    const response = await authFetch(`${API_BASE_URL}/bid-schedule-presets`);
    if (!response.ok) return [];
    return response.json();
}

export async function createBidSchedulePreset(data) {
    const response = await authFetch(`${API_BASE_URL}/bid-schedule-presets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || 'Failed to save preset');
    }
    return response.json();
}

export async function deleteBidSchedulePreset(presetId) {
    const response = await authFetch(`${API_BASE_URL}/bid-schedule-presets/${presetId}`, {
        method: 'DELETE',
    });
    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || 'Failed to delete preset');
    }
    return response.json();
}

export async function applyBidSchedulePreset(presetId, data) {
    const response = await authFetch(`${API_BASE_URL}/bid-schedule-presets/${presetId}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    const out = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(out.detail || 'Failed to apply preset');
    return out;
}

// ── Synced Reporting (DB-backed, zero FB API calls) ──────────────────────────

export async function getSyncedCampaigns(adAccountId, connectionId = null, date = null) {
    let url = `${REPORTING_BASE_URL}/campaigns?ad_account_id=${adAccountId}`;
    if (connectionId) url += `&connection_id=${connectionId}`;
    if (date) url += `&date=${date}`;
    const response = await authFetch(url);
    if (!response.ok) throw new Error('Failed to fetch synced campaigns');
    return response.json();
}

export async function getSyncedAdSets(campaignId, adAccountId, connectionId = null, date = null) {
    let url = `${REPORTING_BASE_URL}/adsets?ad_account_id=${adAccountId}&campaign_id=${campaignId}`;
    if (connectionId) url += `&connection_id=${connectionId}`;
    if (date) url += `&date=${date}`;
    const response = await authFetch(url);
    if (!response.ok) throw new Error('Failed to fetch synced ad sets');
    return response.json();
}

export async function getSyncedAds(adsetId, adAccountId, connectionId = null, date = null) {
    let url = `${REPORTING_BASE_URL}/ads?ad_account_id=${adAccountId}&adset_id=${adsetId}`;
    if (connectionId) url += `&connection_id=${connectionId}`;
    if (date) url += `&date=${date}`;
    const response = await authFetch(url);
    if (!response.ok) throw new Error('Failed to fetch synced ads');
    return response.json();
}

export async function getSyncedAllAds(adAccountId, connectionId = null, date = null) {
    let url = `${REPORTING_BASE_URL}/all-ads?ad_account_id=${adAccountId}`;
    if (connectionId) url += `&connection_id=${connectionId}`;
    if (date) url += `&date=${date}`;
    const response = await authFetch(url);
    if (!response.ok) throw new Error('Failed to fetch all synced ads');
    return response.json();
}

export async function getSyncedAllAdSets(adAccountId, connectionId = null, date = null) {
    let url = `${REPORTING_BASE_URL}/all-adsets?ad_account_id=${adAccountId}`;
    if (connectionId) url += `&connection_id=${connectionId}`;
    if (date) url += `&date=${date}`;
    const response = await authFetch(url);
    if (!response.ok) throw new Error('Failed to fetch all synced ad sets');
    return response.json();
}

// ─── Daily Stats (per-day breakdown, any date range from DB) ────────────────

export async function getDailySyncedCampaigns(adAccountId, since, until, connectionId = null) {
    let url = `${REPORTING_BASE_URL}/daily/campaigns?ad_account_id=${adAccountId}&since=${since}&until=${until}`;
    if (connectionId) url += `&connection_id=${connectionId}`;
    const response = await authFetch(url);
    if (!response.ok) throw new Error('Failed to fetch daily campaigns');
    return response.json();
}

export async function getDailySyncedAdSets(adAccountId, since, until, campaignId = null, connectionId = null) {
    let url = `${REPORTING_BASE_URL}/daily/adsets?ad_account_id=${adAccountId}&since=${since}&until=${until}`;
    if (campaignId) url += `&campaign_id=${campaignId}`;
    if (connectionId) url += `&connection_id=${connectionId}`;
    const response = await authFetch(url);
    if (!response.ok) throw new Error('Failed to fetch daily adsets');
    return response.json();
}

export async function getDailySyncedAds(adAccountId, since, until, adsetId = null, connectionId = null) {
    let url = `${REPORTING_BASE_URL}/daily/ads?ad_account_id=${adAccountId}&since=${since}&until=${until}`;
    if (adsetId) url += `&adset_id=${adsetId}`;
    if (connectionId) url += `&connection_id=${connectionId}`;
    const response = await authFetch(url);
    if (!response.ok) throw new Error('Failed to fetch daily ads');
    return response.json();
}

export async function getDailySyncedAllAds(adAccountId, since, until, connectionId = null) {
    let url = `${REPORTING_BASE_URL}/daily/all-ads?ad_account_id=${adAccountId}&since=${since}&until=${until}`;
    if (connectionId) url += `&connection_id=${connectionId}`;
    const response = await authFetch(url);
    if (!response.ok) throw new Error('Failed to fetch daily all ads');
    return response.json();
}

export async function getDailySyncedAllAdSets(adAccountId, since, until, connectionId = null) {
    let url = `${REPORTING_BASE_URL}/daily/all-adsets?ad_account_id=${adAccountId}&since=${since}&until=${until}`;
    if (connectionId) url += `&connection_id=${connectionId}`;
    const response = await authFetch(url);
    if (!response.ok) throw new Error('Failed to fetch daily all adsets');
    return response.json();
}

export async function getSyncStatus(adAccountId, connectionId = null) {
    let url = `${REPORTING_BASE_URL}/sync-status?ad_account_id=${adAccountId}`;
    if (connectionId) url += `&connection_id=${connectionId}`;
    const response = await authFetch(url);
    if (!response.ok) throw new Error('Failed to fetch sync status');
    return response.json();
}

export async function safeAllAds(adAccountId, connectionId = null) {
    const response = await authFetch(`${API_BASE_URL}/safe-all-ads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ad_account_id: adAccountId, connection_id: connectionId }),
    });
    if (!response.ok) throw new Error('Failed to trigger safe-all-ads');
    return response.json();
}

export async function triggerSync(adAccountId, connectionId = null) {
    let url = `${REPORTING_BASE_URL}/sync-now?ad_account_id=${adAccountId}`;
    if (connectionId) url += `&connection_id=${connectionId}`;
    const response = await authFetch(url, { method: 'POST' });
    if (!response.ok) throw new Error('Failed to trigger sync');
    return response.json();
}
