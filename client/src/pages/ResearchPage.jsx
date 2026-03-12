// 리서치 페이지 - YouTube 영상 분석 및 선택
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Eye, ThumbsUp, MessageCircle, ExternalLink, AlertTriangle, Loader2, Search, CheckCircle2, Clock, Star } from 'lucide-react';
import StepProgress from '../components/common/StepProgress';
import useJobStore from '../store/jobStore';
import { startResearch, selectVideo, fetchReferences } from '../services/api';

// ── 숫자 포맷 (1000000 → 100만) ──
function formatNumber(n) {
  if (!n) return '0';
  if (n >= 100000000) return `${(n / 100000000).toFixed(1)}억`;
  if (n >= 10000) return `${(n / 10000).toFixed(1)}만`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}천`;
  return String(n);
}

// ── 날짜 상대 표현 ──
function timeAgo(isoDate) {
  const days = Math.floor((Date.now() - new Date(isoDate).getTime()) / 86400000);
  if (days < 1) return '오늘';
  if (days < 7) return `${days}일 전`;
  if (days < 30) return `${Math.floor(days / 7)}주 전`;
  if (days < 365) return `${Math.floor(days / 30)}개월 전`;
  return `${Math.floor(days / 365)}년 전`;
}

// ── 훅 타입 한글 ──
const HOOK_LABEL = {
  emotional_shock: '감정충격',
  curiosity: '호기심',
  question: '질문형',
  number: '숫자형',
  confession: '고백형',
};

// ── 점수 색상 ──
function scoreColor(score) {
  if (score >= 8) return 'text-green-600';
  if (score >= 6) return 'text-yellow-600';
  return 'text-red-500';
}

// ── 영상 카드 컴포넌트 ──
function VideoCard({ video, index, selected, onSelect }) {
  const isSelected = selected === video.videoId;

  return (
    <div
      onClick={() => onSelect(video.videoId)}
      className={`relative rounded-xl border-2 cursor-pointer transition-all duration-200
        ${isSelected
          ? 'border-blue-500 bg-blue-50 shadow-md'
          : 'border-gray-200 bg-white hover:border-blue-300 hover:shadow-sm'}`}
    >
      {/* 선택 표시 */}
      {isSelected && (
        <div className="absolute -top-2 -right-2 bg-blue-500 text-white rounded-full p-0.5 z-10">
          <CheckCircle2 size={18} />
        </div>
      )}

      <div className="flex gap-4 p-4">
        {/* 썸네일 */}
        <div className="relative flex-shrink-0">
          <div className="absolute -top-1 -left-1 bg-white rounded-full w-6 h-6 flex items-center justify-center border border-gray-200 text-xs font-bold text-gray-600 z-10">
            {index + 1}
          </div>
          {video.thumbnailUrl ? (
            <img
              src={video.thumbnailUrl}
              alt={video.title}
              className="w-32 h-20 object-cover rounded-lg"
              onError={e => { e.target.style.display = 'none'; }}
            />
          ) : (
            <div className="w-32 h-20 bg-gray-100 rounded-lg flex items-center justify-center text-gray-400 text-xs">
              No Image
            </div>
          )}
        </div>

        {/* 메타 정보 */}
        <div className="flex-1 min-w-0">
          {/* 제목 */}
          <div className="font-semibold text-gray-900 text-sm leading-snug line-clamp-2 mb-1.5">
            {video.title}
          </div>
          {/* 채널 & 날짜 */}
          <div className="text-xs text-gray-500 mb-2">
            {video.channelName} · {timeAgo(video.publishedAt)} · {video.duration}초
          </div>
          {/* 통계 */}
          <div className="flex items-center gap-3 text-xs text-gray-600 mb-2">
            <span className="flex items-center gap-1"><Eye size={11} />{formatNumber(video.viewCount)}</span>
            <span className="flex items-center gap-1"><ThumbsUp size={11} />{formatNumber(video.likeCount)}</span>
            <span className="flex items-center gap-1"><MessageCircle size={11} />{formatNumber(video.commentCount)}</span>
          </div>
          {/* 분석 태그 */}
          <div className="flex flex-wrap gap-1">
            <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-xs">
              {HOOK_LABEL[video.analysis?.hookType] || video.analysis?.hookType}
            </span>
            <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded text-xs">
              {video.analysis?.pacing === 'fast' ? '빠른페이싱' : video.analysis?.pacing === 'slow' ? '느린페이싱' : '중간페이싱'}
            </span>
            {video.analysis?.viralPoints?.slice(0, 2).map((vp, i) => (
              <span key={i} className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-xs">{vp}</span>
            ))}
            {video.analysis?.riskFlags?.length > 0 && (
              <span className="px-1.5 py-0.5 bg-red-100 text-red-700 rounded text-xs flex items-center gap-0.5">
                <AlertTriangle size={10} />{video.analysis.riskFlags[0]}
              </span>
            )}
          </div>
        </div>

        {/* 종합 점수 */}
        <div className="flex-shrink-0 flex flex-col items-center justify-center w-14">
          <Star size={14} className="text-yellow-400 mb-0.5" />
          <span className={`text-xl font-bold ${scoreColor(video.score?.totalScore)}`}>
            {video.score?.totalScore?.toFixed(1)}
          </span>
          <span className="text-xs text-gray-400">/ 10</span>
          <a
            href={`https://youtube.com/shorts/${video.videoId}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="mt-2 text-gray-400 hover:text-blue-500 transition-colors"
          >
            <ExternalLink size={13} />
          </a>
        </div>
      </div>
    </div>
  );
}

