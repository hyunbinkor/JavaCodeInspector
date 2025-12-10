# 금융권 Java 코드 품질 검증 시스템

> Java 코드를 3-Layer로 분석하여 가이드라인 위반, 안티패턴, 보안 취약점을 자동 탐지하고 수정안을 제시합니다.

## 1. 개요

### 핵심 기능
- **개발가이드 검사**: VectorDB에서 규칙 로드 → LLM 기반 위반 탐지
- **패턴 분석**: 코드 임베딩 → 유사 안티패턴 검색 → 이슈 탐지
- **통합 리포트**: 우선순위 정렬 + 자동 수정안 생성

### 기술 스택
| 구분 | 기술 |
|------|------|
| 런타임 | Node.js (ES2022+) |
| LLM | Ollama (개발) → vLLM (운영) |
| VectorDB | Qdrant |
| 임베딩 | nomic-embed-text (768D → 480D 변환) |

---

## 2. 아키텍처

### 3-Layer 구조

```
┌─────────────────────────────────────────────────────────────────┐
│                      UnifiedJavaCodeChecker                     │
│                        (Layer 3: 통합)                          │
├─────────────────────────┬───────────────────────────────────────┤
│       Layer 1           │              Layer 2                  │
│   가이드라인 검사        │            패턴 분석                   │
│  (GuidelineChecker)     │      (IssueCodeAnalyzer)              │
├─────────────────────────┼───────────────────────────────────────┤
│ ┌─────────┐ ┌─────────┐ │ ┌──────────┐ ┌──────────┐             │
│ │ 정적    │ │컨텍스트  │ │ │ 임베딩    │ │ VectorDB │             │
│ │ 규칙    │ │ 규칙     │ │ │ 생성      │ │ 검색     │            │
│ │(보류)   │ │ (LLM)   │ │  │ (480D)   │ │ (Qdrant) │            │
│ └────┬────┘ └────┬────┘ │ └────┬─────┘ └────┬─────┘             │
│      │           │      │      │            │                   │
│      ▼           ▼      │      └─────┬──────┘                   │
│  SonarQube    gpt-oss   │            ▼                          │
│  (향후)       :120b     │     안티패턴 탐지                      │
└─────────────────────────┴───────────────────────────────────────┘
```

### v2.1 이원화 (가이드라인 검사)

| 규칙 타입 | 검사 방식 | 상태 | 비고 |
|----------|----------|------|------|
| **정적 규칙** (regex/ast) | SonarQube | ⏸️ 보류 | 담당자 협의 후 연동 |
| **컨텍스트 규칙** (llm_contextual) | LLM | ✅ 활성 | 통합/배치 프롬프트 |

---

## 3. 실행 방식

### 초기 설정
```bash
# 1. 의존성 설치
npm install

# 2. Docker 서비스 실행
docker-compose up -d

# 3. Ollama 임베딩 모델 설치
docker exec -it code-pattern-ollama ollama pull nomic-embed-text

# 4. 이슈 데이터 배치 처리 (VectorDB 초기화)
npm start -- batch
```

### 주요 명령어

| 명령어 | 설명 | 예시 |
|--------|------|------|
| `check` | 통합 검사 (권장) | `npm start -- check -c test_code_4.java -o report.json` |
| `check-guidelines` | 가이드라인만 검사 | `npm start -- check-guidelines -c test_code_4.java --fix` |
| `search` | 패턴 검색만 수행 | `npm start -- search -c code.java -l 10` |
| `extract-guidelines` | 규칙 추출 | `npm start -- extract-guidelines -i development_guide_1.docx -o rules_1.json` |
| `import-guidelines` | 규칙을 VectorDB에 저장 | `npm start -- import-guidelines -i rules_1.json` |
| `status` | 시스템 상태 확인 | `npm start -- status` |

### v2.1 전용 옵션
```bash
# 통합 검사 (기본: 컨텍스트 규칙만, 통합 프롬프트)
npm start -- check -c code.java

# 배치 프롬프트 사용 (규칙이 많을 때)
npm start -- check -c code.java --use-batch-prompt

# 정적 규칙 포함 테스트 (SonarQube 연동 전)
npm start -- check-guidelines -c code.java --include-static
```

---

## 4. 호출 체인

### 4.1 통합 검사 (`check`)

