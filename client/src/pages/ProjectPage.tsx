import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { clsx } from 'clsx';
import { Plus, Upload, Save } from 'lucide-react';
import {
  GUIDELINE_FILES, GUIDELINE_LABELS, MENU_LABELS, STATE_LABELS,
  type GuidelineFile, type Menu,
} from '@shared/constants';
import { api } from '@/api/client';
import { Badge, Button, Card, EmptyState, Input, Modal, Textarea } from '@/components/ui';
import { StepIndicator } from '@/components/pipeline';

interface JobSummary {
  id: string; title: string; state: string; progress: number; pipeline: string[]; createdAt: string;
}
interface ProductData {
  product: { name: string; price: string; features: string[]; sellingPoints: string[] };
  files: Array<{ name: string; url: string }>;
}

export default function ProjectPage() {
  const { menu, pid } = useParams() as { menu: Menu; pid: string };
  const [tab, setTab] = useState<'jobs' | 'guidelines' | 'product'>('jobs');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-slate-400">{MENU_LABELS[menu]}</p>
          <h2 className="text-lg font-semibold">{pid}</h2>
        </div>
        <nav className="flex gap-1 rounded-lg bg-slate-100 p-1">
          {([['jobs', '작업'], ['guidelines', '지침'], ['product', '제품자료']] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={clsx(
                'rounded-md px-3.5 py-1.5 text-sm font-medium',
                tab === k ? 'bg-white shadow-sm' : 'text-slate-500 hover:text-slate-700',
              )}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>

      {tab === 'jobs' && <JobsTab menu={menu} pid={pid} />}
      {tab === 'guidelines' && <GuidelinesTab menu={menu} pid={pid} />}
      {tab === 'product' && <ProductTab menu={menu} pid={pid} />}
    </div>
  );
}

function JobsTab({ menu, pid }: { menu: Menu; pid: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const jobs = useQuery({
    queryKey: ['jobs', menu, pid],
    queryFn: () => api.get<JobSummary[]>(`/projects/${menu}/${pid}/jobs`),
  });
  const create = useMutation({
    mutationFn: () => api.post<JobSummary>(`/projects/${menu}/${pid}/jobs`, { title }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['jobs'] });
      void qc.invalidateQueries({ queryKey: ['active-jobs'] });
      setOpen(false);
      setTitle('');
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}><Plus size={16} /> 새 영상 작업</Button>
      </div>
      {jobs.data?.length === 0 && <EmptyState message="아직 작업이 없습니다." />}
      {(jobs.data ?? []).map((j) => (
        <Link key={j.id} to={`/job/${j.id}`} className="block">
          <Card className="transition-shadow hover:shadow-md">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-medium">{j.title}</span>
              <Badge color={j.state === 'done' ? 'green' : j.state === 'failed' ? 'red' : 'blue'}>
                {STATE_LABELS[j.state] ?? j.state}
              </Badge>
            </div>
            <StepIndicator pipeline={j.pipeline} state={j.state} />
          </Card>
        </Link>
      ))}
      <Modal open={open} onClose={() => setOpen(false)} title="새 영상 작업">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 1편 - 흡입력 비교" autoFocus />
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)}>취소</Button>
          <Button onClick={() => create.mutate()} disabled={!title.trim() || create.isPending}>만들기</Button>
        </div>
      </Modal>
    </div>
  );
}

