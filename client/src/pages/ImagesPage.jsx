// 이미지 관리 페이지 - Style/Character Bible + 이미지 그리드
import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { RefreshCw, CheckCircle2, RotateCcw, ZoomIn, CheckCheck } from 'lucide-react';
import { mockImages, mockJobs } from '../data/mockData';
import StepProgress from '../components/common/StepProgress';
import ActivityLog from '../components/common/ActivityLog';

const BIBLE_STEPS = ['style_bible', 'character_bible', 'images'];

function StyleBibleCard({ onApprove }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 mb-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-bold text-gray-900">🎨 Style Bible</h3>
          <p className="text-xs text-gray-500 mt-0.5">승인 후 Character Bible 생성 → 이미지 생성 순서로 진행됩니다</p>
        </div>
        <span className="text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded-full font-medium">승인 대기</span>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <div className="text-xs font-semibold text-gray-500 mb-2">화풍 스타일</div>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
            Pixar 3D CGI 애니메이션 / 서브서피스 스캐터링 털 / 시네마틱 라이팅
          </div>
        </div>
        <div>
          <div className="text-xs font-semibold text-gray-500 mb-2">컬러 팔레트</div>
          <div className="flex gap-2">
            {['#F5A623', '#F8E71C', '#7ED321', '#4A90E2', '#9B59B6', '#FFFFFF'].map(color => (
              <div key={color} className="flex flex-col items-center gap-1">
                <div className="w-8 h-8 rounded-lg border border-gray-200 shadow-sm" style={{ backgroundColor: color }} />
                <span className="text-[9px] text-gray-400">{color}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        {[
          { label: '라인 굵기', value: 'medium' },
          { label: '라이팅 무드', value: 'warm' },
          { label: '카메라 비율', value: '9:16 (고정)' },
        ].map(item => (
          <div key={item.label} className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs text-gray-400">{item.label}</div>
            <div className="text-sm font-medium text-gray-700 mt-0.5">{item.value}</div>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          onClick={onApprove}
          className="flex-1 py-2 bg-green-500 hover:bg-green-600 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5"
        >
          <CheckCircle2 size={14} />
          Style Bible 승인
        </button>
        <button className="px-4 py-2 border border-gray-200 text-sm text-gray-600 rounded-lg hover:bg-gray-50 transition-colors">
          수정
        </button>
        <button className="px-4 py-2 border border-gray-200 text-sm text-gray-600 rounded-lg hover:bg-gray-50 transition-colors">
          <RefreshCw size={14} />
        </button>
      </div>
    </div>
  );
}

function CharacterBibleCard({ onApprove }) {
  const [frozenItems, setFrozenItems] = useState({
    face: true, body: true, costume: true, renderStyle: true, palette: true, ratio: true,
  });
  const [flexItems, setFlexItems] = useState({
    expression: false, pose: false, composition: false, hands: false, props: false, bgDetail: false,
  });

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 mb-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-bold text-gray-900">🐾 Character Bible</h3>
          <p className="text-xs text-gray-500 mt-0.5">Frozen 항목은 모든 씬에서 동일하게 유지됩니다</p>
        </div>
        <span className="text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded-full font-medium">승인 대기</span>
      </div>

      {/* 캐릭터 카드 */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
        <div className="flex items-start gap-3">
          <div className="text-4xl">🐕</div>
          <div>
            <div className="font-semibold text-gray-900">주인공 강아지</div>
            <div className="text-xs text-gray-600 mt-1">골든리트리버 / 2살 / 따뜻하고 귀여운 눈망울 / 밀키 골드 털</div>
            <div className="text-xs text-blue-600 mt-1 font-mono">IP-Adapter 참조: 참조이미지.png</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        {/* Frozen 항목 */}
        <div>
          <div className="text-xs font-semibold text-gray-600 mb-2">🔒 Frozen (재생성 시 보존)</div>
          <div className="space-y-1.5">
            {[
              { key: 'face', label: '얼굴' },
              { key: 'body', label: '신체' },
              { key: 'costume', label: '의상/털 패턴' },
              { key: 'renderStyle', label: '렌더링 스타일' },
              { key: 'palette', label: '팔레트' },
              { key: 'ratio', label: '종횡비' },
            ].map(item => (
              <label key={item.key} className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={frozenItems[item.key]}
                  onChange={e => setFrozenItems(prev => ({ ...prev, [item.key]: e.target.checked }))}
                  className="rounded border-gray-300 text-blue-500"
                />
                ☑ {item.label}
              </label>
            ))}
          </div>
        </div>

        {/* Flexible 항목 */}
        <div>
          <div className="text-xs font-semibold text-gray-600 mb-2">🎭 Flexible (씬별 변경 가능)</div>
          <div className="space-y-1.5">
            {[
              { key: 'expression', label: '표정' },
              { key: 'pose', label: '포즈' },
              { key: 'composition', label: '구도' },
              { key: 'hands', label: '손/발 디테일' },
              { key: 'props', label: '소품' },
              { key: 'bgDetail', label: '배경 디테일' },
            ].map(item => (
              <label key={item.key} className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={flexItems[item.key]}
                  onChange={e => setFlexItems(prev => ({ ...prev, [item.key]: e.target.checked }))}
                  className="rounded border-gray-300 text-blue-500"
                />
                ☐ {item.label}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={onApprove}
          className="flex-1 py-2 bg-green-500 hover:bg-green-600 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5"
        >
          <CheckCircle2 size={14} />
          Character Bible 승인 → 이미지 생성 시작
        </button>
        <button className="px-4 py-2 border border-gray-200 text-sm text-gray-600 rounded-lg hover:bg-gray-50 transition-colors">
          수정
        </button>
      </div>
    </div>
  );
}

function AssetCard({ img, onApprove, onRegen, onRestore }) {
  const [hovered, setHovered] = useState(false);

  const statusColors = {
    approved: 'bg-green-100 text-green-700 border-green-200',
    pending: 'bg-orange-100 text-orange-700 border-orange-200',
    regen: 'bg-purple-100 text-purple-700 border-purple-200',
    error: 'bg-red-100 text-red-700 border-red-200',
  };

  const statusLabels = {
    approved: '승인됨',
    pending: '승인 대기',
    regen: '재생성 중',
    error: '실패',
  };

  return (
    <div
      className={`bg-white rounded-xl border-2 overflow-hidden transition-all
        ${img.status === 'approved' ? 'border-green-300' : 'border-gray-200'}
        ${hovered ? 'shadow-lg' : 'shadow-sm'}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* 이미지 영역 (9:16 비율) */}
      <div className="relative" style={{ aspectRatio: '9/16' }}>
        <img
          src={img.thumbnail}
          alt={`씬 ${img.sceneNumber}`}
          className="w-full h-full object-cover"
        />

        {/* 상태 배지 */}
        <div className={`absolute top-2 left-2 text-xs px-1.5 py-0.5 rounded-full border font-medium ${statusColors[img.status]}`}>
          {statusLabels[img.status]}
        </div>

        {/* 버전 배지 */}
        <div className="absolute top-2 right-2 text-xs bg-black/60 text-white px-1.5 py-0.5 rounded-full">
          v{img.version}
        </div>

        {/* 확대 버튼 */}
        {hovered && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
            <button className="p-2 bg-white/90 rounded-full">
              <ZoomIn size={16} className="text-gray-700" />
            </button>
          </div>
        )}
      </div>

      {/* 씬 정보 */}
      <div className="p-2.5">
        <div className="text-xs font-semibold text-gray-700 mb-1">씬 {img.sceneNumber}</div>

        {/* 재생성 카운터 */}
        {img.regenCount > 0 && (
          <div className="text-xs text-purple-600 mb-2">🔄 {img.regenCount}/3</div>
        )}

        {/* 액션 버튼 */}
        <div className="flex gap-1">
          {img.status !== 'approved' && (
            <button
              onClick={() => onApprove(img.id)}
              className="flex-1 py-1 text-xs bg-green-50 hover:bg-green-100 text-green-700 rounded-lg transition-colors flex items-center justify-center gap-0.5"
            >
              <CheckCircle2 size={11} />
              승인
            </button>
          )}
          <button
            onClick={() => onRegen(img.id)}
            disabled={img.regenCount >= 3}
            className="flex-1 py-1 text-xs bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg transition-colors flex items-center justify-center gap-0.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RefreshCw size={11} />
            재생성
          </button>
          {img.version > 1 && (
            <button
              onClick={() => onRestore(img.id)}
              className="py-1 px-2 text-xs bg-gray-50 hover:bg-gray-100 text-gray-600 rounded-lg transition-colors"
            >
              <RotateCcw size={11} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ImagesPage() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const [bibleStep, setBibleStep] = useState('style_bible'); // 'style_bible' | 'character_bible' | 'images'
  const [images, setImages] = useState(mockImages);

  const job = mockJobs.find(j => j.id === jobId) || mockJobs[0];
  const approvedCount = images.filter(i => i.status === 'approved').length;
  const totalCount = images.length;
  const allApproved = approvedCount === totalCount;

  const handleApprove = (imgId) => {
    setImages(prev => prev.map(i => i.id === imgId ? { ...i, status: 'approved' } : i));
  };

  const handleRegen = (imgId) => {
    setImages(prev => prev.map(i =>
      i.id === imgId ? { ...i, status: 'regen', regenCount: i.regenCount + 1 } : i
    ));
    setTimeout(() => {
      setImages(prev => prev.map(i =>
        i.id === imgId ? { ...i, status: 'pending', version: i.version + 1, thumbnail: `https://picsum.photos/180/320?random=${Math.random() * 100 | 0}` } : i
      ));
    }, 2000);
  };

  const handleBulkApprove = () => {
    setImages(prev => prev.map(i => ({ ...i, status: 'approved' })));
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <StepProgress job={{ ...job, status: bibleStep === 'images' ? 'images_pending_approval' : 'style_bible_pending' }} />

      <div className="flex-1 overflow-hidden flex">
        {/* 메인 영역 */}
        <div className="flex-1 overflow-y-auto">
          {/* Bible 단계 표시 */}
          {bibleStep !== 'images' && (
            <div className="p-4 bg-blue-50 border-b border-blue-100">
              <div className="flex items-center gap-3 text-sm text-blue-700">
                <span className={bibleStep === 'style_bible' ? 'font-bold' : 'text-blue-400'}>1. Style Bible 승인</span>
                <span className="text-blue-300">→</span>
                <span className={bibleStep === 'character_bible' ? 'font-bold' : 'text-blue-400'}>2. Character Bible 승인</span>
                <span className="text-blue-300">→</span>
                <span className="text-blue-400">3. 이미지 생성</span>
              </div>
            </div>
          )}

          <div className="p-6">
            {bibleStep === 'style_bible' && (
              <StyleBibleCard onApprove={() => setBibleStep('character_bible')} />
            )}
            {bibleStep === 'character_bible' && (
              <CharacterBibleCard onApprove={() => setBibleStep('images')} />
            )}
            {bibleStep === 'images' && (
              <>
                {/* 헤더 */}
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-lg font-bold text-gray-900">이미지 검토</h2>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {approvedCount}/{totalCount} 씬 승인됨
                      {allApproved && ' · 전체 승인 완료!'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleBulkApprove}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-green-50 border border-green-200 text-green-700 rounded-lg hover:bg-green-100 transition-colors"
                    >
                      <CheckCheck size={14} />
                      전체 승인
                    </button>
                    {allApproved && (
                      <button
                        onClick={() => navigate(`/jobs/${jobId}/video`)}
                        className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                      >
                        다음 단계 →
                      </button>
                    )}
                  </div>
                </div>

                {/* 진행률 바 */}
                <div className="bg-gray-100 rounded-full h-2 mb-6">
                  <div
                    className="bg-green-500 h-2 rounded-full transition-all"
                    style={{ width: `${(approvedCount / totalCount) * 100}%` }}
                  />
                </div>

                {/* 이미지 그리드 */}
                <div className="grid grid-cols-4 gap-4">
                  {images.map(img => (
                    <AssetCard
                      key={img.id}
                      img={img}
                      onApprove={handleApprove}
                      onRegen={handleRegen}
                      onRestore={(id) => console.log('restore', id)}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* 우측 로그 패널 */}
        <div className="w-72 border-l border-gray-200 flex flex-col bg-white">
          <div className="p-4 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700">진행 현황</h3>
          </div>
          <div className="flex-1 p-4 space-y-3">
            <div className="bg-blue-50 rounded-lg p-3">
              <div className="text-xs font-semibold text-blue-700 mb-1">🧠 image-generator</div>
              <div className="text-xs text-blue-600">Scene 4/8 생성 중...</div>
              <div className="mt-2 bg-blue-200 rounded-full h-1.5">
                <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: '50%' }} />
              </div>
            </div>
            <div className="space-y-1">
              {images.map(img => (
                <div key={img.id} className="flex items-center gap-2 text-xs">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0
                    ${img.status === 'approved' ? 'bg-green-500' :
                      img.status === 'regen' ? 'bg-purple-500' : 'bg-orange-400'}`} />
                  <span className="text-gray-600">씬 {img.sceneNumber}</span>
                  <span className="text-gray-400 ml-auto">
                    {img.status === 'approved' ? '✓ 승인' :
                      img.status === 'regen' ? '🔄 재생성' : '대기'}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <ActivityLog jobId={jobId} />
        </div>
      </div>
    </div>
  );
}
