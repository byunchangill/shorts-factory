# 외부에서 가져온 스킬

아래 13개는 **ECC**(https://github.com/affaan-m/ECC) v2.2.0 에서 복사했다.
ECC는 MIT 라이선스이고 저작권은 Copyright (c) 2026 Affaan Mustafa 에 있다.

```
api-design           click-path-audit          coding-standards
contract-first       cost-aware-llm-pipeline   e2e-testing
error-handling       react-patterns            react-testing
remotion-video-creation                        security-review
tdd-workflow         vite-patterns
```

## 왜 플러그인으로 안 쓰고 복사했나

ECC를 플러그인으로 켜면 **378개 스킬이 통째로 들어와 매 세션 40,459 토큰**이 깔린다.
이 저장소에 실제로 쓰는 건 13개고, 그것만 복사하면 **약 1,030 토큰**이다.

더 중요한 이유는 **클라우드(깃허브) 세션**이다. 2026-08-13 실측:

> 프로젝트 `.claude/settings.json`에 `enabledPlugins`와 `extraKnownMarketplaces`를
> 둘 다 적어 커밋했는데도, 클라우드 세션에서 ecc가 **안 켜졌다.**
> `~/.claude/plugins/installed_plugins.json`이 `{}`였고 marketplaces 디렉터리 자체가 없었다.
> `extraKnownMarketplaces`는 "어디서 받을지"만 선언할 뿐 설치를 트리거하지 않는다.

**클라우드에서 확실히 동작하는 건 저장소에 커밋된 `.claude/skills/` 파일뿐이다.**
그래서 플러그인이 아니라 파일로 가져왔다.

## 갱신하는 법

ECC가 올라가면 필요할 때만 다시 복사한다. 자동 동기화는 걸지 않았다 —
378개가 다시 들어오는 사고를 막기 위해서다.

```bash
E=~/.claude/plugins/cache/ecc/ecc/<버전>/skills
for s in api-design click-path-audit coding-standards contract-first \
         cost-aware-llm-pipeline e2e-testing error-handling react-patterns \
         react-testing remotion-video-creation security-review tdd-workflow vite-patterns; do
  cp -r "$E/$s" .claude/skills/
done
```

## 이 저장소 자체 스킬 (외부 아님)

`answer-job` · `create-format` · `shorts-content-team` · `shorts-dev-team` ·
`shorts-script-qc` · `shorts-viral-script`
