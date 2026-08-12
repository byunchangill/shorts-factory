import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { FolderPlus, Folder, Sparkles } from 'lucide-react';
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

  // 샘플 소재는 해외영상 짜집기 흐름(다운로드 → 분석 → 정리)용이라 menu-a에서만 쓴다
  const sample = useQuery({
    queryKey: ['sample'],
    queryFn: () => api.get<{ available: boolean; title: string }>('/projects/sample'),
    enabled: menu === 'menu-a',
  });

  const createSample = useMutation({
    mutationFn: () => api.post<{ project: { id: string }; job: { id: string } }>(
      '/projects/sample', { title: title.trim() || undefined }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['projects'] });
      setOpen(false);
      setTitle('');
      navigate(`/job/${r.job.id}`);
    },
  });

  // 이전 실패 메시지가 남은 채로 모달이 다시 열리지 않게 한다
  const openModal = () => {
    create.reset();
    createSample.reset();
    setOpen(true);
  };

  // menu-b 최초 진입: 포맷이 하나도 없으면 포맷 만들기로 유도
  const noFormats = menu === 'menu-b' && formats.data && formats.data.length === 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{MENU_LABELS[menu]} — 작업 폴더</h2>
        <div className="flex gap-2">
          {menu === 'menu-b' && (
            <Link to="/formats"><Button variant="secondary">고유 포맷 관리</Button></Link>
          )}
          <Button onClick={openModal} disabled={!!noFormats}>
            <FolderPlus size={16} /> 새 폴더
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
          message="작업 폴더가 없습니다. 제품/주제별로 폴더를 만들어 시작하세요."
          action={<Button onClick={openModal}><FolderPlus size={16} /> 새 폴더</Button>}
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

      <Modal open={open} onClose={() => setOpen(false)} title="새 작업 폴더">
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">폴더 이름 (제품/주제)</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 무선청소기" autoFocus />
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
          {(create.isError || createSample.isError) && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              폴더를 만들지 못했습니다 — {(create.error ?? createSample.error)?.message}
            </p>
          )}

          {/* 리포에 들어 있는 실제 영상으로 바로 시작 — 새 PC에서 눌러볼 것을 만든다 */}
          {sample.data?.available && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-medium">샘플 소재로 시작</p>
              <p className="mt-1 text-xs text-slate-500">
                리포에 들어 있는 주방 선반 영상 4개를 넣고 <b>영상 분석</b>부터 시작합니다.
                이름을 비워두면 "{sample.data.title}"로 만듭니다. 원본 샘플은 그대로 보존됩니다.
              </p>
              <Button
                variant="secondary"
                className="mt-2"
                onClick={() => createSample.mutate()}
                disabled={createSample.isPending}
              >
                <Sparkles size={15} /> {createSample.isPending ? '만드는 중…' : '샘플 사용하기'}
              </Button>
            </div>
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
