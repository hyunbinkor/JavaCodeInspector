/**
 * 통합 Java 코드 품질 검사 시스템 (UnifiedJavaCodeChecker)
 * 
 * Layer3 통합 컴포넌트 - 모든 검사 결과를 하나의 리포트로 통합
 * 
 * 3-Layer 아키텍처:
 * 
 * Layer 1 - 개발가이드 검사 (DevelopmentGuidelineChecker):
 *   - VectorDB에서 가이드라인 규칙 로드
 *   - 정적 규칙 검사 (정규식, AST 기반)
 *   - 컨텍스트 규칙 검사 (vLLM 기반)
 *   - 카테고리별 위반사항 그룹핑
 *   - 스타일 점수 계산 (0-100)
 * 
 * Layer 2 - VectorDB 패턴 분석 (issueCodeAnalyzer):
 *   - CodeEmbeddingGenerator로 코드 벡터화 (480차원)
 *   - VectorClient로 유사 패턴 검색 (유사도 0.7+)
 *   - DynamicSafePatternAnalyzer로 안전/위험 패턴 분류
 *   - 카테고리별 특화 검사:
 *     * resource_management: 리소스 누수 탐지
 *     * security_vulnerability: SQL Injection 등
 *     * performance_issue: N+1 쿼리 문제
 *     * exception_handling: 부적절한 예외 처리
 *   - 거짓 양성 필터링 (주석, 선언문 제외)
 *   - 패턴 품질 점수 계산 (0-100)
 * 
 * Layer 3 - 결과 통합 및 리포트 (이 클래스):
 *   - 가이드라인 + 패턴 결과 병합
 *   - 우선순위 정렬:
 *     * 심각도: CRITICAL > HIGH > MEDIUM > LOW
 *     * 카테고리: security > resource > performance
 *   - 통합 점수 계산 (가중 평균)
 *   - 수정 권장사항 생성
 *   - (옵션) 자동 수정안 생성
 * 
 * 분석 옵션:
 * - skipGuidelines: 가이드라인 검사 생략
 * - skipPatterns: 패턴 분석 생략
 * - patternLimit: 검색할 유사 패턴 수 (기본: 10)
 * - generateRecommendations: 권장사항 생성 (기본: true)
 * - generateFixes: 자동 수정안 생성 (기본: false)
 * 
 * 통합 리포트 구조:
 * {
 *   "overview": {
 *     "totalIssues": 15,
 *     "criticalCount": 2,
 *     "overallScore": 75.5,
 *     "analysisDate": "2025-10-23T..."
 *   },
 *   "issues": [
 *     {
 *       "id": "issue_001",
 *       "source": "guideline" | "pattern",
 *       "title": "SQL Injection 취약점",
 *       "severity": "CRITICAL",
 *       "category": "security_vulnerability",
 *       "location": { "startLine": 42, "endLine": 45 },
 *       "description": "...",
 *       "recommendation": "PreparedStatement 사용",
 *       "codeSnippet": "...",
 *       "fixable": true
 *     }
 *   ],
 *   "recommendations": {
 *     "immediate": [...],  // CRITICAL/HIGH 이슈
 *     "planned": [...],    // MEDIUM 이슈
 *     "optional": [...]    // LOW 이슈
 *   },
 *   "scores": {
 *     "styleScore": 85,
 *     "patternScore": 70,
 *     "overallScore": 77.5
 *   }
 * }
 * 
 * 호출 체인:
 * 1. analyzeCode() → 메인 엔트리포인트
 * 2. performGuidelineCheck() → DevelopmentGuidelineChecker.checkRules()
 * 3. performPatternAnalysis():
 *    a. PatternDatasetGenerator.generateEmbeddings()
 *    b. VectorClient.searchSimilarPatterns()
 *    c. issueCodeAnalyzer.analyzeCodeIssues()
 * 4. unifyResults() → 결과 병합 및 우선순위 정렬
 * 5. (옵션) generateFixSuggestions() → 자동 수정안 생성
 * 
 * @module UnifiedJavaCodeChecker
 * @requires JavaASTParser - Java AST 파싱
 * @requires LLMService - vLLM 기반 분석
 * @requires issueCodeAnalyzer - 패턴 기반 이슈 분석
 * @requires VectorClient - VectorDB 연동
 * @requires PatternDatasetGenerator - 임베딩 생성
 * @requires DevelopmentGuidelineChecker - 가이드라인 검증
 * 
 * # TODO: Node.js → Python 변환 (FastAPI + Pydantic)
 * # TODO: 병렬 실행 Promise.all → asyncio.gather
 * # TODO: 리포트 생성 → Jinja2 템플릿
 * # NOTE: 금융권 보안: 민감 정보 마스킹 필요
 * # PERFORMANCE: 가이드라인 + 패턴 검사 병렬 실행 (현재 구현됨)
 * # PERFORMANCE: 결과 캐싱 (동일 코드 재분석 시)
 */
import { JavaASTParser } from '../ast/javaAstParser.js';
import { LLMService } from '../clients/llmService.js';
import { issueCodeAnalyzer } from './issueCodeAnalyzer.js';
import { VectorClient } from '../clients/vectorClient.js';
import { PatternDatasetGenerator } from './patternGenerator.js';
import { DevelopmentGuidelineChecker } from './guidelineChecker.js';
import { config } from '../config.js';

