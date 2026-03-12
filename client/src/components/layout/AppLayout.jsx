// 3컬럼 레이아웃 - 사이드바 + 메인 + 우측 패널
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';

export default function AppLayout() {
  return (
    <div className="flex h-screen bg-gray-100 overflow-hidden">
      {/* 좌측 사이드바 */}
      <Sidebar />

      {/* 메인 콘텐츠 영역 */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
