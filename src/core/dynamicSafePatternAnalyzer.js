/**
 * 동적 안전 패턴 분석기 (DynamicSafePatternAnalyzer)
 * 
 * VectorDB 기반 동적 패턴 로딩 및 코드 분석
 * - 안전한 구현 패턴 vs 문제 있는 안티패턴 분류
 * - 실시간 패턴 로드 및 캐싱
 * - 카테고리별 패턴 매칭 및 이슈 탐지
 * 
 * 핵심 기능:
 * 1. VectorDB에서 패턴 로드 (Weaviate/Qdrant)
 * 2. 안전/위험 패턴 분류 및 캐싱
 * 3. 소스 코드에서 패턴 매칭
 * 4. 카테고리별 특화 검사 (리소스, 보안, 성능, 예외 처리)
 * 5. 권장사항 자동 생성
 * 
 * 패턴 구조 (VectorDB 스키마):
 * {
 *   "category": "resource_management",
 *   "recommended_pattern": {
 *     "code_template": "try-with-resources 코드",
 *     "pattern_name": "auto_resource_management",
 *     "implementation_guide": {
 *       "best_practices": [...],
 *       "framework_specific_notes": [...]
 *     }
 *   },
 *   "anti_pattern": {
 *     "code_template": "문제 있는 코드",
 *     "pattern_signature": {
 *       "semantic_signature": [...키워드...],
 *       "regex_patterns": [...]
 *     },
 *     "problematic_characteristics": {...}
 *   }
 * }
 * 
 * 분석 카테고리:
 * - resource_management: 리소스 누수 (Connection, Stream 등)
 * - security_vulnerability: SQL Injection, XSS 등
 * - performance_issue: N+1 쿼리, 비효율 루프 등
 * - exception_handling: 예외 무시, printStackTrace() 사용 등
 * - code_smell: 긴 메서드, 중복 코드 등
 * 
 * 호출 체인:
 * 1. initialize() → loadAndClassifyPatterns() → VectorClient.getAllPatterns()
 * 2. checkForSafePracticesDynamic() → 안전한 패턴 탐지
 * 3. classifySimilarPatterns() → 패턴 분류
 * 4. findIssuesUsingDynamicPatterns() → 이슈 위치 탐지
 * 5. performCategorySpecificMatching() → 카테고리별 특화 검사
 * 6. generateRecommendations() → 권장사항 생성
 * 
 * @module DynamicSafePatternAnalyzer
 * @requires JavaASTParser - Java AST 파싱
 * @requires LLMService - vLLM 기반 분석
 * @requires VectorClient - Qdrant/Weaviate VectorDB 연동
 */
import { JavaASTParser } from '../ast/javaAstParser.js';
import { LLMService } from '../clients/llmService.js';
import { VectorClient } from '../clients/vectorClient.js';
import { config } from '../config.js';
import logger from '../utils/loggerUtils.js';
/**
 * 동적 안전 패턴 분석기 클래스
 * 
 * 내부 구조:
 * - astParser: JavaASTParser 인스턴스
 * - llmService: LLMService 인스턴스
 * - vectorClient: VectorClient 인스턴스
 * - safePatternCache: Map<category, pattern> - 안전한 패턴 캐시
 * - antiPatternCache: Map<uniqueKey, pattern> - 문제 패턴 캐시
 * 
 * 생명주기:
 * 1. new DynamicSafePatternAnalyzer()
 * 2. await initialize() - VectorDB 패턴 로드 및 분류
 * 3. checkForSafePracticesDynamic() / findIssuesUsingDynamicPatterns() - 반복 호출
 * 
 * @class
 */
export class DynamicSafePatternAnalyzer {
  /**
   * 생성자: 분석기 및 캐시 초기화
   * 
   * @constructor
   */
  constructor() {
    this.astParser = new JavaASTParser();
    this.llmService = new LLMService();
    this.vectorClient = new VectorClient();
    this.safePatternCache = new Map(); // 카테고리별 안전한 패턴 저장 (category -> pattern)
    this.antiPatternCache = new Map(); // 문제 패턴 저장 (uniqueKey -> pattern)
  }

