// 패키징 & 다운로드 페이지
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Download, FolderOpen, FileText, Film, Music, Image, Package, CheckCircle2, ChevronRight, ChevronDown } from 'lucide-react';
import { mockJobs } from '../data/mockData';
import StepProgress from '../components/common/StepProgress';

const FILE_TREE = [
  {
    id: 'final',
    label: 'final/',
    icon: '📁',
    description: '최종 영상만 다운로드',
    children: [
      { id: 'final_mp4', label: 'final_shorts.mp4', icon: '🎬', size: '87.3 MB' },
      { id: 'final_mp3', label: 'final_voice.mp3', icon: '🎵', size: '4.2 MB' },
    ],
  },
  {
    id: 'images',
    label: 'images/',
    icon: '📁',
    description: '모든 이미지 다운로드',
    children: [
      { id: 'scene_01_png', label: 'scene_01.png ~ scene_08.png', icon: '🖼️', size: '48.5 MB' },
      {
        id: 'versions',
        label: 'versions/',
        icon: '📁',
        children: [
          { id: 'scene_03_v1', label: 'scene_03_v1.png', icon: '🖼️', size: '5.2 MB' },
          { id: 'scene_04_v1', label: 'scene_04_v1.png', icon: '🖼️', size: '5.1 MB' },
        ],
      },
    ],
  },
  {
    id: 'videos',
    label: 'videos/',
    icon: '📁',
    description: '모든 영상 다운로드',
    children: [
      { id: 'scene_vids', label: 'scene_01.mp4 ~ scene_08.mp4', icon: '🎬', size: '125.4 MB' },
    ],
  },
  {
    id: 'audio',
    label: 'audio/',
    icon: '📁',
    description: '모든 오디오 다운로드',
    children: [
      { id: 'narration', label: 'full_narration.mp3', icon: '🎵', size: '4.2 MB' },
      { id: 'scene_audios', label: 'scene_01.mp3 ~ scene_08.mp3', icon: '🎵', size: '2.1 MB' },
      { id: 'srt', label: 'subtitles.srt', icon: '📝', size: '12 KB' },
    ],
  },
  {
    id: 'script',
    label: 'script/',
    icon: '📁',
    description: '대본+설정 다운로드',
    children: [
      { id: 'script_md', label: 'script.md', icon: '📝', size: '8 KB' },
      { id: 'storyboard', label: 'storyboard.json', icon: '📄', size: '24 KB' },
      { id: 'prompts', label: 'prompts.json', icon: '📄', size: '18 KB' },
      { id: 'style_bible', label: 'style_bible.json', icon: '📄', size: '6 KB' },
      { id: 'char_bible', label: 'character_bible.json', icon: '📄', size: '9 KB' },
      { id: 'prod_log', label: 'production_log.json', icon: '📄', size: '42 KB' },
    ],
  },
  {
    id: 'metadata',
    label: 'metadata/',
    icon: '📁',
    description: '메타데이터 다운로드',
    children: [
      { id: 'title_opts', label: 'title_options.json', icon: '📄', size: '3 KB' },
      { id: 'description', label: 'description.txt', icon: '📝', size: '2 KB' },
      { id: 'hashtags', label: 'hashtags.txt', icon: '📝', size: '1 KB' },
      { id: 'upload_info', label: 'upload_info.json', icon: '📄', size: '2 KB' },
    ],
  },
];

