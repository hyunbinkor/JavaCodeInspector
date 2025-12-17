/**
 * 개발가이드 전용 검사기 (Layer1: DevelopmentGuidelineChecker)
 * 
 * 금융권 Java 코드 정적 분석 시스템의 Layer1 컴포넌트
 * 
 * v3.0 아키텍처 (태그 기반 필터링 지원):
 * ┌─────────────────────────────────────────────────────────────┐
 * │                    개발가이드 규칙                           │
 * ├─────────────────────────┬───────────────────────────────────┤
 * │   정적 규칙 (Static)    │    컨텍스트 규칙 (Contextual)       │
 * │   → SonarQube (보류)    │    → LLM 전담 (활성)               │
 * └─────────────────────────┴───────────────────────────────────┘
 *                              │
 *                              ▼
 * ┌─────────────────────────────────────────────────────────────┐
 * │               태그 기반 사전 필터링 (v3.0 신규)               │
 * ├─────────────────────────────────────────────────────────────┤
 * │  1. CodeProfiler로 코드 태그 추출 (Tier 1: 정규식/AST)        │
 * │  2. RuleMatcher로 tagCondition 매칭                          │
 * │  3. 매칭된 규칙만 LLM 검증 (효율성 대폭 향상)                  │
 * └─────────────────────────────────────────────────────────────┘
 * 
 * 필터링 전략:
 * - 기존 방식: keywords 기반 (단순 문자열 매칭)
 * - 태그 방식: tagCondition 표현식 (논리 연산자 지원)
 * - 하이브리드: 둘 다 지원 (useTagFiltering 옵션)
 * 
 * @module DevelopmentGuidelineChecker
 * @version 3.0.0 - 태그 기반 필터링 지원
 */
import { VectorClient } from '../clients/vectorClient.js';
import { LLMService } from '../clients/llmService.js';
import { CodeProfiler } from '../profiler/CodeProfiler.js';
import { RuleMatcher } from '../matcher/RuleMatcher.js';
import logger from '../utils/loggerUtils.js';

/**
 * 규칙 검사 타입 상수
 * @constant {Object}
 */
const CHECK_TYPES = {
  REGEX: 'regex',
  AST: 'ast',
  COMBINED: 'combined',
  STATIC_ANALYSIS: 'static_analysis',
  LLM_CONTEXTUAL: 'llm_contextual',
  LLM_WITH_AST: 'llm_with_ast'  // 🆕 신규: AST 정보를 활용한 LLM 검사
};

/**
 * 개발가이드 전용 검사기 클래스 (Layer1 Component)
 */
export class DevelopmentGuidelineChecker {
  /**
   * 생성자: 규칙 저장소 및 클라이언트 초기화
   */
  constructor() {
    // 컨텍스트 규칙 저장소 (LLM 검사용)
    this.contextualRules = new Map();

    // 정적 규칙 저장소 (SonarQube 연동 준비용)
    this.staticRules = new Map();

    // VectorDB 클라이언트
    this.vectorClient = new VectorClient();

    // LLM 서비스
    this.llmService = new LLMService();

    // 가이드 해석 전용 모델 (설정에서 오버라이드 가능)
    this.guidelineModel = process.env.GUIDELINE_LLM_MODEL || 'gpt-oss:120b';

    // ══════════════════════════════════════════════════════════════
    // v3.0 신규: 태그 기반 필터링 컴포넌트
    // ══════════════════════════════════════════════════════════════

    /** @type {CodeProfiler} 코드 프로파일러 */
    this.codeProfiler = null;

    /** @type {RuleMatcher} 규칙 매처 */
    this.ruleMatcher = null;

    /** @type {boolean} 태그 필터링 활성화 여부 */
    this.tagFilteringEnabled = false;

    /** @type {Object} 태그 필터링 통계 */
    this.filteringStats = {
      totalChecks: 0,
      keywordFiltered: 0,
      tagFiltered: 0,
      llmCalls: 0
    };
  }

  /**
   * 개발가이드 룰 초기화 프로세스
   * 
   * @param {Object} options - 초기화 옵션
   * @param {boolean} [options.enableTagFiltering=true] - 태그 필터링 활성화
   */
  async initialize(options = {}) {
    logger.info('📋 개발가이드 룰 로딩 중...');

    const { enableTagFiltering = true } = options;

    // VectorDB에서 규칙 로드
    await this.loadGuidelineRules();

    // v3.0: 태그 기반 필터링 초기화
    if (enableTagFiltering) {
      await this.initializeTagFiltering();
    }

    logger.info(`✅ 개발가이드 룰 로딩 완료:`);
    logger.info(`   - 컨텍스트 규칙 (LLM): ${this.contextualRules.size}개`);
    logger.info(`   - 정적 규칙 (SonarQube 예정): ${this.staticRules.size}개`);
    logger.info(`   - 태그 필터링: ${this.tagFilteringEnabled ? '활성화' : '비활성화'}`);
  }

  /**
   * 태그 기반 필터링 초기화 (v3.0 신규)
   */
  async initializeTagFiltering() {
    try {
      logger.info('  🏷️ 태그 기반 필터링 초기화 중...');

      // CodeProfiler 초기화
      this.codeProfiler = new CodeProfiler();
      await this.codeProfiler.initialize({
        enableTier2: true  // LLM 기반 태깅도 활성화
      });

      // RuleMatcher 초기화
      this.ruleMatcher = new RuleMatcher();
      await this.ruleMatcher.initialize();

      this.tagFilteringEnabled = true;
      logger.info('  ✅ 태그 기반 필터링 초기화 완료');

    } catch (error) {
      logger.warn(`  ⚠️ 태그 기반 필터링 초기화 실패: ${error.message}`);
      logger.warn('     → 기존 keywords 방식으로 폴백');
      this.tagFilteringEnabled = false;
    }
  }