  /**
   * 동적 패턴 분석기 초기화
   * 
   * 내부 흐름:
   * 1. LLMService.checkConnection() → vLLM 서비스 연결 확인
   * 2. loadAndClassifyPatterns() 호출
   * 3. VectorClient.getAllPatterns() → 모든 패턴 조회
   * 4. normalizePatternFields() → 필드명 정규화
   * 5. recommended_pattern 있으면 safePatternCache에 저장
   * 6. anti_pattern 있으면 antiPatternCache에 저장
   * 7. 캐시 크기 및 패턴 목록 출력
   * 
   * @async
   * @returns {Promise<void>}
   * @throws {Error} LLM 서비스 연결 실패 시
   * 
   * @example
   * const analyzer = new DynamicSafePatternAnalyzer();
   * await analyzer.initialize();
   */
  async initialize() {
    logger.info('🚀 동적 패턴 분석기 초기화 중...');

    const isConnected = await this.llmService.checkConnection();
    if (!isConnected) {
      throw new Error('LLM 서비스 연결 실패');
    }

    // VectorDB에서 모든 패턴을 가져와 안전/문제 패턴으로 분류하여 캐시에 저장
    await this.loadAndClassifyPatterns();

    logger.info('✅ 동적 패턴 분석기 초기화 완료');
    logger.info(`  📊 안전한 패턴: ${this.safePatternCache.size}개`);
    logger.info(`  ⚠️  문제 패턴: ${this.antiPatternCache.size}개`);
  }

  /**
   * Weaviate 스키마 필드명 정규화
   * 
   * Weaviate/Qdrant는 필드명을 다양한 형태로 반환할 수 있음:
   * - snake_case: issue_record_id
   * - camelCase: issueRecordId
   * - properties 래핑: { properties: { field: value } }
   * 
   * 이 메서드는 모든 형태를 통일된 형태로 변환
   * 
   * @param {Object} raw - VectorDB에서 조회한 원본 패턴 객체
   * @returns {Object} 정규화된 필드 객체
   * @returns {string} return.issueRecordId - 패턴 고유 ID
   * @returns {string} return.title - 패턴 제목
   * @returns {string} return.category - 카테고리
   * @returns {Object} return.recommended - 안전한 패턴 정보
   * @returns {Object} return.anti - 문제 패턴 정보
   * @returns {Object} return.raw - 원본 객체 (디버깅용)
   */
  normalizePatternFields(raw) {
    const p = raw || {};
    // Weaviate가 properties로 래핑하는 경우 대비
    const props = p.properties || p;

    // 다양한 필드명 변형에 대응하여 통일된 값 추출
    const issueRecordId =
      props.issue_record_id || props.issueRecordId || props.id || props.uuid;

    const metadata = props.metadata || {};
    const title =
      metadata.title || props.title || props.metadata_title || props.name;

    const category =
      props.category || metadata.category || props.type || props.kind;

    const recommended =
      props.recommended_pattern || props.recommendedPattern || props.recPattern;

    const anti =
      props.anti_pattern || props.antiPattern || props.badPattern;

    return { issueRecordId, title, category, recommended, anti, raw: props };
  }