```
main.js (CLI)
    │
    ▼
performUnifiedCheck()                    [checkCommand.js]
    │
    ▼
UnifiedJavaCodeChecker.analyzeCode()     [unifiedCodeChecker.js]
    │
    ├─── [병렬 1] performGuidelineCheck()
    │         │
    │         ▼
    │    GuidelineChecker.checkRules()   [guidelineChecker.js]
    │         │
    │         ├── (정적 규칙: 스킵 - SonarQube 보류)
    │         │
    │         └── checkContextualRulesUnified()
    │                   │
    │                   ├── filterApplicableRules()  ← keywords 필터링
    │                   ├── buildUnifiedPrompt()     ← 통합 프롬프트 생성
    │                   ├── LLMService.generateCompletion() ← gpt-oss:120b
    │                   └── parseUnifiedResponse()   ← JSON 파싱
    │
    └─── [병렬 2] performPatternAnalysis()
              │
              ▼
         PatternDatasetGenerator.generateEmbeddings()  [patternGenerator.js]
              │
              ▼
         VectorClient.searchSimilarPatterns()          [vectorClient.js]
              │
              ▼
         IssueCodeAnalyzer.analyzeCodeIssues()         [issueCodeAnalyzer.js]
              │
              ├── DynamicSafePatternAnalyzer.analyze()
              ├── 카테고리별 이슈 탐지
              └── 거짓 양성 필터링
    │
    ▼
unifyResults()  ← 결과 병합 + 우선순위 정렬 + 점수 계산
    │
    ▼
displayUnifiedResults()  ← 콘솔 출력
```

### 4.2 가이드라인 추출 (`extract-guidelines`)

```
main.js (CLI)
    │
    ▼
extractGuidelinesFromGuide()             [guidelineCommand.js]
    │
    ▼
GuidelineExtractor.extractFromFile()     [guidelineExtractor.js]
    │
    ├── PDF 파싱 (pdf-parse)
    │
    ├── 섹션 분리 (정규식)
    │
    └── LLM 분석 (규칙 구조화)
         │
         ├── checkType 결정 (regex/ast/llm_contextual)
         ├── 패턴 추출 (antiPatterns/goodPatterns)
         ├── 예제 코드 추출
         └── keywords 생성
    │
    ▼
JSON 저장 → (옵션) VectorDB import
```

### 4.3 패턴 검색 (`search`)

```
main.js (CLI)
    │
    ▼
searchAndAnalyzePatterns()               [utilCommand.js]
    │
    ▼
PatternDatasetGenerator.generateEmbeddings()
    │
    ├── AST 파싱 → 구문 임베딩 (128D)
    ├── 의미 분석 → 의미 임베딩 (256D)
    ├── 어노테이션 → 프레임워크 임베딩 (64D)
    └── 키워드 → 비즈니스 임베딩 (32D)
         │
         ▼
    combineEmbeddings() → 480D 통합 벡터
    │
    ▼
VectorClient.searchSimilarPatterns()     [vectorClient.js → qdrantAdapter.js]
    │
    ▼
IssueCodeAnalyzer.analyzeCodeIssues()
    │
    └── (옵션) generateFixSuggestion() ← LLM 수정안 생성
```

### 4.4 이슈 배치 처리 (`batch`)

```
main.js (CLI)
    │
    ▼
processBatchIssues()                     [issueCommand.js]
    │
    ▼
[각 이슈 JSON 파일에 대해]
    │
    ▼
PatternDatasetGenerator.generateFromIssue()
    │
    ├── LLM 분석 (안티패턴/권장패턴 생성)
    │
    ├── 임베딩 생성 (480D)
    │
    └── VectorClient.upsertPattern() → Qdrant 저장
```

---

## 부록: 디렉토리 구조

```
src/
├── ast/
│   └── javaAstParser.js        # Java AST 파싱
├── clients/
│   ├── vectorClient.js         # VectorDB 추상화
│   └── qdrantAdapter.js        # Qdrant 어댑터
├── commands/
│   ├── checkCommand.js         # check, check-guidelines
│   ├── guidelineCommand.js     # extract, import, manage
│   ├── issueCommand.js         # analyze, batch
│   └── utilCommand.js          # search, status
├── core/
│   ├── guidelineChecker.js     # Layer 1: 가이드라인 검사
│   ├── issueCodeAnalyzer.js    # Layer 2: 패턴 분석
│   ├── unifiedCodeChecker.js   # Layer 3: 통합
│   ├── guidelineExtractor.js   # PDF → 규칙 추출
│   ├── patternGenerator.js     # 패턴 데이터셋 생성
│   └── codeEmbedding.js        # 임베딩 생성
├── services/
│   └── llmService.js           # LLM 추상화 (Ollama/vLLM)
├── utils/
│   ├── fileUtils.js
│   ├── issueUtils.js
│   └── loggerUtils.js
├── config.js                   # 환경 설정
└── main.js                     # CLI 진입점
```