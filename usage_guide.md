# 통합 Java 코드 검사 시스템 사용 가이드

## 설치 및 초기 설정

```bash
# 의존성 설치
npm install

# 환경 설정
cp .env.example .env

# VectorDB 초기화
node -e "import('./clients/weaviateClient.js').then(({WeaviateClient}) => new WeaviateClient().initializeSchema())"
```

## 주요 명령어

### 1. 통합 코드 품질 검사 (추천)

```bash
# 기본 통합 검사 (가이드라인 + 패턴 분석)
./unified-code-analyzer check -c MyService.java

# 결과를 파일로 저장
./unified-code-analyzer check -c MyService.java -o analysis_report.json

# 수정안 자동 생성 포함
./unified-code-analyzer check -c MyService.java --generate-fixes

# 특정 검사만 실행
./unified-code-analyzer check -c MyService.java --skip-patterns  # 패턴 분석 제외
./unified-code-analyzer check -c MyService.java --skip-contextual  # LLM 맥락 검사 제외
```

### 2. 개발가이드 검사만 수행

```bash
# 정적 규칙만 검사
./unified-code-analyzer check-guidelines -c MyService.java

# LLM 맥락적 검사 포함
./unified-code-analyzer check-guidelines -c MyService.java --include-contextual
```

### 3. 패턴 분석만 수행 (기존 기능)

```bash
# 기본 패턴 분석
./unified-code-analyzer search-patterns -c MyService.java

# 수정안 제시 포함
./unified-code-analyzer search-patterns -c MyService.java --fix
```

### 4. 가이드라인 관리

```bash
# 가이드라인 텍스트 파일에서 가져오기
./unified-code-analyzer manage-guidelines --import development_guide.txt

# 저장된 가이드라인 목록 확인
./unified-code-analyzer manage-guidelines --list

# 가이드라인을 파일로 내보내기
./unified-code-analyzer manage-guidelines --export guidelines_backup.json
```

## 실행 예시

### 통합 검사 실행 예시

```bash
$ ./unified-code-analyzer check -c UserService.java --generate-fixes

=== 통합 Java 코드 품질 검사 시작 ===
대상 파일: UserService.java

검사 범위:
- 개발가이드 검사: O
- 맥락적 가이드라인: O  
- 패턴 분석: O
- 자동 수정안: O

🚀 통합 코드 품질 검사 시스템 초기화 중...
✅ 통합 시스템 초기화 완료
📊 통합 코드 분석 시작...
📋 개발가이드 규칙 검사 중...
  🤖 LLM 기반 맥락적 가이드라인 검사 시작...
    적용 가능한 맥락적 가이드라인: 2개
    맥락적 가이드라인 검사 완료: 1개 위반 발견
  📊 가이드라인 검사 결과: 3개 위반, 2개 경고
🔍 패턴 분석 검사 중...
  🔍 패턴 분석 결과: 1개 패턴 이슈 발견
🔗 검사 결과 통합 중...
✅ 통합 분석 완료 (2845ms)

=== 검사 결과 종합 ===
파일: UserService.java
전체 점수: 72/100
총 이슈: 4개

스타일 & 가이드라인 점수: 78/100
- 위반사항: 3개
- 경고사항: 2개

패턴 분석 점수: 85/100
- 발견된 이슈: 1개
- 유사 패턴: 5개

=== 주요 이슈 (우선순위 순) ===
1. 🟠 [naming_convention] LData/LMultiData 키 명명 규칙
   라인 25: DB 컬럼명이 대문자로 사용되고 있습니다
   출처: llm_contextual | 수정 난이도: 2/5

2. 🟡 [resource_management] Database Connection 누수 위험
   라인 18: Connection이 적절히 닫히지 않고 있습니다  
   출처: pattern_analysis | 수정 난이도: 3/5

3. 🔵 [formatting] 메서드명과 괄호 사이 공백 금지
   라인 12: 메서드 이름과 괄호 사이에 공백이 있습니다
   출처: development_guideline | 수정 난이도: 1/5

=== 개선 권장사항 ===
1. naming_convention (1개 이슈)
   즉시 수정 가능:
   - 라인 25: DB 컬럼명이 대문자로 사용되고 있습니다

2. resource_management (1개 이슈)  
   즉시 수정 가능:
   - 라인 18: Connection이 적절히 닫히지 않고 있습니다

결과 저장: analysis_report.json

=== 통합 검사 완료 ===
```

### 생성되는 보고서 구조