  /**
   * VectorDB에서 모든 패턴 로드 및 분류
   * 
   * 내부 흐름:
   * 1. VectorClient.getAllPatterns() → 전체 패턴 조회
   * 2. 각 패턴에 대해 루프:
   *    a. normalizePatternFields() → 필드명 정규화
   *    b. recommended_pattern.code_template 존재 시:
   *       - extractSafePattern() → 안전한 패턴 추출
   *       - safePatternCache.set() → 캐시에 저장
   *    c. anti_pattern.code_template 존재 시:
   *       - extractAntiPattern() → 문제 패턴 추출
   *       - antiPatternCache.set() → 캐시에 저장
   * 3. 분류 결과 통계 출력
   * 4. (실패 시) initializeFallbackPatterns() → 기본 패턴 사용
   * 
   * @async
   * @returns {Promise<void>}
   */
  async loadAndClassifyPatterns() {
    try {
      const allPatterns = await this.vectorClient.getAllPatterns();
      logger.info(`🔍 로드된 전체 패턴: ${allPatterns.length}개`);

      for (const pattern of allPatterns) {
        const { issueRecordId, title, category, recommended, anti } =
          this.normalizePatternFields(pattern);

        logger.info(`📋 처리 중인 패턴: ${title || issueRecordId} (${category})`);

        // recommended_pattern의 code_template이 존재하면 안전한 패턴으로 등록
        if (recommended && recommended.code_template) {
          logger.info(`  ✅ 안전한 패턴으로 분류: ${category}`);
          const safePattern = this.extractSafePattern({ category, recommended_pattern: recommended, metadata: { title } });
          if (safePattern) this.safePatternCache.set(category, safePattern);
        }

        // anti_pattern의 code_template이 존재하면 문제 패턴으로 등록
        if (anti && anti.code_template) {
          logger.info(`  ⚠️ 문제 패턴으로 분류: ${category}`);
          const key = `${category}_${issueRecordId || title || Math.random().toString(36).slice(2)}`;
          const antiPattern = this.extractAntiPattern({ category, anti_pattern: anti, metadata: { title }, issue_record_id: issueRecordId });
          if (antiPattern) this.antiPatternCache.set(key, antiPattern);
        }

        if (!(recommended && recommended.code_template) && !(anti && anti.code_template)) {
          logger.info(`  ⚠️ 패턴에 recommended_pattern 또는 anti_pattern 정보 없음`);
        }
      }

      logger.info('📋 패턴 분류 완료');
      logger.info(`  ✅ 안전한 패턴: ${this.safePatternCache.size}개`);
      logger.info(`  ⚠️ 문제 패턴: ${this.antiPatternCache.size}개`);

      // 분류된 패턴 목록 출력 (디버깅용)
      if (this.safePatternCache.size > 0) {
        logger.info('  📋 안전한 패턴 목록:');
        for (const [category, pattern] of this.safePatternCache) {
          logger.info(`    - ${category}: ${pattern.patternName}`);
        }
      }

      if (this.antiPatternCache.size > 0) {
        logger.info('  📋 문제 패턴 목록:');
        for (const [key, pattern] of this.antiPatternCache) {
          logger.info(`    - ${key}: ${pattern.title}`);
        }
      }

    } catch (error) {
      // 로드 실패 시 기본 패턴으로 폴백
      console.warn('⚠️ 패턴 로드 실패, 기본 패턴 사용:', error.message);
      this.initializeFallbackPatterns();
    }
  }

  /**
   * 안전한 패턴 정보 추출 및 구조화
   * 
   * 추출 항목:
   * 1. category: 패턴 카테고리
   * 2. patternName: 패턴 이름
   * 3. codeTemplate: 권장 코드 템플릿
   * 4. detectionRules: 탐지 규칙 (generateDetectionRules로 생성)
   * 5. bestPractices: 베스트 프랙티스 목록
   * 6. frameworkNotes: 프레임워크별 노트
   * 7. signatures: 패턴 시그니처 (키워드, 정규식, 구조)
   * 
   * @param {Object} pattern - VectorDB의 패턴 객체
   * @param {string} pattern.category - 카테고리
   * @param {Object} pattern.recommended_pattern - 안전한 패턴 정보
   * @param {Object} pattern.metadata - 메타데이터
   * @returns {Object|null} 구조화된 안전한 패턴 객체
   */
  extractSafePattern(pattern) {
    const recommendedPattern = pattern.recommended_pattern;
    const category = pattern.category;

    if (!recommendedPattern.code_template) {
      return null;
    }

    return {
      category: category,
      patternName: recommendedPattern.pattern_name || 'safe_pattern',
      codeTemplate: recommendedPattern.code_template,
      detectionRules: this.generateDetectionRules(recommendedPattern, category),
      bestPractices: recommendedPattern.implementation_guide?.best_practices || [],
      frameworkNotes: recommendedPattern.implementation_guide?.framework_specific_notes || [],

      // 코드에서 이 패턴을 찾기 위한 키워드, 정규식 등의 시그니처
      signatures: this.extractPatternSignatures(recommendedPattern.code_template, category)
    };
  }

