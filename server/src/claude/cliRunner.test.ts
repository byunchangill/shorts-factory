import { describe, it, expect } from 'vitest';
import type { Packet } from '@shared/types';
import { cliArgs, cliFailureMessage } from './cliRunner.js';
import { packetCommands, packetSlashCommand } from './packets.js';

const packet = {
  id: 'p06-script',
  kind: 'script',
  status: 'waiting',
  dir: 'menu-a/생활용품/jobs/20260816-001/requests/p06-script',
} as unknown as Packet;

describe('packetSlashCommand', () => {
  it('빠르게는 혼자 처리, 고품질은 팀 처리 스킬을 부른다', () => {
    expect(packetSlashCommand(packet, 'fast')).toBe(`/answer-job workspace/${packet.dir}`);
    expect(packetSlashCommand(packet, 'quality')).toBe(`/shorts-content-team workspace/${packet.dir}`);
  });

  /**
   * 화면에 보이는 명령과 앱이 실제로 돌리는 명령이 갈라지면, 사용자는 붙여넣어 본 것과
   * 다른 일이 일어나는 것을 알 길이 없다. 한 곳에서 나와야 한다.
   */
  it('화면에 띄우는 명령도 같은 문자열에서 나온다', () => {
    const cmds = packetCommands(packet);
    expect(cmds.fast).toContain(packetSlashCommand(packet, 'fast'));
    expect(cmds.quality).toContain(packetSlashCommand(packet, 'quality'));
  });
});

describe('cliArgs', () => {
  it('요청서 슬래시 명령을 비대화형(-p)으로 넘긴다', () => {
    const args = cliArgs(packet, 'fast');
    expect(args[0]).toBe('-p');
    expect(args[1]).toBe(packetSlashCommand(packet, 'fast'));
  });

  /**
   * `acceptEdits`를 켜면 작업 폴더 안이라는 이유로 저장소 어디든 쓰게 된다 —
   * 실측에서 CLI가 `tools/`에 제 도우미 스크립트를 만들어 놓고 갔다.
   */
  it('쓰기를 그 요청서의 result/ 안으로 못 박는다', () => {
    const tools = cliArgs(packet, 'fast').slice(cliArgs(packet, 'fast').indexOf('--allowedTools') + 1);
    expect(tools).toContain(`Edit(workspace/${packet.dir}/result/**)`);
    // 범위 없는 통짜 쓰기 권한이 다시 들어오면 안 된다
    expect(tools).not.toContain('Write');
    expect(tools).not.toContain('Edit');
  });

  /**
   * 파일 권한 검사는 `Edit(경로)`만 본다 — `Write(경로)`는 넘겨도 아무 일도 안 하고,
   * 그것만 주면 전부 거부된다. 도로 넣으면 조용히 아무것도 못 쓰게 된다.
   */
  it('쓸모없는 Write(경로) 규칙을 넣지 않는다', () => {
    expect(cliArgs(packet, 'fast').some((a) => a.startsWith('Write('))).toBe(false);
  });

  it('편집 자동 승인을 켜지 않는다 — 켜면 위 제한이 통째로 무의미해진다', () => {
    expect(cliArgs(packet, 'fast')).not.toContain('--permission-mode');
  });

  it('셸을 안 붙인다 — 요청서 처리에 필요한 건 읽기와 쓰기뿐이다', () => {
    const tools = cliArgs(packet, 'quality').slice(cliArgs(packet, 'quality').indexOf('--allowedTools') + 1);
    expect(tools).toContain('Read');
    expect(tools.some((t) => t.startsWith('Bash'))).toBe(false);
  });

  it('명령을 셸 문자열로 조립하지 않는다 — 경로에 공백·한글이 들어온다', () => {
    // 인자 배열이므로 따옴표를 우리가 붙일 일이 없다
    expect(cliArgs(packet, 'fast').some((a) => a.includes('"'))).toBe(false);
  });
});

describe('cliFailureMessage', () => {
  it('제일 흔한 실패는 고장이 아니라 로그인 안 됨이다', () => {
    expect(cliFailureMessage(['Error: Not logged in. Run /login'])).toContain('로그인');
  });

  it('CLI를 못 찾은 것은 서버 재시작을 짚어준다 (PATH를 새로 읽는다)', () => {
    expect(cliFailureMessage([], new Error('spawn claude ENOENT'))).toContain('다시 시작');
  });

  it('사용량 한도는 API 자동이라는 대안을 알려준다', () => {
    expect(cliFailureMessage(['Claude usage limit reached'])).toContain('API 자동');
  });

  it('원인을 모르면 마지막 줄을 그대로 보여준다', () => {
    expect(cliFailureMessage(['TypeError: something broke'])).toContain('something broke');
  });
});
