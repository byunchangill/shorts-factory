import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { FolderPlus, Folder } from 'lucide-react';
import { MENU_LABELS, type Menu } from '@shared/constants';
import { api } from '@/api/client';
import { Badge, Button, Card, EmptyState, Input, Modal } from '@/components/ui';

interface ProjectWithCounts {
  id: string;
  title: string;
  menu: Menu;
  formatId?: string;
  jobCounts: { total: number; done: number; active: number };
}

interface FormatSummary { id: string; name: string }

export default function MenuPage({ menu }: { menu: Menu }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [formatId, setFormatId] = useState('');

  const projects = useQuery({
    queryKey: ['projects', menu],
    queryFn: () => api.get<ProjectWithCounts[]>(`/projects?menu=${menu}`),
  });
  const formats = useQuery({
    queryKey: ['formats'],
    queryFn: () => api.get<FormatSummary[]>('/formats'),
    enabled: menu === 'menu-b',
  });

  const create = useMutation({
    mutationFn: () =>
      api.post<ProjectWithCounts>('/projects', {
        menu,
        title,
        formatId: menu === 'menu-b' && formatId ? formatId : undefined,
      }),
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: ['projects'] });
      setOpen(false);
      setTitle('');
      navigate(`/project/${menu}/${p.id}`);
    },
  });

  // 이전 실패 메시지가 남은 채로 모달이 다시 열리지 않게 한다
  const openModal = () => {
    create.reset();
    setOpen(true);
  };

  // menu-b 최초 진입: 포맷이 하나도 없으면 포맷 만들기로 유도
  const noFormats = menu === 'menu-b' && formats.data && formats.data.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{MENU_LABELS[menu]} — 카테고리</h2>
        <div className="flex gap-2">
          {menu === 'menu-b' && (
            <Link to="/formats"><Button variant="secondary">고유 포맷 관리</Button></Link>
          )}
          <Button onClick={openModal} disabled={!!noFormats}>
            <FolderPlus size={16} /> 새 카테고리
          </Button>
        </div>
      </div>

      {noFormats && (
        <Card className="border-violet-200 bg-violet-50">
          <p className="font-medium text-violet-900">먼저 고유 포맷을 만들어야 합니다</p>
          <p className="mt-1 text-sm text-violet-700">
            제품정보리뷰는 채널 고유 포맷(구조·톤·씬 템플릿·브랜딩)을 정한 뒤, 그 포맷으로 반복 생산하는 메뉴입니다.
          </p>
          <Link to="/formats"><Button className="mt-3">고유 포맷 만들기</Button></Link>
        </Card>
      )}

      {projects.data?.length === 0 && !noFormats && (
        <EmptyState
          message="카테고리가 없습니다. 생활용품·주방·수납처럼 묶어서 만들고, 그 안에 영상 작업을 하나씩 만드세요."
          action={<Button onClick={openModal}><FolderPlus size={16} /> 새 카테고리</Button>}
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(projects.data ?? []).map((p) => (
          <Link key={p.id} to={`/project/${menu}/${p.id}`}>
            <Card className="transition-shadow hover:shadow-md">
              <div className="flex items-center gap-2.5">
                <Folder size={18} className="text-slate-400" />
                <span className="font-medium">{p.title}</span>
              </div>
              <div className="mt-3 flex items-center gap-2">
                {p.jobCounts.active > 0 && <Badge color="blue">진행 {p.jobCounts.active}</Badge>}
                {p.jobCounts.done > 0 && <Badge color="green">완료 {p.jobCounts.done}</Badge>}
                {p.jobCounts.total === 0 && <Badge>작업 없음</Badge>}
                {p.formatId && <Badge color="violet">{p.formatId}</Badge>}
              </div>
            </Card>
          </Link>
        ))}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="새 카테고리">
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">카테고리 이름</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 생활용품" autoFocus />
          </div>
          {menu === 'menu-b' && (
            <div>
              <label className="mb-1 block text-sm font-medium">사용할 고유 포맷</label>
              <select
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={formatId}
                onChange={(e) => setFormatId(e.target.value)}
              >
                <option value="">선택하세요</option>
                {(formats.data ?? []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
          )}
          {create.isError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              카테고리를 만들지 못했습니다 — {create.error.message}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>취소</Button>
            <Button
              onClick={() => create.mutate()}
              disabled={!title.trim() || (menu === 'menu-b' && !formatId) || create.isPending}
            >
              만들기
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
