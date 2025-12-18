/**
 * 개발가이드 전용 검사기 (Layer1: DevelopmentGuidelineChecker)
 * 
 * 금융권 Java 코드 정적 분석 시스템의 Layer1 컴포넌트
 * 
 * v4.0 아키텍처 (checkType 재구성):
 * ┌─────────────────────────────────────────────────────────────┐
 * │                    개발가이드 규칙 (v4.0)                     │
 * ├─────────────────────┬───────────────────────────────────────┤
 * │   pure_regex        │    LLM 스킵, 정규식만으로 판정           │
 * │   llm_with_regex    │    정규식 후보 탐지 → LLM 검증           │
 * │   llm_contextual    │    태그/키워드 필터 → LLM 분석           │
 * │   llm_with_ast      │    AST 정보 + LLM 검증                  │
 * └─────────────────────┴───────────────────────────────────────┘
 *                              │
 *                              ▼
 * ┌─────────────────────────────────────────────────────────────┐
 * │              v4.0 단계적 필터링 + 통합 LLM 프롬프트            │
 * ├─────────────────────────────────────────────────────────────┤
 * │  1. preFilterRules()로 checkType별 사전 필터링               │
 * │     - pure_regex → 즉시 위반 판정 (LLM 스킵)                 │
 * │     - llm_with_regex → 정규식 후보 탐지                      │
 * │     - llm_contextual → 태그/키워드 조건 확인                 │
 * │     - llm_with_ast → AST 조건 확인                          │
 * │  2. buildSectionedLLMPrompt()로 섹션별 통합 프롬프트 생성     │
 * │  3. LLM 1회 호출로 모든 후보 검증                            │
 * └─────────────────────────────────────────────────────────────┘
 * 
 * @module DevelopmentGuidelineChecker
 * @version 4.0.0 - checkType 재구성, 단계적 필터링
 */
import { VectorClient } from '../clients/vectorClient.js';
import { LLMService } from '../clients/llmService.js';
import { CodeProfiler } from '../profiler/CodeProfiler.js';
import { RuleMatcher } from '../matcher/RuleMatcher.js';
import logger from '../utils/loggerUtils.js';

/**
 * 🆕 v4.0 규칙 검사 타입 상수
 * @constant {Object}
 */
const CHECK_TYPES = {
  // v4.0 신규
  PURE_REGEX: 'pure_regex',           // 정규식만으로 100% 판정 (LLM 스킵)
  LLM_WITH_REGEX: 'llm_with_regex',   // 정규식 후보 → LLM 검증
  LLM_CONTEXTUAL: 'llm_contextual',   // 의미론적 분석 (LLM 전담)
  LLM_WITH_AST: 'llm_with_ast',       // AST + LLM 하이브리드

  // 레거시 (v3.x) - 마이그레이션용
  REGEX: 'regex',
  AST: 'ast',
  COMBINED: 'combined',
  STATIC_ANALYSIS: 'static_analysis'
};

/**
 * 🆕 v4.0 레거시 checkType 매핑
 */
const LEGACY_CHECK_TYPE_MAP = {
  'regex': 'pure_regex',
  'ast': 'llm_with_ast',
  'combined': 'llm_with_regex',
  'static_analysis': 'pure_regex',
  'regex_with_validation': 'llm_with_regex'
};

/**
 * 개발가이드 전용 검사기 클래스 (Layer1 Component)
 */
export class DevelopmentGuidelineChecker {
  /**
   * 생성자: 규칙 저장소 및 클라이언트 초기화
   */
  constructor() {
    // 컨텍스트 규칙 저장소 (모든 규칙)
    this.contextualRules = new Map();

    // 정적 규칙 저장소 (SonarQube 연동 준비용 - 현재 미사용)
    this.staticRules = new Map();

    // VectorDB 클라이언트
    this.vectorClient = new VectorClient();

    // LLM 서비스
    this.llmService = new LLMService();

    // 가이드 해석 전용 모델
    this.guidelineModel = process.env.GUIDELINE_LLM_MODEL || 'gpt-oss:120b';

    // 태그 기반 필터링 컴포넌트
    this.codeProfiler = null;
    this.ruleMatcher = null;
    this.tagFilteringEnabled = false;

    // 필터링 통계
    this.filteringStats = {
      totalChecks: 0,
      pureRegexViolations: 0,
      llmCandidates: 0,
      llmCalls: 0,
      falsePositivesFiltered: 0
    };

    // 🆕 v4.0 유효한 checkType
    this.validCheckTypes = ['pure_regex', 'llm_with_regex', 'llm_contextual', 'llm_with_ast'];
  }

  /**
   * 개발가이드 룰 초기화 프로세스
   */
  async initialize(options = {}) {
    logger.info('📋 개발가이드 룰 로딩 중 (v4.0)...');

    const { enableTagFiltering = true } = options;

    // VectorDB에서 규칙 로드
    await this.loadGuidelineRules();

    // 태그 기반 필터링 초기화
    if (enableTagFiltering) {
      await this.initializeTagFiltering();
    }

    // checkType 분포 출력
    this.logCheckTypeDistribution();

    logger.info(`✅ 개발가이드 룰 로딩 완료:`);
    logger.info(`   - 전체 규칙: ${this.contextualRules.size}개`);
    logger.info(`   - 태그 필터링: ${this.tagFilteringEnabled ? '활성화' : '비활성화'}`);
  }

