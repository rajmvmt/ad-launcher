import { useState } from 'react';
import { X, Zap, Loader2, CheckCircle, AlertCircle } from 'lucide-react';

const GenerateContentModal = ({ isOpen, onClose, onGenerate, personaName, isGenerating = false, result = null }) => {
  const [contentType, setContentType] = useState('all');
  const [model, setModel] = useState('sonnet');

  if (!isOpen) return null;

  const handleGenerate = () => {
    onGenerate({ contentType, model });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
              <Zap className="text-amber-600" size={20} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900">Generate Content</h3>
              {personaName && <p className="text-sm text-gray-500">{personaName}</p>}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-500">
            <X size={20} />
          </button>
        </div>

        {result ? (
          <div className="space-y-4">
            <div className={`flex items-start gap-3 p-4 rounded-lg ${result.error ? 'bg-red-50' : 'bg-green-50'}`}>
              {result.error ? (
                <AlertCircle className="text-red-500 shrink-0 mt-0.5" size={20} />
              ) : (
                <CheckCircle className="text-green-500 shrink-0 mt-0.5" size={20} />
              )}
              <div>
                {result.error ? (
                  <p className="text-sm text-red-700">{result.error}</p>
                ) : (
                  <div className="text-sm text-green-700">
                    <p className="font-medium mb-1">Content generated successfully!</p>
                    {result.generated && (
                      <ul className="space-y-0.5">
                        {result.generated.posts > 0 && <li>{result.generated.posts} posts</li>}
                        {result.generated.comments > 0 && <li>{result.generated.comments} comments</li>}
                        {result.generated.image_prompts > 0 && <li>{result.generated.image_prompts} image prompts</li>}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-full px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium"
            >
              Close
            </button>
          </div>
        ) : isGenerating ? (
          <div className="flex flex-col items-center py-8">
            <Loader2 size={40} className="text-amber-500 animate-spin mb-4" />
            <p className="text-gray-600 font-medium">Generating content...</p>
            <p className="text-sm text-gray-400 mt-1">This may take a minute</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Content Type</label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { value: 'all', label: 'All Content' },
                  { value: 'posts', label: 'Posts Only' },
                  { value: 'comments', label: 'Comments Only' },
                  { value: 'image_prompts', label: 'Image Prompts Only' },
                ].map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setContentType(opt.value)}
                    className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
                      contentType === opt.value
                        ? 'border-amber-500 bg-amber-50 text-amber-700 font-medium'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">AI Model</label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { value: 'sonnet', label: 'Sonnet', desc: 'Better quality' },
                  { value: 'haiku', label: 'Haiku', desc: 'Faster, cheaper' },
                ].map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setModel(opt.value)}
                    className={`px-3 py-2 text-sm rounded-lg border transition-colors text-left ${
                      model === opt.value
                        ? 'border-amber-500 bg-amber-50 text-amber-700'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <span className="font-medium">{opt.label}</span>
                    <span className="block text-xs text-gray-400 mt-0.5">{opt.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleGenerate}
                className="flex-1 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors font-medium shadow-sm flex items-center justify-center gap-2"
              >
                <Zap size={16} />
                Generate
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default GenerateContentModal;