  /**
   * 문제 패턴 정보 추출 및 구조화
   * 
   * 추출 항목:
   * 1. category: 패턴 카테고리
   * 2. title: 패턴 제목
   * 3. codeTemplate: 문제 코드 템플릿
   * 4. severity: 심각도 (CRITICAL/HIGH/MEDIUM/LOW)
   * 5. signatures: 패턴 시그니처 (탐지용)
   * 6. problematicCharacteristics: 문제 특성
   * 
   * @param {Object} pattern - VectorDB의 패턴 객체
   * @param {string} pattern.category - 카테고리
   * @param {Object} pattern.anti_pattern - 문제 패턴 정보
   * @param {Object} pattern.metadata - 메타데이터
   * @returns {Object|null} 구조화된 문제 패턴 객체
   */
  extractAntiPattern(pattern) {
    const antiPattern = pattern.anti_pattern;
    const category = pattern.category;

    if (!antiPattern.code_template) {
      return null;
    }

    return {
      category: category,
      title: pattern.metadata?.title || 'anti_pattern',
      codeTemplate: antiPattern.code_template,
      severity: pattern.metadata?.severity || 'MEDIUM',
      signatures: this.extractPatternSignatures(antiPattern.code_template, category),
      problematicCharacteristics: antiPattern.problematic_characteristics || {}
    };
  }

  /**
   * 코드 템플릿에서 패턴 시그니처 추출
   * 
   * 카테고리별 시그니처 추출 전략:
   * 
   * 1. resource_management:
   *    - keywords: try-with-resources, Connection, close(), finally
   *    - patterns: try\s*\([^)]*Connection, \.close\s*\(\)
   * 
   * 2. security_vulnerability:
   *    - keywords: PreparedStatement, setString, parameterized
   *    - patterns: PreparedStatement.*setString, \?
   * 
   * 3. performance_issue:
   *    - keywords: JOIN, batch, IN \(, ArrayList
   *    - patterns: JOIN, IN\s*\([^)]*\?
   * 
   * 4. exception_handling:
   *    - keywords: logger, catch, @Transactional
   *    - patterns: logger\.(error|warn), catch\s*\([^)]*Exception
   * 
   * @param {string} codeTemplate - 코드 템플릿
   * @param {string} category - 카테고리
   * @returns {Object} 패턴 시그니처
   * @returns {Array} return.keywords - 추출된 키워드
   * @returns {Array} return.patterns - 정규식 패턴
   * @returns {Array} return.structures - 구조적 특징
   */
  extractPatternSignatures(codeTemplate, category) {
    const signatures = {
      keywords: [],
      patterns: [],
      structures: []
    };

    switch (category) {
      case 'resource_management':
        signatures.keywords = this.extractKeywords(codeTemplate, [
          'try-with-resources', 'try \\(', 'Connection', 'close\\(\\)',
          'PreparedStatement', 'ResultSet', 'finally', 'AutoCloseable'
        ]);
        signatures.patterns = [
          /try\s*\([^)]*(?:Connection|Statement|ResultSet)[^)]*\)/,
          /\.close\s*\(\s*\)/,
          /finally\s*\{[^}]*\.close\s*\(\s*\)/
        ];
        break;

      case 'security_vulnerability':
        signatures.keywords = this.extractKeywords(codeTemplate, [
          'PreparedStatement', 'setString', 'setInt', '\\?', 'parameterized',
          'bind', 'placeholder'
        ]);
        signatures.patterns = [
          /PreparedStatement.*setString\s*\(\s*\d+/,
          /prepareStatement.*\?\s*[,)]/,
          /(?!.*\+.*executeQuery)/
        ];
        break;

