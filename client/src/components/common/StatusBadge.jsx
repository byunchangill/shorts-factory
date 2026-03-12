// 상태 배지 공통 컴포넌트
import { STATUS_LABELS } from '../../data/mockData';

const STATUS_STYLES = {
  // 승인 대기 계열
  references_presented: 'bg-orange-50 text-orange-700 border-orange-200',
  script_pending_approval: 'bg-orange-50 text-orange-700 border-orange-200',
  style_bible_pending: 'bg-orange-50 text-orange-700 border-orange-200',
  character_bible_pending: 'bg-orange-50 text-orange-700 border-orange-200',
  images_pending_approval: 'bg-orange-50 text-orange-700 border-orange-200',
  video_pending_approval: 'bg-orange-50 text-orange-700 border-orange-200',
  qc_warning: 'bg-orange-50 text-orange-700 border-orange-200',
  images_version_restored: 'bg-orange-50 text-orange-700 border-orange-200',

  // 진행중 계열
  searching: 'bg-blue-50 text-blue-700 border-blue-200',
  scripting: 'bg-blue-50 text-blue-700 border-blue-200',
  script_revision_requested: 'bg-blue-50 text-blue-700 border-blue-200',
  images_generating: 'bg-blue-50 text-blue-700 border-blue-200',
  images_regen_requested: 'bg-blue-50 text-blue-700 border-blue-200',
  video_generating: 'bg-blue-50 text-blue-700 border-blue-200',
  video_regen_requested: 'bg-blue-50 text-blue-700 border-blue-200',
  tts_generating: 'bg-blue-50 text-blue-700 border-blue-200',
  tts_syncing: 'bg-blue-50 text-blue-700 border-blue-200',
  compose_generating: 'bg-blue-50 text-blue-700 border-blue-200',
  qc_reviewing: 'bg-blue-50 text-blue-700 border-blue-200',
  exporting: 'bg-blue-50 text-blue-700 border-blue-200',
  recovering: 'bg-blue-50 text-blue-700 border-blue-200',

  // 완료 계열
  script_approved: 'bg-green-50 text-green-700 border-green-200',
  images_fully_approved: 'bg-green-50 text-green-700 border-green-200',
  video_approved: 'bg-green-50 text-green-700 border-green-200',
  compose_done: 'bg-green-50 text-green-700 border-green-200',
  qc_passed: 'bg-green-50 text-green-700 border-green-200',
  exported: 'bg-green-50 text-green-700 border-green-200',
  reference_selected: 'bg-green-50 text-green-700 border-green-200',

  // 오류 계열
  script_failed: 'bg-red-50 text-red-700 border-red-200',
  video_failed: 'bg-red-50 text-red-700 border-red-200',
  tts_failed: 'bg-red-50 text-red-700 border-red-200',
  compose_failed: 'bg-red-50 text-red-700 border-red-200',
  export_failed: 'bg-red-50 text-red-700 border-red-200',
  qc_failed: 'bg-red-50 text-red-700 border-red-200',
  error: 'bg-red-50 text-red-700 border-red-200',

  // 재생성/보라
  images_partial: 'bg-purple-50 text-purple-700 border-purple-200',
  video_partial: 'bg-purple-50 text-purple-700 border-purple-200',

  // 스킵/회색
  abandoned: 'bg-gray-100 text-gray-600 border-gray-200',
  paused: 'bg-gray-100 text-gray-600 border-gray-200',

  // 기본
  default: 'bg-gray-50 text-gray-700 border-gray-200',
};

export default function StatusBadge({ status, size = 'sm' }) {
  const style = STATUS_STYLES[status] || STATUS_STYLES.default;
  const label = STATUS_LABELS[status] || status;
  const sizeClass = size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-sm px-3 py-1';

  return (
    <span className={`inline-flex items-center rounded-full border font-medium ${style} ${sizeClass}`}>
      {label}
    </span>
  );
}