/**
 * 통합 Java 코드 품질 검사 클래스 (Layer3 Component)
 * 
 * Java 코드 품질 검사 통합 시스템
 * 
 * 내부 구조:
 * - astParser: JavaASTParser - AST 파싱
 * - llmService: LLMService - vLLM 연동
 * - vectorClient: VectorClient - VectorDB 연동
 * - issueCodeAnalyzer: issueCodeAnalyzer - 패턴 분석
 * - guidelineChecker: DevelopmentGuidelineChecker - 가이드라인 검증
 * 
 * 생명주기:
 * 1. new UnifiedJavaCodeChecker()
 * 2. await initialize() - 모든 컴포넌트 초기화
 * 3. await analyzeCode(sourceCode, options) - 코드 분석 (반복 호출 가능)
 * 
 * 3계층 분석 아키텍처:
 * - Layer 1: 개발가이드 검사
 *   - DevelopmentGuidelineChecker로 컨텍스트 기반 규칙 검증 (LLM 활용)
 * 
 * - Layer 2: VectorDB 패턴 분석
 *   - PatternDatasetGenerator로 코드 임베딩 생성
 *   - VectorClient로 유사 코드 패턴 검색 (임베딩 유사도 0.7 이상)
 *   - issueCodeAnalyzer로 안티패턴 분류 및 이슈 탐지
 * 
 * - Layer 3: 결과 통합
 *   - 심각도(CRITICAL > HIGH > MEDIUM > LOW) 기준 정렬
 *   - 카테고리별(보안 > 리소스 > 성능 순) 우선순위 결정
 *   - 수정 난이도(effort) 고려한 실행 가능한 권장사항 생성
 * 
 * @class
 * 
 * # TODO: Python 클래스 변환 시 async with 컨텍스트 매니저
 * # PERFORMANCE: 컴포넌트 초기화 결과 캐싱
 */
export class UnifiedJavaCodeChecker {
  /**
   * 생성자: 모든 분석 컴포넌트 초기화
   * 
   * 초기화 항목:
   * 1. JavaASTParser 인스턴스 생성 - Java 소스코드 구문 트리 변환
   * 2. LLMService 인스턴스 생성 - 컨텍스트 기반 코드 분석
   * 3. VectorClient 인스턴스 생성 - 코드 패턴 유사도 검색
   * 4. issueCodeAnalyzer 인스턴스 생성 - 안티패턴 탐지 및 분류
   * 5. DevelopmentGuidelineChecker 인스턴스 생성 - LLM 기반 컨텍스트 분석
   * 
   * @constructor
   * 
   * # NOTE: 실제 초기화는 initialize() 호출 시 수행
   */
  constructor() {
    // AST 파서 초기화 - Java 소스코드를 구문 트리로 변환
    this.astParser = new JavaASTParser();
    
    // LLM 서비스 초기화 - 컨텍스트 기반 코드 분석에 사용
    this.llmService = new LLMService();
    
    // VectorDB 클라이언트 초기화 - 코드 패턴 유사도 검색
    this.vectorClient = new VectorClient();
    
    // 패턴 기반 이슈 분석기 - 안티패턴 탐지 및 분류
    this.issueCodeAnalyzer = new issueCodeAnalyzer();
    
    // 개발가이드 규칙 검사기 - LLM 기반 컨텍스트 분석
    this.guidelineChecker = new DevelopmentGuidelineChecker();
  }

  /**
   * 통합 시스템 초기화 프로세스
   * 
   * 내부 흐름:
   * 1. LLMService.checkConnection() → vLLM 서비스 health check
   * 2. issueCodeAnalyzer.initialize():
   *    - DynamicSafePatternAnalyzer 초기화
   *    - VectorDB에서 패턴 로드 및 분류
   * 3. guidelineChecker.initialize():
   *    - VectorDB에서 가이드라인 규칙 로드
   *    - 정적/컨텍스트 규칙 분류
   * 
   * @async
   * @returns {Promise<void>}
   * @throws {Error} LLM 서비스 연결 실패 시
   * 
   * @example
   * const checker = new UnifiedJavaCodeChecker();
   * await checker.initialize();
   * 
   * # TODO: Python 변환 시 async def __aenter__ 구현
   * # PERFORMANCE: 초기화 시간 측정 및 로깅
   */
  async initialize() {
    console.log('🚀 통합 코드 품질 검사 시스템 초기화 중...');

    // LLM API 연결 상태 확인 - 실패 시 에러 throw
    const isConnected = await this.llmService.checkConnection();
    if (!isConnected) {
      throw new Error('LLM 서비스 연결 실패');
    }

    // 각 분석 컴포넌트 초기화 (규칙 로드, DB 연결 등)
    await this.issueCodeAnalyzer.initialize();
    await this.guidelineChecker.initialize();

    console.log('✅ 통합 시스템 초기화 완료');
  }