      case 'performance_issue':
        signatures.keywords = this.extractKeywords(codeTemplate, [
          'JOIN', 'batch', 'IN \\(', 'ArrayList', 'HashMap', 'LinkedList'
        ]);
        signatures.patterns = [
          /(?:INNER|LEFT|RIGHT)?\s*JOIN/i,
          /IN\s*\([^)]*\?\s*[,)]/,
          /batch/i
        ];
        break;

      case 'exception_handling':
        signatures.keywords = this.extractKeywords(codeTemplate, [
          'logger\\.', 'log\\.', 'catch', 'throw', '@Transactional',
          'try', 'finally'
        ]);
        signatures.patterns = [
          /logger\.(error|warn|info|debug)/,
          /@Transactional/,
          /catch\s*\([^)]*Exception[^)]*\)/
        ];
        break;
    }

    return signatures;
  }

  /**
   * 코드 템플릿에서 키워드 추출
   * 
   * 추출 프로세스:
   * 1. keywordPatterns 배열의 각 정규식 패턴 순회
   * 2. codeTemplate에서 패턴 매칭
   * 3. 매칭된 키워드를 배열에 추가
   * 4. 중복 제거 후 반환
   * 
   * @param {string} codeTemplate - 코드 템플릿
   * @param {Array<string>} keywordPatterns - 정규식 패턴 배열
   * @returns {Array<string>} 추출된 고유 키워드 배열
   */
  extractKeywords(codeTemplate, keywordPatterns) {
    const keywords = [];
    keywordPatterns.forEach(pattern => {
      const regex = new RegExp(pattern, 'gi');
      const matches = codeTemplate.match(regex);
      if (matches) {
        keywords.push(...matches);
      }
    });
    // 중복 제거
    return [...new Set(keywords)];
  }
  /**
     * recommended_pattern의 code_template을 분석하여
     * 실제 코드에서 이 패턴을 탐지하기 위한 정규식 기반 규칙을 생성
     * (try-with-resources, PreparedStatement, JOIN, logger 사용 등)
     */
  generateDetectionRules(recommendedPattern, category) {
    const rules = [];

    const codeTemplate = recommendedPattern.code_template;

    if (codeTemplate.includes('try (') && category === 'resource_management') {
      rules.push({
        type: 'try_with_resources',
        pattern: /try\s*\([^)]*(?:Connection|Statement|ResultSet|Stream|Reader|Writer)[^)]*\)/,
        description: 'Try-with-resources 자동 리소스 관리'
      });
    }

    if (codeTemplate.includes('PreparedStatement') && codeTemplate.includes('setString')) {
      rules.push({
        type: 'parameterized_query',
        pattern: /PreparedStatement.*setString\s*\(\s*\d+/,
        description: 'PreparedStatement 파라미터 바인딩'
      });
    }

    if (codeTemplate.includes('JOIN') || codeTemplate.includes('batch')) {
      rules.push({
        type: 'optimized_query',
        pattern: /(?:JOIN|batch|IN\s*\()/i,
        description: 'JOIN 쿼리 또는 배치 처리'
      });
    }

    if (codeTemplate.includes('logger.') && category === 'exception_handling') {
      rules.push({
        type: 'proper_logging',
        pattern: /logger\.(error|warn|info|debug)/,
        description: 'Logger를 통한 적절한 예외 처리'
      });
    }

    if (codeTemplate.includes('@Transactional')) {
      rules.push({
        type: 'transaction_management',
        pattern: /@Transactional/,
        description: '@Transactional 트랜잭션 관리'
      });
    }

    return rules;
  }

  /**
   * 소스 코드를 분석하여 캐시된 안전한 패턴들 중 어떤 것이 구현되어 있는지 확인
   * (각 패턴의 detectionRules를 순회하며 매칭 수행)
   */
  checkForSafePracticesDynamic(sourceCode) {
    const safePractices = [];

    for (const [category, safePattern] of this.safePatternCache) {
      const detectedPatterns = this.matchSafePattern(sourceCode, safePattern);
      safePractices.push(...detectedPatterns);
    }

    return safePractices;
  }

  /**
   * 특정 안전한 패턴의 탐지 규칙들을 소스 코드에 적용하여
   * 매칭되는 패턴들의 목록을 반환
   */
  matchSafePattern(sourceCode, safePattern) {
    const matchedPatterns = [];

    for (const rule of safePattern.detectionRules) {
      if (rule.pattern.test(sourceCode)) {
        matchedPatterns.push({
          type: rule.type,
          category: safePattern.category,
          description: rule.description,
          patternName: safePattern.patternName,
          confidence: 0.9
        });
      }
    }

    return matchedPatterns;
  }

  /**
   * 특정 카테고리의 안전한 구현이 탐지된 패턴 목록에 포함되어 있는지 확인
   */
  isCategorySafelyImplementedDynamic(category, detectedSafePractices) {
    return detectedSafePractices.some(practice => practice.category === category);
  }

  /**
   * VectorDB 검색 결과로 받은 유사 패턴들을
   * recommended_pattern/anti_pattern 존재 여부에 따라 분류
   * (하나의 패턴이 둘 다 가질 수 있으므로 독립적으로 처리)
   */
  classifySimilarPatterns(similarPatterns) {
    logger.info(`\n🔍 유사 패턴 분류 시작 (총 ${similarPatterns.length}개)`);

    const classification = {
      safePatterns: [],
      antiPatterns: []
    };

    similarPatterns.forEach((pattern, index) => {
      logger.info(`📋 패턴 ${index + 1} 분석: ${pattern.metadata?.title || pattern.issue_record_id}`);
      logger.info(`  카테고리: ${pattern.category}`);
      logger.info(`  recommended_pattern 존재: ${pattern.recommended_pattern ? 'YES' : 'NO'}`);
      logger.info(`  anti_pattern 존재: ${pattern.anti_pattern ? 'YES' : 'NO'}`);

      // recommended_pattern.code_template이 있으면 안전한 패턴으로 추가
      if (pattern.recommended_pattern && pattern.recommended_pattern.code_template) {
        logger.info(`  ✅ 안전한 패턴 정보 추가`);
        classification.safePatterns.push({
          ...pattern,
          type: 'safe_pattern'
        });
      }

      // anti_pattern.code_template이 있으면 문제 패턴으로 추가 (독립적)
      if (pattern.anti_pattern && pattern.anti_pattern.code_template) {
        logger.info(`  ⚠️ 문제 패턴으로 분류`);
        classification.antiPatterns.push({
          ...pattern,
          type: 'anti_pattern'
        });
      }

      // 둘 다 없으면 하위 호환성을 위해 문제 패턴으로 간주
      if (!pattern.recommended_pattern && !pattern.anti_pattern) {
        logger.info(`  ⚠️ 패턴 정보 없음, 기본적으로 문제 패턴으로 분류`);
        classification.antiPatterns.push({
          ...pattern,
          type: 'anti_pattern'
        });
      }
    });

    logger.info(`📊 분류 결과:`);
    logger.info(`  ✅ 안전한 패턴: ${classification.safePatterns.length}개`);
    logger.info(`  ⚠️ 문제 패턴: ${classification.antiPatterns.length}개`);

    return classification;
  }

  /**
   * 주어진 문제 패턴 목록을 소스 코드와 매칭하여
   * 실제로 코드에 존재하는 이슈들을 탐지
   */
  async findIssuesUsingDynamicPatterns(sourceCode, antiPatterns) {
    logger.info(`\n🔍 동적 패턴 매칭 시작 (문제 패턴 ${antiPatterns.length}개 검사)`);
    const issues = [];

    for (const pattern of antiPatterns) {
      logger.info(`📋 패턴 검사 중: ${pattern.metadata?.title || pattern.title} (${pattern.category})`);

      const matches = await this.matchAntiPattern(sourceCode, pattern);
      logger.info(`  발견된 매치: ${matches.length}개`);

      if (matches.length > 0) {
        issues.push(...matches);
        matches.forEach((match, idx) => {
          logger.info(`    ${idx + 1}. 라인 ${match.startLine}: ${match.description}`);
        });
      }
    }

    logger.info(`📊 동적 패턴 매칭 결과: ${issues.length}개 이슈 발견`);
    return issues;
  }

  /**
   * 문제 패턴을 소스 코드와 매칭
   * 1. pattern_signature의 regex_patterns로 매칭 시도
   * 2. 카테고리별 특화된 추가 검사 수행
   */
  async matchAntiPattern(sourceCode, antiPattern) {
    const matches = [];
    const lines = sourceCode.split('\n');

    // anti_pattern.pattern_signature에 정의된 정규식 패턴으로 매칭
    const signatures = antiPattern.anti_pattern?.pattern_signature || {};

    if (signatures.regex_patterns && Array.isArray(signatures.regex_patterns)) {
      logger.info(`  정규식 패턴 검사: ${signatures.regex_patterns.length}개`);

      for (const regexPattern of signatures.regex_patterns) {
        try {
          const regex = new RegExp(regexPattern, 'gm');
          let match;

          while ((match = regex.exec(sourceCode)) !== null) {
            const lineNum = this.getLineNumberFromIndex(sourceCode, match.index);

            matches.push({
              type: antiPattern.category,
              startLine: lineNum,
              endLine: lineNum,
              confidence: 0.8,
              description: antiPattern.metadata?.title || 'Pattern match',
              matchedText: match[0],
              patternId: antiPattern.issue_record_id,
              severity: antiPattern.metadata?.severity || 'MEDIUM'
            });
          }
        } catch (error) {
          console.warn(`    정규식 오류: ${regexPattern} - ${error.message}`);
        }
      }
    }

    // 카테고리별로 특화된 추가 검사 수행
    const additionalMatches = await this.performCategorySpecificMatching(sourceCode, antiPattern);
    matches.push(...additionalMatches);

    return matches;
  }

  /**
   * 카테고리별로 실제 문제 코드를 탐지하기 위한 구체적인 로직 수행
   * - resource_management: close() 누락, try-with-resources 미사용 탐지
   * - security_vulnerability: SQL Injection 위험 패턴 탐지
   * - performance_issue: N+1 쿼리 문제 탐지
   * - exception_handling: printStackTrace() 등 부적절한 예외 처리 탐지
   */
  async performCategorySpecificMatching(sourceCode, antiPattern) {
    const matches = [];
    const lines = sourceCode.split('\n');
    const category = antiPattern.category;

    switch (category) {
      case 'resource_management':
        // getConnection()이 있지만 close()나 try-with-resources가 없는 경우 탐지
        lines.forEach((line, index) => {
          const trimmed = line.trim();
          if (trimmed.includes('getConnection()') && !trimmed.startsWith('//')) {
            const contextLines = lines.slice(Math.max(0, index - 3), Math.min(lines.length, index + 10));
            const hasClose = contextLines.some(l => l.includes('.close()'));
            const hasTryWithResources = contextLines.some(l => /try\s*\([^)]*Connection[^)]*\)/.test(l));

            if (!hasClose && !hasTryWithResources) {
              matches.push({
                type: 'connection_leak',
                startLine: index + 1,
                endLine: index + 1,
                confidence: 0.9,
                description: 'Database Connection이 닫히지 않아 리소스 누수 위험',
                matchedText: trimmed
              });
            }
          }
        });
        break;

      case 'security_vulnerability':
        // 문자열 연결로 SQL을 생성하는 위험한 패턴 탐지
        lines.forEach((line, index) => {
          const trimmed = line.trim();
          if ((/String\s+sql\s*=.*\+\s*\w+/.test(trimmed) &&
            !/FROM|JOIN|ORDER|GROUP|SELECT|INSERT|UPDATE|DELETE/.test(trimmed.split('+')[1])) ||
            /executeUpdate.*\+\s*\w+/.test(trimmed)) {
            matches.push({
              type: 'sql_injection',
              startLine: index + 1,
              endLine: index + 1,
              confidence: 0.95,
              description: 'SQL Injection 취약점: 문자열 연결로 SQL 생성',
              matchedText: trimmed
            });
          }
        });
        break;

      case 'performance_issue':
        // ResultSet 루프 내에서 추가 DB 호출이 있는 N+1 쿼리 문제 탐지
        let inLoop = false;
        let loopStart = -1;

        lines.forEach((line, index) => {
          const trimmed = line.trim();

          if (/while\s*\(.*rs\.next\(\)/.test(trimmed)) {
            inLoop = true;
            loopStart = index + 1;
          }

          if (inLoop && trimmed.includes('}')) {
            const loopContent = lines.slice(loopStart - 1, index + 1).join('\n');
            if (loopContent.includes('getConnection()') || loopContent.includes('executeQuery')) {
              matches.push({
                type: 'n_plus_one',
                startLine: loopStart,
                endLine: index + 1,
                confidence: 0.85,
                description: 'N+1 쿼리 성능 문제',
                details: '루프 내에서 개별 데이터베이스 쿼리 실행'
              });
            }
            inLoop = false;
          }
        });
        break;

      case 'exception_handling':
        // printStackTrace() 사용으로 인한 부적절한 예외 처리 탐지
        lines.forEach((line, index) => {
          const trimmed = line.trim();
          if (trimmed.includes('printStackTrace()')) {
            matches.push({
              type: 'poor_exception_handling',
              startLine: index + 1,
              endLine: index + 1,
              confidence: 0.8,
              description: 'printStackTrace() 사용으로 부적절한 예외 처리',
              matchedText: trimmed
            });
          }
        });
        break;
    }

    return matches;
  }

  /**
   * 텍스트 내 특정 인덱스 위치가 몇 번째 라인인지 계산
   */
  getLineNumberFromIndex(text, index) {
    return text.substring(0, index).split('\n').length;
  }

  /**
   * 특정 카테고리에 대한 권장사항 생성
   * - 구현된 안전한 패턴 목록
   * - 아직 구현되지 않은 권장사항
   * - 베스트 프랙티스 및 코드 예제 제공
   */
  generateRecommendations(category, detectedSafePractices) {
    const safePattern = this.safePatternCache.get(category);
    if (!safePattern) {
      return this.getDefaultRecommendations(category);
    }

    const recommendations = {
      category: category,
      implemented: detectedSafePractices.filter(p => p.category === category),
      missing: [],
      suggestions: safePattern.bestPractices || [],
      codeExample: safePattern.codeTemplate,
      frameworkNotes: safePattern.frameworkNotes || []
    };

    // 구현된 패턴의 타입을 Set으로 관리
    const implementedTypes = new Set(recommendations.implemented.map(p => p.type));
    const allRequiredTypes = safePattern.detectionRules.map(r => r.type);

    // 필요하지만 아직 구현되지 않은 패턴 찾기
    recommendations.missing = allRequiredTypes.filter(type => !implementedTypes.has(type))
      .map(type => {
        const rule = safePattern.detectionRules.find(r => r.type === type);
        return rule ? rule.description : type;
      });

    return recommendations;
  }

  /**
   * 캐시에 패턴이 없을 때 사용할 카테고리별 기본 권장사항
   */
  getDefaultRecommendations(category) {
    const defaultRecommendations = {
      'resource_management': ['리소스 자동 관리 구현', 'try-with-resources 사용'],
      'security_vulnerability': ['입력값 검증', '파라미터화된 쿼리 사용'],
      'performance_issue': ['쿼리 최적화', '배치 처리 고려'],
      'exception_handling': ['적절한 로깅', '예외 전파']
    };

    return {
      category: category,
      implemented: [],
      missing: defaultRecommendations[category] || [],
      suggestions: defaultRecommendations[category] || [],
      codeExample: '// 패턴 정보 없음',
      frameworkNotes: []
    };
  }

  /**
   * VectorDB 연결 실패 시 사용할 최소한의 기본 안전 패턴 설정
   */
  initializeFallbackPatterns() {
    const fallbackSafePatterns = [
      {
        category: 'resource_management',
        patternName: 'try_with_resources',
        detectionRules: [{
          type: 'try_with_resources',
          pattern: /try\s*\([^)]*(?:Connection|Statement|ResultSet)[^)]*\)/,
          description: 'Try-with-resources 자동 리소스 관리'
        }]
      },
      {
        category: 'security_vulnerability',
        patternName: 'parameterized_queries',
        detectionRules: [{
          type: 'parameterized_queries',
          pattern: /PreparedStatement.*setString\s*\(\s*\d+/,
          description: 'PreparedStatement 파라미터 바인딩'
        }]
      }
    ];

    fallbackSafePatterns.forEach(pattern => {
      this.safePatternCache.set(pattern.category, pattern);
    });
  }
}