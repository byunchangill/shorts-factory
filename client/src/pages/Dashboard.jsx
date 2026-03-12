// 대시보드 페이지 - 작업 목록 및 요약 통계
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Filter, Clock, AlertCircle, List, RefreshCw, WifiOff } from 'lucide-react';
import useJobStore from '../store/jobStore';
import StatusBadge from '../components/common/StatusBadge';

const CONTENT_TYPE_ICONS = { dog: '🐶', sseoltoon: '📖', health: '💊' };
const CONTENT_TYPE_LABELS = { dog: '강아지', sseoltoon: '썰툰', health: '건강' };

const TAB_FILTERS = [
  { id: 'all', label: '전체' },
  { id: 'active', label: '진행중' },
  { id: 'pending_approval', label: '승인 대기' },
  { id: 'completed', label: '완료' },
  { id: 'error', label: '오류' },
];

function matchesTab(job, tab) {
  if (tab === 'all') return true;
  if (tab === 'active') {
    const activeStatuses = ['searching', 'scripting', 'images_generating', 'video_generating', 'tts_generating', 'tts_syncing', 'compose_generating', 'qc_reviewing', 'exporting'];
    return activeStatuses.includes(job.status);
  }
  if (tab === 'pending_approval') {
    return job.status.includes('pending_approval') || job.status.includes('presented') || job.status.includes('bible_pending');
  }
  if (tab === 'completed') {
    return job.status === 'exported' || job.status === 'qc_passed';
  }
  if (tab === 'error') {
    return job.status === 'error' || job.status.includes('failed') || job.status === 'abandoned';
  }
  return true;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { jobs, isLoading, error, apiConnected, loadJobs } = useJobStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [contentTypeFilter, setContentTypeFilter] = useState('all');

  // 컴포넌트 마운트 시 API에서 Job 목록 로드
  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  // 통계
  const totalJobs = jobs.length;
  const today = new Date().toISOString().slice(0, 10);
  const todayJobs = jobs.filter(j => j.createdAt?.startsWith(today)).length;
  const pendingApproval = jobs.filter(j =>
    j.status.includes('pending_approval') || j.status.includes('presented') || j.status.includes('bible_pending')
  ).length;
  const errorJobs = jobs.filter(j => j.status === 'error' || j.status.includes('failed')).length;

  // 필터링
  const filtered = jobs.filter(j => {
    const matchSearch = !searchQuery || j.keyword.includes(searchQuery) || j.id.includes(searchQuery);
    const matchTab = matchesTab(j, activeTab);
    const matchType = contentTypeFilter === 'all' || j.contentType === contentTypeFilter;
    return matchSearch && matchTab && matchType;
  });

  return (
    <div className="flex-1 overflow-y-auto p-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">대시보드</h1>
          <p className="text-sm text-gray-500 mt-1">AI 쇼츠 제작 현황</p>
        </div>
        <div className="flex items-center gap-3">
          {/* API 연결 상태 */}
          {!apiConnected && (
            <div className="flex items-center gap-1.5 text-xs text-red-500 bg-red-50 px-3 py-1.5 rounded-full border border-red-200">
              <WifiOff size={12} />
              API 서버 미연결 (포트 3001)
            </div>
          )}
          <button
            onClick={loadJobs}
            disabled={isLoading}
            className="flex items-center gap-1.5 text-gray-500 hover:text-gray-700 px-3 py-2 rounded-lg text-sm border border-gray-200 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
            새로고침
          </button>
          <button
            onClick={() => navigate('/jobs/new')}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus size={16} />
            새 작업 만들기
          </button>
        </div>
      </div>

      {/* 오류 배너 */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center gap-2">
          <AlertCircle size={16} />
          백엔드 연결 실패: {error} — <code className="bg-red-100 px-1 rounded">npm run dev:api</code> 실행 여부를 확인하세요
        </div>
      )}

      {/* 요약 카드 */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-500">전체 작업</span>
            <List size={16} className="text-gray-400" />
          </div>
          <div className="text-3xl font-bold text-gray-900">{totalJobs}</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-500">오늘 생성</span>
            <Clock size={16} className="text-blue-400" />
          </div>
          <div className="text-3xl font-bold text-blue-600">{todayJobs}</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-500">승인 대기</span>
            <RefreshCw size={16} className="text-orange-400" />
          </div>
          <div className="text-3xl font-bold text-orange-600">{pendingApproval}</div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-500">오류</span>
            <AlertCircle size={16} className="text-red-400" />
          </div>
          <div className="text-3xl font-bold text-red-600">{errorJobs}</div>
        </div>
      </div>

      {/* 검색 + 필터 */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="p-4 border-b border-gray-100">
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-xs">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="키워드 또는 작업 ID 검색..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter size={14} className="text-gray-400" />
              <select
                value={contentTypeFilter}
                onChange={e => setContentTypeFilter(e.target.value)}
                className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">전체 타입</option>
                <option value="dog">🐶 강아지</option>
                <option value="sseoltoon">📖 썰툰</option>
                <option value="health">💊 건강</option>
              </select>
            </div>
          </div>
        </div>

        {/* 탭 */}
        <div className="flex border-b border-gray-100 px-4">
          {TAB_FILTERS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors
                ${activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            >
              {tab.label}
              <span className="ml-2 text-xs text-gray-400">
                ({jobs.filter(j => matchesTab(j, tab.id)).length})
              </span>
            </button>
          ))}
        </div>

        {/* 테이블 */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">작업</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">타입</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">상태</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">진행률</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">생성일</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">액션</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-gray-400">
                    <div className="text-4xl mb-2">📭</div>
                    <div>검색 결과가 없습니다</div>
                  </td>
                </tr>
              ) : (
                filtered.map(job => (
                  <tr
                    key={job.id}
                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => navigate(`/jobs/${job.id}`)}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900 truncate max-w-[200px]">{job.keyword}</div>
                      <div className="text-xs text-gray-400">{job.id}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-lg">{CONTENT_TYPE_ICONS[job.contentType]}</span>
                      <span className="ml-1 text-xs text-gray-500">{CONTENT_TYPE_LABELS[job.contentType]}</span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={job.status} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-gray-200 rounded-full h-1.5 max-w-[80px]">
                          <div
                            className="bg-blue-500 h-1.5 rounded-full"
                            style={{ width: `${job.progress}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-500">{job.progress}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {new Date(job.createdAt).toLocaleDateString('ko-KR')}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={e => { e.stopPropagation(); navigate(`/jobs/${job.id}`); }}
                        className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                      >
                        이어가기 →
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