  /**
   * 코드 분석 메인 프로세스
   * 
   * 실행 흐름:
   * 1. AST 파싱으로 코드 구조 분석
   * 2. 병렬 실행: 가이드라인 검사 + 패턴 분석 (options 설정에 따라)
   * 3. 두 결과를 통합하여 우선순위별로 정렬된 통합 리포트 생성
   * 4. 선택적으로 수정 권장사항 및 자동 수정안 생성
   * 
   * @param {string} sourceCode - 분석할 Java 소스코드
   * @param {object} options - 분석 옵션
   *   - skipGuidelines: 가이드라인 검사 생략 여부
   *   - skipPatterns: 패턴 분석 생략 여부
   *   - patternLimit: 검색할 유사 패턴 최대 개수 (기본값: 10)
   *   - generateRecommendations: 권장사항 생성 여부 (기본값: true)
   *   - generateFixes: 자동 수정안 생성 여부 (기본값: false)
   * @returns {object} 통합 분석 리포트
   */
  async analyzeCode(sourceCode, options = {}) {
    const startTime = Date.now();
    console.log('📊 통합 코드 분석 시작...');

    // Java 코드를 AST로 파싱 - 클래스, 메서드, 변수 등 구조 정보 추출
    const astAnalysis = this.astParser.parseJavaCode(sourceCode);
    const tasks = [];

    // 옵션에 따라 실행할 분석 작업 구성 (병렬 실행 준비)
    if (!options.skipGuidelines) {
      tasks.push(this.performGuidelineCheck(sourceCode, astAnalysis, options));
    }

    if (!options.skipPatterns) {
      tasks.push(this.performPatternAnalysis(sourceCode, astAnalysis, options));
    }

    // 기본값 설정 - 분석 실패 시에도 안전하게 처리하기 위한 초기 구조
    let guidelineResults = {
      violations: [],
      warnings: [],
      suggestions: [],
      styleScore: 100,
      categories: {}
    };
    let patternResults = {
      detectedIssues: [],
      similarPatterns: [],
      patternScore: 100
    };

    try {
      // 병렬 실행된 분석 작업들의 결과 수집
      const results = await Promise.all(tasks);
      let resultIndex = 0;

      // 가이드라인 검사 결과 추출 (실행된 경우)
      if (!options.skipGuidelines) {
        const guideline = results[resultIndex];
        if (guideline && typeof guideline === 'object') {
          guidelineResults = {
            violations: guideline.violations || [],
            warnings: guideline.warnings || [],
            suggestions: guideline.suggestions || [],
            styleScore: guideline.styleScore || 100,
            categories: guideline.categories || {}
          };
        }
        resultIndex++;
      }

      // 패턴 분석 결과 추출 (실행된 경우)
      if (!options.skipPatterns) {
        const pattern = results[resultIndex];
        if (pattern && typeof pattern === 'object') {
          patternResults = {
            detectedIssues: pattern.detectedIssues || [],
            similarPatterns: pattern.similarPatterns || [],
            patternScore: pattern.patternScore || 100,
            safePracticesFound: pattern.safePracticesFound || [],
            patternClassification: pattern.patternClassification || { safePatterns: [], antiPatterns: [] }
          };
        }
      }
    } catch (error) {
      // 개별 검사 실패 시에도 다른 검사 결과는 유지 (부분 성공 허용)
      console.error('검사 실행 중 오류:', error.message);
    }

    // 가이드라인 + 패턴 결과를 하나의 통합 리포트로 병합
    // 우선순위 정렬, 점수 계산, 권장사항 생성 수행
    const unifiedResults = await this.unifyResults(
      guidelineResults,
      patternResults,
      sourceCode,
      options
    );

    const duration = Date.now() - startTime;
    console.log(`✅ 통합 분석 완료 (${duration}ms)`);

    return unifiedResults;
  }

  /**
   * 개발가이드 규칙 검사 수행
   * 
   * DevelopmentGuidelineChecker를 사용한 컨텍스트 기반 검사:
   * - 비즈니스 로직, 아키텍처 패턴 등 복잡한 규칙 검증
   * - AST 정보와 함께 코드 의미 분석
   * 
   * 결과를 카테고리별로 그룹핑하고 스타일 점수 계산
   * 
   * @returns {object} 가이드라인 검사 결과
   *   - violations: 반드시 수정해야 할 위반사항
   *   - warnings: 개선 권장사항
   *   - suggestions: 선택적 개선사항
   *   - styleScore: 0-100점 스타일 점수
   *   - categories: 카테고리별 그룹핑된 이슈
   */
  async performGuidelineCheck(sourceCode, astAnalysis, options = {}) {
    console.log('📋 개발가이드 규칙 검사 중...');

    const results = {
      violations: [],
      warnings: [],
      suggestions: [],
      styleScore: 0,
      categories: {}
    };

    // 컨텍스트 기반 가이드라인 검사 (LLM 활용)
    const guidelineViolations = await this.guidelineChecker.checkRules(
      sourceCode,
      astAnalysis,
      options
    );

    // 검사 결과 병합
    results.violations.push(...guidelineViolations);
    
    // 카테고리별 그룹핑 (예: naming_convention, formatting 등)
    results.categories = this.groupByCategory([...results.violations, ...results.warnings]);
    
    // 위반사항과 경고 개수 기반 점수 계산
    results.styleScore = this.calculateStyleScore(results);

    console.log(`  📊 가이드라인 검사 결과: ${results.violations.length}개 위반, ${results.warnings.length}개 경고`);
    return results;
  }

