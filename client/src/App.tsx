import { NavLink, Route, Routes } from 'react-router-dom';
import { clsx } from 'clsx';
import { LayoutDashboard, Globe, Package, Palette, Settings, Youtube, KeyRound, TrendingUp } from 'lucide-react';
import { useServerEvents } from '@/api/sse';
import { focusRing } from '@/components/ui';
import ApiHealthBanner from '@/components/ApiHealthBanner';
import Dashboard from '@/pages/Dashboard';
import MenuPage from '@/pages/MenuPage';
import ProjectPage from '@/pages/ProjectPage';
import JobPage from '@/pages/JobPage';
import FormatsPage from '@/pages/FormatsPage';
import SettingsPage from '@/pages/SettingsPage';
import KeysPage from '@/pages/KeysPage';
import YouTubePage from '@/pages/YouTubePage';
import ViralPage from '@/pages/ViralPage';

const NAV = [
  { to: '/', label: '대시보드', icon: LayoutDashboard },
  { to: '/menu-a', label: '해외영상 짜집기', icon: Globe },
  { to: '/menu-b', label: '제품정보리뷰', icon: Package },
  { to: '/viral', label: '바이럴 제품', icon: TrendingUp },
  { to: '/youtube', label: '유튜브 리서치', icon: Youtube },
  { to: '/formats', label: '고유 포맷', icon: Palette },
  { to: '/keys', label: 'API 키', icon: KeyRound },
  { to: '/settings', label: '설정', icon: Settings },
];

export default function App() {
  useServerEvents();

  return (
    <div className="flex min-h-screen">
      {/* 사이드바 항목이 8개라 키보드 사용자는 본문까지 8번을 눌러야 한다 — 한 번에 건너뛴다 */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-brand-600 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white focus:shadow-lg"
      >
        본문으로 건너뛰기
      </a>
      {/* 스크롤을 내려도 메뉴는 제자리에 — 잡 화면은 세로로 길어서 매번 위로 올라가야 했다 */}
      <aside className="sticky top-0 h-screen w-56 shrink-0 overflow-y-auto border-r border-slate-200 bg-white">
        <div className="px-5 py-5">
          <h1 className="text-[15px] font-semibold tracking-tight">쇼핑쇼츠 팩토리</h1>
        </div>
        <nav className="space-y-0.5 px-3 pb-6">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                clsx(
                  // 현재 위치는 색만이 아니라 왼쪽 띠로도 표시한다 — 색만으로 구분하면
                  // 색각 이상이 있는 사용자에게는 아무 표시도 없는 것과 같다
                  'relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
                  focusRing,
                  isActive
                    ? 'bg-brand-50 font-semibold text-brand-700 before:absolute before:left-0 before:top-1.5 before:h-[calc(100%-0.75rem)] before:w-1 before:rounded-full before:bg-brand-600'
                    : 'font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                )
              }
            >
              <Icon size={17} className="shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 flex-1">
        <ApiHealthBanner />
        <main id="main" className="p-6">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/menu-a" element={<MenuPage menu="menu-a" />} />
            <Route path="/menu-b" element={<MenuPage menu="menu-b" />} />
            <Route path="/project/:menu/:pid" element={<ProjectPage />} />
            <Route path="/job/:jid" element={<JobPage />} />
            <Route path="/formats" element={<FormatsPage />} />
            <Route path="/viral" element={<ViralPage />} />
            <Route path="/youtube" element={<YouTubePage />} />
            <Route path="/keys" element={<KeysPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