function FileNode({ node, depth = 0, selectedFiles, onToggleFile }) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children && node.children.length > 0;
  const isFolder = hasChildren;

  return (
    <div>
      <div
        className={`flex items-center gap-2 py-1.5 px-2 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors
          ${depth > 0 ? 'ml-' + (depth * 4) : ''}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => isFolder ? setExpanded(!expanded) : onToggleFile(node.id)}
      >
        {isFolder ? (
          expanded ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />
        ) : (
          <input
            type="checkbox"
            checked={selectedFiles.includes(node.id)}
            onChange={() => onToggleFile(node.id)}
            onClick={e => e.stopPropagation()}
            className="rounded border-gray-300 text-blue-500 w-3.5 h-3.5"
          />
        )}
        <span className="text-sm">{node.icon}</span>
        <span className={`text-sm ${isFolder ? 'font-medium text-gray-700' : 'text-gray-600'}`}>{node.label}</span>
        {node.size && <span className="ml-auto text-xs text-gray-400">{node.size}</span>}
        {isFolder && node.description && (
          <button
            onClick={e => { e.stopPropagation(); }}
            className="ml-auto text-xs text-blue-600 hover:underline flex items-center gap-0.5"
          >
            <Download size={11} />
            {node.description}
          </button>
        )}
      </div>
      {isFolder && expanded && node.children.map(child => (
        <FileNode
          key={child.id}
          node={child}
          depth={depth + 1}
          selectedFiles={selectedFiles}
          onToggleFile={onToggleFile}
        />
      ))}
    </div>
  );
}

export default function ExportPage() {
  const { jobId } = useParams();
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [isPackaging, setIsPackaging] = useState(false);
  const [packaged, setPackaged] = useState(false);
  const [progress, setProgress] = useState(0);

  const job = mockJobs.find(j => j.id === jobId) || mockJobs[0];

  const handleToggleFile = (fileId) => {
    setSelectedFiles(prev =>
      prev.includes(fileId) ? prev.filter(f => f !== fileId) : [...prev, fileId]
    );
  };

  const handlePackage = () => {
    setIsPackaging(true);
    let p = 0;
    const interval = setInterval(() => {
      p += 10;
      setProgress(p);
      if (p >= 100) {
        clearInterval(interval);
        setIsPackaging(false);
        setPackaged(true);
      }
    }, 300);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <StepProgress job={{ ...job, status: packaged ? 'exported' : 'exporting' }} />

      <div className="flex-1 overflow-hidden flex">
        {/* 파일 트리 */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-bold text-gray-900">패키징 & 다운로드</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                {packaged ? '마지막 패키징: 2026-03-12 14:30 · 언제든 재다운로드 가능' : '파일을 선택하거나 전체를 다운로드하세요'}
              </p>
            </div>
            {packaged && (
              <div className="flex items-center gap-2 text-green-600">
                <CheckCircle2 size={18} />
                <span className="text-sm font-medium">패키징 완료</span>
              </div>
            )}
          </div>

          {/* 파일 검증 */}
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-4">
            <div className="flex items-center gap-2 text-sm text-green-700">
              <CheckCircle2 size={16} />
              <span>파일 검증 완료 — 예상 파일 32개 / 실제 32개</span>
              <span className="mx-2 text-green-300">·</span>
              <span>총 크기: 245 MB</span>
            </div>
          </div>

          {/* 진행률 */}
          {isPackaging && (
            <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-700">패키징 중...</span>
                <span className="text-sm font-bold text-blue-600">{progress}%</span>
              </div>
              <div className="bg-gray-100 rounded-full h-2">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {/* 파일 트리 */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 font-mono text-sm">
            <div className="text-xs text-gray-400 mb-3 font-sans">output/{jobId}/</div>
            {FILE_TREE.map(node => (
              <FileNode
                key={node.id}
                node={node}
                selectedFiles={selectedFiles}
                onToggleFile={handleToggleFile}
              />
            ))}
          </div>
        </div>

        {/* 다운로드 패널 */}
        <div className="w-72 border-l border-gray-200 bg-white flex flex-col">
          <div className="p-5 flex-1">
            <h3 className="font-semibold text-gray-900 mb-4">다운로드 옵션</h3>

            <div className="space-y-2 mb-6">
              {[
                { id: 'zip', label: '전체 ZIP 다운로드', desc: '245 MB', icon: Package, primary: true },
                { id: 'final', label: '최종 영상만', desc: '87.3 MB', icon: Film },
                { id: 'images', label: '이미지만', desc: '48.5 MB', icon: Image },
                { id: 'script', label: '대본만', desc: '107 KB', icon: FileText },
                { id: 'metadata', label: '메타데이터', desc: '8 KB', icon: FolderOpen },
              ].map(opt => (
                <button
                  key={opt.id}
                  className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-all text-left
                    ${opt.primary
                      ? 'bg-blue-600 border-blue-600 text-white hover:bg-blue-700'
                      : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}
                >
                  <opt.icon size={16} className={opt.primary ? 'text-blue-200' : 'text-gray-400'} />
                  <div className="flex-1">
                    <div className="text-sm font-medium">{opt.label}</div>
                    <div className={`text-xs ${opt.primary ? 'text-blue-200' : 'text-gray-400'}`}>{opt.desc}</div>
                  </div>
                  <Download size={14} className={opt.primary ? 'text-blue-200' : 'text-gray-400'} />
                </button>
              ))}
            </div>

            {selectedFiles.length > 0 && (
              <div className="border-t border-gray-100 pt-4">
                <div className="text-xs text-gray-500 mb-2">{selectedFiles.length}개 선택됨</div>
                <button className="w-full py-2 border border-blue-300 text-blue-600 text-sm rounded-lg hover:bg-blue-50 transition-colors flex items-center justify-center gap-1.5">
                  <Download size={14} />
                  선택 파일 다운로드
                </button>
              </div>
            )}

            {!packaged && (
              <button
                onClick={handlePackage}
                disabled={isPackaging}
                className="w-full mt-4 py-3 bg-green-500 hover:bg-green-600 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
              >
                {isPackaging ? '패키징 중...' : '패키징 시작'}
              </button>
            )}
          </div>

          {/* YouTube 메타데이터 미리보기 */}
          <div className="border-t border-gray-100 p-4">
            <div className="text-xs font-semibold text-gray-600 mb-2">YouTube 업로드 미리보기</div>
            <div className="text-xs text-gray-500 space-y-1">
              <div><span className="text-gray-400">제목:</span> 강아지가 주인 기다리다 잠든 순간 😭</div>
              <div><span className="text-gray-400">해시태그:</span> #강아지 #귀여운 #반려견 #쇼츠</div>
              <div className="text-gray-400">면책문구 자동 포함 ✓</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