  /**
   * VectorDB 기반 패턴 분석 수행
   * 
   * 실행 단계:
   * 1. 코드 임베딩 생성 (PatternDatasetGenerator)
   *    - 코드를 벡터 공간에 매핑 (의미적 유사도 측정 가능)
   * 
   * 2. 유사 패턴 검색 (VectorClient)
   *    - 임베딩 유사도 0.7 이상인 패턴 검색
   *    - 기존에 분석된 코드 패턴 DB에서 검색
   * 
   * 3. 안티패턴 탐지 (issueCodeAnalyzer)
   *    - 유사 패턴과 비교하여 문제점 분류
   *    - 보안 취약점, 리소스 누수, 성능 이슈 등 탐지
   * 
   * @returns {object} 패턴 분석 결과
   *   - detectedIssues: 탐지된 안티패턴 이슈
   *   - similarPatterns: 유사한 코드 패턴 (최대 patternLimit개)
   *   - patternScore: 0-100점 패턴 품질 점수
   *   - safePracticesFound: 발견된 좋은 패턴
   *   - patternClassification: 안전/위험 패턴 분류
   */
  async performPatternAnalysis(sourceCode, astAnalysis, options = {}) {
    console.log('🔍 패턴 분석 검사 중...');

    try {
      // Step 1: 패턴 데이터셋 생성기 초기화 및 임베딩 생성
      const generator = new PatternDatasetGenerator();
      await generator.initialize();

      // 코드를 벡터로 변환 (의미적 유사도 계산 가능한 형태)
      const embeddings = await generator.generateEmbeddings(sourceCode, {});
      
      // Step 2: VectorDB에서 유사 패턴 검색
      // - combined_embedding: 코드 전체의 통합 벡터 표현
      // - patternLimit: 검색할 최대 패턴 수 (기본값 10)
      // - 0.7: 최소 유사도 임계값 (코사인 유사도)
      const similarPatterns = await this.vectorClient.searchSimilarPatterns(
        embeddings.combined_embedding,
        options.patternLimit || 10,
        0.7
      );

      // 유사 패턴이 없으면 분석 종료 (비교 대상 없음)
      if (similarPatterns.length === 0) {
        console.log('  📄 유사 패턴을 찾을 수 없음');
        return {
          detectedIssues: [],
          similarPatterns: [],
          patternScore: 100
        };
      }

      // Step 3: 유사 패턴과 비교하여 안티패턴 탐지
      // - 리소스 누수, 보안 취약점, 성능 문제 등 분류
      const analysisResults = await this.issueCodeAnalyzer.analyzeCodeIssues(sourceCode, similarPatterns);

      console.log(`  🔎 패턴 분석 결과: ${analysisResults.detectedIssues.length}개 패턴 이슈 발견`);
      return {
        detectedIssues: analysisResults.detectedIssues,
        similarPatterns: similarPatterns,
        patternScore: this.calculatePatternScore(analysisResults.detectedIssues),
        safePracticesFound: analysisResults.safePracticesFound,
        patternClassification: analysisResults.patternClassification
      };
    } catch (error) {
      // 패턴 분석 실패 시에도 가이드라인 검사 결과는 유지
      console.warn('패턴 분석 실패:', error.message);
      return {
        detectedIssues: [],
        similarPatterns: [],
        patternScore: 100
      };
    }
  }

