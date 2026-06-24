import React from 'react';
import { useNavigate } from 'react-router-dom';
import { FileImage, Video, Type, ArrowRight, Image } from 'lucide-react';

export default function CreateAds() {
    const navigate = useNavigate();

    return (
        <div>
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-gray-900">Build Creatives</h1>
                <p className="text-gray-600 mt-2">All your creative tools in one place</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
                {/* Image Ad Card */}
                <button
                    onClick={() => navigate('/image-ads')}
                    className="group relative flex flex-col items-start p-8 bg-white rounded-2xl border-2 border-gray-100 hover:border-amber-200 hover:shadow-xl transition-all duration-300 text-left"
                >
                    <div className="w-16 h-16 bg-amber-100 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                        <FileImage size={32} className="text-amber-600" />
                    </div>

                    <h3 className="text-2xl font-bold text-gray-900 mb-3">Image Ad</h3>
                    <p className="text-gray-500 mb-8 leading-relaxed">
                        Create high-converting static image ads using our template library or AI generation. Perfect for feed posts and stories.
                    </p>

                    <div className="mt-auto flex items-center gap-2 text-amber-600 font-semibold group-hover:gap-3 transition-all">
                        Start Creating <ArrowRight size={20} />
                    </div>
                </button>

                {/* Video Ad Card */}
                <button
                    onClick={() => navigate('/video-ads')}
                    className="group relative flex flex-col items-start p-8 bg-white rounded-2xl border-2 border-gray-100 hover:border-blue-200 hover:shadow-xl transition-all duration-300 text-left"
                >
                    <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                        <Video size={32} className="text-blue-600" />
                    </div>

                    <h3 className="text-2xl font-bold text-gray-900 mb-3">Video Ad</h3>
                    <p className="text-gray-500 mb-8 leading-relaxed">
                        Generate engaging video ads from product shots or stock footage. Ideal for Reels, Stories, and TikTok.
                    </p>

                    <div className="mt-auto flex items-center gap-2 text-blue-600 font-semibold group-hover:gap-3 transition-all">
                        Start Creating <ArrowRight size={20} />
                    </div>
                </button>

                {/* Headlines Card */}
                <button
                    onClick={() => navigate('/headlines')}
                    className="group relative flex flex-col items-start p-8 bg-white rounded-2xl border-2 border-gray-100 hover:border-purple-200 hover:shadow-xl transition-all duration-300 text-left"
                >
                    <div className="w-16 h-16 bg-purple-100 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                        <Type size={32} className="text-purple-600" />
                    </div>

                    <h3 className="text-2xl font-bold text-gray-900 mb-3">Headlines</h3>
                    <p className="text-gray-500 mb-8 leading-relaxed">
                        Generate scroll-stopping headlines from your research docs using AI. Build a library of proven headline angles.
                    </p>

                    <div className="mt-auto flex items-center gap-2 text-purple-600 font-semibold group-hover:gap-3 transition-all">
                        Generate Headlines <ArrowRight size={20} />
                    </div>
                </button>

                {/* Generated Ads Card */}
                <button
                    onClick={() => navigate('/generated-ads')}
                    className="group relative flex flex-col items-start p-8 bg-white rounded-2xl border-2 border-gray-100 hover:border-green-200 hover:shadow-xl transition-all duration-300 text-left"
                >
                    <div className="w-16 h-16 bg-green-100 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300">
                        <Image size={32} className="text-green-600" />
                    </div>

                    <h3 className="text-2xl font-bold text-gray-900 mb-3">Generated Ads</h3>
                    <p className="text-gray-500 mb-8 leading-relaxed">
                        Browse all your AI-generated ad creatives. View, download, and manage your generated image and video ads.
                    </p>

                    <div className="mt-auto flex items-center gap-2 text-green-600 font-semibold group-hover:gap-3 transition-all">
                        View Gallery <ArrowRight size={20} />
                    </div>
                </button>
            </div>
        </div>
    );
}
