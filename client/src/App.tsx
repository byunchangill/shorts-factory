import { NavLink, Route, Routes } from 'react-router-dom';
import { clsx } from 'clsx';
import { LayoutDashboard, Globe, Package, Palette, Settings } from 'lucide-react';
import { useServerEvents } from '@/api/sse';
import Dashboard from '@/pages/Dashboard';
import MenuPage from '@/pages/MenuPage';
import ProjectPage from '@/pages/ProjectPage';
import JobPage from '@/pages/JobPage';
import FormatsPage from '@/pages/FormatsPage';
import SettingsPage from '@/pages/SettingsPage';

const NAV = [
  { to: '/', label: '대시보드', icon: LayoutDashboard },
  { to: '/menu-a', label: '해외영상 짜집기', icon: Globe },
  { to: '/menu-b', label: '제품정보리뷰', icon: Package },
  { to: '/formats', label: '고유 포맷', icon: Palette },
  { to: '/settings', label: '설정', icon: Settings },
];

export default function App() {
  useServerEvents();

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-slate-200 bg-white">
        <div className="px-5 py-5">
          <h1 className="text-lg font-bold">🏭 쇼핑쇼츠 팩토리</h1>
          <p className="mt-0.5 text-xs text-slate-400">리서치 → 제작 → 패키징</p>
        </div>
        <nav className="space-y-0.5 px-3">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium',
                  isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100',
                )
              }
            >
              <Icon size={17} />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 flex-1 p-6">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/menu-a" element={<MenuPage menu="menu-a" />} />
          <Route path="/menu-b" element={<MenuPage menu="menu-b" />} />
          <Route path="/project/:menu/:pid" element={<ProjectPage />} />
          <Route path="/job/:jid" element={<JobPage />} />
          <Route path="/formats" element={<FormatsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </div>
    </div>
  );
}
