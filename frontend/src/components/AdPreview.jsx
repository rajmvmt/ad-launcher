import React, { useState } from 'react';
import { Play, ThumbsUp, MessageCircle, Share2, X } from 'lucide-react';

const CTA_LABELS = {
    'LEARN_MORE': 'Learn More',
    'SHOP_NOW': 'Shop Now',
    'SIGN_UP': 'Sign Up',
    'CONTACT_US': 'Contact Us',
    'DOWNLOAD': 'Download',
    'BOOK_NOW': 'Book Now',
    'BUY_TICKETS': 'Buy Tickets',
    'GET_QUOTE': 'Get Quote',
    'DONATE_NOW': 'Donate Now',
    'SUBSCRIBE': 'Subscribe',
    'GET_OFFER': 'Get Offer',
    'APPLY_NOW': 'Apply Now',
    'ORDER_NOW': 'Order Now',
    'WATCH_MORE': 'Watch More',
    'SEE_MENU': 'See Menu',
};

const ctaLabel = (cta) => CTA_LABELS[cta] || cta?.replace(/_/g, ' ') || 'Learn More';

const getDomain = (url) => {
    try {
        return new URL(url).hostname.replace('www.', '');
    } catch {
        return url || 'example.com';
    }
};

const FeedPreview = ({ pageName, pageAvatarUrl, primaryText, headline, description, cta, mediaUrl, mediaType, websiteUrl }) => (
    <div className="bg-white rounded-lg shadow-lg max-w-[400px] w-full border border-gray-200 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 p-3 pb-2">
            <div className="w-10 h-10 rounded-full bg-gray-300 overflow-hidden flex-shrink-0">
                {pageAvatarUrl ? (
                    <img src={pageAvatarUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                    <div className="w-full h-full bg-blue-600 flex items-center justify-center text-white font-bold text-sm">
                        {pageName?.[0] || 'P'}
                    </div>
                )}
            </div>
            <div>
                <div className="font-semibold text-sm text-gray-900">{pageName || 'Page Name'}</div>
                <div className="text-xs text-gray-500">Sponsored</div>
            </div>
        </div>

        {/* Primary Text */}
        <div className="px-3 pb-2">
            <p className="text-sm text-gray-900 whitespace-pre-wrap line-clamp-3">{primaryText || 'Ad copy goes here...'}</p>
        </div>

        {/* Media */}
        <div className="relative bg-gray-100 aspect-square">
            {mediaType === 'video' ? (
                <>
                    {mediaUrl ? (
                        mediaUrl.match(/\.(mp4|mov|webm|avi)(\?|$)/i) ? (
                            <video src={mediaUrl} className="w-full h-full object-cover" muted playsInline preload="metadata" />
                        ) : (
                            <img src={mediaUrl} alt="Video thumbnail" className="w-full h-full object-cover" />
                        )
                    ) : (
                        <div className="w-full h-full bg-gray-200" />
                    )}
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-16 h-16 rounded-full bg-black/60 flex items-center justify-center">
                            <Play size={28} className="text-white ml-1" fill="white" />
                        </div>
                    </div>
                </>
            ) : (
                mediaUrl ? (
                    <img src={mediaUrl} alt="Ad creative" className="w-full h-full object-cover" />
                ) : (
                    <div className="w-full h-full bg-gray-200 flex items-center justify-center text-gray-400 text-sm">
                        No image
                    </div>
                )
            )}
        </div>

        {/* Link Bar */}
        <div className="flex items-center justify-between p-3 bg-gray-50 border-t border-gray-200">
            <div className="flex-1 min-w-0 mr-3">
                <div className="text-xs text-gray-500 uppercase truncate">{getDomain(websiteUrl)}</div>
                <div className="text-sm font-semibold text-gray-900 truncate">{headline || 'Headline'}</div>
                {description && <div className="text-xs text-gray-500 truncate">{description}</div>}
            </div>
            {cta !== 'NO_BUTTON' && (
                <button className="px-4 py-2 bg-gray-200 text-sm font-semibold text-gray-900 rounded whitespace-nowrap">
                    {ctaLabel(cta)}
                </button>
            )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-around py-2 border-t border-gray-200 text-gray-500">
            <div className="flex items-center gap-1 text-sm"><ThumbsUp size={16} /> Like</div>
            <div className="flex items-center gap-1 text-sm"><MessageCircle size={16} /> Comment</div>
            <div className="flex items-center gap-1 text-sm"><Share2 size={16} /> Share</div>
        </div>
    </div>
);

const StoryPreview = ({ pageName, pageAvatarUrl, primaryText, cta, mediaUrl, mediaType }) => (
    <div className="bg-black rounded-2xl max-w-[240px] w-full overflow-hidden shadow-lg" style={{ aspectRatio: '9/16' }}>
        <div className="relative w-full h-full flex flex-col">
            {/* Background Media */}
            <div className="absolute inset-0">
                {mediaUrl ? (
                    mediaUrl.match(/\.(mp4|mov|webm|avi)(\?|$)/i) ? (
                        <video src={mediaUrl} className="w-full h-full object-cover" muted playsInline preload="metadata" />
                    ) : (
                        <img src={mediaUrl} alt="" className="w-full h-full object-cover" />
                    )
                ) : (
                    <div className="w-full h-full bg-gray-800" />
                )}
                {/* Gradient overlay */}
                <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/70" />
            </div>

            {/* Header */}
            <div className="relative flex items-center gap-2 p-3 pt-4">
                <div className="w-8 h-8 rounded-full bg-gray-400 overflow-hidden flex-shrink-0 ring-2 ring-white/50">
                    {pageAvatarUrl ? (
                        <img src={pageAvatarUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                        <div className="w-full h-full bg-blue-600 flex items-center justify-center text-white font-bold text-xs">
                            {pageName?.[0] || 'P'}
                        </div>
                    )}
                </div>
                <div className="text-white text-xs font-semibold truncate">{pageName || 'Page'}</div>
                <div className="text-white/60 text-xs">Sponsored</div>
            </div>

            {/* Video play icon */}
            {mediaType === 'video' && (
                <div className="relative flex-1 flex items-center justify-center">
                    <div className="w-14 h-14 rounded-full bg-black/50 flex items-center justify-center">
                        <Play size={24} className="text-white ml-1" fill="white" />
                    </div>
                </div>
            )}
            {mediaType !== 'video' && <div className="flex-1" />}

            {/* Bottom overlay */}
            <div className="relative p-3 pb-4 space-y-2">
                {primaryText && (
                    <p className="text-white text-xs line-clamp-2 drop-shadow">{primaryText}</p>
                )}
                {cta !== 'NO_BUTTON' && (
                    <div className="bg-white rounded-full py-2 px-4 text-center">
                        <span className="text-sm font-semibold text-gray-900">{ctaLabel(cta)}</span>
                    </div>
                )}
            </div>
        </div>
    </div>
);

const AdPreview = ({ pageName, pageAvatarUrl, primaryText, headline, description, cta, mediaUrl, mediaType, websiteUrl, onClose }) => {
    const [placement, setPlacement] = useState('feed');

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                {/* Modal Header */}
                <div className="flex items-center justify-between p-4 border-b border-gray-200">
                    <h3 className="font-semibold text-gray-900">Ad Preview</h3>
                    <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded">
                        <X size={20} />
                    </button>
                </div>

                {/* Placement Toggle */}
                <div className="flex gap-2 p-4 pb-2">
                    <button
                        onClick={() => setPlacement('feed')}
                        className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                            placement === 'feed'
                                ? 'bg-blue-600 text-white'
                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                    >
                        Feed
                    </button>
                    <button
                        onClick={() => setPlacement('story')}
                        className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                            placement === 'story'
                                ? 'bg-blue-600 text-white'
                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                    >
                        Story
                    </button>
                </div>

                {/* Preview */}
                <div className="flex justify-center p-4 pt-2">
                    {placement === 'feed' ? (
                        <FeedPreview
                            pageName={pageName}
                            pageAvatarUrl={pageAvatarUrl}
                            primaryText={primaryText}
                            headline={headline}
                            description={description}
                            cta={cta}
                            mediaUrl={mediaUrl}
                            mediaType={mediaType}
                            websiteUrl={websiteUrl}
                        />
                    ) : (
                        <StoryPreview
                            pageName={pageName}
                            pageAvatarUrl={pageAvatarUrl}
                            primaryText={primaryText}
                            cta={cta}
                            mediaUrl={mediaUrl}
                            mediaType={mediaType}
                        />
                    )}
                </div>
            </div>
        </div>
    );
};

export default AdPreview;
export { FeedPreview, StoryPreview };