  /**
   * 가이드라인 검사와 패턴 분석 결과를 통합 리포트로 병합
   * 
   * 통합 프로세스:
   * 1. 입력 검증 및 정규화
   *    - 각 결과가 유효한 객체인지 확인
   *    - 배열 필드들이 실제 배열인지 검증
   * 
   * 2. 통합 리포트 구조 생성
   *    - overview: 전체 요약 정보 (총 이슈 수, 점수, 분석 날짜 등)
   *    - styleAndGuideline: 가이드라인 검사 상세 결과
   *    - patternAnalysis: 패턴 분석 상세 결과
   * 
   * 3. 이슈 우선순위 결정
   *    - 심각도 > 카테고리 > 수정 난이도 순으로 정렬
   *    - CRITICAL 이슈를 최우선으로 배치
   * 
   * 4. 통합 점수 계산
   *    - 스타일 점수 + 패턴 점수 평균
   *    - CRITICAL 이슈마다 -10점 페널티
   * 
   * 5. 실행 가능한 권장사항 생성 (옵션)
   *    - 카테고리별 개선 방향 제시
   *    - 빠른 수정(quick fixes)과 장기 개선 분리
   * 
   * 6. 자동 수정안 생성 (옵션)
   *    - 수정 가능한 이슈에 대한 코드 변경 제안
   *    - 난이도 3 이하의 이슈만 자동 수정 대상
   * 
   * @returns {object} 통합 분석 리포트
   */
  async unifyResults(guidelineResults, patternResults, sourceCode, options) {
    console.log('🔗 검사 결과 통합 중...');

    try {
      // Step 1: 입력 검증 - null/undefined 방어 및 기본값 설정
      if (!guidelineResults || typeof guidelineResults !== 'object') {
        console.warn('⚠️ 가이드라인 결과가 유효하지 않음');
        guidelineResults = {
          violations: [],
          warnings: [],
          suggestions: [],
          styleScore: 100,
          categories: {}
        };
      }

      if (!patternResults || typeof patternResults !== 'object') {
        console.warn('⚠️ 패턴 결과가 유효하지 않음');
        patternResults = {
          detectedIssues: [],
          similarPatterns: [],
          patternScore: 100
        };
      }

      // 배열 필드 정규화 - 배열이 아닌 경우 빈 배열로 초기화
      guidelineResults.violations = Array.isArray(guidelineResults.violations) ? guidelineResults.violations : [];
      guidelineResults.warnings = Array.isArray(guidelineResults.warnings) ? guidelineResults.warnings : [];
      guidelineResults.categories = guidelineResults.categories || {};

      patternResults.detectedIssues = Array.isArray(patternResults.detectedIssues) ? patternResults.detectedIssues : [];
      patternResults.similarPatterns = Array.isArray(patternResults.similarPatterns) ? patternResults.similarPatterns : [];

      console.log(`  가이드라인 위반: ${guidelineResults.violations.length}개`);
      console.log(`  가이드라인 경고: ${guidelineResults.warnings.length}개`);
      console.log(`  패턴 이슈: ${patternResults.detectedIssues.length}개`);

      // Step 2: 통합 리포트 기본 구조 생성
      const unifiedReport = {
        overview: {
          totalIssues: 0,
          overallScore: 0,
          analysisDate: new Date().toISOString(),
          codeLength: sourceCode.length,
          analysisTypes: []  // 실행된 분석 타입 기록
        },
        styleAndGuideline: null,
        patternAnalysis: null,
        prioritizedIssues: [],
        recommendations: [],
        fixSuggestions: []
      };

      // Step 3: 가이드라인 검사 결과 추가 (실행된 경우)
      if (!options.skipGuidelines) {
        unifiedReport.overview.analysisTypes.push('guideline_check');
        unifiedReport.styleAndGuideline = {
          score: guidelineResults.styleScore || 100,
          violations: guidelineResults.violations || [],
          warnings: guidelineResults.warnings || [],
          suggestions: guidelineResults.suggestions || [],
          categories: guidelineResults.categories || {}
        };
      }

      // Step 4: 패턴 분석 결과 추가 (실행된 경우)
      if (!options.skipPatterns) {
        unifiedReport.overview.analysisTypes.push('pattern_analysis');
        unifiedReport.patternAnalysis = {
          score: patternResults.patternScore || 100,
          detectedIssues: patternResults.detectedIssues || [],
          // 유사 패턴은 상위 5개만 포함 (리포트 크기 최적화)
          similarPatterns: (patternResults.similarPatterns || []).slice(0, 5),
          safePracticesFound: patternResults.safePracticesFound || [],
          patternClassification: patternResults.patternClassification || { safePatterns: [], antiPatterns: [] }
        };
      }

      // Step 5: 모든 이슈를 우선순위에 따라 정렬
      // - 심각도(CRITICAL > HIGH > MEDIUM > LOW)
      // - 카테고리(보안 > 리소스 > 성능 순)
      // - 수정 난이도(낮을수록 우선)
      unifiedReport.prioritizedIssues = this.prioritizeAllIssues(
        guidelineResults,
        patternResults
      );

      // Step 6: 통합 점수 계산
      // - 스타일 점수와 패턴 점수의 평균
      // - CRITICAL 이슈마다 -10점 페널티 적용
      unifiedReport.overview.overallScore = this.calculateOverallScore(
        guidelineResults.styleScore || 100,
        patternResults.patternScore || 100,
        unifiedReport.prioritizedIssues
      );

      unifiedReport.overview.totalIssues = unifiedReport.prioritizedIssues.length;

      // Step 7: 실행 가능한 개선 권장사항 생성 (옵션)
      // - 카테고리별 우선순위와 구체적 액션 아이템 제공
      if (options.generateRecommendations !== false) {
        unifiedReport.recommendations = await this.generateUnifiedRecommendations(
          unifiedReport.prioritizedIssues,
          sourceCode
        );
      }

      // Step 8: 자동 수정안 생성 (옵션, 명시적 요청 시만)
      // - 수정 가능한 이슈에 대한 코드 변경 제안
      // - 난이도 3 이하의 이슈만 대상 (최대 10개)
      if (options.generateFixes) {
        unifiedReport.fixSuggestions = await this.generateUnifiedFixes(
          unifiedReport.prioritizedIssues,
          sourceCode
        );
      }

      return unifiedReport;

    } catch (error) {
      // 통합 프로세스 실패 시 기본 구조만 반환 (에러 정보 포함)
      console.error('❌ unifyResults 실행 중 오류:', error.message);

      return {
        overview: {
          totalIssues: 0,
          overallScore: 0,
          analysisDate: new Date().toISOString(),
          codeLength: sourceCode.length,
          analysisTypes: [],
          error: error.message
        },
        styleAndGuideline: null,
        patternAnalysis: null,
        prioritizedIssues: [],
        recommendations: [],
        fixSuggestions: []
      };
    }
  }

  /**
   * 가이드라인 위반과 패턴 이슈를 통합하여 우선순위별로 정렬
   * 
   * 통합 프로세스:
   * 1. 가이드라인 위반사항 변환
   *    - 각 violation을 표준화된 이슈 포맷으로 변환
   *    - 위치 정보, 심각도, 카테고리 등 메타데이터 추가
   *    - 수정 난이도 추정 (카테고리 기반)
   * 
   * 2. 패턴 분석 이슈 변환
   *    - detectedIssues를 표준 포맷으로 변환
   *    - 패턴 정보(유사 코드, 발생 빈도 등) 포함
   * 
   * 3. 우선순위 정렬
   *    - 1순위: 심각도 (CRITICAL > HIGH > MEDIUM > LOW)
   *    - 2순위: 카테고리 (보안 > 리소스 > 성능 순)
   *    - 3순위: 수정 난이도 (낮을수록 우선)
   *    - 4순위: 위치 (파일 상단 이슈 우선)
   * 
   * @returns {array} 우선순위별로 정렬된 통합 이슈 목록
   */
  prioritizeAllIssues(guidelineResults, patternResults) {
    const allIssues = [];

    // 입력 검증 - null/undefined 방어
    if (!guidelineResults || !guidelineResults.violations) {
      guidelineResults = { violations: [], warnings: [] };
    }

    if (!patternResults || !patternResults.detectedIssues) {
      patternResults = { detectedIssues: [] };
    }

    try {
      // Step 1: 가이드라인 위반사항을 표준 이슈 포맷으로 변환
      (guidelineResults.violations || []).forEach((violation) => {
        allIssues.push({
          id: `style_${violation.ruleId}_${violation.line}`,  // 고유 식별자 생성
          type: 'guideline_violation',
          severity: violation.severity || 'MEDIUM',
          title: violation.title,
          description: violation.message,
          location: {
            startLine: violation.line,
            endLine: violation.line,
            column: violation.column || 0
          },
          category: violation.category || 'code_style',
          source: violation.source || 'development_guideline',
          fixable: violation.fixable || false,
          effort: this.estimateFixEffort(violation),  // 카테고리 기반 난이도 추정
          suggestion: violation.suggestion
        });
      });
    } catch (error) {
      console.error('violations 처리 실패:', error.message);
    }

    try {
      // Step 2: 패턴 분석 이슈를 표준 포맷으로 변환
      (patternResults.detectedIssues || []).forEach((issue) => {
        allIssues.push({
          id: `pattern_${issue.id || Math.random().toString(36).slice(2)}`,
          type: 'pattern_violation',
          severity: issue.severity,
          title: issue.title,
          description: issue.description,
          location: issue.location,
          category: issue.category,
          source: 'pattern_analysis',
          patternInfo: issue.patternInfo,  // 유사 패턴 정보 포함
          fixable: true,  // 패턴 이슈는 일반적으로 수정 가능
          effort: this.estimatePatternFixEffort(issue)
        });
      });
    } catch (error) {
      console.error('detectedIssues 처리 실패:', error.message);
    }

    // Step 3: 다층 정렬 알고리즘 적용
    return this.sortByUnifiedPriority(allIssues);
  }

