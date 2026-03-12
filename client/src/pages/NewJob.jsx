// 새 작업 생성 페이지
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ArrowRight, Sparkles, Loader2 } from 'lucide-react';
import useJobStore from '../store/jobStore';

const CONTENT_TYPES = [
  {
    id: 'dog',
    icon: '🐶',
    label: '강아지 AI쇼츠',
    description: '픽사 스타일 3D CGI 강아지 캐릭터. 감정선과 캐릭터 일관성이 핵심.',
    keywords: ['강아지', '개', '반려견', '멍멍', '댕댕'],
    style: 'Pixar 3D CGI',
    hasVideo: true,
    color: 'border-amber-300 bg-amber-50',
    activeColor: 'border-amber-500 bg-amber-100 ring-2 ring-amber-400',
  },
  {
    id: 'sseoltoon',
    icon: '📖',
    label: '썰툰',
    description: '한국 웹툰 스타일. 영상화 없이 이미지+자막만으로 구성. 훅과 반전이 핵심.',
    keywords: ['썰', '썰툰', '실화', '사연', '에피소드'],
    style: '웹툰 클린 라인아트',
    hasVideo: false,
    color: 'border-indigo-300 bg-indigo-50',
    activeColor: 'border-indigo-500 bg-indigo-100 ring-2 ring-indigo-400',
  },
  {
    id: 'health',
    icon: '💊',
    label: '건강 쇼츠',
    description: '클린 인포그래픽 스타일. 건강 정보 컴플라이언스(L1~L4) 자동 적용.',
    keywords: ['건강', '효능', '영양', '다이어트', '운동', '상식'],
    style: '클린 인포그래픽',
    hasVideo: true,
    color: 'border-green-300 bg-green-50',
    activeColor: 'border-green-500 bg-green-100 ring-2 ring-green-400',
  },
];

function detectContentType(keyword) {
  for (const ct of CONTENT_TYPES) {
    if (ct.keywords.some(kw => keyword.includes(kw))) return ct.id;
  }
  return null;
}

export default function NewJob() {
  const navigate = useNavigate();
  const { createJob, isLoading } = useJobStore();
  const [keyword, setKeyword] = useState('');
  const [selectedType, setSelectedType] = useState(null);
  const [autoDetected, setAutoDetected] = useState(null);
  const [createError, setCreateError] = useState(null);

  const handleKeywordChange = (val) => {
    setKeyword(val);
    const detected = detectContentType(val);
    if (detected && !selectedType) {
      setAutoDetected(detected);
    }
  };

  const effectiveType = selectedType || autoDetected;

  // API 호출로 Job 생성 후 리서치 페이지로 이동
  const handleCreate = async () => {
    if (!keyword.trim() || !effectiveType) return;
    setCreateError(null);
    try {
      const jobId = await createJob(keyword.trim(), effectiveType);
      navigate(`/jobs/${jobId}/research`);
    } catch (err) {
      setCreateError('Job 생성 실패: 백엔드 서버(포트 3001)가 실행 중인지 확인하세요.');
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-12">
        {/* 헤더 */}
        <div className="text-center mb-10">
          <div className="text-5xl mb-4">🎬</div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">새 쇼츠 제작</h1>
          <p className="text-gray-500">키워드 하나로 AI가 YouTube 인기 영상을 분석하고<br/>저작권 안전한 쇼츠를 자동 제작합니다</p>
        </div>

        {/* 키워드 입력 */}
        <div className="mb-8">
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            검색 키워드
          </label>
          <div className="relative">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={keyword}
              onChange={e => handleKeywordChange(e.target.value)}
              placeholder="예: 강아지 귀여운 순간, 직장인 썰, 커피 효능..."
              className="w-full pl-11 pr-4 py-3.5 text-base border-2 border-gray-200 rounded-xl focus:outline-none focus:border-blue-500 transition-colors"
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
            />
          </div>
          {autoDetected && !selectedType && (
            <div className="mt-2 flex items-center gap-1.5 text-sm text-blue-600">
              <Sparkles size={14} />
              <span>
                자동 감지: <strong>{CONTENT_TYPES.find(t => t.id === autoDetected)?.label}</strong>
              </span>
            </div>
          )}
        </div>

        {/* 콘텐츠 타입 선택 */}
        <div className="mb-8">
          <label className="block text-sm font-semibold text-gray-700 mb-3">
            콘텐츠 타입
            {autoDetected && !selectedType && <span className="ml-2 text-xs text-gray-400 font-normal">(자동 감지됨 — 다른 타입 클릭 시 변경)</span>}
          </label>
          <div className="space-y-3">
            {CONTENT_TYPES.map(ct => {
              const isSelected = effectiveType === ct.id;
              const isAutoSelected = autoDetected === ct.id && !selectedType;

              return (
                <button
                  key={ct.id}
                  onClick={() => setSelectedType(ct.id === selectedType ? null : ct.id)}
                  className={`w-full text-left p-4 rounded-xl border-2 transition-all
                    ${isSelected ? ct.activeColor : `${ct.color} hover:border-opacity-70`}`}
                >
                  <div className="flex items-start gap-3">
                    <span className="text-3xl">{ct.icon}</span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-900">{ct.label}</span>
                        {isAutoSelected && (
                          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">자동 감지</span>
                        )}
                        {!ct.hasVideo && (
                          <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">영상화 없음</span>
                        )}
                      </div>
                      <p className="text-sm text-gray-600 mt-0.5">{ct.description}</p>
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-xs text-gray-400">스타일: {ct.style}</span>
                        <span className="text-gray-300">·</span>
                        <span className="text-xs text-gray-400">키워드: {ct.keywords.join(', ')}</span>
                      </div>
                    </div>
                    <div className={`w-5 h-5 rounded-full border-2 mt-0.5 flex items-center justify-center flex-shrink-0
                      ${isSelected ? 'border-current bg-current' : 'border-gray-300'}`}
                    >
                      {isSelected && <div className="w-2 h-2 rounded-full bg-white" />}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* 오류 표시 */}
        {createError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {createError}
          </div>
        )}

        {/* 생성 버튼 */}
        <button
          onClick={handleCreate}
          disabled={!keyword.trim() || !effectiveType || isLoading}
          className={`w-full flex items-center justify-center gap-2 py-4 rounded-xl text-base font-semibold transition-all
            ${keyword.trim() && effectiveType && !isLoading
              ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-lg hover:shadow-blue-200 hover:shadow-xl'
              : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
        >
          {isLoading ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              <span>Job 생성 중...</span>
            </>
          ) : (
            <>
              <span>YouTube 검색 시작</span>
              <ArrowRight size={18} />
            </>
          )}
        </button>

        {/* 워크플로우 안내 */}
        <div className="mt-8 bg-gray-50 rounded-xl p-4">
          <div className="text-xs font-semibold text-gray-500 mb-3">제작 워크플로우</div>
          <div className="flex items-center gap-1 text-xs text-gray-400 flex-wrap">
            {['🔍 리서치', '→', '📝 대본', '→', '🖼️ 이미지', '→', '🎵 영상/TTS', '→', '✅ QC', '→', '📦 패키징'].map((s, i) => (
              <span key={i} className={s === '→' ? 'text-gray-300' : 'font-medium text-gray-500'}>{s}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
