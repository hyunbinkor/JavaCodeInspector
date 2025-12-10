/**
 * 통합 Java 코드 품질 검사 시스템 (UnifiedJavaCodeChecker)
 * 
 * Layer3 통합 컴포넌트 - 모든 검사 결과를 하나의 리포트로 통합
 * 
 * v2.1 이원화 아키텍처:
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                    개발가이드 규칙 검사                           │
 * ├─────────────────────────┬───────────────────────────────────────┤
 * │   정적 규칙 (Static)    │    컨텍스트 규칙 (Contextual)           │
 * │   → SonarQube (보류)    │    → LLM 전담 (활성)                   │
 * │   skipStaticRules=true  │    useUnifiedPrompt=true              │
 * └─────────────────────────┴───────────────────────────────────────┘
 * 
 * 3-Layer 아키텍처:
 * 
 * Layer 1 - 개발가이드 검사 (DevelopmentGuidelineChecker):
 *   - VectorDB에서 가이드라인 규칙 로드
 *   - 정적 규칙: SonarQube 연동 예정 (현재 skipStaticRules=true)
 *   - 컨텍스트 규칙: LLM 전담 (통합/배치 프롬프트)
 *   - 카테고리별 위반사항 그룹핑
 *   - 스타일 점수 계산 (0-100)
 * 
 * Layer 2 - VectorDB 패턴 분석 (issueCodeAnalyzer):
 *   - CodeEmbeddingGenerator로 코드 벡터화 (480차원)
 *   - VectorClient로 유사 패턴 검색 (유사도 0.7+)
 *   - DynamicSafePatternAnalyzer로 안전/위험 패턴 분류
 *   - 카테고리별 특화 검사
 *   - 거짓 양성 필터링
 *   - 패턴 품질 점수 계산 (0-100)
 * 
 * Layer 3 - 결과 통합 및 리포트 (이 클래스):
 *   - 가이드라인 + 패턴 결과 병합
 *   - 우선순위 정렬
 *   - 통합 점수 계산
 *   - 수정 권장사항 생성
 * 
 * @module UnifiedJavaCodeChecker
 * @version 2.1.0 - 이원화 지원
 */
import { JavaASTParser } from '../ast/javaAstParser.js';
import { LLMService } from '../clients/llmService.js';
import { issueCodeAnalyzer } from './issueCodeAnalyzer.js';
import { VectorClient } from '../clients/vectorClient.js';
import { PatternDatasetGenerator } from './patternGenerator.js';
import { DevelopmentGuidelineChecker } from './guidelineChecker.js';
import logger from '../utils/loggerUtils.js';
import { config } from '../config.js';

/**
 * 통합 Java 코드 품질 검사 클래스 (Layer3 Component)
 */
export class UnifiedJavaCodeChecker {
  /**
   * 생성자: 모든 분석 컴포넌트 인스턴스 생성
   */
  constructor() {
    this.astParser = new JavaASTParser();
    this.llmService = new LLMService();
    this.vectorClient = new VectorClient();
    this.issueAnalyzer = new issueCodeAnalyzer();
    this.guidelineChecker = new DevelopmentGuidelineChecker();
  }

  /**
   * 초기화: 모든 컴포넌트 연결 확인
   */
  async initialize() {
    logger.info('🚀 통합 검사 시스템 초기화 중...');

    // LLM 서비스 연결 확인
    const llmConnected = await this.llmService.checkConnection();
    if (!llmConnected) {
      logger.warn('⚠️ LLM 서비스 연결 실패 - 컨텍스트 검사가 제한될 수 있습니다');
    }

    // VectorDB 연결 확인
    const vectorConnected = await this.vectorClient.checkConnection();
    if (!vectorConnected) {
      logger.warn('⚠️ VectorDB 연결 실패 - 패턴 분석이 제한될 수 있습니다');
    }

    // 가이드라인 체커 초기화
    await this.guidelineChecker.initialize();

    // 이슈 분석기 초기화
    await this.issueAnalyzer.initialize();

    logger.info('✅ 통합 검사 시스템 초기화 완료');
    logger.info(`   - 정적 규칙: ${this.guidelineChecker.staticRules.size}개 (SonarQube 연동 예정)`);
    logger.info(`   - 컨텍스트 규칙: ${this.guidelineChecker.contextualRules.size}개 (LLM 전담)`);
  }

