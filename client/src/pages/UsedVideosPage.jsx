// 사용된 영상 배제 관리 페이지
import { useState, useEffect } from 'react';
import { Shield, Trash2, Clock, Plus, AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { fetchUsedVideos } from '../services/api';

export default function UsedVideosPage() {
  const [rawData, setRawData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // API에서 실제 데이터 로드
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await fetchUsedVideos();
      setRawData(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  // API 응답 → UI 형식으로 변환
  const videos = rawData?.videos ? Object.values(rawData.videos) : [];
  const permanent = videos.filter(v => v.usageType === 'selected_for_homage');
  const temporary = videos.filter(v => v.usageType === 'presented_not_selected' && v.expiresAt);

  const data = { permanent, temporary, stats: rawData?.stats };
  const [newUrl, setNewUrl] = useState('');
  const [confirmRelease, setConfirmRelease] = useState(null);

  const handleRelease = (videoId) => {
    // TODO: 배제 해제 API 호출 (백엔드 구현 필요)
    alert(`영상 ${videoId} 배제 해제 (백엔드 API 구현 예정)`);
    setConfirmRelease(null);
  };

  const handleAddExclusion = () => {
    if (!newUrl.trim()) return;
    alert('영구 배제가 추가되었습니다: ' + newUrl);
    setNewUrl('');
  };

  // 남은 날짜 계산
  const getDaysLeft = (releaseDate) => {
    const days = Math.ceil((new Date(releaseDate) - new Date()) / (1000 * 60 * 60 * 24));
    return Math.max(0, days);
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={24} className="animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          API 오류: {error}
        </div>
      )}

      {/* 헤더 */}
      <div className="flex items-center gap-3 mb-6">
        <Shield size={24} className="text-blue-600" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">사용 영상 배제 관리</h1>
          <p className="text-sm text-gray-500 mt-0.5">중복 콘텐츠 제작 방지 및 다양성 확보</p>
        </div>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <div className="text-2xl font-bold text-red-600">{data.permanent.length}</div>
          <div className="text-sm text-gray-500 mt-1">영구 배제 영상</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <div className="text-2xl font-bold text-orange-500">{data.temporary.length}</div>
          <div className="text-sm text-gray-500 mt-1">임시 배제 영상</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <div className="text-2xl font-bold text-gray-700">{data.stats.totalSelected}</div>
          <div className="text-sm text-gray-500 mt-1">누적 선택 영상</div>
          <div className="text-xs text-gray-400 mt-0.5">마지막 정리: 2026-03-12 06:00</div>
        </div>
      </div>

      {/* 수동 배제 추가 */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <Plus size={15} />
          영상 URL로 영구 배제 추가
        </h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={newUrl}
            onChange={e => setNewUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
            className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleAddExclusion}
            className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded-lg transition-colors"
          >
            영구 배제
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* 영구 배제 목록 */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
            <h3 className="font-semibold text-gray-900">영구 배제 ({data.permanent.length})</h3>
          </div>
          <div className="divide-y divide-gray-50">
            {data.permanent.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">배제된 영상이 없습니다</div>
            ) : (
              data.permanent.map(video => (
                <div key={video.videoId} className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="text-xl flex-shrink-0">🔴</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-800 truncate">{video.title}</div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        채널: {video.channel} · Job: <span className="text-blue-600">{video.usedJobId}</span>
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">선택일: {video.selectedAt}</div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 임시 배제 목록 */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-orange-400" />
            <h3 className="font-semibold text-gray-900">임시 배제 ({data.temporary.length})</h3>
            <span className="text-xs text-gray-400 ml-1">(7일 자동 해제)</span>
          </div>
          <div className="divide-y divide-gray-50">
            {data.temporary.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">임시 배제된 영상이 없습니다</div>
            ) : (
              data.temporary.map(video => (
                <div key={video.videoId} className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="text-xl flex-shrink-0">🟡</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-800 truncate">{video.title}</div>
                      <div className="text-xs text-gray-500 mt-0.5">채널: {video.channel}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <Clock size={11} className="text-orange-400" />
                        <span className="text-xs text-orange-600 font-medium">
                          {getDaysLeft(video.releaseDate)}일 후 해제 ({video.releaseDate})
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => setConfirmRelease(video)}
                      className="text-xs text-gray-500 hover:text-red-600 flex items-center gap-1 px-2 py-1 rounded hover:bg-red-50 transition-colors"
                    >
                      <Trash2 size={12} />
                      즉시 해제
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* 확인 모달 */}
      {confirmRelease && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full mx-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle size={20} className="text-orange-500" />
              <h3 className="font-bold text-gray-900">임시 배제 즉시 해제</h3>
            </div>
            <p className="text-sm text-gray-600 mb-1">
              <strong>"{confirmRelease.title}"</strong>을 즉시 해제하시겠습니까?
            </p>
            <p className="text-xs text-gray-400 mb-5">
              해제 시 이 영상은 다음 검색에서 다시 나타날 수 있습니다.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmRelease(null)}
                className="flex-1 py-2 border border-gray-200 text-sm text-gray-600 rounded-lg hover:bg-gray-50 transition-colors"
              >
                취소
              </button>
              <button
                onClick={() => handleRelease(confirmRelease.videoId)}
                className="flex-1 py-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded-lg transition-colors"
              >
                즉시 해제
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
