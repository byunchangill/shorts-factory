// QC 검수 페이지
import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, XCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { mockQCItems, mockJobs } from '../data/mockData';
import StepProgress from '../components/common/StepProgress';

function QCResultIcon({ result }) {
  if (result === 'pass') return <CheckCircle2 size={20} className="text-green-500" />;
  if (result === 'warning') return <AlertTriangle size={20} className="text-orange-500" />;
  return <XCircle size={20} className="text-red-500" />;
}

function QCItem({ item, expanded, onToggle }) {
  const bgColor = item.result === 'pass' ? 'bg-green-50 border-green-200' :
    item.result === 'warning' ? 'bg-orange-50 border-orange-200' :
    'bg-red-50 border-red-200';

  const scoreColor = item.score >= 90 ? 'text-green-600' :
    item.score >= 70 ? 'text-orange-600' : 'text-red-600';

  return (
    <div className={`rounded-xl border p-4 ${bgColor}`}>
      <button
        className="w-full flex items-center gap-3"
        onClick={onToggle}
      >
        <QCResultIcon result={item.result} />
        <div className="flex-1 text-left">
          <div className="font-semibold text-gray-900 text-sm">{item.label}</div>
        </div>
        <span className={`text-lg font-bold ${scoreColor}`}>{item.score}점</span>
        {expanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
      </button>

      {expanded && (
        <div className="mt-3 pl-9">
          <div className="text-sm text-gray-600 bg-white/60 rounded-lg p-3">{item.detail}</div>
          {item.result === 'warning' && (
            <button className="mt-2 text-xs text-orange-700 bg-orange-100 hover:bg-orange-200 px-3 py-1 rounded-lg transition-colors">
              무시하고 계속 진행
            </button>
          )}
          {item.result === 'fail' && (
            <div className="mt-2 flex gap-2">
              <button className="text-xs text-red-700 bg-red-100 hover:bg-red-200 px-3 py-1 rounded-lg transition-colors">
                이전 단계로 복귀
              </button>
              <button className="text-xs text-gray-600 bg-gray-100 hover:bg-gray-200 px-3 py-1 rounded-lg transition-colors">
                작업 포기
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function QCRecoveryModal({ failItem, onClose, onRecover }) {
  const [targetStep, setTargetStep] = useState(3);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl p-6 max-w-md w-full mx-4">
        <div className="flex items-center gap-2 mb-4">
          <XCircle size={20} className="text-red-500" />
          <h3 className="font-bold text-gray-900">QC 실패: {failItem?.label}</h3>
        </div>
        <p className="text-sm text-gray-600 mb-4">{failItem?.detail}</p>

        <div className="mb-4">
          <div className="text-sm font-semibold text-gray-700 mb-2">돌아갈 단계를 선택하세요:</div>
          <div className="space-y-2">
            {[
              { step: 3, label: '대본 수정', recommended: true },
              { step: 4, label: '이미지 수정' },
              { step: 5, label: '영상/TTS 수정' },
            ].map(option => (
              <label key={option.step} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors
                ${targetStep === option.step ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                <input
                  type="radio"
                  checked={targetStep === option.step}
                  onChange={() => setTargetStep(option.step)}
                  className="text-blue-500"
                />
                <span className="text-sm text-gray-700">Step {option.step}: {option.label}</span>
                {option.recommended && (
                  <span className="ml-auto text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">추천 ⭐</span>
                )}
              </label>
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 border border-gray-200 text-sm text-gray-600 rounded-lg hover:bg-gray-50 transition-colors">
            취소
          </button>
          <button
            onClick={() => onRecover(targetStep)}
            className="flex-1 py-2 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded-lg transition-colors"
          >
            돌아가기
          </button>
        </div>
      </div>
    </div>
  );
}

export default function QCPage() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const [expandedItem, setExpandedItem] = useState('qc-04');
  const [showRecovery, setShowRecovery] = useState(false);

  const job = mockJobs.find(j => j.id === jobId) || { ...mockJobs[0], contentType: 'health' };
  const qcItems = mockQCItems;

  const passCount = qcItems.filter(i => i.result === 'pass').length;
  const warnCount = qcItems.filter(i => i.result === 'warning').length;
  const failCount = qcItems.filter(i => i.result === 'fail').length;
  const overallResult = failCount > 0 ? 'fail' : warnCount > 0 ? 'warning' : 'pass';

  const avgScore = Math.round(qcItems.reduce((sum, i) => sum + i.score, 0) / qcItems.length);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <StepProgress job={{ ...job, status: overallResult === 'pass' ? 'qc_passed' : overallResult === 'warning' ? 'qc_warning' : 'qc_failed' }} />

      <div className="flex-1 overflow-y-auto p-6">
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold text-gray-900">최종 QC 검수</h2>
            <p className="text-sm text-gray-500 mt-0.5">6개 항목 자동 검증 완료</p>
          </div>
          {overallResult === 'pass' && (
            <button
              onClick={() => navigate(`/jobs/${jobId}/export`)}
              className="flex items-center gap-2 px-6 py-2.5 bg-green-500 hover:bg-green-600 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              <CheckCircle2 size={16} />
              패키징 진행 →
            </button>
          )}
        </div>

        {/* 종합 결과 카드 */}
        <div className={`rounded-2xl p-6 mb-6 text-center
          ${overallResult === 'pass' ? 'bg-green-50 border-2 border-green-200' :
            overallResult === 'warning' ? 'bg-orange-50 border-2 border-orange-200' :
            'bg-red-50 border-2 border-red-200'}`}>
          <div className="text-5xl mb-3">
            {overallResult === 'pass' ? '✅' : overallResult === 'warning' ? '⚠️' : '❌'}
          </div>
          <div className={`text-2xl font-bold mb-1
            ${overallResult === 'pass' ? 'text-green-700' :
              overallResult === 'warning' ? 'text-orange-700' : 'text-red-700'}`}>
            {overallResult === 'pass' ? 'QC 통과' : overallResult === 'warning' ? 'QC 경고' : 'QC 실패'}
          </div>
          <div className="text-sm text-gray-600">
            종합 점수: <strong>{avgScore}점</strong>
            {' · '}통과 {passCount} · 경고 {warnCount} · 실패 {failCount}
          </div>
        </div>

        {/* QC 항목 목록 */}
        <div className="space-y-3">
          {qcItems.map(item => (
            <QCItem
              key={item.id}
              item={item}
              expanded={expandedItem === item.id}
              onToggle={() => setExpandedItem(expandedItem === item.id ? null : item.id)}
            />
          ))}

          {/* 건강 컴플라이언스 (💊 타입만) */}
          {job.contentType === 'health' && (
            <div className="bg-teal-50 border border-teal-200 rounded-xl p-4">
              <div className="flex items-center gap-3 mb-3">
                <CheckCircle2 size={20} className="text-teal-500" />
                <span className="font-semibold text-gray-900 text-sm">🛡️ 건강 컴플라이언스</span>
                <span className="text-lg font-bold text-teal-600 ml-auto">100점</span>
              </div>
              <div className="pl-8 space-y-1.5 text-xs text-teal-700">
                <div>✓ 주장 등급: L1(안전) 6개, L2(조건부) 2개</div>
                <div>✓ 금지 표현 없음 — "완치", "기적" 등 감지되지 않음</div>
                <div>✓ 출처 신뢰도: T1(공인기관) 3건, T2(의료기관) 2건</div>
                <div>✓ 면책 자동 삽입 완료 — 씬 8 + YouTube 설명란</div>
              </div>
            </div>
          )}
        </div>

        {/* 경고 무시 버튼 */}
        {overallResult === 'warning' && (
          <div className="mt-6 flex gap-3">
            <button
              onClick={() => navigate(`/jobs/${jobId}/export`)}
              className="flex-1 py-3 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded-xl transition-colors"
            >
              ⚠️ 경고 무시하고 패키징 진행
            </button>
            <button className="flex-1 py-3 border-2 border-gray-200 text-sm text-gray-600 rounded-xl hover:bg-gray-50 transition-colors">
              이전 단계로 수정
            </button>
          </div>
        )}
      </div>

      {showRecovery && (
        <QCRecoveryModal
          failItem={qcItems.find(i => i.result === 'fail')}
          onClose={() => setShowRecovery(false)}
          onRecover={(step) => { setShowRecovery(false); navigate(`/jobs/${jobId}`); }}
        />
      )}
    </div>
  );
}
