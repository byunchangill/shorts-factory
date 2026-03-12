// 대본 편집기 페이지
import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle2, RefreshCw, Edit3, ChevronRight } from 'lucide-react';
import { mockScript, mockJobs } from '../data/mockData';
import StepProgress from '../components/common/StepProgress';

function SimilarityGauge({ label, value, threshold }) {
  const isOver = value > threshold;
  return (
    <div className="flex-1">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-gray-600">{label}</span>
        <span className={`text-xs font-bold ${isOver ? 'text-red-600' : 'text-green-600'}`}>
          {value}% {isOver ? '⚠' : '✓'}
        </span>
      </div>
      <div className="bg-gray-100 rounded-full h-2">
        <div
          className={`h-2 rounded-full transition-all ${isOver ? 'bg-red-500' : 'bg-green-500'}`}
          style={{ width: `${Math.min(value, 100)}%` }}
        />
      </div>
      <div className="text-xs text-gray-400 mt-0.5">임계값: {threshold}%</div>
    </div>
  );
}

export default function ScriptPage() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const [activeScene, setActiveScene] = useState('scene-01');
  const [editMode, setEditMode] = useState(false);
  const [scenes, setScenes] = useState(mockScript.scenes);
  const [revisionNote, setRevisionNote] = useState('');

  const job = mockJobs.find(j => j.id === jobId) || mockJobs[0];
  const script = mockScript;
  const { phraseOverlap, structureOverlap, titleSimilarity } = script.similarity;
  const isOverThreshold = phraseOverlap > 30 || structureOverlap > 70 || titleSimilarity > 50;

  const activeSceneData = scenes.find(s => s.id === activeScene);

  const handleApprove = () => {
    navigate(`/jobs/${jobId}/images`);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <StepProgress job={{ ...job, status: 'script_pending_approval' }} />

      <div className="flex-1 overflow-hidden flex flex-col">
        {/* 헤더 */}
        <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">대본 편집기</h2>
            <p className="text-xs text-gray-500">제목: {script.title} · 총 {script.totalDuration}초 · {scenes.length}개 씬</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setEditMode(!editMode)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border transition-colors
                ${editMode ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
            >
              <Edit3 size={14} />
              {editMode ? '편집 중' : '편집'}
            </button>
            <button className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors">
              <RefreshCw size={14} />
              재생성
            </button>
            <button
              onClick={handleApprove}
              className="flex items-center gap-1.5 px-4 py-1.5 text-sm rounded-lg bg-green-500 hover:bg-green-600 text-white font-medium transition-colors"
            >
              <CheckCircle2 size={14} />
              대본 승인
            </button>
          </div>
        </div>

        {/* 2컬럼 레이아웃 */}
        <div className="flex-1 overflow-hidden flex">
          {/* 씬 타임라인 (40%) */}
          <div className="w-2/5 border-r border-gray-200 overflow-y-auto bg-gray-50">
            <div className="p-3 space-y-2">
              {scenes.map((scene, idx) => (
                <button
                  key={scene.id}
                  onClick={() => setActiveScene(scene.id)}
                  className={`w-full text-left p-3 rounded-lg border transition-all
                    ${activeScene === scene.id
                      ? 'bg-white border-blue-300 shadow-sm'
                      : 'bg-white border-gray-200 hover:border-gray-300'}`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0
                      ${activeScene === scene.id ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600'}`}>
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-700 line-clamp-2">{scene.narration}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-gray-400">{scene.duration}초</span>
                        <span className="text-xs text-gray-300">·</span>
                        <span className="text-xs text-gray-400">{scene.emotion}</span>
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* 씬 편집기 (60%) */}
          <div className="flex-1 overflow-y-auto">
            {activeSceneData && (
              <div className="p-6">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center text-sm font-bold">
                    {activeSceneData.sceneNumber}
                  </div>
                  <h3 className="font-semibold text-gray-900">씬 {activeSceneData.sceneNumber}</h3>
                  <span className="text-sm text-gray-400">{activeSceneData.duration}초</span>
                </div>

                {/* 나레이션 */}
                <div className="mb-4">
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">나레이션</label>
                  {editMode ? (
                    <textarea
                      value={activeSceneData.narration}
                      onChange={e => setScenes(prev => prev.map(s =>
                        s.id === activeSceneData.id ? { ...s, narration: e.target.value } : s
                      ))}
                      className="w-full p-3 border border-blue-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                      rows={3}
                    />
                  ) : (
                    <div className="p-3 bg-gray-50 rounded-lg text-sm text-gray-800 leading-relaxed">
                      {activeSceneData.narration}
                    </div>
                  )}
                </div>

                {/* 비주얼 설명 */}
                <div className="mb-4">
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">비주얼 설명</label>
                  {editMode ? (
                    <textarea
                      value={activeSceneData.visualDescription}
                      onChange={e => setScenes(prev => prev.map(s =>
                        s.id === activeSceneData.id ? { ...s, visualDescription: e.target.value } : s
                      ))}
                      className="w-full p-3 border border-blue-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                      rows={2}
                    />
                  ) : (
                    <div className="p-3 bg-blue-50 rounded-lg text-sm text-gray-700 leading-relaxed border border-blue-100">
                      {activeSceneData.visualDescription}
                    </div>
                  )}
                </div>

                {/* 감정 태그 */}
                <div className="mb-6">
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">감정 태그</label>
                  <span className="inline-flex items-center px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-xs font-medium">
                    {activeSceneData.emotion}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 유사도 게이지 */}
        <div className="bg-white border-t border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold text-gray-700">저작권 유사도 검증</h4>
              {isOverThreshold ? (
                <span className="flex items-center gap-1 text-xs text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                  <AlertCircle size={12} />
                  임계값 초과
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                  <CheckCircle2 size={12} />
                  안전
                </span>
              )}
            </div>
            {isOverThreshold && (
              <button className="text-xs text-blue-600 hover:underline">재생성 요청</button>
            )}
          </div>
          <div className="flex gap-6">
            <SimilarityGauge label="문장 유사도" value={phraseOverlap} threshold={30} />
            <SimilarityGauge label="구조 유사도" value={structureOverlap} threshold={70} />
            <SimilarityGauge label="제목 유사도" value={titleSimilarity} threshold={50} />
          </div>
        </div>
      </div>
    </div>
  );
}