// ── 메인 페이지 ──
export default function ResearchPage() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const { jobs, loadJob, updateJob } = useJobStore();

  const [references, setReferences] = useState([]);
  const [selected, setSelected] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [selectLoading, setSelectLoading] = useState(false);

  // 현재 Job
  const job = jobs.find(j => j.jobId === jobId || j.id === jobId);

  // job 로드
  useEffect(() => {
    if (!job) loadJob(jobId);
  }, [jobId, job, loadJob]);

  // 상태별 처리
  useEffect(() => {
    if (!job) return;

    // searching 상태면 자동 검색 시작
    if (job.status === 'searching') {
      handleSearch();
      return;
    }

    // references_presented / reference_selected 이면 저장된 결과 로드
    if (['references_presented', 'reference_selected'].includes(job.status) && references.length === 0) {
      fetchReferences(jobId)
        .then(data => { if (data.references?.length > 0) setReferences(data.references); })
        .catch(() => {});
    }

    // 이미 선택된 영상 반영
    if (job.selectedReferenceId) setSelected(job.selectedReferenceId);
  }, [job?.status]);

  const handleSearch = async () => {
    setIsSearching(true);
    setSearchError(null);
    setReferences([]);
    try {
      const data = await startResearch(jobId);
      updateJob(data.job);
      if (data.references?.length > 0) setReferences(data.references);
    } catch (err) {
      setSearchError(`리서치 실패: ${err.message}`);
    } finally {
      setIsSearching(false);
    }
  };

  const handleStartScript = async () => {
    if (!selected) return;
    setSelectLoading(true);
    try {
      const data = await selectVideo(jobId, selected);
      updateJob(data.job);
      navigate(`/jobs/${jobId}/script`);
    } catch (err) {
      setSearchError(`영상 선택 실패: ${err.message}`);
    } finally {
      setSelectLoading(false);
    }
  };

  if (!job) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-gray-400" />
      </div>
    );
  }

  const selectedVideo = references.find(v => v.videoId === selected);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <StepProgress job={{ ...job, status: 'references_presented', currentStep: 2 }} />

      <div className="flex-1 overflow-y-auto p-6">
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold text-gray-900">YouTube 리서치</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              키워드: <strong>"{job.keyword}"</strong>
              {['references_presented', 'reference_selected'].includes(job.status)
                ? ` — 인기 영상 TOP ${references.length || 5} 분석 완료`
                : ' — 검색 중...'}
            </p>
          </div>
          <button
            onClick={handleSearch}
            disabled={isSearching}
            className="flex items-center gap-2 px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            {isSearching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            {isSearching ? '검색 중...' : '재검색'}
          </button>
        </div>

        {/* 오류 배너 */}
        {searchError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center gap-2">
            <AlertTriangle size={14} />
            {searchError}
          </div>
        )}

        {/* 검색 중 */}
        {isSearching && (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <Loader2 size={40} className="animate-spin mb-4" />
            <div className="text-base font-medium">YouTube에서 인기 영상을 검색 중입니다...</div>
            <div className="text-sm mt-1">이전 사용 영상을 자동으로 배제하고 TOP 5를 선별합니다</div>
          </div>
        )}

        {/* 검색 전 안내 */}
        {!isSearching && job.status === 'searching' && (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <div className="text-5xl mb-4">🔍</div>
            <div className="text-base font-medium">리서치 준비 완료</div>
            <div className="text-sm mt-1 mb-6">YouTube에서 "{job.keyword}" 관련 인기 영상을 검색합니다</div>
            <button onClick={handleSearch}
              className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors">
              <Search size={16} />검색 시작
            </button>
          </div>
        )}

        {/* 실제 검색 결과 카드 목록 */}
        {!isSearching && references.length > 0 && (
          <div className="space-y-3 mb-6">
            <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
              <AlertTriangle size={14} className="flex-shrink-0" />
              <span>이전에 사용한 영상은 자동 배제되었습니다. 오마주할 영상 1개를 선택하세요.</span>
            </div>
            {references.map((video, i) => (
              <VideoCard key={video.videoId} video={video} index={i} selected={selected} onSelect={setSelected} />
            ))}
          </div>
        )}

        {/* YouTube API 미연동 안내 */}
        {!isSearching && references.length === 0 &&
          ['references_presented', 'reference_selected'].includes(job.status) && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-center mb-6">
            <div className="text-3xl mb-3">⚠️</div>
            <div className="font-semibold text-amber-800 mb-1">검색 결과 없음</div>
            <div className="text-sm text-amber-700">
              YouTube API 검색에서 결과가 없거나 API 키를 확인해주세요.{' '}
              <code className="bg-amber-100 px-1 rounded">config/.env</code>의{' '}
              <code className="bg-amber-100 px-1 rounded">YOUTUBE_API_KEY</code>를 확인하세요.
            </div>
          </div>
        )}

        {/* 하단 액션 */}
        <div className="flex items-center justify-between bg-white rounded-xl border border-gray-200 p-4">
          <div>
            {selectedVideo ? (
              <div className="text-sm">
                <span className="font-medium text-gray-900">선택됨: </span>
                <span className="text-gray-600">{selectedVideo.title}</span>
              </div>
            ) : (
              <span className="text-sm text-gray-500 flex items-center gap-1.5">
                <Clock size={13} />
                {references.length > 0 ? '위 목록에서 영상을 선택해주세요' : '검색 후 영상을 선택할 수 있습니다'}
              </span>
            )}
          </div>
          <button
            onClick={handleStartScript}
            disabled={!selected || selectLoading}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-semibold transition-all
              ${selected && !selectLoading
                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
          >
            {selectLoading && <Loader2 size={14} className="animate-spin" />}
            대본 생성 시작 →
          </button>
        </div>
      </div>
    </div>
  );
}
