# Java 코드 품질 검사 시스템 종합 매뉴얼

## 목차
1. [시스템 개요](#1-시스템-개요)
2. [아키텍처 구조](#2-아키텍처-구조)
3. [핵심 컴포넌트](#3-핵심-컴포넌트)
4. [실행 방식](#4-실행-방식)
5. [처리 프로세스](#5-처리-프로세스)
6. [설정 가이드](#6-설정-가이드)

---

## 1. 시스템 개요

### 1.1 목적
Java 코드의 품질을 다각도로 분석하여 개발 가이드라인 준수 여부, 안티패턴 탐지, 보안 취약점 등을 종합적으로 검사하는 시스템입니다.

### 1.2 주요 기능
- **3계층 분석 아키텍처**
  - Layer 1: 개발가이드 규칙 검사 (정적 + LLM 컨텍스트)
  - Layer 2: VectorDB 기반 패턴 분석 (유사 코드 검색)
  - Layer 3: 통합 리포트 및 수정안 생성

- **분석 범위**
  - 보안 취약점 (SQL Injection, XSS 등)
  - 리소스 관리 (메모리 누수, Connection 미해제)
  - 성능 이슈 (N+1 쿼리, 비효율적 루프)
  - 예외 처리 패턴
  - 코드 스타일 및 포맷팅

---

## 2. 아키텍처 구조

### 2.1 전체 구성도

```
┌─────────────────────────────────────────────────────────┐
│                    CLI Interface (main.js)               │
│  - check: 통합 검사                                       │
│  - check-guidelines: 가이드라인 전용                      │
│  - search: 패턴 검색 및 분석                              │
│  - extract-guidelines: PDF 가이드 추출                    │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│           UnifiedJavaCodeChecker (통합 검사기)            │
│  - AST 파싱                                               │
│  - 병렬 분석 실행                                          │
│  - 결과 통합 및 우선순위 정렬                              │
└─────────────────────────────────────────────────────────┘
         │                                    │
         ▼                                    ▼
┌─────────────────────┐          ┌────────────────────────┐
│ DevelopmentGuideline│          │ PatternAnalysis        │
│ Checker             │          │ (VectorDB 기반)        │
│                     │          │                        │
│ - 정적 규칙 검사     │          │ - 임베딩 생성          │
│ - LLM 컨텍스트 검사 │          │ - 유사 패턴 검색       │
│ - 가이드라인 DB     │          │ - 안티패턴 탐지        │
└─────────────────────┘          └────────────────────────┘
         │                                    │
         ▼                                    ▼
┌─────────────────────────────────────────────────────────┐
│                  Supporting Services                     │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌────────────────────┐   │
│  │ LLMService│  │ Weaviate │  │ CodeEmbedding      │   │
│  │ (Ollama/ │  │ Client   │  │ Generator          │   │
│  │  Bedrock)│  │          │  │                    │   │
│  └──────────┘  └──────────┘  └────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### 2.2 데이터 흐름

```
소스코드 입력
    │
    ▼
AST 파싱 (JavaASTParser)
    │
    ├─→ [Layer 1] 가이드라인 검사
    │   ├─ 정적 규칙 (Regex, AST)
    │   └─ 컨텍스트 규칙 (LLM)
    │
    ├─→ [Layer 2] 패턴 분석
    │   ├─ 코드 임베딩 (480차원)
    │   ├─ VectorDB 유사도 검색
    │   └─ 안티패턴 탐지
    │
    ▼
[Layer 3] 결과 통합
    ├─ 우선순위 정렬
    ├─ 카테고리별 통계
    ├─ 실행 가능 권장사항
    └─ 자동 수정안 (옵션)
    │
    ▼
JSON 리포트 출력
```

---

## 3. 핵심 컴포넌트

### 3.1 UnifiedJavaCodeChecker
**역할**: 전체 검사 프로세스 조율

**주요 메서드**:
- `initialize()`: LLM, VectorDB 연결 확인
- `analyzeCode(sourceCode, options)`: 통합 분석 실행
- `unifyResults()`: 결과 병합 및 우선순위 정렬

**처리 흐름**:
1. AST 파싱으로 코드 구조 분석
2. 가이드라인 검사 + 패턴 분석 병렬 실행
3. 결과를 심각도·카테고리·수정난이도 기준으로 정렬
4. 통합 리포트 생성

### 3.2 DevelopmentGuidelineChecker
**역할**: 개발 가이드라인 규칙 검증

**검사 타입**:
- **정적 규칙**: Regex, AST 기반 즉시 검증
- **컨텍스트 규칙**: LLM 활용 의미론적 검사

**주요 메서드**:
- `checkRules()`: 전체 규칙 실행
- `checkContextualRules()`: LLM 기반 심층 분석
- `deduplicateViolations()`: 중복 제거

**특징**:
- Cast Operator 등 복잡한 규칙에 customValidator 지원
- 배치 처리로 LLM API 호출 최적화 (3개씩)

### 3.3 issueCodeAnalyzer
**역할**: VectorDB 기반 동적 패턴 분석

**처리 과정**:
1. **안전한 패턴 확인**: VectorDB에서 동적으로 로드
2. **유사 패턴 분류**: safe_pattern vs anti_pattern
3. **실제 이슈 탐지**: 안티패턴과 코드 매칭
4. **거짓 양성 제거**: 주석, 선언문 등 필터링
5. **우선순위 정렬**: 심각도·신뢰도·카테고리 순

**주요 메서드**:
- `analyzeCodeIssues()`: 종합 분석
- `findIssuesUsingDynamicPatterns()`: 패턴 매칭
- `generateFixSuggestion()`: VectorDB 기반 수정안

### 3.4 PatternDatasetGenerator
**역할**: 이슈 코드를 학습 가능한 패턴 데이터로 변환

**생성 프로세스**:
1. **LLM 패턴 생성**: 안티패턴·권장패턴·영향분석
2. **프레임워크 분석**: 어노테이션·커스텀 클래스 추출
3. **임베딩 생성**: 480차원 벡터 (구문·의미·프레임워크·비즈니스)
4. **관련 패턴 분석**: 기존 패턴과 유사도 계산
5. **검증 및 저장**: VectorDB 저장

### 3.5 GuidelineExtractor
**역할**: PDF 개발 가이드에서 규칙 자동 추출

**처리 단계**:
1. **PDF 파싱**: 텍스트 추출 및 섹션 분리
2. **규칙 추출**: 섹션 번호 기반 파싱
3. **LLM 심화 분석**: 규칙 유형·패턴·예제 추출
4. **Cast Operator 특수 처리**: customValidator 자동 생성
5. **JSON 저장**: VectorDB import 가능 형식

### 3.6 CodeEmbeddingGenerator
**역할**: 코드를 480차원 벡터로 변환

**임베딩 구조**:
```
총 480차원 = 구문(128) + 의미(256) + 프레임워크(64) + 비즈니스(32)
```

- **구문 임베딩** (128차원): AST 구조, 복잡도, 중첩 깊이
- **의미 임베딩** (256차원): CRUD 패턴, 보안 위험, 성능 이슈
- **프레임워크 임베딩** (64차원): Spring, JPA 어노테이션
- **비즈니스 임베딩** (32차원): 도메인 키워드, 로직 복잡도

**L2 정규화**: 코사인 유사도 계산을 위해 벡터 크기 1로 통일

---

## 4. 실행 방식

### 4.1 CLI 명령어

#### 최초 설정
```bash
# vector+ ollama embeding 실행
docker-compose up -d

# Ollama에 임베딩 모델 설치
docker exec -it code-pattern-ollama ollama pull nomic-embed-text

# 디렉토리 내 모든 JSON 파일 처리 (issue 추가 시 재진행)
npm start -- batch -i examples -o output
```

#### 주요 명령어

**1. 통합 검사 (권장)**
```bash
# 전체 통합 검사 (패턴 + 가이드라인)
npm start -- check -c examples/test_code.java -o report.json
```

**2. 가이드라인 전용 검사**
```bash
# 가이드라인 검사
npm start -- check-guidelines -c examples/guide_test_code.java

# 가이드라인 검사 및 수정안 생성
npm start -- check-guidelines -c examples/guide_test_code.java --fix -o result.json
```

**3. 패턴 검색 및 분석**
```bash
# 패턴 검사
npm start -- search -c examples/test_code.java -l 5

# 패턴 검사 및 수정안 생성
npm start -- search -c examples/test_code.java -l 5 --fix -o result.json
```

**4. PDF 가이드 추출**
```bash
# PDF에서 가이드라인 추출
npm start -- extract-guidelines -i development_guide.pdf -o extracted_rules.json

# PDF에서 추출 후 바로 VectorDB에 import
npm start -- extract-guidelines -i development_guide.pdf -o extracted_rules.json --import-to-db
```

**5. 가이드라인 VectorDB 저장**
```bash
# 이미 추출된 JSON을 VectorDB에 저장
npm start -- import-guidelines -i extracted_rules.json
```

**6. 시스템 상태 확인**
```bash
node main.js status
```

**d**
```bash
# vector admin
git clone https://github.com/Mintplex-Labs/vector-admin.git
cd vector-admin
docker-compose up -d --build postgres
docker run -d ^
  --name vectoradmin ^
  -p 3001:3001 ^
  -e SERVER_PORT="3001" ^
  -e JWT_SECRET="thisismysecret" ^
  -e INNGEST_EVENT_KEY="background_workers" ^
  -e INNGEST_SIGNING_KEY="random-string-goes-here" ^
  -e INNGEST_LANDING_PAGE="true" ^
  -e DATABASE_CONNECTION_STRING="postgresql://vectoradmin:password@host.docker.internal:5433/vdbms" ^
  mintplexlabs/vectoradmin

root@vectoradmin.com  password

http://host.docker.internal:8080 my-secret-key
```

### 4.2 환경 설정

**config.js 주요 설정**:

```javascript
{
  llm: {
    provider: 'ollama',  // 'ollama' 또는 'bedrock'
    
    ollama: {
      baseUrl: 'http://103.196.86.239:12942',
      model: 'qwen3:32b',
      timeout: 180000,  // 3분
      maxRetries: 2
    },
    
    bedrock: {
      region: 'us-east-1',
      modelId: 'claude-sonnet-4-...',
      maxTokens: 4000
    }
  },
  
  weaviate: {
    url: 'http://localhost:8080'
  }
}
```

**환경 변수** (.env):
```
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://103.196.86.239:12942
OLLAMA_MODEL=qwen3:32b
WEAVIATE_URL=http://localhost:8080
```

---

## 5. 처리 프로세스

### 5.1 통합 검사 프로세스

```
1. 초기화 단계
   ├─ LLM 서비스 연결 확인
   ├─ VectorDB 연결 확인
   └─ 가이드라인 규칙 로드

2. AST 파싱
   └─ JavaASTParser로 구조 분석

3. 병렬 분석 실행
   ├─ [Thread 1] 가이드라인 검사
   │   ├─ 정적 규칙 (Regex/AST)
   │   └─ 컨텍스트 규칙 (LLM)
   │
   └─ [Thread 2] 패턴 분석
       ├─ 코드 임베딩 생성
       ├─ VectorDB 유사 패턴 검색
       └─ 안티패턴 탐지

4. 결과 통합
   ├─ 이슈 병합 및 중복 제거
   ├─ 우선순위 정렬
   │   └─ 심각도 > 카테고리 > 수정난이도 > 위치
   ├─ 카테고리별 권장사항 생성
   └─ 자동 수정안 생성 (옵션)

5. 리포트 출력
   └─ JSON 형식 최적화 리포트
```

### 5.2 가이드라인 검사 상세

**정적 규칙 검사**:
1. 각 규칙의 패턴(Regex/AST)을 코드에 적용
2. Cast Operator 등 특수 규칙은 customValidator 실행
3. 라인·컬럼 위치 정확히 기록
4. 중복 제거 (같은 라인·같은 규칙)

**컨텍스트 규칙 검사**:
1. keywords로 적용 가능 규칙 필터링
2. 3개씩 배치 처리로 LLM 호출
3. good/bad 예시 포함 프롬프트
4. JSON 응답 파싱 및 검증
5. 배치 실패 시 개별 재시도

### 5.3 패턴 분석 상세

**1단계: 임베딩 생성**
```
소스코드
  │
  ├─→ AST 파싱 → 구문 임베딩 (128차원)
  ├─→ 의미 분석 → 의미 임베딩 (256차원)
  ├─→ 어노테이션 → 프레임워크 임베딩 (64차원)
  └─→ 키워드 분석 → 비즈니스 임베딩 (32차원)
       │
       ▼
    480차원 통합 벡터 (L2 정규화)
```

**2단계: VectorDB 검색**
- 코사인 유사도 0.7 이상 패턴 검색
- 최대 limit개 반환 (기본 10)

**3단계: 패턴 분류**
- `recommended_pattern` 있음 → 안전한 패턴
- `anti_pattern` 있음 → 문제 패턴

**4단계: 이슈 탐지**
- 안티패턴의 pattern_signature로 매칭
- 카테고리별 특화 검사 (SQL Injection, N+1 쿼리 등)
- 거짓 양성 필터링

### 5.4 수정안 생성 프로세스

**Ollama 전용 개별 처리**:
1. 이슈를 우선순위 정렬
2. 각 이슈의 포함 메서드 추출
3. 메서드 단위로 LLM 수정 요청
4. 수정 검증 (시그니처 유지, 중괄호 균형)
5. 원본 코드에 메서드 교체
6. 처리된 메서드 캐시 기록

**Bedrock 일괄 처리**:
1. 모든 이슈 + VectorDB 권장사항 통합
2. 전체 코드 수정 프롬프트 생성
3. LLM 응답에서 코드 추출
4. 품질 검증 (길이, 구문, 중복 제거)

---

## 6. 설정 가이드

### 6.1 시스템 요구사항

**필수**:
- Node.js 16+
- LLM 서비스 (Ollama 또는 AWS Bedrock)
- Weaviate VectorDB

**권장**:
- 메모리: 8GB+
- Ollama GPU 지원 환경

### 6.2 초기 설정

**1. 의존성 설치**
```bash
npm install
```

**2. 환경 변수 설정**
```bash
cp .env.example .env
# .env 파일 수정
```

**3. VectorDB 스키마 초기화**
```bash
node main.js status  # 자동으로 스키마 생성
```

**4. 가이드라인 로드**
```bash
# PDF에서 추출
node main.js extract-guidelines -i dev_guide.pdf -o guidelines.json --import-to-db

# 또는 JSON 직접 import
node main.js import-guidelines -i guidelines.json
```

### 6.3 성능 최적화

**Ollama 설정**:
- `maxRequestSize`: 8000 (대용량 코드 처리)
- `timeout`: 180000 (3분, 복잡한 분석)
- `maxRetries`: 2 (안정성)

**배치 처리**:
- 가이드라인 LLM 검사: 3개씩 배치
- 패턴 검색: limit 10 이하 권장

**메모리 관리**:
- 처리된 메서드 캐시로 중복 방지
- 임베딩은 480차원으로 고정 (메모리 예측 가능)

### 6.4 문제 해결

**LLM 연결 실패**:
- config.js에서 baseUrl/region 확인
- health check 엔드포인트 테스트

**VectorDB 오류**:
- Weaviate 서비스 실행 상태 확인
- 스키마 재초기화: `initializeSchema()` 호출

**AST 파싱 실패**:
- Java 구문 오류 확인
- fallback 분석으로 자동 전환

---

## 7. 출력 리포트 구조

### 7.1 JSON 리포트 형식

```json
{
  "metadata": {
    "fileName": "Sample.java",
    "analysisDate": "2025-10-02T...",
    "codeLines": 150,
    "checkOptions": { ... }
  },
  
  "summary": {
    "overallScore": 75,
    "totalIssues": 8,
    "criticalIssues": 1,
    "highIssues": 2,
    "mediumIssues": 3,
    "lowIssues": 2
  },
  
  "topIssues": [
    {
      "title": "SQL Injection 취약점",
      "category": "security_vulnerability",
      "severity": "CRITICAL",
      "line": 45,
      "description": "...",
      "effort": 4
    }
  ],
  
  "recommendations": [
    {
      "category": "security_vulnerability",
      "priority": 90,
      "quickFixes": [ ... ],
      "longtermImprovements": [ ... ]
    }
  ]
}
```

### 7.2 리포트 해석

**우선순위 정렬 기준**:
1. CRITICAL 보안 이슈 (최우선)
2. HIGH 리소스 관리
3. MEDIUM 성능/예외처리
4. LOW 스타일/포맷팅

**effort 값**:
- 1: 간단 (공백, 포맷)
- 2: 중간 (명명 규칙)
- 3: 복잡 (구조 변경)
- 4: 매우 복잡 (설계 변경)

---

이 시스템은 정적 분석, 동적 패턴 매칭, LLM 기반 컨텍스트 이해를 결합하여 Java 코드 품질을 종합적으로 평가합니다. VectorDB 기반 학습으로 프로젝트별 패턴을 축적하며, 시간이 지날수록 정확도가 향상됩니다.