  /**
   * 통합 코드 분석 실행 (메인 엔트리포인트)
   * 
   * v2.1 이원화 옵션:
   * - skipStaticRules: 정적 규칙 스킵 (SonarQube 연동 전까지 기본 true)
   * - useUnifiedPrompt: LLM 통합 프롬프트 사용 (기본 true)
   * 
   * @param {string} sourceCode - 분석할 Java 소스코드
   * @param {object} options - 분석 옵션
   *   - skipGuidelines: 가이드라인 검사 생략 여부
   *   - skipPatterns: 패턴 분석 생략 여부
   *   - skipStaticRules: 정적 규칙 생략 (기본: true, SonarQube 연동 전)
   *   - skipContextual: 컨텍스트 검사 생략 여부
   *   - useUnifiedPrompt: LLM 통합 프롬프트 사용 (기본: true)
   *   - patternLimit: 검색할 유사 패턴 최대 개수 (기본: 10)
   *   - generateRecommendations: 권장사항 생성 여부 (기본: true)
   *   - generateFixes: 자동 수정안 생성 여부 (기본: false)
   * @returns {object} 통합 분석 리포트
   */
  async analyzeCode(sourceCode, options = {}) {
    const startTime = Date.now();
    logger.info('📊 통합 코드 분석 시작...');

    // v2.1 이원화 옵션 기본값 설정
    const analysisOptions = {
      ...options,
      skipStaticRules: options.skipStaticRules !== false,  // 기본: true
      useUnifiedPrompt: options.useUnifiedPrompt !== false  // 기본: true
    };

    // Java 코드를 AST로 파싱
    const astAnalysis = this.astParser.parseJavaCode(sourceCode);
    const tasks = [];

    // 옵션에 따라 실행할 분석 작업 구성 (병렬 실행 준비)
    if (!analysisOptions.skipGuidelines) {
      tasks.push(this.performGuidelineCheck(sourceCode, astAnalysis, analysisOptions));
    }

    if (!analysisOptions.skipPatterns) {
      tasks.push(this.performPatternAnalysis(sourceCode, astAnalysis, analysisOptions));
    }

    // 기본값 설정
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
      const results = await Promise.all(tasks);
      let resultIndex = 0;

      if (!analysisOptions.skipGuidelines) {
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

      if (!analysisOptions.skipPatterns) {
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
      logger.error('검사 실행 중 오류:', error.message);
    }

    // 결과 통합
    const unifiedResults = await this.unifyResults(
      guidelineResults,
      patternResults,
      sourceCode,
      analysisOptions
    );

    const duration = Date.now() - startTime;
    logger.info(`✅ 통합 분석 완료 (${duration}ms)`);

    return unifiedResults;
  }

  /**
   * 개발가이드 규칙 검사 수행
   * 
   * v2.1 이원화:
   * - 정적 규칙: skipStaticRules=true면 스킵 (SonarQube 연동 예정)
   * - 컨텍스트 규칙: LLM 전담 (통합/배치 프롬프트)
   * 
   * @param {string} sourceCode - 검사할 소스코드
   * @param {object} astAnalysis - AST 분석 결과
   * @param {object} options - 검사 옵션
   * @returns {object} 가이드라인 검사 결과
   */
  async performGuidelineCheck(sourceCode, astAnalysis, options = {}) {
    logger.info('📋 개발가이드 규칙 검사 중...');

    // v2.1 이원화 상태 로깅
    if (options.skipStaticRules) {
      logger.info('  ⏸️ 정적 규칙: 스킵 (SonarQube 연동 예정)');
    }
    if (!options.skipContextual) {
      const promptMode = options.useUnifiedPrompt ? '통합 프롬프트' : '배치 프롬프트';
      logger.info(`  🤖 컨텍스트 규칙: LLM 전담 (${promptMode})`);
    }

    const results = {
      violations: [],
      warnings: [],
      suggestions: [],
      styleScore: 0,
      categories: {}
    };

    // 가이드라인 검사 실행 (v2.1 옵션 전달)
    const guidelineViolations = await this.guidelineChecker.checkRules(
      sourceCode,
      astAnalysis,
      {
        skipStaticRules: options.skipStaticRules,
        skipContextual: options.skipContextual,
        useUnifiedPrompt: options.useUnifiedPrompt
      }
    );

    results.violations.push(...guidelineViolations);
    results.categories = this.groupByCategory([...results.violations, ...results.warnings]);
    results.styleScore = this.calculateStyleScore(results);

    logger.info(`  📊 가이드라인 검사 결과: ${results.violations.length}개 위반, ${results.warnings.length}개 경고`);
    return results;
  }

  /**
   * VectorDB 기반 패턴 분석 수행
   */
  async performPatternAnalysis(sourceCode, astAnalysis, options = {}) {
    logger.info('🔍 패턴 분석 검사 중...');

    try {
      const generator = new PatternDatasetGenerator();
      await generator.initialize();

      const embeddings = await generator.generateEmbeddings(sourceCode, {});
      
      const limit = options.patternLimit || 10;
      const similarPatterns = await this.vectorClient.searchSimilarPatterns(
        embeddings.combined || embeddings,
        limit
      );

      const analysisResult = await this.issueAnalyzer.analyzeCodeIssues(
        sourceCode,
        similarPatterns,
        astAnalysis
      );

      const patternScore = this.calculatePatternScore(analysisResult);

      logger.info(`  📊 패턴 분석 결과: ${analysisResult.detectedIssues?.length || 0}개 이슈, 점수: ${patternScore}`);

      return {
        detectedIssues: analysisResult.detectedIssues || [],
        similarPatterns: similarPatterns || [],
        patternScore,
        safePracticesFound: analysisResult.safePracticesFound || [],
        patternClassification: analysisResult.patternClassification || { safePatterns: [], antiPatterns: [] }
      };
    } catch (error) {
      logger.error('패턴 분석 실패:', error.message);
      return {
        detectedIssues: [],
        similarPatterns: [],
        patternScore: 100,
        safePracticesFound: [],
        patternClassification: { safePatterns: [], antiPatterns: [] }
      };
    }
  }

  /**
   * 가이드라인 + 패턴 결과 통합
   */
  async unifyResults(guidelineResults, patternResults, sourceCode, options) {
    // 모든 이슈 수집
    const allIssues = [
      ...guidelineResults.violations.map(v => ({ ...v, source: 'guideline' })),
      ...patternResults.detectedIssues.map(i => ({ ...i, source: 'pattern' }))
    ];

    // 우선순위 정렬
    const prioritizedIssues = this.prioritizeIssues(allIssues);

    // 통합 점수 계산
    const overallScore = this.calculateOverallScore(
      guidelineResults.styleScore,
      patternResults.patternScore
    );

    // 권장사항 생성
    let recommendations = {};
    if (options.generateRecommendations !== false) {
      recommendations = this.generateRecommendations(prioritizedIssues);
    }

    return {
      overview: {
        totalIssues: prioritizedIssues.length,
        criticalCount: prioritizedIssues.filter(i => i.severity === 'CRITICAL').length,
        highCount: prioritizedIssues.filter(i => i.severity === 'HIGH').length,
        overallScore,
        analysisDate: new Date().toISOString(),
        analysisMode: {
          staticRules: !options.skipStaticRules ? 'active' : 'skipped (SonarQube pending)',
          contextualRules: !options.skipContextual ? 'LLM' : 'skipped',
          patternAnalysis: !options.skipPatterns ? 'active' : 'skipped'
        }
      },
      issues: prioritizedIssues,
      guidelineResults: {
        violations: guidelineResults.violations,
        warnings: guidelineResults.warnings,
        styleScore: guidelineResults.styleScore,
        categories: guidelineResults.categories
      },
      patternResults: {
        detectedIssues: patternResults.detectedIssues,
        similarPatterns: patternResults.similarPatterns,
        patternScore: patternResults.patternScore
      },
      recommendations,
      scores: {
        styleScore: guidelineResults.styleScore,
        patternScore: patternResults.patternScore,
        overallScore
      }
    };
  }

  /**
   * 이슈 우선순위 정렬
   */
  prioritizeIssues(issues) {
    const severityOrder = { 'CRITICAL': 0, 'HIGH': 1, 'MEDIUM': 2, 'LOW': 3 };
    const categoryOrder = {
      'security_vulnerability': 0,
      'resource_management': 1,
      'performance_issue': 2,
      'exception_handling': 3,
      'code_quality': 4
    };

    return [...issues].sort((a, b) => {
      // 1. 심각도
      const sevDiff = (severityOrder[a.severity] || 4) - (severityOrder[b.severity] || 4);
      if (sevDiff !== 0) return sevDiff;

      // 2. 카테고리
      const catDiff = (categoryOrder[a.category] || 5) - (categoryOrder[b.category] || 5);
      if (catDiff !== 0) return catDiff;

      // 3. 라인 번호
      return (a.line || 0) - (b.line || 0);
    });
  }

  /**
   * 카테고리별 그룹핑
   */
  groupByCategory(issues) {
    const grouped = {};
    for (const issue of issues) {
      const category = issue.category || 'general';
      if (!grouped[category]) {
        grouped[category] = [];
      }
      grouped[category].push(issue);
    }
    return grouped;
  }

  /**
   * 스타일 점수 계산
   */
  calculateStyleScore(results) {
    const violations = results.violations?.length || 0;
    const warnings = results.warnings?.length || 0;
    
    // 위반: -10점, 경고: -3점
    const deduction = (violations * 10) + (warnings * 3);
    return Math.max(0, 100 - deduction);
  }

  /**
   * 패턴 점수 계산
   */
  calculatePatternScore(analysisResult) {
    const issues = analysisResult.detectedIssues?.length || 0;
    const critical = analysisResult.detectedIssues?.filter(i => i.severity === 'CRITICAL').length || 0;
    const high = analysisResult.detectedIssues?.filter(i => i.severity === 'HIGH').length || 0;

    // CRITICAL: -20점, HIGH: -10점, 기타: -5점
    const deduction = (critical * 20) + (high * 10) + ((issues - critical - high) * 5);
    return Math.max(0, 100 - deduction);
  }

  /**
   * 통합 점수 계산 (가중 평균)
   */
  calculateOverallScore(styleScore, patternScore) {
    // 스타일 40%, 패턴 60%
    return Math.round((styleScore * 0.4) + (patternScore * 0.6));
  }

  /**
   * 권장사항 생성
   */
  generateRecommendations(issues) {
    return {
      immediate: issues.filter(i => i.severity === 'CRITICAL' || i.severity === 'HIGH'),
      planned: issues.filter(i => i.severity === 'MEDIUM'),
      optional: issues.filter(i => i.severity === 'LOW')
    };
  }
}