```json
{
  "overview": {
    "totalIssues": 4,
    "overallScore": 72,
    "analysisDate": "2025-01-21T10:30:00.000Z",
    "codeLength": 1250,
    "analysisTypes": ["guideline_check", "pattern_analysis"]
  },
  "styleAndGuideline": {
    "score": 78,
    "violations": [
      {
        "id": "style_naming_ldata_convention_25",
        "type": "guideline_violation",
        "severity": "MEDIUM",
        "title": "LData/LMultiData 키 명명 규칙",
        "description": "DB 컬럼명이 대문자로 사용되고 있습니다",
        "location": {"startLine": 25, "endLine": 25},
        "category": "naming_convention",
        "source": "llm_contextual",
        "fixable": true,
        "suggestion": "DB 컬럼명을 소문자로 변경하세요"
      }
    ],
    "warnings": [...],
    "categories": {...}
  },
  "patternAnalysis": {
    "score": 85,
    "detectedIssues": [...],
    "similarPatterns": [...],
    "safePracticesFound": [...],
    "patternClassification": {...}
  },
  "prioritizedIssues": [...],
  "recommendations": [...],
  "fixSuggestions": [
    {
      "issueId": "style_naming_ldata_convention_25",
      "title": "LData/LMultiData 키 명명 규칙",
      "fixType": "llm_contextual",
      "steps": ["DB 컬럼명을 소문자로 변경"],
      "fixedCode": "lMultiData.getString(\"user_id\")",
      "explanation": "개발가이드 LData/LMultiData 키 명명 규칙에 따른 수정",
      "confidence": 0.8
    }
  ]
}
```

## 고급 사용법

### 1. 대용량 프로젝트 검사

```bash
# 디렉토리 내 모든 Java 파일 검사
find src/ -name "*.java" -exec ./unified-code-analyzer check -c {} \;

# 배치 스크립트 활용
cat java_files.txt | xargs -I {} ./unified-code-analyzer check -c {}
```

### 2. CI/CD 파이프라인 통합

```yaml
# .github/workflows/code-quality.yml
- name: Java Code Quality Check
  run: |
    ./unified-code-analyzer check -c src/main/java/MyService.java -o quality_report.json
    if [ $(jq '.overview.overallScore' quality_report.json) -lt 70 ]; then
      echo "Code quality below threshold"
      exit 1
    fi
```

### 3. 커스텀 가이드라인 추가

```javascript
// custom_guidelines.json
[
  {
    "ruleId": "custom.logging.001",
    "title": "로깅 레벨 적절성",
    "category": "logging",
    "checkType": "llm_contextual",
    "description": "DEBUG, INFO, WARN, ERROR 로깅 레벨을 상황에 맞게 사용해야 합니다.",
    "severity": "MEDIUM",
    "keywords": ["logger", "log", "debug", "info", "warn", "error"],
    "examples": {
      "good": ["logger.info(\"User login successful\")", "logger.error(\"Database connection failed\", e)"],
      "bad": ["logger.debug(\"Critical system failure\")", "logger.error(\"User clicked button\")"]
    }
  }
]
```

```bash
# 커스텀 가이드라인 적용
./unified-code-analyzer manage-guidelines --import custom_guidelines.json
```

## 성능 최적화 팁

1. **선택적 검사**: 대용량 파일의 경우 `--skip-contextual`로 LLM 검사 생략
2. **배치 처리**: 여러 파일은 배치로 처리하여 초기화 시간 단축  
3. **캐싱 활용**: 동일한 패턴에 대한 LLM 결과는 자동으로 캐싱됨
4. **필터링**: `--limit` 옵션으로 패턴 검색 결과 수 제한

## 문제 해결

### 일반적인 오류 및 해결방법

1. **LLM 연결 실패**
   ```bash
   # Ollama 서비스 상태 확인
   curl http://localhost:11434/api/tags
   
   # AWS Bedrock 자격증명 확인  
   aws sts get-caller-identity
   ```

2. **VectorDB 연결 실패**
   ```bash
   # Weaviate 서비스 확인
   curl http://localhost:8080/v1/meta
   ```

3. **메모리 부족 오류**
   ```bash
   # Node.js 메모리 제한 증가
   node --max-old-space-size=4096 unified-code-analyzer check -c large_file.java
   ```

## 추가 리소스

- [개발가이드 작성 가이드](./docs/guideline-authoring.md)
- [커스텀 패턴 추가 방법](./docs/custom-patterns.md)  
- [API 참조 문서](./docs/api-reference.md)
- [아키텍처 문서](./docs/architecture.md)