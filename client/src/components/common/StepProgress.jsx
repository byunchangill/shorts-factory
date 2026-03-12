// 7단계 워크플로우 진행 표시자
import { Check, AlertCircle, Minus } from 'lucide-react';
import { CONTENT_TYPES, STATUS_STEP } from '../../data/mockData';

const STEPS = [
  { id: 1, label: '리서치', icon: '🔍' },
  { id: 2, label: '레퍼런스', icon: '🎬' },
  { id: 3, label: '대본', icon: '📝' },
  { id: 4, label: '이미지', icon: '🖼️' },
  { id: 5, label: '영상/TTS', icon: '🎵' },
  { id: 6, label: 'QC', icon: '✅' },
  { id: 7, label: '패키징', icon: '📦' },
];

function getStepStatus(stepId, currentStep, jobStatus) {
  if (stepId < currentStep) return 'completed';
  if (stepId === currentStep) {
    if (jobStatus?.includes('failed') || jobStatus === 'error') return 'error';
    return 'active';
  }
  return 'pending';
}

export default function StepProgress({ job, onStepClick }) {
  if (!job) return null;

  const currentStep = STATUS_STEP[job.status] || 1;
  const contentType = job.contentType;
  const isHealthType = contentType === CONTENT_TYPES.HEALTH;
  const isSseoltoon = contentType === CONTENT_TYPES.SSEOLTOON;

  return (
    <div className="bg-white border-b border-gray-200 px-6 py-4">
      <div className="flex items-center justify-between">
        {STEPS.map((step, idx) => {
          const status = getStepStatus(step.id, currentStep, job.status);
          const isVideoStep = step.id === 5;
          const isQCStep = step.id === 6;
          const isScriptStep = step.id === 3;
          const isSkipped = isSseoltoon && isVideoStep; // 썰툰은 영상 단계 스킵

          return (
            <div key={step.id} className="flex items-center flex-1">
              {/* 스텝 노드 */}
              <div className="flex flex-col items-center">
                <button
                  onClick={() => status === 'completed' && onStepClick?.(step.id)}
                  disabled={status !== 'completed'}
                  className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium border-2 transition-all relative
                    ${status === 'completed' ? 'bg-green-500 border-green-500 text-white cursor-pointer hover:bg-green-600' : ''}
                    ${status === 'active' ? 'bg-blue-500 border-blue-500 text-white' : ''}
                    ${status === 'error' ? 'bg-red-500 border-red-500 text-white' : ''}
                    ${status === 'pending' ? 'bg-white border-gray-300 text-gray-400' : ''}
                    ${isSkipped ? '!bg-gray-200 !border-gray-300 !text-gray-400 opacity-60' : ''}
                  `}
                >
                  {status === 'completed' && !isSkipped ? (
                    <Check size={16} />
                  ) : status === 'error' ? (
                    <AlertCircle size={16} />
                  ) : isSkipped ? (
                    <Minus size={16} />
                  ) : (
                    <span>{step.icon}</span>
                  )}

                  {/* 건강 콘텐츠 아이콘 */}
                  {isHealthType && (isScriptStep || isQCStep) && (
                    <span className="absolute -top-1 -right-1 text-xs">🛡️</span>
                  )}
                </button>

                <span className={`mt-1 text-xs font-medium whitespace-nowrap
                  ${status === 'completed' ? 'text-green-600' : ''}
                  ${status === 'active' ? 'text-blue-600' : ''}
                  ${status === 'error' ? 'text-red-600' : ''}
                  ${status === 'pending' ? 'text-gray-400' : ''}
                  ${isSkipped ? 'text-gray-400 line-through' : ''}
                `}>
                  {step.label}
                </span>

                {/* 현재 실행 스킬 */}
                {status === 'active' && (
                  <span className="mt-0.5 text-xs text-blue-500 whitespace-nowrap">
                    {currentStep === 1 && '🧠 youtube-researcher'}
                    {currentStep === 3 && '🧠 script-creator'}
                    {currentStep === 4 && '🧠 image-generator'}
                    {currentStep === 5 && '🧠 tts-sync'}
                    {currentStep === 6 && '🧠 shorts-qc-reviewer'}
                    {currentStep === 7 && '🧠 export-packager'}
                  </span>
                )}
              </div>

              {/* 연결선 */}
              {idx < STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 mx-2 mt-[-18px]
                  ${step.id < currentStep ? 'bg-green-500' : 'bg-gray-200'}
                `} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