  /**
   * 통합 우선순위 정렬 알고리즘
   * 
   * 4단계 정렬 기준:
   * 1. 심각도 가중치 (CRITICAL=100 > HIGH=75 > MEDIUM=50 > LOW=25)
   * 2. 카테고리 가중치 (보안=90 > 리소스=80 > 성능=70 > ... > 포맷=20)
   * 3. 수정 난이도 (effort 낮을수록 우선)
   * 4. 코드 위치 (파일 상단 이슈 우선)
   * 
   * 정렬 원칙:
   * - CRITICAL 보안 이슈가 최우선
   * - 같은 심각도면 중요 카테고리 우선
   * - 심각도와 카테고리가 같으면 쉬운 것부터 수정
   * - 모든 조건이 같으면 파일 상단부터 처리
   */
  sortByUnifiedPriority(issues) {
    // 심각도별 가중치 맵 - 숫자가 클수록 우선순위 높음
    const severityWeight = { 'CRITICAL': 100, 'HIGH': 75, 'MEDIUM': 50, 'LOW': 25 };
    
    // 카테고리별 가중치 맵 - 보안/리소스가 최우선
    const categoryWeight = {
      'security_vulnerability': 90,
      'resource_management': 80,
      'performance_issue': 70,
      'exception_handling': 60,
      'naming_convention': 50,
      'architecture': 40,
      'code_style': 30,
      'formatting': 20
    };

    return issues.sort((a, b) => {
      // 1순위: 심각도 비교 (높을수록 우선)
      const severityDiff = (severityWeight[b.severity] || 0) - (severityWeight[a.severity] || 0);
      if (severityDiff !== 0) return severityDiff;

      // 2순위: 카테고리 비교 (보안 > 리소스 > 성능 순)
      const categoryDiff = (categoryWeight[b.category] || 40) - (categoryWeight[a.category] || 40);
      if (categoryDiff !== 0) return categoryDiff;

      // 3순위: 수정 난이도 비교 (낮을수록 우선 - 빠른 승리)
      const effortDiff = a.effort - b.effort;
      if (effortDiff !== 0) return effortDiff;

      // 4순위: 코드 위치 비교 (파일 상단 우선)
      return a.location.startLine - b.location.startLine;
    });
  }

  /**
   * 카테고리별 실행 가능한 개선 권장사항 생성
   * 
   * 생성 프로세스:
   * 1. 카테고리별 이슈 그룹핑
   *    - 보안, 리소스, 성능 등으로 분류
   * 
   * 2. 각 카테고리별 권장사항 구성
   *    - 이슈 개수와 우선순위 계산
   *    - 빠른 수정 가능 항목 추출 (fixable + effort ≤ 3)
   *    - 장기 개선 필요 항목 추출 (effort > 3)
   * 
   * 3. 실행 계획 생성
   *    - quickFixes: 즉시 수정 가능한 상위 3개 이슈
   *    - longtermImprovements: 체계적 개선이 필요한 복합 이슈
   * 
   * 4. 우선순위 정렬
   *    - 카테고리 중요도에 따라 정렬 (보안 최우선)
   * 
   * @returns {array} 카테고리별 권장사항 목록
   */
  async generateUnifiedRecommendations(prioritizedIssues, sourceCode) {
    const recommendations = [];
    
    // Step 1: 이슈를 카테고리별로 그룹핑
    const issuesByCategory = this.groupIssuesByCategory(prioritizedIssues);

    // Step 2: 각 카테고리별로 권장사항 생성
    for (const [category, issues] of Object.entries(issuesByCategory)) {
      const categoryRecommendation = {
        category: category,
        issueCount: issues.length,
        priority: this.getCategoryPriority(category),  // 카테고리 중요도
        recommendations: [],
        quickFixes: [],  // 즉시 수정 가능
        longtermImprovements: []  // 장기 개선 필요
      };

      // Step 3: 빠른 수정 항목 추출 (수정 가능 + 난이도 낮음)
      const fixableIssues = issues.filter(issue => issue.fixable);
      if (fixableIssues.length > 0) {
        // 상위 3개만 추출 (실행 가능성 중시)
        categoryRecommendation.quickFixes = fixableIssues.slice(0, 3).map(issue => ({
          title: issue.title,
          description: `라인 ${issue.location.startLine}: ${issue.description}`,
          effort: issue.effort,
          suggestion: issue.suggestion
        }));
      }

      // Step 4: 장기 개선 항목 추출 (복잡한 이슈)
      const complexIssues = issues.filter(issue => issue.effort > 3);
      if (complexIssues.length > 0) {
        categoryRecommendation.longtermImprovements = [
          `${category} 관련 ${complexIssues.length}개 복합 이슈 체계적 개선 필요`
        ];
      }

      recommendations.push(categoryRecommendation);
    }

    // Step 5: 카테고리 우선순위에 따라 정렬 (보안 > 리소스 > 성능 순)
    return recommendations.sort((a, b) => b.priority - a.priority);
  }

