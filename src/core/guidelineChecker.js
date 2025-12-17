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

    // Step 1: 정적 규칙 검사 (SonarQube 연동 전까지 선택적)
    if (!options.skipStaticRules && this.staticRules.size > 0) {
      logger.info('  ⚠️ 정적 규칙 검사는 SonarQube 연동 후 지원 예정');
      // TODO: SonarQube 연동 시 구현
    }

    // Step 2: 컨텍스트 규칙 검사 (LLM 전담)
    if (!options.skipContextual) {
      const useUnified = options.useUnifiedPrompt !== false; // 기본: true
      const useTagFiltering = options.useTagFiltering !== false && this.tagFilteringEnabled; // 기본: true

      let contextualViolations;

      if (useTagFiltering) {
        // v3.0: 태그 기반 필터링 방식
        contextualViolations = await this.checkContextualRulesWithTags(
          sourceCode,
          astAnalysis,
          { useUnifiedPrompt: useUnified }
        );
      } else if (useUnified) {
        // 기존 통합 프롬프트 방식 (효율적)
        contextualViolations = await this.checkContextualRulesUnified(sourceCode, astAnalysis);
      } else {
        // 기존 배치 방식 (폴백)
        contextualViolations = await this.checkContextualRulesBatch(sourceCode);
      }

      violations.push(...contextualViolations);
    }

    // 중복 제거
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
}

export default DevelopmentGuidelineChecker;