  /**
   * 🆕 v4.0: checkType 분포 로깅
   */
  logCheckTypeDistribution() {
    const dist = { pure_regex: 0, llm_with_regex: 0, llm_contextual: 0, llm_with_ast: 0 };

    for (const rule of this.contextualRules.values()) {
      if (dist[rule.checkType] !== undefined) {
        dist[rule.checkType]++;
      }
    }

    logger.info('   📊 checkType 분포:');
    for (const [type, count] of Object.entries(dist)) {
      if (count > 0) {
        logger.info(`      - ${type}: ${count}개`);
      }
    }
  }

  /**
   * 태그 기반 필터링 초기화
   */
  async initializeTagFiltering() {
    try {
      logger.info('  🏷️ 태그 기반 필터링 초기화 중...');

      this.codeProfiler = new CodeProfiler();
      await this.codeProfiler.initialize({ enableTier2: true });

      this.ruleMatcher = new RuleMatcher();
      await this.ruleMatcher.initialize();

      this.tagFilteringEnabled = true;
      logger.info('  ✅ 태그 기반 필터링 초기화 완료');

    } catch (error) {
      logger.warn(`  ⚠️ 태그 기반 필터링 초기화 실패: ${error.message}`);
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

          // 🆕 v4.0: checkType 정규화
          let checkType = guideline.checkType || 'llm_contextual';
          let originalCheckType = guideline.originalCheckType || null;

          // 레거시 checkType 변환
          if (LEGACY_CHECK_TYPE_MAP[checkType]) {
            originalCheckType = checkType;
            checkType = LEGACY_CHECK_TYPE_MAP[checkType];
          }

          // 유효하지 않으면 llm_contextual로 폴백
          if (!this.validCheckTypes.includes(checkType)) {
            originalCheckType = checkType;
            checkType = 'llm_contextual';
          }

          const rule = {
            id: guideline.ruleId,
            ruleId: guideline.ruleId,
            title: guideline.title,
            category: guideline.category || 'general',
            description: guideline.description || '',
            severity: guideline.severity || 'MEDIUM',
            keywords: keywords,
            examples: examples,

            // 🆕 v4.0 checkType
            checkType: checkType,
            checkTypeReason: guideline.checkTypeReason || null,
            originalCheckType: originalCheckType,

            // 태그 조건
            tagCondition: guideline.tagCondition || null,
            requiredTags: guideline.requiredTags || [],
            excludeTags: guideline.excludeTags || [],

            // AST 관련
            astDescription: guideline.astDescription || null,
            checkPoints: Array.isArray(guideline.checkPoints) ? guideline.checkPoints : [],
            astHints: guideline.astHints || null,

            // 패턴
            antiPatterns: guideline.antiPatterns || [],
            goodPatterns: guideline.goodPatterns || []
          };

          this.contextualRules.set(guideline.ruleId, rule);
        });

