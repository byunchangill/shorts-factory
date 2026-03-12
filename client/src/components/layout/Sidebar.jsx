// 좌측 사이드바 네비게이션
import { NavLink, useNavigate } from 'react-router-dom';
import { Plus, LayoutDashboard, Video, Settings, Shield, ChevronLeft, ChevronRight, Wifi, WifiOff } from 'lucide-react';
import useJobStore from '../../store/jobStore';
import StatusBadge from '../common/StatusBadge';

const CONTENT_TYPE_ICONS = {
  dog: '🐶',
  sseoltoon: '📖',
  health: '💊',
};

export default function Sidebar() {
  const navigate = useNavigate();
  const { jobs, sidebarCollapsed, toggleSidebar, apiConnected } = useJobStore();

  // 진행 중인 작업만 표시 (최근 5개)
  const recentJobs = jobs.slice(0, 6);

  return (
    <div className={`flex flex-col h-full bg-gray-900 text-white transition-all duration-200 ${sidebarCollapsed ? 'w-14' : 'w-60'}`}>
      {/* 로고 + 접기 버튼 */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-gray-700">
        {!sidebarCollapsed && (
          <div>
            <div className="text-sm font-bold text-white">🎬 Shorts Factory</div>
            <div className="text-xs text-gray-400">AI 쇼츠 제작 시스템</div>
          </div>
        )}
        <button
          onClick={toggleSidebar}
          className="p-1 hover:bg-gray-700 rounded transition-colors ml-auto"
        >
          {sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      {/* 새 작업 버튼 */}
      <div className="px-3 py-3">
        <button
          onClick={() => navigate('/jobs/new')}
          className={`flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors w-full
            ${sidebarCollapsed ? 'justify-center px-2 py-2' : 'px-3 py-2'}`}
        >
          <Plus size={16} />
          {!sidebarCollapsed && <span className="text-sm font-medium">새 작업</span>}
        </button>
      </div>

      {/* 네비게이션 */}
      <nav className="px-3 space-y-1">
        <NavLink
          to="/dashboard"
          className={({ isActive }) =>
            `flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors
            ${isActive ? 'bg-gray-700 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`
          }
        >
          <LayoutDashboard size={16} />
          {!sidebarCollapsed && '대시보드'}
        </NavLink>
        <NavLink
          to="/admin/used-videos"
          className={({ isActive }) =>
            `flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors
            ${isActive ? 'bg-gray-700 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`
          }
        >
          <Shield size={16} />
          {!sidebarCollapsed && '영상 배제 관리'}
        </NavLink>
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            `flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors
            ${isActive ? 'bg-gray-700 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'}`
          }
        >
          <Settings size={16} />
          {!sidebarCollapsed && '설정'}
        </NavLink>
      </nav>

      {/* 구분선 */}
      <div className="mx-3 my-3 border-t border-gray-700" />

      {/* 최근 작업 목록 */}
      {!sidebarCollapsed && (
        <div className="flex-1 overflow-y-auto">
          <div className="px-4 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wider">최근 작업</div>
          <div className="px-3 space-y-1">
            {recentJobs.map(job => (
              <NavLink
                key={job.id}
                to={`/jobs/${job.id}`}
                className={({ isActive }) =>
                  `block px-3 py-2 rounded-lg text-xs transition-colors
                  ${isActive ? 'bg-gray-700' : 'hover:bg-gray-800'}`
                }
              >
                <div className="flex items-center gap-1 mb-1">
                  <span>{CONTENT_TYPE_ICONS[job.contentType]}</span>
                  <span className="text-gray-200 truncate flex-1">{job.keyword}</span>
                </div>
                <StatusBadge status={job.status} size="sm" />
              </NavLink>
            ))}
          </div>
        </div>
      )}

      {/* API 서버 상태 */}
      <div className={`flex items-center gap-2 px-4 py-3 border-t border-gray-700 ${sidebarCollapsed ? 'justify-center' : ''}`}>
        {apiConnected ? (
          <>
            <Wifi size={14} className="text-green-400" />
            {!sidebarCollapsed && <span className="text-xs text-green-400">API 연결됨</span>}
          </>
        ) : (
          <>
            <WifiOff size={14} className="text-red-400" />
            {!sidebarCollapsed && <span className="text-xs text-red-400">API 미연결</span>}
          </>
        )}
      </div>
    </div>
  );
}
