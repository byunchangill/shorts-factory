// 실시간 활동 로그 패널
import { useState } from 'react';
import { ChevronDown, ChevronUp, Activity } from 'lucide-react';
import { mockActivityLog } from '../../data/mockData';

const LOG_TYPE_STYLES = {
  system: 'text-gray-500',
  user: 'text-blue-600',
  error: 'text-red-600',
  tool: 'text-purple-600',
};

const LOG_ICONS = {
  system: '⚙️',
  user: '👤',
  error: '❌',
  tool: '🧠',
};

export default function ActivityLog({ jobId }) {
  const [collapsed, setCollapsed] = useState(false);
  const [filter, setFilter] = useState('all');

  const logs = mockActivityLog;
  const filtered = filter === 'all' ? logs : logs.filter(l => l.type === filter);

  return (
    <div className="border-t border-gray-200 bg-gray-50">
      {/* 헤더 */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-4 py-2 hover:bg-gray-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-gray-500" />
          <span className="text-xs font-semibold text-gray-600">활동 로그</span>
          <span className="text-xs text-gray-400">({logs.length})</span>
        </div>
        {collapsed ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
      </button>

      {!collapsed && (
        <div>
          {/* 필터 탭 */}
          <div className="flex gap-1 px-4 pb-2">
            {['all', 'system', 'user', 'error', 'tool'].map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-xs px-2 py-0.5 rounded transition-colors
                  ${filter === f ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:bg-gray-200'}`}
              >
                {f === 'all' ? '전체' : f === 'system' ? '시스템' : f === 'user' ? '사용자' : f === 'error' ? '에러' : '스킬'}
              </button>
            ))}
          </div>

          {/* 로그 목록 */}
          <div className="max-h-40 overflow-y-auto px-4 pb-3 space-y-1">
            {filtered.map(log => (
              <div key={log.id} className="flex items-start gap-2 text-xs">
                <span className="text-gray-400 font-mono whitespace-nowrap">{log.timestamp}</span>
                <span>{LOG_ICONS[log.type]}</span>
                <span className={LOG_TYPE_STYLES[log.type]}>{log.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