  /**
   * VectorDB에서 가이드라인 규칙 로드 및 분류
   */
  async loadGuidelineRules() {
    try {
      const guidelines = await this.vectorClient.searchGuidelines();

      if (guidelines && guidelines.length > 0) {
        guidelines.forEach(guideline => {
          // keywords 검증 및 폴백
          let keywords = guideline.keywords;
          if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
            keywords = this.extractKeywordsFromText(guideline.title, guideline.description);
            if (keywords.length === 0) {
              keywords = ['java', 'code'];
            }
          }

          // examples 검증
          let examples = guideline.examples;
          if (!examples || typeof examples !== 'object') {
            examples = { good: [], bad: [] };
          }
          if (!Array.isArray(examples.good)) examples.good = [];
          if (!Array.isArray(examples.bad)) examples.bad = [];

          const rule = {
            id: guideline.ruleId,
            ruleId: guideline.ruleId,
            title: guideline.title,
            category: guideline.category || 'general',
            description: guideline.description || '',
            severity: guideline.severity || 'MEDIUM',
            keywords: keywords,
            examples: examples,
            checkType: guideline.checkType || 'llm_contextual',

            // v3.0: tagCondition 필드
            tagCondition: guideline.tagCondition || null,
            requiredTags: guideline.requiredTags || [],
            excludeTags: guideline.excludeTags || [],

            // ═══════════════════════════════════════════════════════════
            // 🆕 v3.1 신규 필드 (Unified Schema)
            // ═══════════════════════════════════════════════════════════

            /** @type {string|null} 원래 checkType (마이그레이션 추적용) */
            originalCheckType: guideline.originalCheckType || null,

            /** @type {string|null} AST 검사 기준 자연어 설명 (LLM용) */
            astDescription: guideline.astDescription || null,

            /** @type {string[]} LLM 체크포인트 목록 */
            checkPoints: Array.isArray(guideline.checkPoints) ? guideline.checkPoints : [],

            /** @type {Object|null} AST 검사 힌트 */
            astHints: guideline.astHints || null,

            /** @type {string[]|null} 위반 패턴 정규식 */
            antiPatterns: guideline.antiPatterns || null,

            /** @type {string[]|null} 올바른 패턴 정규식 */
            goodPatterns: guideline.goodPatterns || null
          };

          // llm_with_ast는 LLM 파이프라인으로 처리하므로 contextualRules로 분류
          const isStaticRule = ['regex', 'ast', 'combined', 'static_analysis'].includes(guideline.checkType);
          const isLLMRule = ['llm_contextual', 'llm_with_ast'].includes(guideline.checkType);

          // Line 179-184 조건문 수정:
          if (isStaticRule && !isLLMRule) {
            this.staticRules.set(guideline.ruleId, rule);
          } else {
            // llm_contextual, llm_with_ast, 또는 알 수 없는 타입
            this.contextualRules.set(guideline.ruleId, rule);
          }
        });

        // tagCondition 있는 규칙 수 카운트
        const rulesWithTagCondition = Array.from(this.contextualRules.values())
          .filter(r => r.tagCondition).length;

        // 🆕 새 필드 통계
        const rulesWithAstDescription = Array.from(this.contextualRules.values())
          .filter(r => r.astDescription).length;
        const llmWithAstRules = Array.from(this.contextualRules.values())
          .filter(r => r.checkType === 'llm_with_ast').length;

        logger.info(`  📊 가이드라인 분류 완료:`);
        logger.info(`     - 컨텍스트(LLM): ${this.contextualRules.size}개`);
        logger.info(`     - 정적(SonarQube): ${this.staticRules.size}개`);
        logger.info(`     - tagCondition 보유: ${rulesWithTagCondition}개`);
        logger.info(`     - 🆕 llm_with_ast: ${llmWithAstRules}개`);
        logger.info(`     - 🆕 astDescription 보유: ${rulesWithAstDescription}개`);
      } else {
        logger.warn('  ⚠️ VectorDB에서 가이드라인을 찾을 수 없습니다');
        this.loadDefaultContextualRules();
      }
    } catch (error) {
      logger.error('가이드라인 룰 로딩 실패:', error.message);
      this.loadDefaultContextualRules();
    }
  }

  /**
   * 기본 컨텍스트 규칙 로드 (VectorDB 실패 시 폴백)
   */
  loadDefaultContextualRules() {
    const defaultRules = [
      {
        id: 'CTX-001',
        ruleId: 'CTX-001',
        title: 'LData 명명 규칙',
        category: 'naming_convention',
        description: 'LData 변수명은 업무적 의미를 담아야 하며, 한글 주석과 함께 사용해야 합니다.',
        severity: 'MEDIUM',
        keywords: ['LData', 'LMultiData', '변수'],
        examples: {
          good: ['LData custInfo = new LData(); // 고객정보'],
          bad: ['LData data1 = new LData();']
        },
        checkType: 'llm_contextual',
        // v3.0: tagCondition 추가
        tagCondition: 'USES_LDATA'
      },
      {
        id: 'CTX-002',
        ruleId: 'CTX-002',
        title: '비즈니스 로직 분리',
        category: 'architecture',
        description: 'Controller에 비즈니스 로직을 직접 작성하지 않고 Service 계층으로 분리해야 합니다.',
        severity: 'HIGH',
        keywords: ['Controller', 'Service', '@RequestMapping', '@GetMapping', '@PostMapping'],
        examples: {
          good: ['service.processOrder(orderId)'],
          bad: ['// Controller에서 직접 DB 쿼리 실행']
        },
        checkType: 'llm_contextual',
        tagCondition: 'IS_CONTROLLER && (CALLS_DAO || LAYER_VIOLATION)'
      },
      {
        id: 'CTX-003',
        ruleId: 'CTX-003',
        title: '트랜잭션 경계 관리',
        category: 'transaction_management',
        description: '@Transactional 어노테이션은 Service 계층에만 적용하고, 적절한 propagation을 설정해야 합니다.',
        severity: 'HIGH',
        keywords: ['@Transactional', 'Transaction', 'Service'],
        examples: {
          good: ['@Transactional(propagation = Propagation.REQUIRED)'],
          bad: ['@Transactional // Controller에 적용']
        },
        checkType: 'llm_contextual',
        tagCondition: 'HAS_TRANSACTIONAL && !IS_SERVICE'
      },
      {
        id: 'CTX-004',
        ruleId: 'CTX-004',
        title: '리소스 누수 방지',
        category: 'resource_management',
        description: 'Connection, Statement, ResultSet 등의 리소스는 반드시 try-with-resources 또는 finally에서 close해야 합니다.',
        severity: 'CRITICAL',
        keywords: ['Connection', 'Statement', 'ResultSet', 'close', 'try'],
        examples: {
          good: ['try (Connection conn = dataSource.getConnection()) { ... }'],
          bad: ['Connection conn = dataSource.getConnection(); // close 없음']
        },
        checkType: 'llm_contextual',
        tagCondition: 'RESOURCE_LEAK_RISK'
      },
      {
        id: 'CTX-005',
        ruleId: 'CTX-005',
        title: 'SQL Injection 방지',
        category: 'security',
        description: 'SQL 문자열 연결 대신 PreparedStatement를 사용해야 합니다.',
        severity: 'CRITICAL',
        keywords: ['SQL', 'Statement', 'query', 'execute'],
        examples: {
          good: ['PreparedStatement ps = conn.prepareStatement("SELECT * FROM users WHERE id = ?")'],
          bad: ['"SELECT * FROM users WHERE id = " + userId']
        },
        checkType: 'llm_contextual',
        tagCondition: 'SQL_INJECTION_RISK'
      }
    ];

    defaultRules.forEach(rule => {
      this.contextualRules.set(rule.ruleId, rule);
    });

    logger.info(`  📦 기본 컨텍스트 규칙 ${defaultRules.length}개 로드`);
  }

  /**
   * 텍스트에서 키워드 추출
   */
  extractKeywordsFromText(title, description) {
    const keywords = new Set();
    const text = `${title || ''} ${description || ''}`;

    // 한글 단어 (2글자 이상)
    const koreanWords = text.match(/[가-힣]{2,}/g) || [];
    koreanWords.forEach(w => keywords.add(w));

    // 영문 단어 (CamelCase 분리)
    const englishWords = text.match(/[A-Z][a-z]+|[a-z]+|[A-Z]+/g) || [];
    englishWords.forEach(w => {
      if (w.length >= 3) keywords.add(w);
    });

    // Java 관련 키워드 우선
    const javaKeywords = ['class', 'method', 'public', 'private', 'static',
      'void', 'String', 'int', 'LData', 'LMultiData',
      'try', 'catch', 'Exception', 'throw', 'Controller',
      'Service', 'Repository', 'Transactional'];
    javaKeywords.forEach(kw => {
      if (text.toLowerCase().includes(kw.toLowerCase())) {
        keywords.add(kw);
      }
    });

    return Array.from(keywords).slice(0, 10);
  }

  // ═══════════════════════════════════════════════════════════════════
  // 메인 검사 메서드
  // ═══════════════════════════════════════════════════════════════════

  /**
   * 가이드라인 규칙 검사 (메인 엔트리포인트)
   * 
   * @param {string} sourceCode - 검사할 소스 코드
   * @param {object} astAnalysis - AST 분석 결과
   * @param {object} options - 검사 옵션
   *   - skipStaticRules: 정적 규칙 검사 스킵 (SonarQube 연동 시 true)
   *   - skipContextual: 컨텍스트 규칙 검사 스킵
   *   - useUnifiedPrompt: 통합 프롬프트 사용 (기본: true)
   *   - useTagFiltering: 태그 기반 필터링 사용 (기본: true) [v3.0 신규]
   * @returns {Promise<array>} 위반사항 배열
   */
  async checkRules(sourceCode, astAnalysis, options = {}) {
    const violations = [];
    this.filteringStats.totalChecks++;

    if (!options.skipStaticRules && this.staticRules.size > 0) {
      logger.info('  ⚠️ 정적 규칙 검사는 SonarQube 연동 후 지원 예정');
    }

    if (!options.skipContextual) {
      const useUnified = options.useUnifiedPrompt !== false;
      const useTagFiltering = options.useTagFiltering !== false && this.tagFilteringEnabled;

      let contextualViolations = [];

      // 🆕 llm_with_ast / llm_contextual 분리 처리
      const allRules = Array.from(this.contextualRules.values());
      const llmWithAstRules = allRules.filter(r => r.checkType === 'llm_with_ast');
      const otherRules = allRules.filter(r => r.checkType !== 'llm_with_ast');

      // llm_with_ast 규칙 검사
      if (llmWithAstRules.length > 0) {
        logger.info(`  🔬 llm_with_ast 규칙 검사: ${llmWithAstRules.length}개`);
        const astViolations = await this.checkLLMWithAstRules(
          sourceCode, astAnalysis, llmWithAstRules, options
        );
        contextualViolations.push(...astViolations);
      }

      // llm_contextual 규칙 검사 (기존 방식)
      if (otherRules.length > 0) {
        logger.info(`  🤖 llm_contextual 규칙 검사: ${otherRules.length}개`);
        const originalRules = this.contextualRules;
        this.contextualRules = new Map(otherRules.map(r => [r.ruleId, r]));

        let llmViolations;
        if (useTagFiltering) {
          llmViolations = await this.checkContextualRulesWithTags(
            sourceCode, astAnalysis, { useUnifiedPrompt: useUnified }
          );
        } else if (useUnified) {
          llmViolations = await this.checkContextualRulesUnified(sourceCode, astAnalysis);
        } else {
          llmViolations = await this.checkContextualRulesBatch(sourceCode);
        }
        contextualViolations.push(...llmViolations);
        this.contextualRules = originalRules;
      }

      violations.push(...contextualViolations);
    }

    const uniqueViolations = this.deduplicateViolations(violations);
    logger.info(`  📊 검사 완료: ${violations.length}개 → 중복 제거 후 ${uniqueViolations.length}개`);
    return uniqueViolations;
  }

  /**
   * 위반사항 중복 제거
   */
  deduplicateViolations(violations) {
    const seen = new Map();

    return violations.filter(violation => {
      const key = `${violation.line}-${violation.ruleId}-${violation.column || 0}`;
      if (seen.has(key)) {
        return false;
      }
      seen.set(key, true);
      return true;
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // v3.0 신규: 태그 기반 필터링 검사
  // ═══════════════════════════════════════════════════════════════════

  /**
   * 태그 기반 필터링을 사용한 컨텍스트 규칙 검사 (v3.0 신규)
   * 
   * 처리 흐름:
   * 1. CodeProfiler로 코드 프로파일 생성 (태그 추출)
   * 2. RuleMatcher로 tagCondition 매칭
   * 3. 매칭된 규칙만 LLM 검증 (효율성 대폭 향상)
   * 
   * @param {string} sourceCode - 소스 코드
   * @param {object} astAnalysis - AST 분석 결과
   * @param {object} options - 옵션
   * @returns {Promise<array>} 위반사항 배열
   */
  async checkContextualRulesWithTags(sourceCode, astAnalysis, options = {}) {
    logger.info('  🏷️ 태그 기반 가이드라인 검사 시작...');
    const startTime = Date.now();

    // Step 1: 코드 프로파일 생성
    logger.info('    Step 1: 코드 프로파일 생성 중...');
    const profile = await this.codeProfiler.generateProfile(sourceCode, {
      enableTier2: true,
      includeCompound: true
    });

    logger.info(`    → 추출된 태그: ${profile.tags.size}개 (위험도: ${profile.riskLevel})`);

    // Step 2: 규칙 배열로 변환
    const allRules = Array.from(this.contextualRules.values());

    // Step 3: 태그 기반 매칭
    logger.info('    Step 2: 태그 조합 매칭 중...');
    const matchResult = await this.ruleMatcher.matchRules(profile, allRules, {
      skipUntagged: false,  // tagCondition 없는 규칙도 포함
      sortByPriority: true
    });

    const tagFilteredRules = matchResult.violations;
    this.filteringStats.tagFiltered++;

    logger.info(`    → 태그 매칭 결과: ${allRules.length}개 → ${tagFilteredRules.length}개 (${((1 - tagFilteredRules.length / allRules.length) * 100).toFixed(0)}% 감소)`);

    // Step 4: 추가 keywords 필터링 (tagCondition 없는 규칙용)
    const rulesWithoutTagCondition = allRules.filter(r => !r.tagCondition);
    const keywordFilteredRules = this.filterApplicableRules(sourceCode)
      .filter(r => !r.tagCondition); // tagCondition 없는 것만

    // Step 5: 최종 적용 규칙 병합
    const applicableRules = [
      ...tagFilteredRules.map(v => this.contextualRules.get(v.ruleId)).filter(Boolean),
      ...keywordFilteredRules
    ];

    // 중복 제거
    const uniqueRuleIds = new Set();
    const finalRules = applicableRules.filter(rule => {
      if (uniqueRuleIds.has(rule.ruleId)) return false;
      uniqueRuleIds.add(rule.ruleId);
      return true;
    });

    logger.info(`    → 최종 적용 규칙: ${finalRules.length}개`);

    if (finalRules.length === 0) {
      logger.info('    해당 코드에 적용 가능한 가이드라인 없음');
      return [];
    }

    // Step 6: LLM 검증 (통합 또는 배치)
    logger.info('    Step 3: LLM 위반 검증 중...');
    this.filteringStats.llmCalls++;

    let violations;
    if (options.useUnifiedPrompt && finalRules.length > 1) {
      violations = await this.verifyWithUnifiedPrompt(sourceCode, finalRules, profile, astAnalysis);
    } else {
      violations = await this.verifyWithBatchPrompt(sourceCode, finalRules);
    }

    const elapsed = Date.now() - startTime;
    logger.info(`    ✅ 태그 기반 검사 완료: ${violations.length}개 위반 (${elapsed}ms)`);

    // 통계 로깅
    this.logFilteringStats();

    return violations;
  }

  /**
   * 통합 프롬프트로 LLM 검증
   */
  async verifyWithUnifiedPrompt(sourceCode, rules, profile, astAnalysis) {
    // 프로파일 정보를 프롬프트에 포함
    const profileSummary = `
## 코드 프로파일 (자동 분석 결과)
- 추출된 태그: ${Array.from(profile.tags).slice(0, 15).join(', ')}
- 위험 수준: ${profile.riskLevel}
- 카테고리: ${profile.categories.join(', ') || '없음'}
- 복합 태그: ${Object.entries(profile.compoundTags)
        .filter(([_, v]) => v.matched)
        .map(([k, _]) => k)
        .join(', ') || '없음'}
`;

    const prompt = this.buildUnifiedPromptWithProfile(sourceCode, rules, astAnalysis, profileSummary);

    try {
      const response = await this.llmService.generateCompletion(prompt, {
        model: this.guidelineModel,
        temperature: 0.1,
        num_predict: 2000
      });

      return this.parseUnifiedResponse(response, rules);

    } catch (error) {
      logger.warn(`    통합 검증 실패: ${error.message}, 배치 방식으로 폴백`);
      return this.verifyWithBatchPrompt(sourceCode, rules);
    }
  }

  /**
   * 배치 프롬프트로 LLM 검증
   */
  async verifyWithBatchPrompt(sourceCode, rules) {
    const violations = [];
    const batchSize = 3;

    for (let i = 0; i < rules.length; i += batchSize) {
      const batch = rules.slice(i, i + batchSize);

      try {
        const batchViolations = await this.checkRulesBatchLLM(sourceCode, batch);
        violations.push(...batchViolations);
      } catch (error) {
        logger.warn(`    배치 검증 실패: ${error.message}`);
      }

      // Rate limiting
      if (i + batchSize < rules.length) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    return violations;
  }

  /**
   * 프로파일 정보가 포함된 통합 프롬프트 생성
   */
  buildUnifiedPromptWithProfile(sourceCode, rules, astAnalysis, profileSummary) {
    // AST 정보 요약
    const astSummary = astAnalysis ? `
## 코드 구조 정보
- 클래스: ${astAnalysis.classes?.map(c => c.name).join(', ') || 'N/A'}
- 메서드 수: ${astAnalysis.methods?.length || 0}개
- 어노테이션: ${astAnalysis.annotations?.slice(0, 10).join(', ') || 'N/A'}
` : '';

    // 규칙 목록 생성
    const rulesText = rules.map((rule, idx) => {
      const goodEx = rule.examples?.good?.[0] || '';
      const badEx = rule.examples?.bad?.[0] || '';
      const tagInfo = rule.tagCondition ? `\n- **매칭 조건**: \`${rule.tagCondition}\`` : '';

      return `
### ${idx + 1}. ${rule.title} [${rule.ruleId}]
- **심각도**: ${rule.severity}
- **설명**: ${rule.description}${tagInfo}
${goodEx ? `- **올바른 예**: \`${goodEx}\`` : ''}
${badEx ? `- **잘못된 예**: \`${badEx}\`` : ''}`;
    }).join('\n');

    return `당신은 금융권 Java 코드 품질 전문가입니다.
아래 개발 가이드라인을 기반으로 코드를 검사하고 위반사항을 찾아주세요.

## 검사 대상 코드
\`\`\`java
${this.truncateCode(sourceCode, 6000)}
\`\`\`
${astSummary}
${profileSummary}

## 적용할 가이드라인 (${rules.length}개)
${rulesText}

## 검사 지침
1. 코드 프로파일 정보를 참고하여 위반 가능성이 높은 부분에 집중하세요
2. 실제로 위반한 경우에만 보고하세요 (False Positive 최소화)
3. 위반 라인 번호를 정확히 지정하세요
4. 구체적인 위반 내용과 수정 제안을 포함하세요

## 응답 형식 (JSON)
\`\`\`json
{
  "violations": [
    {
      "ruleId": "규칙 ID",
      "title": "규칙 제목",
      "line": 위반 라인 번호,
      "severity": "심각도",
      "description": "구체적인 위반 내용",
      "suggestion": "수정 제안"
    }
  ]
}
\`\`\`

위반사항이 없으면 violations를 빈 배열로 반환해주세요.
JSON만 출력하세요.`;
  }

  /**
   * 필터링 통계 로깅
   */
  logFilteringStats() {
    if (this.filteringStats.totalChecks % 10 === 0) {
      logger.debug(`[필터링 통계] 총 검사: ${this.filteringStats.totalChecks}, ` +
        `키워드: ${this.filteringStats.keywordFiltered}, ` +
        `태그: ${this.filteringStats.tagFiltered}, ` +
        `LLM 호출: ${this.filteringStats.llmCalls}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // 기존 컨텍스트 규칙 검사 (LLM 전담) - 하위 호환성 유지
  // ═══════════════════════════════════════════════════════════════════

  /**
   * 통합 프롬프트 방식 - 모든 규칙을 한 번에 검사
   * 
   * @param {string} sourceCode - 소스 코드
   * @param {object} astAnalysis - AST 분석 결과
   * @returns {Promise<array>} 위반사항 배열
   */
  async checkContextualRulesUnified(sourceCode, astAnalysis) {
    logger.info('  🤖 LLM 통합 가이드라인 검사 시작...');
    this.filteringStats.keywordFiltered++;

    // 적용 가능한 규칙 필터링 (기존 keywords 방식)
    const applicableRules = this.filterApplicableRules(sourceCode);
    if (applicableRules.length === 0) {
      logger.info('    해당 코드에 적용 가능한 가이드라인 없음');
      return [];
    }

    logger.info(`    적용 가능한 가이드라인: ${applicableRules.length}개`);

    // 통합 프롬프트 생성
    const prompt = this.buildUnifiedPrompt(sourceCode, applicableRules, astAnalysis);

    try {
      this.filteringStats.llmCalls++;

      // LLM 호출 (가이드 해석 전용 모델)
      const response = await this.llmService.generateCompletion(prompt, {
        model: this.guidelineModel,
        temperature: 0.1,
        num_predict: 2000
      });

      // 응답 파싱
      const violations = this.parseUnifiedResponse(response, applicableRules);
      logger.info(`    통합 검사 완료: ${violations.length}개 위반 발견`);

      return violations;
    } catch (error) {
      logger.warn(`    통합 검사 실패: ${error.message}, 배치 방식으로 폴백`);
      return this.checkContextualRulesBatch(sourceCode);
    }
  }

  /**
   * 통합 프롬프트 생성
   */
  buildUnifiedPrompt(sourceCode, rules, astAnalysis) {
    // AST 정보 요약
    const astSummary = astAnalysis ? `
## 코드 구조 정보
- 클래스: ${astAnalysis.classes?.map(c => c.name).join(', ') || 'N/A'}
- 메서드 수: ${astAnalysis.methods?.length || 0}개
- 어노테이션: ${astAnalysis.annotations?.slice(0, 10).join(', ') || 'N/A'}
` : '';

    // 규칙 목록 생성
    const rulesText = rules.map((rule, idx) => {
      const goodEx = rule.examples?.good?.[0] || '';
      const badEx = rule.examples?.bad?.[0] || '';

      return `
### ${idx + 1}. ${rule.title} [${rule.ruleId}]
- **심각도**: ${rule.severity}
- **설명**: ${rule.description}
${goodEx ? `- **올바른 예**: \`${goodEx}\`` : ''}
${badEx ? `- **잘못된 예**: \`${badEx}\`` : ''}`;
    }).join('\n');

    return `당신은 금융권 Java 코드 품질 전문가입니다.
아래 개발 가이드라인을 기반으로 코드를 검사하고 위반사항을 찾아주세요.

## 검사 대상 코드
\`\`\`java
${this.truncateCode(sourceCode, 6000)}
\`\`\`
${astSummary}
## 적용할 가이드라인 (${rules.length}개)
${rulesText}

## 검사 지침
1. 각 가이드라인에 대해 코드를 검토하세요
2. 실제로 위반한 경우에만 보고하세요 (False Positive 최소화)
3. 위반 라인 번호를 정확히 지정하세요
4. 구체적인 위반 내용과 수정 제안을 포함하세요

## 응답 형식 (JSON)
\`\`\`json
{
  "violations": [
    {
      "ruleId": "규칙 ID",
      "title": "규칙 제목",
      "line": 위반 라인 번호,
      "severity": "심각도",
      "description": "구체적인 위반 내용",
      "suggestion": "수정 제안"
    }
  ]
}
\`\`\`

위반사항이 없으면 violations를 빈 배열로 반환해주세요.
JSON만 출력하세요.`;
  }

  /**
   * 통합 프롬프트 응답 파싱
   */
  parseUnifiedResponse(response, applicableRules) {
    const violations = [];

    try {
      // JSON 추출
      const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : response;

      const cleaned = jsonStr.replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);

      if (parsed.violations && Array.isArray(parsed.violations)) {
        for (const v of parsed.violations) {
          // 규칙 ID 매핑
          const rule = applicableRules.find(r =>
            r.ruleId === v.ruleId ||
            r.title === v.title
          );

          violations.push({
            ruleId: v.ruleId || rule?.ruleId || 'UNKNOWN',
            title: v.title || rule?.title || '',
            line: v.line || 0,
            column: v.column || 0,
            severity: v.severity || rule?.severity || 'MEDIUM',
            description: v.description || '',
            suggestion: v.suggestion || '',
            category: rule?.category || 'general',
            source: 'guideline_checker'
          });
        }
      }

    } catch (error) {
      logger.warn(`    응답 파싱 실패: ${error.message}`);
    }

    return violations;
  }

  /**
   * 배치 방식 - 규칙을 그룹으로 나누어 검사 (폴백용)
   */
  async checkContextualRulesBatch(sourceCode) {
    logger.info('  🤖 LLM 배치 가이드라인 검사 시작...');
    this.filteringStats.keywordFiltered++;

    const violations = [];

    // 적용 가능한 규칙 필터링
    const applicableRules = this.filterApplicableRules(sourceCode);
    if (applicableRules.length === 0) {
      logger.info('    해당 코드에 적용 가능한 가이드라인 없음');
      return violations;
    }

    logger.info(`    적용 가능한 가이드라인: ${applicableRules.length}개`);

    // 배치 처리 (3개씩)
    const batchSize = 3;
    for (let i = 0; i < applicableRules.length; i += batchSize) {
      const batch = applicableRules.slice(i, i + batchSize);

      try {
        this.filteringStats.llmCalls++;
        const batchViolations = await this.checkRulesBatchLLM(sourceCode, batch);
        violations.push(...batchViolations);
      } catch (error) {
        logger.warn(`    배치 검사 실패: ${error.message}`);

        // 개별 처리로 폴백
        for (const rule of batch) {
          try {
            const individualViolations = await this.checkSingleRuleLLM(sourceCode, rule);
            violations.push(...individualViolations);
          } catch (individualError) {
            logger.warn(`    개별 규칙 검사 실패 (${rule.id}): ${individualError.message}`);
          }
        }
      }

      // Rate limiting
      if (i + batchSize < applicableRules.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    logger.info(`    배치 검사 완료: ${violations.length}개 위반 발견`);
    return violations;
  }

  /**
   * 적용 가능한 규칙 필터링 (기존 keywords 방식)
   */
  filterApplicableRules(sourceCode) {
    const applicable = [];
    const lowerCode = sourceCode.toLowerCase();

    for (const [ruleId, rule] of this.contextualRules) {
      if (!rule.keywords || !Array.isArray(rule.keywords) || rule.keywords.length === 0) {
        continue;
      }

      const hasRelevantKeywords = rule.keywords.some(keyword => {
        if (typeof keyword !== 'string') return false;
        return lowerCode.includes(keyword.toLowerCase());
      });

      if (hasRelevantKeywords) {
        applicable.push(rule);
      }
    }

    return applicable;
  }

  /**
   * 규칙 배치 LLM 검사
   */
  async checkRulesBatchLLM(sourceCode, rules) {
    const rulesDescription = rules.map(rule => {
      const goodExamples = rule.examples?.good || [];
      const badExamples = rule.examples?.bad || [];

      return `
### ${rule.title} (${rule.ruleId})
${rule.description || ''}

올바른 예시:
${goodExamples.length > 0 ? goodExamples.map(ex => `- ${ex}`).join('\n') : '- (없음)'}

잘못된 예시:  
${badExamples.length > 0 ? badExamples.map(ex => `- ${ex}`).join('\n') : '- (없음)'}
`;
    }).join('\n---\n');

    const prompt = `다음 Java 코드가 제시된 개발 가이드라인들을 준수하는지 검사해주세요.

## 검사 대상 코드:
\`\`\`java
${this.truncateCode(sourceCode, 2000)}
\`\`\`

## 적용할 가이드라인들:
${rulesDescription}

## 검사 결과 형식 (JSON):
\`\`\`json
{
  "violations": [
    {
      "ruleId": "규칙 ID",
      "title": "규칙 제목",
      "violation": true,
      "line": 위반 라인 번호,
      "description": "구체적인 위반 내용",
      "suggestion": "수정 제안"
    }
  ]
}
\`\`\`

위반사항이 없으면 violations를 빈 배열로 반환해주세요.`;

    const response = await this.llmService.generateCompletion(prompt, {
      model: this.guidelineModel,
      temperature: 0.1,
      num_predict: 1000
    });

    return this.parseBatchResponse(response, rules);
  }

  /**
   * 배치 응답 파싱
   */
  parseBatchResponse(response, rules) {
    const violations = [];

    try {
      const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : response;

      const cleaned = jsonStr.replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);

      if (parsed.violations && Array.isArray(parsed.violations)) {
        for (const v of parsed.violations) {
          if (v.violation === true || v.violation === undefined) {
            const rule = rules.find(r => r.ruleId === v.ruleId);

            violations.push({
              ruleId: v.ruleId || 'UNKNOWN',
              title: v.title || rule?.title || '',
              line: v.line || 0,
              severity: rule?.severity || 'MEDIUM',
              description: v.description || '',
              suggestion: v.suggestion || '',
              category: rule?.category || 'general',
              source: 'guideline_checker'
            });
          }
        }
      }

    } catch (error) {
      logger.warn(`    배치 응답 파싱 실패: ${error.message}`);
    }

    return violations;
  }

  /**
   * 단일 규칙 LLM 검사
   */
  async checkSingleRuleLLM(sourceCode, rule) {
    const goodExamples = rule.examples?.good || [];
    const badExamples = rule.examples?.bad || [];

    const prompt = `다음 Java 코드가 개발 가이드라인을 준수하는지 검사해주세요.

## 검사 대상 코드:
\`\`\`java
${this.truncateCode(sourceCode, 2000)}
\`\`\`

## 가이드라인: ${rule.title}
${rule.description}

올바른 예시:
${goodExamples.length > 0 ? goodExamples.map(ex => `- ${ex}`).join('\n') : '- (없음)'}

잘못된 예시:
${badExamples.length > 0 ? badExamples.map(ex => `- ${ex}`).join('\n') : '- (없음)'}

## 검사 결과 형식 (JSON):
\`\`\`json
{
  "violation": true 또는 false,
  "line": 위반 라인 번호 (위반 시),
  "description": "위반 내용 설명",
  "suggestion": "수정 제안"
}
\`\`\`

JSON만 출력하세요.`;

    this.filteringStats.llmCalls++;

    const response = await this.llmService.generateCompletion(prompt, {
      model: this.guidelineModel,
      temperature: 0.1,
      num_predict: 500
    });

    return this.parseSingleResponse(response, rule);
  }

  /**
   * 단일 응답 파싱
   */
  parseSingleResponse(response, rule) {
    const violations = [];

    try {
      const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : response;

      const cleaned = jsonStr.replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);

      if (parsed.violation === true) {
        violations.push({
          ruleId: rule.ruleId,
          title: rule.title,
          line: parsed.line || 0,
          severity: rule.severity || 'MEDIUM',
          description: parsed.description || '',
          suggestion: parsed.suggestion || '',
          category: rule.category || 'general',
          source: 'guideline_checker'
        });
      }

    } catch (error) {
      logger.warn(`    단일 응답 파싱 실패: ${error.message}`);
    }

    return violations;
  }

  /**
   * 코드 길이 제한 (토큰 절약)
   */
  truncateCode(code, maxLength) {
    if (code.length <= maxLength) {
      return code;
    }

    const half = Math.floor(maxLength / 2);
    const start = code.substring(0, half);
    const end = code.substring(code.length - half);

    return `${start}\n\n// ... (${code.length - maxLength} characters truncated) ...\n\n${end}`;
  }

  // ═══════════════════════════════════════════════════════════════════
  // 유틸리티 메서드
  // ═══════════════════════════════════════════════════════════════════

  /**
   * 필터링 통계 반환
   */
  getFilteringStats() {
    return { ...this.filteringStats };
  }

  /**
   * 필터링 통계 초기화
   */
  resetFilteringStats() {
    this.filteringStats = {
      totalChecks: 0,
      keywordFiltered: 0,
      tagFiltered: 0,
      llmCalls: 0
    };
  }

  /**
   * 태그 필터링 활성화/비활성화
   */
  setTagFilteringEnabled(enabled) {
    if (enabled && !this.codeProfiler) {
      logger.warn('CodeProfiler가 초기화되지 않아 태그 필터링을 활성화할 수 없습니다');
      return false;
    }
    this.tagFilteringEnabled = enabled;
    return true;
  }

  async checkLLMWithAstRules(sourceCode, astAnalysis, rules, options = {}) {
    logger.info('    🔬 AST + LLM 하이브리드 검사 시작...');
    const startTime = Date.now();

    // Step 1: AST 사전 검사
    const preCheckResults = await this.performAstPreCheck(sourceCode, astAnalysis, rules);
    const candidateResults = preCheckResults.filter(r => r.isCandidate);

    logger.info(`      → ${rules.length}개 중 ${candidateResults.length}개 후보 선정`);

    if (candidateResults.length === 0) {
      return [];
    }

    // Step 2: LLM 검증
    this.filteringStats.llmCalls++;
    const llmViolations = await this.verifyWithAstContext(sourceCode, astAnalysis, candidateResults, options);

    // Step 3: AST 교차 검증 (False Positive 제거)
    const verifiedViolations = this.verifyViolationsWithAST(
      llmViolations,
      astAnalysis,
      sourceCode
    );

    return verifiedViolations;
  }

  async performAstPreCheck(sourceCode, astAnalysis, rules) {
    const results = [];

    for (const rule of rules) {
      const result = { ruleId: rule.ruleId, rule, isCandidate: false, matchedConditions: [], skipReason: null };
      const astHints = rule.astHints || {};

      if (Object.keys(astHints).length === 0) {
        result.isCandidate = true;
        result.matchedConditions.push('no_ast_hints_fallback');
        results.push(result);
        continue;
      }

      // nodeTypes 검사
      if (astHints.nodeTypes?.length > 0) {
        if (this.checkNodeTypesPresent(astAnalysis, astHints.nodeTypes, sourceCode)) {
          result.matchedConditions.push(`nodeTypes: ${astHints.nodeTypes.join(', ')}`);
        } else {
          result.skipReason = `필수 노드 타입 없음`;
          results.push(result);
          continue;
        }
      }

      // keywords 검사
      if (rule.keywords?.length > 0) {
        const lowerCode = sourceCode.toLowerCase();
        const matched = rule.keywords.filter(kw => lowerCode.includes(kw.toLowerCase()));
        if (matched.length > 0) {
          result.matchedConditions.push(`keywords: ${matched.join(', ')}`);
        }
      }

      result.isCandidate = result.matchedConditions.length > 0;
      results.push(result);
    }

    return results;
  }

  checkNodeTypesPresent(astAnalysis, nodeTypes, sourceCode) {
    for (const nodeType of nodeTypes) {
      switch (nodeType) {
        case 'ClassDeclaration': if (astAnalysis?.classes?.length > 0) return true; break;
        case 'MethodDeclaration': if (astAnalysis?.methods?.length > 0) return true; break;
        case 'CatchClause': if (sourceCode.includes('catch')) return true; break;
        case 'TryStatement': if (sourceCode.includes('try')) return true; break;
        case 'IfStatement': if (/\bif\s*\(/.test(sourceCode)) return true; break;
        case 'ForStatement': if (/\bfor\s*\(/.test(sourceCode)) return true; break;
        case 'ThrowStatement': if (/\bthrow\s+/.test(sourceCode)) return true; break;
        default: if (sourceCode.toLowerCase().includes(nodeType.toLowerCase())) return true;
      }
    }
    return false;
  }

  checkAnnotationsPresent(astAnalysis, requiredAnnotations, sourceCode) {
    if (astAnalysis?.annotations) {
      return requiredAnnotations.some(ann =>
        astAnalysis.annotations.some(a => a.includes(ann.replace('@', '')))
      );
    }
    return requiredAnnotations.some(ann => sourceCode.includes(ann));
  }

  async verifyWithAstContext(sourceCode, astAnalysis, candidateResults, options = {}) {
    const rules = candidateResults.map(c => c.rule);
    const prompt = this.buildLLMWithAstPrompt(sourceCode, astAnalysis, candidateResults);

    try {
      const response = await this.llmService.generateCompletion(prompt, {
        model: this.guidelineModel,
        temperature: 0.1,
        num_predict: 2500
      });
      return this.parseAstContextResponse(response, rules);
    } catch (error) {
      logger.warn(`      AST 검증 실패: ${error.message}`);
      return this.verifyWithBatchPrompt(sourceCode, rules);
    }
  }

  buildLLMWithAstPrompt(sourceCode, astAnalysis, candidateResults) {
    const astSummary = astAnalysis ? `
  ## 코드 구조
  - 클래스: ${astAnalysis.classes?.map(c => c.name).join(', ') || '없음'}
  - 메서드: ${astAnalysis.methods?.length || 0}개
  ` : '';

    const rulesText = candidateResults.map((c, idx) => {
      const rule = c.rule;
      const checkPoints = rule.checkPoints || [];
      return `
  ### ${idx + 1}. ${rule.title} (${rule.ruleId})
  **AST 검사 기준**: ${rule.astDescription || rule.description}
  **체크포인트**:
  ${checkPoints.map((cp, i) => `  ${i + 1}. ${cp}`).join('\n') || '  - 규칙 설명 참조'}
  **예시**: Good: ${rule.examples?.good?.[0] || '없음'} / Bad: ${rule.examples?.bad?.[0] || '없음'}
  `;
    }).join('\n---\n');

    return `Java 코드가 아래 가이드라인의 체크포인트를 준수하는지 검사하세요.
  
  ## 코드
  \`\`\`java
  ${this.truncateCode(sourceCode, 5000)}
  \`\`\`
  ${astSummary}
  
  ## 가이드라인 (${candidateResults.length}개)
  ${rulesText}
  
  ## 응답 (JSON만)
  \`\`\`json
  {
    "violations": [
      { "ruleId": "ID", "title": "제목", "line": 번호, "severity": "심각도", 
        "failedCheckPoint": "위반 체크포인트", "description": "위반 내용", "suggestion": "수정안" }
    ]
  }
  \`\`\``;
  }

  parseAstContextResponse(response, rules) {
    const violations = [];
    try {
      const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[1] : response.replace(/```/g, '').trim());

      if (parsed.violations) {
        for (const v of parsed.violations) {
          const rule = rules.find(r => r.ruleId === v.ruleId);
          violations.push({
            ruleId: v.ruleId || 'UNKNOWN',
            title: v.title || rule?.title || '',
            line: v.line || 0,
            severity: v.severity || rule?.severity || 'MEDIUM',
            description: v.description || '',
            suggestion: v.suggestion || '',
            failedCheckPoint: v.failedCheckPoint || null,
            category: rule?.category || 'general',
            checkType: 'llm_with_ast',
            source: 'guideline_checker_ast'
          });
        }
      }
    } catch (error) {
      logger.warn(`      응답 파싱 실패: ${error.message}`);
    }
    return violations;
  }

  /**
 * LLM이 발견한 위반을 AST/소스코드로 교차 검증
 * 
 * @param {array} violations - LLM이 보고한 위반 목록
 * @param {object} astAnalysis - AST 분석 결과
 * @param {string} sourceCode - 원본 소스 코드
 * @returns {array} 검증된 위반 목록 (False Positive 제거됨)
 */
  verifyViolationsWithAST(violations, astAnalysis, sourceCode) {
    if (!violations || violations.length === 0) {
      return [];
    }

    logger.info(`      🔍 AST 교차 검증 시작: ${violations.length}개 위반`);

    const verifiedViolations = [];
    const filteredOut = [];

    for (const violation of violations) {
      const verificationResult = this.verifySingleViolation(
        violation,
        astAnalysis,
        sourceCode
      );

      if (verificationResult.verified) {
        // 검증 통과 - 위반 유지
        verifiedViolations.push({
          ...violation,
          astVerified: true,
          verificationMethod: verificationResult.method
        });
      } else {
        // 검증 실패 - False Positive로 판단
        filteredOut.push({
          ruleId: violation.ruleId,
          line: violation.line,
          reason: verificationResult.reason
        });
      }
    }

    // 결과 로깅
    if (filteredOut.length > 0) {
      logger.info(`      → 검증 통과: ${verifiedViolations.length}개, False Positive 제거: ${filteredOut.length}개`);
      logger.debug(`      제거된 위반: ${JSON.stringify(filteredOut)}`);
    } else {
      logger.info(`      → 모든 위반 검증 통과: ${verifiedViolations.length}개`);
    }

    return verifiedViolations;
  }

  /**
   * 단일 위반에 대한 검증 수행
   * 
   * @param {object} violation - 위반 객체
   * @param {object} astAnalysis - AST 분석 결과
   * @param {string} sourceCode - 소스 코드
   * @returns {object} { verified: boolean, method: string, reason?: string }
   */
  verifySingleViolation(violation, astAnalysis, sourceCode) {
    // llm_with_ast가 아닌 위반은 검증 없이 통과
    if (violation.checkType !== 'llm_with_ast') {
      return { verified: true, method: 'skip_non_ast' };
    }

    // 규칙 정보 조회
    const rule = this.contextualRules.get(violation.ruleId);
    if (!rule || !rule.astHints) {
      // 규칙 정보 없으면 LLM 결과 신뢰
      return { verified: true, method: 'no_rule_info' };
    }

    const astHints = rule.astHints;
    const line = violation.line || 0;

    // 검증 유형 결정 및 실행
    try {
      // 1. 빈 catch 블록 검증
      if (astHints.checkEmpty && astHints.nodeTypes?.includes('CatchClause')) {
        return this.verifyEmptyCatchBlock(line, sourceCode);
      }

      // 2. 빈 if/else 블록 검증
      if (astHints.checkEmpty && astHints.nodeTypes?.includes('IfStatement')) {
        return this.verifyEmptyIfBlock(line, sourceCode);
      }

      // 3. 메서드 길이 검증
      if (astHints.maxLineCount && astHints.nodeTypes?.includes('MethodDeclaration')) {
        return this.verifyMethodLength(line, sourceCode, astHints.maxLineCount);
      }

      // 4. 복잡도 검증
      if (astHints.maxCyclomaticComplexity) {
        return this.verifyCyclomaticComplexity(astAnalysis, astHints.maxCyclomaticComplexity);
      }

      // 5. 필수 어노테이션 검증
      if (astHints.requiredAnnotations && astHints.requiredAnnotations.length > 0) {
        return this.verifyRequiredAnnotations(line, sourceCode, astAnalysis, astHints.requiredAnnotations);
      }

      // 6. 명명 규칙 검증 (의미론적 검사는 LLM 신뢰)
      if (astHints.namingPattern) {
        return this.verifyNamingPattern(line, sourceCode, astHints.namingPattern);
      }

      // 기타 - 검증 로직 없으면 LLM 결과 신뢰
      return { verified: true, method: 'no_verification_logic' };

    } catch (error) {
      logger.warn(`      검증 중 오류 (${violation.ruleId}): ${error.message}`);
      // 오류 시 LLM 결과 신뢰
      return { verified: true, method: 'error_fallback' };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 빈 catch 블록 검증
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * 빈 catch 블록 검증
   * 
   * @param {number} reportedLine - LLM이 보고한 라인
   * @param {string} sourceCode - 소스 코드
   * @returns {object} 검증 결과
   */
  verifyEmptyCatchBlock(reportedLine, sourceCode) {
    const lines = sourceCode.split('\n');

    // 보고된 라인 근처에서 catch 블록 찾기 (±5줄 범위)
    const searchStart = Math.max(0, reportedLine - 6);
    const searchEnd = Math.min(lines.length, reportedLine + 5);

    for (let i = searchStart; i < searchEnd; i++) {
      const line = lines[i];

      // catch 키워드 찾기
      if (/\bcatch\s*\(/.test(line)) {
        // catch 블록의 시작과 끝 찾기
        const catchBlockInfo = this.extractCatchBlockContent(lines, i);

        if (catchBlockInfo.found) {
          const isEmpty = this.isCatchBlockEmpty(catchBlockInfo.content);

          if (isEmpty) {
            return {
              verified: true,
              method: 'catch_block_verified_empty',
              details: `라인 ${i + 1}의 catch 블록이 비어있음 확인`
            };
          } else {
            return {
              verified: false,
              method: 'catch_block_not_empty',
              reason: `라인 ${i + 1}의 catch 블록에 코드가 있음`
            };
          }
        }
      }
    }

    // catch 블록을 찾지 못한 경우
    // LLM이 다른 위치를 보고했을 수 있으므로 전체 코드에서 빈 catch 찾기
    const emptyCatchExists = this.hasAnyCatchBlockEmpty(sourceCode);

    if (emptyCatchExists) {
      return {
        verified: true,
        method: 'empty_catch_found_elsewhere',
        details: '빈 catch 블록이 코드 내 존재함'
      };
    }

    return {
      verified: false,
      method: 'no_empty_catch_found',
      reason: '코드에서 빈 catch 블록을 찾을 수 없음'
    };
  }

  /**
   * catch 블록 내용 추출
   * 
   * @param {string[]} lines - 소스 코드 라인 배열
   * @param {number} catchLineIndex - catch 키워드가 있는 라인 인덱스
   * @returns {object} { found: boolean, content: string }
   */
  extractCatchBlockContent(lines, catchLineIndex) {
    let braceCount = 0;
    let started = false;
    let content = '';

    for (let i = catchLineIndex; i < lines.length; i++) {
      const line = lines[i];

      for (const char of line) {
        if (char === '{') {
          braceCount++;
          started = true;
        } else if (char === '}') {
          braceCount--;
          if (started && braceCount === 0) {
            return { found: true, content: content.trim() };
          }
        } else if (started && braceCount > 0) {
          content += char;
        }
      }

      if (started && braceCount > 0) {
        content += '\n';
      }
    }

    return { found: false, content: '' };
  }

  /**
   * catch 블록이 비어있는지 확인
   * 
   * @param {string} content - catch 블록 내용
   * @returns {boolean} 비어있으면 true
   */
  isCatchBlockEmpty(content) {
    // 공백, 줄바꿈, 주석만 있으면 비어있는 것으로 판단
    const cleaned = content
      .replace(/\/\/.*$/gm, '')  // 한 줄 주석 제거
      .replace(/\/\*[\s\S]*?\*\//g, '')  // 블록 주석 제거
      .replace(/\s+/g, '');  // 공백 제거

    return cleaned.length === 0;
  }

  /**
   * 코드 전체에서 빈 catch 블록 존재 여부 확인
   * 
   * @param {string} sourceCode - 소스 코드
   * @returns {boolean} 빈 catch 블록이 있으면 true
   */
  hasAnyCatchBlockEmpty(sourceCode) {
    // 빈 catch 블록 패턴: catch(...) { } 또는 catch(...) { // 주석만 }
    const emptyCatchPattern = /catch\s*\([^)]*\)\s*\{\s*(\/\/[^\n]*\s*|\/\*[\s\S]*?\*\/\s*)*\}/;
    return emptyCatchPattern.test(sourceCode);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 빈 if 블록 검증
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * 빈 if/else 블록 검증
   * 
   * @param {number} reportedLine - LLM이 보고한 라인
   * @param {string} sourceCode - 소스 코드
   * @returns {object} 검증 결과
   */
  verifyEmptyIfBlock(reportedLine, sourceCode) {
    const lines = sourceCode.split('\n');
    const searchStart = Math.max(0, reportedLine - 6);
    const searchEnd = Math.min(lines.length, reportedLine + 5);

    for (let i = searchStart; i < searchEnd; i++) {
      const line = lines[i];

      if (/\bif\s*\(/.test(line) || /\belse\s*\{/.test(line)) {
        const blockInfo = this.extractBlockContent(lines, i);

        if (blockInfo.found && this.isBlockEmpty(blockInfo.content)) {
          return {
            verified: true,
            method: 'if_block_verified_empty'
          };
        }
      }
    }

    // 전체에서 빈 if/else 블록 찾기
    const emptyIfPattern = /(if\s*\([^)]*\)|else)\s*\{\s*(\/\/[^\n]*\s*|\/\*[\s\S]*?\*\/\s*)*\}/;
    if (emptyIfPattern.test(sourceCode)) {
      return { verified: true, method: 'empty_if_found_elsewhere' };
    }

    return {
      verified: false,
      reason: '코드에서 빈 if/else 블록을 찾을 수 없음'
    };
  }

  /**
   * 블록 내용 추출 (일반용)
   * 
   * @param {string[]} lines - 소스 코드 라인 배열
   * @param {number} startLineIndex - 시작 라인 인덱스
   * @returns {object} { found: boolean, content: string }
   */
  extractBlockContent(lines, startLineIndex) {
    let braceCount = 0;
    let started = false;
    let content = '';

    for (let i = startLineIndex; i < lines.length; i++) {
      const line = lines[i];

      for (const char of line) {
        if (char === '{') {
          braceCount++;
          started = true;
        } else if (char === '}') {
          braceCount--;
          if (started && braceCount === 0) {
            return { found: true, content: content.trim() };
          }
        } else if (started && braceCount > 0) {
          content += char;
        }
      }

      if (started && braceCount > 0) {
        content += '\n';
      }
    }

    return { found: false, content: '' };
  }

  /**
   * 블록이 비어있는지 확인 (일반용)
   * 
   * @param {string} content - 블록 내용
   * @returns {boolean} 비어있으면 true
   */
  isBlockEmpty(content) {
    const cleaned = content
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, '');

    return cleaned.length === 0;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 메서드 길이 검증
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * 메서드 길이 검증
   * 
   * @param {number} reportedLine - LLM이 보고한 라인
   * @param {string} sourceCode - 소스 코드
   * @param {number} maxLineCount - 최대 허용 라인 수
   * @returns {object} 검증 결과
   */
  verifyMethodLength(reportedLine, sourceCode, maxLineCount) {
    const lines = sourceCode.split('\n');

    // 보고된 라인 근처에서 메서드 시작 찾기
    const methodInfo = this.findMethodAtLine(lines, reportedLine);

    if (!methodInfo.found) {
      // 메서드를 찾지 못하면 전체에서 긴 메서드 있는지 확인
      const hasLongMethod = this.hasAnyLongMethod(sourceCode, maxLineCount);
      if (hasLongMethod) {
        return { verified: true, method: 'long_method_found_elsewhere' };
      }
      return { verified: false, reason: '긴 메서드를 찾을 수 없음' };
    }

    const methodLineCount = methodInfo.endLine - methodInfo.startLine + 1;

    if (methodLineCount > maxLineCount) {
      return {
        verified: true,
        method: 'method_length_verified',
        details: `메서드 '${methodInfo.name}' 길이: ${methodLineCount}줄 (최대: ${maxLineCount}줄)`
      };
    }

    return {
      verified: false,
      reason: `메서드 '${methodInfo.name}' 길이 ${methodLineCount}줄은 ${maxLineCount}줄 이하`
    };
  }

  /**
   * 특정 라인에서 메서드 찾기
   * 
   * @param {string[]} lines - 소스 코드 라인 배열
   * @param {number} targetLine - 대상 라인 (1-based)
   * @returns {object} { found: boolean, name?: string, startLine?: number, endLine?: number }
   */
  findMethodAtLine(lines, targetLine) {
    // 메서드 시작 패턴
    const methodPattern = /(?:public|private|protected)?\s*(?:static)?\s*\w+\s+(\w+)\s*\([^)]*\)\s*(?:throws\s+[\w,\s]+)?\s*\{/;

    // targetLine 위쪽으로 메서드 시작 찾기
    for (let i = Math.min(targetLine - 1, lines.length - 1); i >= 0; i--) {
      const line = lines[i];
      const match = line.match(methodPattern);

      if (match) {
        // 메서드 끝 찾기
        let braceCount = 0;
        let endLine = i;

        for (let j = i; j < lines.length; j++) {
          for (const char of lines[j]) {
            if (char === '{') braceCount++;
            else if (char === '}') braceCount--;
          }

          if (braceCount === 0 && j > i) {
            endLine = j;
            break;
          }
        }

        return {
          found: true,
          name: match[1],
          startLine: i,
          endLine: endLine
        };
      }
    }

    return { found: false };
  }

  /**
   * 코드에 긴 메서드가 있는지 확인
   * 
   * @param {string} sourceCode - 소스 코드
   * @param {number} maxLineCount - 최대 허용 라인 수
   * @returns {boolean} 긴 메서드가 있으면 true
   */
  hasAnyLongMethod(sourceCode, maxLineCount) {
    const lines = sourceCode.split('\n');
    const methodPattern = /(?:public|private|protected)?\s*(?:static)?\s*\w+\s+\w+\s*\([^)]*\)\s*(?:throws\s+[\w,\s]+)?\s*\{/;

    for (let i = 0; i < lines.length; i++) {
      if (methodPattern.test(lines[i])) {
        const methodInfo = this.findMethodAtLine(lines, i + 1);
        if (methodInfo.found) {
          const length = methodInfo.endLine - methodInfo.startLine + 1;
          if (length > maxLineCount) {
            return true;
          }
        }
      }
    }

    return false;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 복잡도 검증
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * 순환 복잡도 검증
   * 
   * @param {object} astAnalysis - AST 분석 결과
   * @param {number} maxComplexity - 최대 허용 복잡도
   * @returns {object} 검증 결과
   */
  verifyCyclomaticComplexity(astAnalysis, maxComplexity) {
    const actualComplexity = astAnalysis?.cyclomaticComplexity || 0;

    if (actualComplexity > maxComplexity) {
      return {
        verified: true,
        method: 'complexity_verified',
        details: `복잡도: ${actualComplexity} (최대: ${maxComplexity})`
      };
    }

    return {
      verified: false,
      reason: `복잡도 ${actualComplexity}는 ${maxComplexity} 이하`
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 필수 어노테이션 검증
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * 필수 어노테이션 검증
   * 
   * @param {number} reportedLine - LLM이 보고한 라인
   * @param {string} sourceCode - 소스 코드
   * @param {object} astAnalysis - AST 분석 결과
   * @param {array} requiredAnnotations - 필수 어노테이션 목록
   * @returns {object} 검증 결과
   */
  verifyRequiredAnnotations(reportedLine, sourceCode, astAnalysis, requiredAnnotations) {
    // AST 분석 결과에서 어노테이션 확인
    const presentAnnotations = astAnalysis?.annotations?.map(a =>
      typeof a === 'string' ? a : a.name
    ) || [];

    // 소스 코드에서도 확인
    const sourceAnnotations = [];
    const annotationPattern = /@(\w+)/g;
    let match;
    while ((match = annotationPattern.exec(sourceCode)) !== null) {
      sourceAnnotations.push(match[1]);
    }

    const allAnnotations = new Set([...presentAnnotations, ...sourceAnnotations]);

    // 필수 어노테이션 중 없는 것 찾기
    const missingAnnotations = requiredAnnotations.filter(req => {
      const reqName = req.replace('@', '');
      return !allAnnotations.has(reqName);
    });

    if (missingAnnotations.length > 0) {
      return {
        verified: true,
        method: 'missing_annotations_verified',
        details: `누락된 어노테이션: ${missingAnnotations.join(', ')}`
      };
    }

    return {
      verified: false,
      reason: '모든 필수 어노테이션이 존재함'
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 명명 규칙 검증
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * 명명 규칙 검증 (형식만, 의미는 LLM 신뢰)
   * 
   * @param {number} reportedLine - LLM이 보고한 라인
   * @param {string} sourceCode - 소스 코드
   * @param {string} expectedPattern - 예상 명명 패턴 (PascalCase, camelCase 등)
   * @returns {object} 검증 결과
   */
  verifyNamingPattern(reportedLine, sourceCode, expectedPattern) {
    const lines = sourceCode.split('\n');
    const targetLine = lines[reportedLine - 1] || '';

    // 패턴별 검증 정규식
    const patterns = {
      'PascalCase': /^[A-Z][a-zA-Z0-9]*$/,
      'camelCase': /^[a-z][a-zA-Z0-9]*$/,
      'UPPER_SNAKE_CASE': /^[A-Z][A-Z0-9_]*$/,
      'snake_case': /^[a-z][a-z0-9_]*$/
    };

    const patternRegex = patterns[expectedPattern];
    if (!patternRegex) {
      // 알 수 없는 패턴 - LLM 결과 신뢰
      return { verified: true, method: 'unknown_pattern_trust_llm' };
    }

    // 라인에서 식별자 추출
    const identifierMatches = targetLine.match(/\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g) || [];

    // 위반되는 식별자가 있는지 확인
    for (const identifier of identifierMatches) {
      // Java 키워드 제외
      if (this.isJavaKeyword(identifier)) continue;

      // 패턴 위반 확인
      if (!patternRegex.test(identifier)) {
        return {
          verified: true,
          method: 'naming_pattern_violation_found',
          details: `'${identifier}'는 ${expectedPattern} 규칙 위반`
        };
      }
    }

    // 해당 라인에서 위반 못 찾음 - 의미론적 위반일 수 있으므로 LLM 신뢰
    return { verified: true, method: 'naming_semantic_trust_llm' };
  }

  /**
   * Java 키워드 여부 확인
   * 
   * @param {string} word - 확인할 단어
   * @returns {boolean} 키워드면 true
   */
  isJavaKeyword(word) {
    const keywords = [
      'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch',
      'char', 'class', 'const', 'continue', 'default', 'do', 'double',
      'else', 'enum', 'extends', 'final', 'finally', 'float', 'for',
      'goto', 'if', 'implements', 'import', 'instanceof', 'int',
      'interface', 'long', 'native', 'new', 'package', 'private',
      'protected', 'public', 'return', 'short', 'static', 'strictfp',
      'super', 'switch', 'synchronized', 'this', 'throw', 'throws',
      'transient', 'try', 'void', 'volatile', 'while', 'true', 'false', 'null',
      // 추가 예약어
      'var', 'yield', 'record', 'sealed', 'permits', 'non-sealed'
    ];
    return keywords.includes(word);
  }
}

export default DevelopmentGuidelineChecker;
