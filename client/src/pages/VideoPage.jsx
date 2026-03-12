// 영상/TTS 합성 페이지
import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Play, Volume2, Music, CheckCircle2, RefreshCw, Sliders } from 'lucide-react';
import { mockJobs, mockImages } from '../data/mockData';
import StepProgress from '../components/common/StepProgress';
import ActivityLog from '../components/common/ActivityLog';

const VOICE_OPTIONS = [
  { id: 'ko-KR-SunHiNeural', label: 'SunHi (여성, 밝음)', gender: '여성' },
  { id: 'ko-KR-InJoonNeural', label: 'InJoon (남성, 차분)', gender: '남성' },
  { id: 'ko-KR-YuJinNeural', label: 'YuJin (여성, 자연스러움)', gender: '여성' },
];

const BGM_TRACKS = [
  { id: 'bgm-01', label: '따뜻한 일상', genre: 'Lo-fi' },
  { id: 'bgm-02', label: '감동적 여정', genre: 'Cinematic' },
  { id: 'bgm-03', label: '밝은 아침', genre: 'Pop' },
  { id: 'bgm-04', label: '없음', genre: '' },
];

export default function VideoPage() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const [phase, setPhase] = useState('video'); // 'video' | 'tts' | 'compose'
  const [selectedVoice, setSelectedVoice] = useState(VOICE_OPTIONS[0].id);
  const [speedRate, setSpeedRate] = useState(1.0);
  const [selectedBgm, setSelectedBgm] = useState('bgm-01');
  const [bgmVolume, setBgmVolume] = useState(20);
  const [subtitleStyle, setSubtitleStyle] = useState('standard');
  const [videoApprovals, setVideoApprovals] = useState({});

  const job = mockJobs.find(j => j.id === jobId) || mockJobs[0];
  const images = mockImages;

  // 썰툰은 영상화 없음
  const isSseoltoon = job.contentType === 'sseoltoon';

  const handleApproveVideo = (sceneId) => {
    setVideoApprovals(prev => ({ ...prev, [sceneId]: true }));
  };

  const handleNextPhase = () => {
    if (phase === 'video') setPhase('tts');
    else if (phase === 'tts') setPhase('compose');
    else navigate(`/jobs/${jobId}/qc`);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <StepProgress job={{ ...job, status: phase === 'video' ? 'video_pending_approval' : phase === 'tts' ? 'tts_generating' : 'compose_generating' }} />

      <div className="flex-1 overflow-hidden flex">
        {/* 메인 */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* 단계 탭 */}
          <div className="flex gap-3 mb-6">
            {[
              { id: 'video', label: '영상화', icon: '🎬', skip: isSseoltoon },
              { id: 'tts', label: 'TTS 나레이션', icon: '🎤', skip: false },
              { id: 'compose', label: '최종 합성', icon: '🎵', skip: false },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => !tab.skip && setPhase(tab.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-all
                  ${tab.skip ? 'opacity-40 cursor-not-allowed border-gray-200 bg-gray-50 text-gray-400 line-through' :
                    phase === tab.id
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-white border-gray-200 text-gray-600 hover:border-blue-300'}`}
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
                {tab.skip && <span className="text-xs">(썰툰 제외)</span>}
              </button>
            ))}
          </div>

          {/* 영상화 단계 */}
          {phase === 'video' && !isSseoltoon && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-gray-900">씬별 영상 검토</h2>
                <div className="text-sm text-gray-500">Ken Burns / AnimateDiff 모션 적용</div>
              </div>
              <div className="grid grid-cols-4 gap-4 mb-6">
                {images.map(img => (
                  <div key={img.id} className={`bg-white rounded-xl border-2 overflow-hidden
                    ${videoApprovals[img.sceneId] ? 'border-green-300' : 'border-gray-200'}`}>
                    <div className="relative" style={{ aspectRatio: '9/16' }}>
                      <img src={img.thumbnail} alt="" className="w-full h-full object-cover" />
                      {/* 플레이 버튼 오버레이 */}
                      <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                        <button className="w-10 h-10 bg-white/90 rounded-full flex items-center justify-center">
                          <Play size={16} className="text-gray-700 ml-0.5" />
                        </button>
                      </div>
                      {videoApprovals[img.sceneId] && (
                        <div className="absolute top-2 right-2 bg-green-500 text-white w-6 h-6 rounded-full flex items-center justify-center text-xs">✓</div>
                      )}
                    </div>
                    <div className="p-2">
                      <div className="text-xs font-medium text-gray-700 mb-1">씬 {img.sceneNumber}</div>
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleApproveVideo(img.sceneId)}
                          className="flex-1 py-1 text-xs bg-green-50 text-green-700 rounded hover:bg-green-100 transition-colors"
                        >
                          승인
                        </button>
                        <button className="py-1 px-2 text-xs bg-gray-50 text-gray-600 rounded hover:bg-gray-100 transition-colors">
                          <RefreshCw size={10} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TTS 단계 */}
          {phase === 'tts' && (
            <div className="max-w-2xl">
              <h2 className="text-lg font-bold text-gray-900 mb-4">TTS 나레이션 설정</h2>

              {/* 음성 선택 */}
              <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <Volume2 size={15} />
                  음성 선택
                </h3>
                <div className="space-y-2">
                  {VOICE_OPTIONS.map(v => (
                    <label key={v.id} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors
                      ${selectedVoice === v.id ? 'border-blue-300 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                      <input
                        type="radio"
                        checked={selectedVoice === v.id}
                        onChange={() => setSelectedVoice(v.id)}
                        className="text-blue-500"
                      />
                      <div>
                        <div className="text-sm font-medium text-gray-800">{v.label}</div>
                        <div className="text-xs text-gray-400">{v.gender}</div>
                      </div>
                      <button className="ml-auto p-1.5 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">
                        <Play size={12} className="text-gray-600" />
                      </button>
                    </label>
                  ))}
                </div>
              </div>

              {/* 속도 조절 */}
              <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <Sliders size={15} />
                  음성 속도
                </h3>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="0.7"
                    max="1.5"
                    step="0.05"
                    value={speedRate}
                    onChange={e => setSpeedRate(parseFloat(e.target.value))}
                    className="flex-1"
                  />
                  <span className="text-sm font-bold text-gray-700 w-10 text-center">{speedRate.toFixed(2)}x</span>
                </div>
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>0.7x (느림)</span>
                  <span>1.0x (기본)</span>
                  <span>1.5x (빠름)</span>
                </div>
              </div>
            </div>
          )}

          {/* 합성 단계 */}
          {phase === 'compose' && (
            <div className="max-w-2xl">
              <h2 className="text-lg font-bold text-gray-900 mb-4">최종 합성 설정</h2>

              {/* BGM */}
              <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <Music size={15} />
                  배경음악 (BGM)
                </h3>
                <div className="grid grid-cols-2 gap-2 mb-4">
                  {BGM_TRACKS.map(bgm => (
                    <button
                      key={bgm.id}
                      onClick={() => setSelectedBgm(bgm.id)}
                      className={`p-3 rounded-lg border text-left transition-all
                        ${selectedBgm === bgm.id ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}
                    >
                      <div className="text-sm font-medium text-gray-800">{bgm.label}</div>
                      {bgm.genre && <div className="text-xs text-gray-400">{bgm.genre}</div>}
                    </button>
                  ))}
                </div>

                {selectedBgm !== 'bgm-04' && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-gray-600">BGM 볼륨</span>
                      <span className="text-xs font-bold text-gray-700">{bgmVolume}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={bgmVolume}
                      onChange={e => setBgmVolume(parseInt(e.target.value))}
                      className="w-full"
                    />
                  </div>
                )}
              </div>

              {/* 자막 스타일 */}
              <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">자막 스타일</h3>
                <div className="flex gap-2">
                  {[
                    { id: 'standard', label: '기본' },
                    { id: 'bold', label: '굵게' },
                    { id: 'shadow', label: '그림자' },
                    { id: 'outline', label: '외곽선' },
                  ].map(s => (
                    <button
                      key={s.id}
                      onClick={() => setSubtitleStyle(s.id)}
                      className={`flex-1 py-2 text-xs rounded-lg border transition-colors
                        ${subtitleStyle === s.id ? 'bg-blue-500 border-blue-500 text-white' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 다음 단계 버튼 */}
          <div className="flex justify-end mt-6">
            <button
              onClick={handleNextPhase}
              className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              {phase === 'compose' ? '합성 시작 → QC 검수' : '다음 단계 →'}
            </button>
          </div>
        </div>

        {/* 우측 패널 */}
        <div className="w-64 border-l border-gray-200 bg-white flex flex-col">
          <div className="p-4 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700">타임라인 싱크</h3>
          </div>
          <div className="flex-1 p-4 space-y-2 overflow-y-auto">
            {images.map((img, idx) => (
              <div key={img.id} className="flex items-center gap-2 text-xs">
                <span className="text-gray-400 w-12">씬 {img.sceneNumber}</span>
                <div className="flex-1 bg-gray-100 rounded h-4 relative">
                  <div
                    className="absolute inset-y-0 left-0 bg-blue-300 rounded"
                    style={{ width: `${60 + idx * 5}%` }}
                  />
                  <div
                    className="absolute inset-y-0 left-0 bg-green-400 rounded opacity-60"
                    style={{ width: `${55 + idx * 5}%` }}
                  />
                </div>
                <span className="text-gray-400 w-8">7s</span>
              </div>
            ))}
            <div className="text-xs text-gray-400 mt-3">
              <div className="flex items-center gap-1.5"><div className="w-3 h-2 bg-blue-300 rounded" />영상</div>
              <div className="flex items-center gap-1.5"><div className="w-3 h-2 bg-green-400 rounded opacity-60" />음성</div>
            </div>
          </div>
          <ActivityLog jobId={jobId} />
        </div>
      </div>
    </div>
  );
}