        logger.info(`  📊 가이드라인 로드 완료: ${this.contextualRules.size}개`);
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
        id: 'REG-001',
        ruleId: 'REG-001',
        title: 'System.out.println 사용 금지',
        category: 'code_style',
        description: '프로덕션 코드에서 System.out.println 대신 로깅 프레임워크를 사용해야 합니다.',
        severity: 'MEDIUM',
        keywords: ['System', 'out', 'println'],
        examples: {
          good: ['logger.info("메시지")'],
          bad: ['System.out.println("디버그")']
        },
        checkType: 'pure_regex',
        antiPatterns: [
          { pattern: 'System\\.out\\.print(ln)?\\s*\\(', flags: 'g', description: 'System.out.print 호출' }
        ],
        goodPatterns: []
      },
      {
        id: 'REG-002',
        ruleId: 'REG-002',
        title: 'e.printStackTrace() 사용 금지',
        category: 'exception_handling',
        description: '예외 처리 시 printStackTrace() 대신 로깅 프레임워크를 사용해야 합니다.',
        severity: 'HIGH',
        keywords: ['printStackTrace', 'Exception', 'catch'],
        examples: {
          good: ['logger.error("오류 발생", e)'],
          bad: ['e.printStackTrace()']
        },
        checkType: 'pure_regex',
        antiPatterns: [
          { pattern: '\\.printStackTrace\\s*\\(\\s*\\)', flags: 'g', description: 'printStackTrace 호출' }
        ],
        goodPatterns: []
      },
      {
        id: 'LLR-001',
        ruleId: 'LLR-001',
        title: '빈 catch 블록 금지',
        category: 'exception_handling',
        description: 'catch 블록에서 예외를 무시하지 말고 최소한 로깅을 수행해야 합니다.',
        severity: 'HIGH',
        keywords: ['catch', 'try', 'Exception'],
        examples: {
          good: ['catch (Exception e) { logger.error("오류", e); }'],
          bad: ['catch (Exception e) { }']
        },
        checkType: 'llm_with_regex',
        antiPatterns: [
          { pattern: 'catch\\s*\\([^)]*\\)\\s*\\{\\s*\\}', flags: 'g', description: '빈 catch 블록' },
          { pattern: 'catch\\s*\\([^)]*\\)\\s*\\{\\s*\\/\\/[^\\n]*\\s*\\}', flags: 'g', description: '주석만 있는 catch' }
        ],
        goodPatterns: []
      },
      {
        id: 'CTX-001',
        ruleId: 'CTX-001',
        title: 'Controller에서 비즈니스 로직 분리',
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
        id: 'AST-001',
        ruleId: 'AST-001',
        title: '메서드 길이 제한',
        category: 'code_style',
        description: '메서드는 50줄을 초과하지 않아야 합니다.',
        severity: 'MEDIUM',
        keywords: ['method', 'public', 'private', 'void'],
        examples: {
          good: ['// 50줄 이하의 간결한 메서드'],
          bad: ['// 100줄이 넘는 긴 메서드']
        },
        checkType: 'llm_with_ast',
        astDescription: '메서드 선언을 검사하여 라인 수가 50을 초과하면 위반입니다.',
        checkPoints: [
          '메서드가 존재하는가?',
          '메서드의 라인 수가 50을 초과하는가?'
        ],
        astHints: {
          nodeTypes: ['MethodDeclaration'],
          maxLineCount: 50
        }
      }
    ];

    defaultRules.forEach(rule => {
      this.contextualRules.set(rule.ruleId, rule);
    });

    logger.info(`  📦 기본 규칙 ${defaultRules.length}개 로드 (v4.0)`);
  }

  /**
   * 텍스트에서 키워드 추출
   */
  extractKeywordsFromText(title, description) {
    const keywords = new Set();
    const text = `${title || ''} ${description || ''}`;

    const koreanWords = text.match(/[가-힣]{2,}/g) || [];
    koreanWords.forEach(w => keywords.add(w));

    const englishWords = text.match(/[A-Z][a-z]+|[a-z]+|[A-Z]+/g) || [];
    englishWords.forEach(w => {
      if (w.length >= 3) keywords.add(w);
    });

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

  // ═══════════════════════════════════════════════════════════════════════════
  // 🆕 v4.0 메인 검사 메서드 (전면 재작성)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * 가이드라인 규칙 검사 (v4.0 메인 엔트리포인트)
   * 
   * 처리 흐름:
   * 1. 코드 프로파일 생성 (선택적)
   * 2. preFilterRules()로 checkType별 사전 필터링
   *    - pure_regex → 즉시 위반 판정
   *    - llm_with_regex/contextual/ast → LLM 후보로 분류
   * 3. buildSectionedLLMPrompt()로 섹션별 통합 프롬프트 생성
   * 4. LLM 1회 호출로 모든 후보 검증
   * 5. AST 교차 검증 (llm_with_ast만)
   * 
   * @param {string} sourceCode - 검사할 소스 코드
   * @param {object} astAnalysis - AST 분석 결과
   * @param {object} options - 검사 옵션
   * @returns {Promise<array>} 위반사항 배열
   */
  async checkRules(sourceCode, astAnalysis, options = {}) {
    const startTime = Date.now();
    this.filteringStats.totalChecks++;

    logger.info('  🔍 v4.0 가이드라인 검사 시작...');

    // Step 1: 코드 프로파일 생성 (태그 필터링용)
    let profile = null;
    if (this.tagFilteringEnabled && options.useTagFiltering !== false) {
      try {
        profile = await this.codeProfiler.generateProfile(sourceCode, {
          enableTier2: true,
          includeCompound: true
        });
        logger.info(`    → 코드 프로파일: ${profile.tags.size}개 태그 (위험도: ${profile.riskLevel})`);
      } catch (error) {
        logger.warn(`    ⚠️ 프로파일 생성 실패: ${error.message}`);
      }
    }

    // Step 2: 사전 필터링
    logger.info('    Step 1: checkType별 사전 필터링...');
    const filterResult = this.preFilterRules(sourceCode, astAnalysis, profile);

    logger.info(`    → pure_regex 위반: ${filterResult.pureRegexViolations.length}개`);
    logger.info(`    → LLM 후보: ${filterResult.llmCandidates.total}개 ` +
      `(regex:${filterResult.llmCandidates.llm_with_regex.length}, ` +
      `ctx:${filterResult.llmCandidates.llm_contextual.length}, ` +
      `ast:${filterResult.llmCandidates.llm_with_ast.length})`);

    this.filteringStats.pureRegexViolations += filterResult.pureRegexViolations.length;
    this.filteringStats.llmCandidates += filterResult.llmCandidates.total;

    // Step 3: pure_regex 위반 수집
    const violations = [...filterResult.pureRegexViolations];

    // Step 4: LLM 검증 (후보가 있을 때만)
    if (filterResult.llmCandidates.total > 0) {
      logger.info('    Step 2: LLM 통합 검증...');
      this.filteringStats.llmCalls++;

      const llmViolations = await this.verifyWithSectionedPrompt(
        sourceCode, astAnalysis, filterResult.llmCandidates, profile
      );

      violations.push(...llmViolations);
    }

    // Step 5: 중복 제거 및 결과 반환
    const uniqueViolations = this.deduplicateViolations(violations);
    const elapsed = Date.now() - startTime;

    logger.info(`    ✅ 검사 완료: ${uniqueViolations.length}개 위반 (${elapsed}ms)`);

    return uniqueViolations;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🆕 v4.0 사전 필터링
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * 🆕 v4.0: checkType별 사전 필터링
   * 
   * @param {string} sourceCode - 소스 코드
   * @param {object} astAnalysis - AST 분석 결과
   * @param {object} profile - 코드 프로파일 (optional)
   * @returns {object} { pureRegexViolations, llmCandidates }
   */
  preFilterRules(sourceCode, astAnalysis, profile) {
    const pureRegexViolations = [];
    const llmCandidates = {
      llm_with_regex: [],
      llm_contextual: [],
      llm_with_ast: [],
      total: 0
    };

    const allRules = Array.from(this.contextualRules.values());

    for (const rule of allRules) {
      switch (rule.checkType) {
        case 'pure_regex':
          // 정규식 직접 매칭 → 즉시 위반 판정
          const regexResult = this.checkPureRegex(sourceCode, rule);
          if (regexResult.violations.length > 0) {
            pureRegexViolations.push(...regexResult.violations);
          }
          break;

        case 'llm_with_regex':
          // 정규식으로 후보 탐지 → LLM 검증 대상
          const candidates = this.findRegexCandidates(sourceCode, rule);
          if (candidates.length > 0) {
            llmCandidates.llm_with_regex.push({ rule, candidates });
            llmCandidates.total += 1;
          }
          break;

        case 'llm_contextual':
          // 태그/키워드 필터링 → LLM 검증 대상
          if (this.matchesContextualCondition(sourceCode, rule, profile)) {
            llmCandidates.llm_contextual.push({ rule });
            llmCandidates.total += 1;
          }
          break;

        case 'llm_with_ast':
          // AST 관련 조건 확인 → LLM 검증 대상
          if (this.matchesAstCondition(sourceCode, astAnalysis, rule)) {
            llmCandidates.llm_with_ast.push({ rule, astAnalysis });
            llmCandidates.total += 1;
          }
          break;

        default:
          // 알 수 없는 checkType → llm_contextual로 처리
          if (this.matchesContextualCondition(sourceCode, rule, profile)) {
            llmCandidates.llm_contextual.push({ rule });
            llmCandidates.total += 1;
          }
      }
    }

    return { pureRegexViolations, llmCandidates };
  }

  /**
   * 🆕 v4.0: 순수 정규식 검사 (LLM 없음)
   * 
   * @param {string} sourceCode - 소스 코드
   * @param {object} rule - 규칙 객체
   * @returns {object} { violations: array }
   */
  checkPureRegex(sourceCode, rule) {
    const violations = [];
    const lines = sourceCode.split('\n');

    // antiPatterns 검사
    if (rule.antiPatterns && rule.antiPatterns.length > 0) {
      for (const antiPattern of rule.antiPatterns) {
        try {
          const regex = new RegExp(antiPattern.pattern, antiPattern.flags || 'g');
          let match;

          while ((match = regex.exec(sourceCode)) !== null) {
            // 매칭 위치의 라인 번호 계산
            const beforeMatch = sourceCode.substring(0, match.index);
            const lineNumber = (beforeMatch.match(/\n/g) || []).length + 1;

            // goodPatterns로 예외 처리
            const lineContent = lines[lineNumber - 1] || '';
            if (this.matchesGoodPattern(lineContent, rule.goodPatterns)) {
              continue;
            }

            violations.push({
              ruleId: rule.ruleId,
              title: rule.title,
              line: lineNumber,
              column: match.index - beforeMatch.lastIndexOf('\n'),
              severity: rule.severity || 'MEDIUM',
              description: antiPattern.description || rule.description,
              suggestion: rule.examples?.good?.[0] || '패턴을 수정하세요',
              category: rule.category || 'general',
              checkType: 'pure_regex',
              source: 'guideline_checker_regex'
            });

            // 같은 규칙에서 너무 많은 위반 방지
            if (violations.filter(v => v.ruleId === rule.ruleId).length >= 5) {
              break;
            }
          }
        } catch (error) {
          logger.warn(`    ⚠️ 정규식 오류 [${rule.ruleId}]: ${error.message}`);
        }
      }
    }

    return { violations };
  }

  /**
   * goodPattern 매칭 여부 확인
   */
  matchesGoodPattern(lineContent, goodPatterns) {
    if (!goodPatterns || goodPatterns.length === 0) return false;

    for (const goodPattern of goodPatterns) {
      try {
        const regex = new RegExp(goodPattern.pattern, goodPattern.flags || 'g');
        if (regex.test(lineContent)) {
          return true;
        }
      } catch (error) {
        // 무시
      }
    }

    return false;
  }

  /**
   * 🆕 v4.0: 정규식으로 후보 탐지 (llm_with_regex용)
   * 
   * @param {string} sourceCode - 소스 코드
   * @param {object} rule - 규칙 객체
   * @returns {array} 후보 배열 [{ line, content, pattern }]
   */
  findRegexCandidates(sourceCode, rule) {
    const candidates = [];
    const lines = sourceCode.split('\n');

    if (!rule.antiPatterns || rule.antiPatterns.length === 0) {
      return candidates;
    }

    for (const antiPattern of rule.antiPatterns) {
      try {
        const regex = new RegExp(antiPattern.pattern, antiPattern.flags || 'g');
        let match;

        while ((match = regex.exec(sourceCode)) !== null) {
          const beforeMatch = sourceCode.substring(0, match.index);
          const lineNumber = (beforeMatch.match(/\n/g) || []).length + 1;
          const lineContent = lines[lineNumber - 1] || '';

          // goodPatterns로 이미 예외 처리되는 경우 스킵
          if (this.matchesGoodPattern(lineContent, rule.goodPatterns)) {
            continue;
          }

          // 컨텍스트 (앞뒤 2줄)
          const contextStart = Math.max(0, lineNumber - 3);
          const contextEnd = Math.min(lines.length, lineNumber + 2);
          const context = lines.slice(contextStart, contextEnd).join('\n');

          candidates.push({
            line: lineNumber,
            content: lineContent.trim(),
            matchedText: match[0],
            pattern: antiPattern.description || antiPattern.pattern,
            context: context
          });

          // 너무 많은 후보 방지
          if (candidates.length >= 10) {
            break;
          }
        }
      } catch (error) {
        logger.warn(`    ⚠️ 정규식 오류 [${rule.ruleId}]: ${error.message}`);
      }
    }

    return candidates;
  }

  /**
   * 🆕 v4.0: 컨텍스트 조건 매칭 (llm_contextual용)
   * 
   * @param {string} sourceCode - 소스 코드
   * @param {object} rule - 규칙 객체
   * @param {object} profile - 코드 프로파일
   * @returns {boolean} 매칭 여부
   */
  matchesContextualCondition(sourceCode, rule, profile) {
    // 1. tagCondition 평가 (프로파일 있을 때)
    if (rule.tagCondition && profile) {
      try {
        const matched = this.ruleMatcher?.evaluateCondition(rule.tagCondition, profile.tags);
        if (matched) return true;
      } catch (error) {
        // 평가 실패 시 keywords 폴백
      }
    }

    // 2. keywords 기반 필터링
    if (rule.keywords && rule.keywords.length > 0) {
      const lowerCode = sourceCode.toLowerCase();
      const hasKeyword = rule.keywords.some(kw =>
        lowerCode.includes(kw.toLowerCase())
      );
      if (hasKeyword) return true;
    }

    // 3. tagCondition도 keywords도 없으면 기본 포함
    if (!rule.tagCondition && (!rule.keywords || rule.keywords.length === 0)) {
      return true;
    }

    return false;
  }

  /**
   * 🆕 v4.0: AST 조건 매칭 (llm_with_ast용)
   * 
   * @param {string} sourceCode - 소스 코드
   * @param {object} astAnalysis - AST 분석 결과
   * @param {object} rule - 규칙 객체
   * @returns {boolean} 매칭 여부
   */
  matchesAstCondition(sourceCode, astAnalysis, rule) {
    const astHints = rule.astHints || {};

    // AST 힌트가 없으면 keywords로 폴백
    if (Object.keys(astHints).length === 0) {
      return this.matchesContextualCondition(sourceCode, rule, null);
    }

    // nodeTypes 검사
    if (astHints.nodeTypes && astHints.nodeTypes.length > 0) {
      if (!this.checkNodeTypesPresent(astAnalysis, astHints.nodeTypes, sourceCode)) {
        return false;
      }
    }

    // keywords 검사
    if (rule.keywords && rule.keywords.length > 0) {
      const lowerCode = sourceCode.toLowerCase();
      const hasKeyword = rule.keywords.some(kw =>
        lowerCode.includes(kw.toLowerCase())
      );
      if (!hasKeyword) return false;
    }

    return true;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🆕 v4.0 섹션별 통합 LLM 프롬프트
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * 🆕 v4.0: 섹션별 통합 프롬프트로 LLM 검증
   * 
   * @param {string} sourceCode - 소스 코드
   * @param {object} astAnalysis - AST 분석 결과
   * @param {object} llmCandidates - LLM 후보 객체
   * @param {object} profile - 코드 프로파일
   * @returns {Promise<array>} 위반사항 배열
   */
  async verifyWithSectionedPrompt(sourceCode, astAnalysis, llmCandidates, profile) {
    const prompt = this.buildSectionedLLMPrompt(sourceCode, astAnalysis, llmCandidates, profile);

    try {
      const response = await this.llmService.generateCompletion(prompt, {
        model: this.guidelineModel,
        temperature: 0.1,
        num_predict: 3000
      });

      const violations = this.parseSectionedResponse(response, llmCandidates);

      // llm_with_ast 위반에 대해 AST 교차 검증
      const verifiedViolations = this.verifyViolationsWithAST(
        violations.filter(v => v.checkType === 'llm_with_ast'),
        astAnalysis,
        sourceCode
      );

      // 다른 타입 위반과 합치기
      const otherViolations = violations.filter(v => v.checkType !== 'llm_with_ast');

      return [...otherViolations, ...verifiedViolations];

    } catch (error) {
      logger.warn(`    ⚠️ LLM 검증 실패: ${error.message}, 배치 방식으로 폴백`);
      return this.fallbackBatchVerification(sourceCode, llmCandidates);
    }
  }

  /**
   * 🆕 v4.0: 섹션별 통합 프롬프트 생성
   * 
   * 섹션 구조:
   * [A] 정규식 탐지 후보 (llm_with_regex) - 문맥 고려 위반 여부 판단
   * [B] 의미 분석 필요 (llm_contextual) - 비즈니스 로직/아키텍처 관점
   * [C] AST 구조 분석 필요 (llm_with_ast) - 체크포인트 기준 판단
   */
  buildSectionedLLMPrompt(sourceCode, astAnalysis, llmCandidates, profile) {
    // AST 정보 요약
    const astSummary = astAnalysis ? `
## 코드 구조 정보
- 클래스: ${astAnalysis.classes?.map(c => c.name).join(', ') || 'N/A'}
- 메서드 수: ${astAnalysis.methods?.length || 0}개
- 어노테이션: ${astAnalysis.annotations?.slice(0, 10).join(', ') || 'N/A'}
` : '';

    // 프로파일 정보 요약
    const profileSummary = profile ? `
## 코드 프로파일
- 태그: ${Array.from(profile.tags).slice(0, 15).join(', ')}
- 위험 수준: ${profile.riskLevel}
` : '';

    // 섹션 [A] 정규식 후보
    let sectionA = '';
    if (llmCandidates.llm_with_regex.length > 0) {
      const items = llmCandidates.llm_with_regex.map((item, idx) => {
        const candidateList = item.candidates.map(c =>
          `  - 라인 ${c.line}: "${c.content.substring(0, 60)}..." (${c.pattern})`
        ).join('\n');

        return `
A${idx + 1}. ${item.rule.title} [${item.rule.ruleId}]
- 설명: ${item.rule.description}
- 탐지된 후보:
${candidateList}
- 올바른 예: ${item.rule.examples?.good?.[0] || '없음'}
- 잘못된 예: ${item.rule.examples?.bad?.[0] || '없음'}`;
      }).join('\n');

      sectionA = `
### [A] 정규식 탐지 후보 (llm_with_regex)
정규식으로 의심 코드가 탐지되었습니다. **문맥을 고려하여** 실제 위반인지 판단하세요.
의도적 무시, 테스트 코드, 주석 내 코드 등은 위반이 아닙니다.
${items}
`;
    }

    // 섹션 [B] 의미 분석
    let sectionB = '';
    if (llmCandidates.llm_contextual.length > 0) {
      const items = llmCandidates.llm_contextual.map((item, idx) => {
        return `
B${idx + 1}. ${item.rule.title} [${item.rule.ruleId}]
- 설명: ${item.rule.description}
- 키워드: ${item.rule.keywords?.join(', ') || '없음'}
- 올바른 예: ${item.rule.examples?.good?.[0] || '없음'}
- 잘못된 예: ${item.rule.examples?.bad?.[0] || '없음'}`;
      }).join('\n');

      sectionB = `
### [B] 의미 분석 필요 (llm_contextual)
비즈니스 로직, 아키텍처 패턴 관점에서 분석하세요.
코드의 의미와 의도를 파악하여 위반 여부를 판단합니다.
${items}
`;
    }

    // 섹션 [C] AST 분석
    let sectionC = '';
    if (llmCandidates.llm_with_ast.length > 0) {
      const items = llmCandidates.llm_with_ast.map((item, idx) => {
        const checkPoints = item.rule.checkPoints || [];
        const checkPointsText = checkPoints.length > 0
          ? checkPoints.map((cp, i) => `  ${i + 1}. ${cp}`).join('\n')
          : '  - 규칙 설명 참조';

        return `
C${idx + 1}. ${item.rule.title} [${item.rule.ruleId}]
- AST 기준: ${item.rule.astDescription || item.rule.description}
- 체크포인트:
${checkPointsText}
- 올바른 예: ${item.rule.examples?.good?.[0] || '없음'}
- 잘못된 예: ${item.rule.examples?.bad?.[0] || '없음'}`;
      }).join('\n');

      sectionC = `
### [C] AST 구조 분석 필요 (llm_with_ast)
코드 구조 정보와 체크포인트를 기준으로 판단하세요.
각 체크포인트를 순서대로 확인하여 위반 여부를 결정합니다.
${items}
`;
    }

    return `당신은 금융권 Java 코드 품질 전문가입니다.
아래 개발 가이드라인을 기반으로 코드를 검사하고 위반사항을 찾아주세요.

## 검사 대상 코드
\`\`\`java
${this.truncateCode(sourceCode, 5000)}
\`\`\`
${astSummary}
${profileSummary}

## 검증할 규칙들
${sectionA}
${sectionB}
${sectionC}

## 검사 지침
1. 각 섹션의 지침에 따라 판단하세요
2. **확실한 위반만** 보고하세요 (False Positive 최소화)
3. 위반 라인 번호를 정확히 지정하세요
4. section 필드에 해당 규칙의 섹션(A/B/C)을 명시하세요

## 응답 형식 (JSON)
\`\`\`json
{
  "violations": [
    {
      "ruleId": "규칙 ID",
      "section": "A|B|C",
      "line": 위반 라인 번호,
      "isViolation": true,
      "confidence": 0.0-1.0,
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
   * 🆕 v4.0: 섹션별 응답 파싱
   */
  parseSectionedResponse(response, llmCandidates) {
    const violations = [];

    try {
      const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : response;
      const cleaned = jsonStr.replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);

      if (parsed.violations && Array.isArray(parsed.violations)) {
        for (const v of parsed.violations) {
          if (v.isViolation === false) continue;

          // 섹션에서 규칙 찾기
          let rule = null;
          let checkType = 'llm_contextual';

          if (v.section === 'A') {
            const item = llmCandidates.llm_with_regex.find(i => i.rule.ruleId === v.ruleId);
            rule = item?.rule;
            checkType = 'llm_with_regex';
          } else if (v.section === 'B') {
            const item = llmCandidates.llm_contextual.find(i => i.rule.ruleId === v.ruleId);
            rule = item?.rule;
            checkType = 'llm_contextual';
          } else if (v.section === 'C') {
            const item = llmCandidates.llm_with_ast.find(i => i.rule.ruleId === v.ruleId);
            rule = item?.rule;
            checkType = 'llm_with_ast';
          } else {
            // 섹션 없으면 ruleId로 찾기
            rule = this.contextualRules.get(v.ruleId);
            checkType = rule?.checkType || 'llm_contextual';
          }

          violations.push({
            ruleId: v.ruleId || 'UNKNOWN',
            title: rule?.title || v.title || '',
            line: v.line || 0,
            column: v.column || 0,
            severity: rule?.severity || 'MEDIUM',
            description: v.description || '',
            suggestion: v.suggestion || '',
            confidence: v.confidence || 0.8,
            category: rule?.category || 'general',
            checkType: checkType,
            source: 'guideline_checker_v4'
          });
        }
      }

    } catch (error) {
      logger.warn(`    응답 파싱 실패: ${error.message}`);
    }

    return violations;
  }

  /**
   * LLM 실패 시 배치 폴백
   */
  async fallbackBatchVerification(sourceCode, llmCandidates) {
    const violations = [];
    const allRules = [
      ...llmCandidates.llm_with_regex.map(i => i.rule),
      ...llmCandidates.llm_contextual.map(i => i.rule),
      ...llmCandidates.llm_with_ast.map(i => i.rule)
    ];

    if (allRules.length === 0) return violations;

    const batchSize = 3;
    for (let i = 0; i < allRules.length; i += batchSize) {
      const batch = allRules.slice(i, i + batchSize);
      try {
        const batchViolations = await this.checkRulesBatchLLM(sourceCode, batch);
        violations.push(...batchViolations);
      } catch (error) {
        logger.warn(`    배치 폴백 실패: ${error.message}`);
      }

      if (i + batchSize < allRules.length) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    return violations;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 기존 메서드들 (하위 호환성 유지)
  // ═══════════════════════════════════════════════════════════════════════════

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

  /**
   * 적용 가능한 규칙 필터링 (기존 keywords 방식 - 하위 호환)
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
              checkType: rule?.checkType || 'llm_contextual',
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

  // ═══════════════════════════════════════════════════════════════════════════
  // AST 관련 메서드
  // ═══════════════════════════════════════════════════════════════════════════

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

  /**
   * LLM이 발견한 위반을 AST/소스코드로 교차 검증
   */
  verifyViolationsWithAST(violations, astAnalysis, sourceCode) {
    if (!violations || violations.length === 0) {
      return [];
    }

    logger.info(`      🔍 AST 교차 검증: ${violations.length}개 위반`);

    const verifiedViolations = [];

    for (const violation of violations) {
      const verificationResult = this.verifySingleViolation(violation, astAnalysis, sourceCode);

      if (verificationResult.verified) {
        verifiedViolations.push({
          ...violation,
          astVerified: true,
          verificationMethod: verificationResult.method
        });
      } else {
        this.filteringStats.falsePositivesFiltered++;
        logger.debug(`      → FP 제거: ${violation.ruleId} (${verificationResult.reason})`);
      }
    }

    logger.info(`      → 검증 통과: ${verifiedViolations.length}개`);
    return verifiedViolations;
  }

  /**
   * 단일 위반에 대한 검증 수행
   */
  verifySingleViolation(violation, astAnalysis, sourceCode) {
    if (violation.checkType !== 'llm_with_ast') {
      return { verified: true, method: 'skip_non_ast' };
    }

    const rule = this.contextualRules.get(violation.ruleId);
    if (!rule || !rule.astHints) {
      return { verified: true, method: 'no_rule_info' };
    }

    const astHints = rule.astHints;
    const line = violation.line || 0;

    try {
      // 빈 catch 블록 검증
      if (astHints.checkEmpty && astHints.nodeTypes?.includes('CatchClause')) {
        return this.verifyEmptyCatchBlock(line, sourceCode);
      }

      // 메서드 길이 검증
      if (astHints.maxLineCount && astHints.nodeTypes?.includes('MethodDeclaration')) {
        return this.verifyMethodLength(line, sourceCode, astHints.maxLineCount);
      }

      // 복잡도 검증
      if (astHints.maxCyclomaticComplexity) {
        return this.verifyCyclomaticComplexity(astAnalysis, astHints.maxCyclomaticComplexity);
      }

      return { verified: true, method: 'no_verification_logic' };

    } catch (error) {
      return { verified: true, method: 'error_fallback' };
    }
  }

  /**
   * 빈 catch 블록 검증
   */
  verifyEmptyCatchBlock(reportedLine, sourceCode) {
    const lines = sourceCode.split('\n');
    const searchStart = Math.max(0, reportedLine - 6);
    const searchEnd = Math.min(lines.length, reportedLine + 5);

    for (let i = searchStart; i < searchEnd; i++) {
      const line = lines[i];

      if (/\bcatch\s*\(/.test(line)) {
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

    const emptyCatchExists = this.hasAnyCatchBlockEmpty(sourceCode);

    if (emptyCatchExists) {
      return {
        verified: true,
        method: 'empty_catch_found_elsewhere'
      };
    }

    return {
      verified: false,
      method: 'no_empty_catch_found',
      reason: '빈 catch 블록을 찾을 수 없음'
    };
  }

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

  isCatchBlockEmpty(content) {
    const withoutComments = content
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
      .trim();

    return withoutComments.length === 0;
  }

  hasAnyCatchBlockEmpty(sourceCode) {
    const emptyCatchPattern = /catch\s*\([^)]*\)\s*\{\s*\}/g;
    const commentOnlyCatchPattern = /catch\s*\([^)]*\)\s*\{\s*\/\/[^\n]*\s*\}/g;

    return emptyCatchPattern.test(sourceCode) || commentOnlyCatchPattern.test(sourceCode);
  }

  verifyMethodLength(reportedLine, sourceCode, maxLineCount) {
    const lines = sourceCode.split('\n');
    const methodInfo = this.findMethodAtLine(lines, reportedLine);

    if (!methodInfo.found) {
      if (this.hasAnyLongMethod(sourceCode, maxLineCount)) {
        return { verified: true, method: 'long_method_found_elsewhere' };
      }
      return { verified: false, reason: '긴 메서드를 찾을 수 없음' };
    }

    const methodLineCount = methodInfo.endLine - methodInfo.startLine + 1;

    if (methodLineCount > maxLineCount) {
      return {
        verified: true,
        method: 'method_length_verified',
        details: `메서드 '${methodInfo.name}' 길이: ${methodLineCount}줄`
      };
    }

    return {
      verified: false,
      reason: `메서드 길이 ${methodLineCount}줄은 ${maxLineCount}줄 이하`
    };
  }

  findMethodAtLine(lines, targetLine) {
    const methodPattern = /(?:public|private|protected)?\s*(?:static)?\s*\w+\s+(\w+)\s*\([^)]*\)\s*(?:throws\s+[\w,\s]+)?\s*\{/;

    for (let i = Math.min(targetLine - 1, lines.length - 1); i >= 0; i--) {
      const line = lines[i];
      const match = line.match(methodPattern);

      if (match) {
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

  verifyCyclomaticComplexity(astAnalysis, maxComplexity) {
    const actualComplexity = astAnalysis?.cyclomaticComplexity || 0;

    if (actualComplexity > maxComplexity) {
      return {
        verified: true,
        method: 'complexity_verified',
        details: `복잡도: ${actualComplexity}`
      };
    }

    return {
      verified: false,
      reason: `복잡도 ${actualComplexity}는 ${maxComplexity} 이하`
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 유틸리티 메서드
  // ═══════════════════════════════════════════════════════════════════════════

  getFilteringStats() {
    return { ...this.filteringStats };
  }

  resetFilteringStats() {
    this.filteringStats = {
      totalChecks: 0,
      pureRegexViolations: 0,
      llmCandidates: 0,
      llmCalls: 0,
      falsePositivesFiltered: 0
    };
  }

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