  /**
   * 수정 가능한 이슈에 대한 자동 수정안 생성
   * 
   * 생성 프로세스:
   * 1. 수정 대상 이슈 필터링
   *    - fixable = true (수정 가능)
   *    - effort ≤ 3 (난이도 3 이하)
   *    - 최대 10개까지만 처리 (성능 고려)
   * 
   * 2. 이슈 소스별 수정안 생성
   *    - development_guideline: 정적 규칙 기반 수정
   *    - pattern_analysis: LLM 기반 패턴 개선 수정
   * 
   * 3. 수정안 구조화
   *    - steps: 수정 단계별 설명
   *    - fixedCode: 수정된 코드
   *    - explanation: 수정 이유 및 효과
   *    - confidence: 수정안 신뢰도 (0-1)
   * 
   * @returns {array} 자동 수정안 목록
   */
  async generateUnifiedFixes(prioritizedIssues, sourceCode) {
    const fixes = [];

    // Step 1: 수정 가능한 이슈만 필터링
    // - fixable = true (수정 가능 플래그)
    // - effort ≤ 3 (간단한 수정만 자동화)
    // - 최대 10개까지 (성능 및 사용자 경험 고려)
    const fixableIssues = prioritizedIssues
      .filter(issue => issue.fixable && issue.effort <= 3)
      .slice(0, 10);

    // Step 2: 각 이슈별로 수정안 생성
    for (const issue of fixableIssues) {
      try {
        let fixSuggestion;

        // 이슈 소스에 따라 적절한 수정 전략 선택
        if (issue.source === 'development_guideline' || issue.source === 'llm_contextual') {
          // 가이드라인 기반: 정적 규칙 적용 (간단한 패턴 매칭)
          fixSuggestion = await this.generateGuidelineFix(issue, sourceCode);
        } 
        else if (issue.source === 'pattern_analysis') {
          // 패턴 분석 기반: LLM 활용한 컨텍스트 기반 수정
          fixSuggestion = await this.issueCodeAnalyzer.generateFixSuggestion(issue, sourceCode);
        }

        // Step 3: 수정안이 생성되면 결과 목록에 추가
        if (fixSuggestion) {
          fixes.push({
            issueId: issue.id,
            title: issue.title,
            fixType: issue.source,
            ...fixSuggestion
          });
        }
      } catch (error) {
        // 개별 수정안 생성 실패는 로그만 남기고 계속 진행
        console.warn(`수정안 생성 실패 (${issue.id}): ${error.message}`);
      }
    }

    return fixes;
  }

  /**
   * 위반사항을 카테고리별로 그룹핑
   * 
   * @returns {object} 카테고리를 키로 하는 위반사항 배열 맵
   *   예: { 'naming_convention': [...], 'formatting': [...] }
   */
  groupByCategory(violations) {
    return violations.reduce((groups, violation) => {
      const category = violation.category || 'general';
      if (!groups[category]) groups[category] = [];
      groups[category].push(violation);
      return groups;
    }, {});
  }

  /**
   * 이슈를 카테고리별로 그룹핑
   * (groupByCategory와 유사하지만 이슈 객체 구조에 맞춤)
   */
  groupIssuesByCategory(issues) {
    return issues.reduce((groups, issue) => {
      if (!groups[issue.category]) groups[issue.category] = [];
      groups[issue.category].push(issue);
      return groups;
    }, {});
  }

  /**
   * 스타일 점수 계산 (0-100점)
   * 
   * 계산 공식:
   * - 기준점: 전체 검사 항목 (위반 + 경고 + 100)
   * - 페널티: 위반 * 2 + 경고 * 1
   * - 점수 = (기준점 - 페널티) / 기준점 * 100
   * 
   * 예시:
   * - 위반 5개, 경고 3개 → 페널티 13 → 점수 88점
   * - 위반 0개, 경고 0개 → 점수 100점
   */
  calculateStyleScore(results) {
    const totalChecks = results.violations.length + results.warnings.length + 100;
    const penalties = results.violations.length * 2 + results.warnings.length;
    return Math.max(0, Math.round((totalChecks - penalties) / totalChecks * 100));
  }

  /**
   * 패턴 품질 점수 계산 (0-100점)
   * 
   * 계산 공식:
   * - 기준점: 100점
   * - 페널티: CRITICAL * 30 + HIGH * 20 + MEDIUM * 10
   * - 점수 = 100 - 페널티 (최소 0점)
   * 
   * 예시:
   * - CRITICAL 1개 → 70점
   * - HIGH 2개 → 60점
   * - 이슈 없음 → 100점
   */
  calculatePatternScore(detectedIssues) {
    if (!detectedIssues || detectedIssues.length === 0) return 100;

    const criticalIssues = detectedIssues.filter(r => r.severity === 'CRITICAL').length;
    const highIssues = detectedIssues.filter(r => r.severity === 'HIGH').length;
    const mediumIssues = detectedIssues.filter(r => r.severity === 'MEDIUM').length;

    const penalties = criticalIssues * 30 + highIssues * 20 + mediumIssues * 10;
    return Math.max(0, 100 - penalties);
  }

