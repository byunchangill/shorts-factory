// 설정 페이지
import { useState } from 'react';
import { Settings, Save, Eye, EyeOff } from 'lucide-react';

export default function SettingsPage() {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [comfyUIUrl, setComfyUIUrl] = useState('http://localhost:8188');
  const [defaultVoice, setDefaultVoice] = useState('ko-KR-SunHiNeural');
  const [maxRetries, setMaxRetries] = useState(3);
  const [outputPath, setOutputPath] = useState('./output');
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto">
        {/* 헤더 */}
        <div className="flex items-center gap-3 mb-6">
          <Settings size={24} className="text-gray-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">설정</h1>
            <p className="text-sm text-gray-500 mt-0.5">API 키 및 파이프라인 설정</p>
          </div>
        </div>

        {/* YouTube API */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
          <h3 className="font-semibold text-gray-900 mb-4">🎬 YouTube Data API v3</h3>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">API Key</label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="AIzaSy..."
                className="w-full pr-10 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              <a href="https://console.cloud.google.com" target="_blank" rel="noreferrer" className="text-blue-500 hover:underline">
                Google Cloud Console
              </a>에서 발급 받으세요
            </p>
          </div>
        </div>

        {/* ComfyUI */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
          <h3 className="font-semibold text-gray-900 mb-4">🖼️ ComfyUI 설정</h3>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">ComfyUI 서버 URL</label>
            <input
              type="text"
              value={comfyUIUrl}
              onChange={e => setComfyUIUrl(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
            />
            <p className="text-xs text-gray-400 mt-1">로컬 GPU에서 실행 중인 ComfyUI 서버 주소</p>
          </div>
        </div>

        {/* TTS */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
          <h3 className="font-semibold text-gray-900 mb-4">🎤 TTS 설정</h3>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">기본 음성</label>
            <select
              value={defaultVoice}
              onChange={e => setDefaultVoice(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="ko-KR-SunHiNeural">SunHi (여성, 밝음)</option>
              <option value="ko-KR-InJoonNeural">InJoon (남성, 차분)</option>
              <option value="ko-KR-YuJinNeural">YuJin (여성, 자연스러움)</option>
            </select>
          </div>
        </div>

        {/* 운영 설정 */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
          <h3 className="font-semibold text-gray-900 mb-4">⚙️ 운영 안전 설정</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                씬당 최대 재시도 횟수
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="1"
                  max="5"
                  value={maxRetries}
                  onChange={e => setMaxRetries(parseInt(e.target.value))}
                  className="flex-1"
                />
                <span className="text-sm font-bold text-gray-700 w-6 text-center">{maxRetries}</span>
              </div>
              <p className="text-xs text-gray-400 mt-1">CLAUDE.md 원칙 #9 — 기본값: 3회</p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">출력 경로</label>
              <input
                type="text"
                value={outputPath}
                onChange={e => setOutputPath(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
              />
              <p className="text-xs text-gray-400 mt-1">화이트리스트 기반 출력 경로 제한 적용</p>
            </div>
          </div>
        </div>

        {/* 저장 버튼 */}
        <button
          onClick={handleSave}
          className={`w-full py-3 text-sm font-semibold rounded-xl transition-all flex items-center justify-center gap-2
            ${saved ? 'bg-green-500 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}
        >
          {saved ? (
            <>✓ 저장됨</>
          ) : (
            <>
              <Save size={15} />
              설정 저장
            </>
          )}
        </button>
      </div>
    </div>
  );
}