function GuidelinesTab({ menu, pid }: { menu: Menu; pid: string }) {
  const [file, setFile] = useState<GuidelineFile>('script.md');
  const [content, setContent] = useState('');
  const qc = useQueryClient();
  const guideline = useQuery({
    queryKey: ['guideline', menu, pid, file],
    queryFn: () => api.get<{ content: string }>(`/projects/${menu}/${pid}/guidelines/${file}`),
  });
  useEffect(() => {
    if (guideline.data) setContent(guideline.data.content);
  }, [guideline.data]);
  const save = useMutation({
    mutationFn: () => api.put(`/projects/${menu}/${pid}/guidelines/${file}`, { content }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['guideline'] }),
  });

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex gap-1">
          {GUIDELINE_FILES.map((f) => (
            <button
              key={f}
              onClick={() => setFile(f)}
              className={clsx(
                'rounded-md px-3 py-1.5 text-sm',
                file === f ? 'bg-brand-50 font-medium text-brand-700' : 'text-slate-500 hover:bg-slate-100',
              )}
            >
              {GUIDELINE_LABELS[f]}
            </button>
          ))}
        </div>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          <Save size={14} /> 저장
        </Button>
      </div>
      <Textarea rows={18} value={content} onChange={(e) => setContent(e.target.value)} />
      <p className="mt-2 text-xs text-slate-500">
        이 지침은 이 폴더에서 발행되는 모든 Claude 요청서에 자동으로 포함되어, 대본·영상이 지침대로 만들어집니다.
      </p>
    </Card>
  );
}

function ProductTab({ menu, pid }: { menu: Menu; pid: string }) {
  const qc = useQueryClient();
  const data = useQuery({
    queryKey: ['product', menu, pid],
    queryFn: () => api.get<ProductData>(`/projects/${menu}/${pid}/product`),
  });
  const upload = useMutation({
    mutationFn: (files: FileList) => {
      const fd = new FormData();
      for (const f of Array.from(files)) fd.append('files', f);
      return api.upload(`/projects/${menu}/${pid}/product/files`, fd);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['product'] }),
  });

  const product = data.data?.product;

  return (
    <div className="space-y-4">
      <Card>
        <h3 className="mb-2 font-medium">쿠팡 상세페이지 첨부</h3>
        <p className="mb-3 text-sm text-slate-500">
          상세페이지 캡처 이미지와 텍스트 파일을 올리면, "제품정보 추출" 요청서로 Claude가 product.json을 만듭니다.
          (제품정보 추출 요청서는 각 작업 화면에서 발행)
        </p>
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 py-8 text-sm text-slate-500 hover:border-brand-400 hover:text-brand-600">
          <Upload size={18} />
          클릭해서 파일 선택 (이미지/텍스트, 여러 개 가능)
          <input
            type="file"
            multiple
            className="hidden"
            onChange={(e) => e.target.files?.length && upload.mutate(e.target.files)}
          />
        </label>
        {upload.isPending && <p className="mt-2 text-sm text-slate-500">업로드 중…</p>}
        {(data.data?.files ?? []).length > 0 && (
          <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {data.data!.files.map((f) => (
              <li key={f.name} className="rounded-lg border border-slate-200 p-1.5 text-xs">
                {/\.(png|jpe?g|webp|gif)$/i.test(f.name) ? (
                  <img src={f.url} alt={f.name} className="mb-1 h-24 w-full rounded object-cover" />
                ) : null}
                <p className="truncate text-slate-600">{f.name}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h3 className="mb-2 font-medium">추출된 제품 정보 (product.json)</h3>
        {product?.name ? (
          <dl className="space-y-1.5 text-sm">
            <div className="flex gap-2"><dt className="w-24 shrink-0 text-slate-500">제품명</dt><dd className="font-medium">{product.name}</dd></div>
            <div className="flex gap-2"><dt className="w-24 shrink-0 text-slate-500">가격</dt><dd>{product.price}</dd></div>
            <div className="flex gap-2"><dt className="w-24 shrink-0 text-slate-500">핵심 기능</dt><dd>{product.features.join(', ')}</dd></div>
            <div className="flex gap-2"><dt className="w-24 shrink-0 text-slate-500">구매 포인트</dt><dd>{product.sellingPoints.join(', ')}</dd></div>
          </dl>
        ) : (
          <p className="text-sm text-slate-400">아직 추출되지 않았습니다. 작업 화면에서 "제품정보 추출" 요청서를 발행하세요.</p>
        )}
      </Card>
    </div>
  );
}