  /**
   * 전체 통합 점수 계산 (0-100점)
   * 
   * 계산 공식:
   * 1. 기본 점수 = (스타일 점수 + 패턴 점수) / 2
   * 2. CRITICAL 이슈 페널티 = CRITICAL 개수 * 10
   * 3. 최종 점수 = 기본 점수 - 페널티 (최소 0점)
   * 
   * 예시:
   * - 스타일 80점, 패턴 70점, CRITICAL 1개 → 65점
   * - 스타일 90점, 패턴 90점, CRITICAL 0개 → 90점
   */
  calculateOverallScore(styleScore, patternScore, issues) {
    const baseScore = (styleScore + patternScore) / 2;
    const criticalPenalty = issues.filter(i => i.severity === 'CRITICAL').length * 10;
    return Math.max(0, Math.round(baseScore - criticalPenalty));
  }

  /**
   * 가이드라인 위반의 수정 난이도 추정 (1-4)
   * 
   * 카테고리별 난이도 맵:
   * - formatting, spacing: 1 (단순 텍스트 변경)
   * - naming_convention: 2 (변수명 변경, 영향 범위 중간)
   * - structure: 3 (코드 구조 변경)
   * - architecture, business_logic: 4 (설계 변경 필요)
   */
  estimateFixEffort(violation) {
    const effortMap = {
      'formatting': 1,
      'spacing': 1,
      'naming_convention': 2,
      'structure': 3,
      'architecture': 4,
      'business_logic': 4
    };
    return effortMap[violation.category] || 2;
  }

  /**
   * 패턴 이슈의 수정 난이도 추정 (2-4)
   * 
   * 카테고리별 난이도 맵:
   * - exception_handling: 2 (try-catch 추가 등)
   * - resource_management, performance_issue: 3 (리소스 처리 개선)
   * - security_vulnerability: 4 (보안 로직 전반 수정)
   */
  estimatePatternFixEffort(issue) {
    const effortMap = {
      'resource_management': 3,
      'security_vulnerability': 4,
      'performance_issue': 3,
      'exception_handling': 2
    };
    return effortMap[issue.category] || 3;
  }

  /**
   * 카테고리 우선순위 반환 (0-100)
   * 
   * 우선순위 맵 (높을수록 중요):
   * - security_vulnerability: 90 (최우선)
   * - resource_management: 80
   * - performance_issue: 70
   * - exception_handling: 60
   * - naming_convention: 50
   * - architecture: 40
   * - code_style: 30
   * - formatting: 20 (최하위)
   */
  getCategoryPriority(category) {
    const priorityMap = {
      'security_vulnerability': 90,
      'resource_management': 80,
      'performance_issue': 70,
      'exception_handling': 60,
      'naming_convention': 50,
      'architecture': 40,
      'code_style': 30,
      'formatting': 20
    };
    return priorityMap[category] || 50;
  }

  /**
   * 가이드라인 이슈에 대한 간단한 수정안 생성
   * 
   * 생성 프로세스:
   * 1. 수정 단계 설명 구성
   * 2. 간단한 패턴 기반 수정 적용 (공백, 포맷팅 등)
   * 3. 수정 설명 및 신뢰도 추가
   * 
   * 신뢰도:
   * - llm_contextual 소스: 0.8 (LLM 판단 포함)
   * - 기타: 0.9 (정적 규칙 기반)
   * 
   * @returns {object} 수정안 정보
   *   - steps: 수정 단계 설명
   *   - fixedCode: 수정된 코드
   *   - explanation: 수정 이유
   *   - confidence: 신뢰도 (0-1)
   */
  async generateGuidelineFix(issue, sourceCode) {
    const steps = [`${issue.title} 규칙 적용`];
    
    // 간단한 패턴 매칭 기반 수정 (공백, 포맷팅 등)
    const fixedCode = this.applySimpleFix(issue, sourceCode);

    // 이슈에 제안사항이 있으면 단계에 추가
    if (issue.suggestion) {
      steps.push(issue.suggestion);
    }

    return {
      steps: steps,
      fixedCode: fixedCode,
      explanation: `개발가이드 ${issue.title} 규칙에 따른 수정`,
      confidence: issue.source === 'llm_contextual' ? 0.8 : 0.9
    };
  }

  /**
   * 간단한 텍스트 기반 수정 적용 (공백, 포맷팅 등)
   * 
   * 현재 지원하는 수정:
   * - spacing/formatting 카테고리: 연속된 공백을 단일 공백으로 변환
   * 
   * 향후 확장 가능:
   * - 들여쓰기 정규화
   * - 괄호 스타일 통일
   * - 세미콜론 추가/제거 등
   * 
   * @returns {string} 수정된 소스코드
   */
  applySimpleFix(issue, sourceCode) {
    const lines = sourceCode.split('\n');
    
    // 해당 라인이 유효한 범위인지 확인
    if (issue.location.startLine <= lines.length) {
      const line = lines[issue.location.startLine - 1];

      // 공백/포맷팅 이슈: 연속된 공백을 단일 공백으로 변환
      if (issue.category === 'spacing' || issue.category === 'formatting') {
        if (issue.suggestion && issue.suggestion.includes('공백')) {
          lines[issue.location.startLine - 1] = line.replace(/\s{2,}/g, ' ');
        }
      }
    }

    return lines.join('\n');
  }
}