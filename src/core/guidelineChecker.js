/**
 * 개발가이드 전용 검사기 (Layer1: DevelopmentGuidelineChecker)
 * 
 * 금융권 Java 코드 정적 분석 시스템의 Layer1 컴포넌트
 * - 개발 가이드라인 규칙 기반 코드 검증
 * - VectorDB에서 규칙 로드 및 적용
 * - 이중 검사 메커니즘 (정적 + 컨텍스트)
 * 
 * 이중 검사 메커니즘:
 * 
 * 1. 정적 규칙 검사 (Static Rules)
 *    - 정규표현식 기반 패턴 매칭
 *    - AST 기반 구조 분석
 *    - 빠른 검증 속도, 명확한 규칙 적용
 *    - 예: 들여쓰기, 변수명 규칙, 라인 길이 등
 * 
 * 2. 컨텍스트 규칙 검사 (Contextual Rules)
 *    - vLLM 기반 의미론적 분석
 *    - 비즈니스 로직, 아키텍처 패턴 등 복잡한 규칙
 *    - 코드 맥락을 이해한 심층 검증
 *    - 예: LData 명명 규칙, 로직 분리, 비즈니스 패턴
 * 
 * 규칙 소스:
 * - Primary: VectorDB (Qdrant)에서 가이드라인 규칙 로드
 * - Fallback: 로드 실패 시 기본 규칙(하드코딩) 사용
 * 
 * 호출 체인:
 * 1. initialize() → loadGuidelineRules() → VectorClient.searchGuidelines()
 * 2. checkCode() → checkStaticRules() / checkContextualRules()
 * 3. checkContextualRules() → LLMService.generateCompletion()
 * 
 * @module DevelopmentGuidelineChecker
 * @requires VectorClient - VectorDB 연동 (가이드라인 규칙 로드)
 * @requires LLMService - vLLM 연동 (컨텍스트 검사)
 * 
 * # TODO: Node.js → Python 변환 (FastAPI + Pydantic)
 * # TODO: loadGuidelineRules() - Qdrant Python 클라이언트로 전환
 * # TODO: checkContextualRules() - vLLM Python SDK 적용
 * # NOTE: 금융권 보안: 규칙 ID 검증, SQL 인젝션 방지
 * # PERFORMANCE: 규칙 캐싱으로 반복 로드 방지 (Redis/메모리)
 */
import { VectorClient } from '../clients/vectorClient.js';
import { LLMService } from '../clients/llmService.js';
import logger from '../utils/loggerUtils.js';
/**
 * 개발가이드 전용 검사기 클래스 (Layer1 Component)
 * 
 * 내부 구조:
 * - staticRules: Map<ruleId, rule> - 정적 규칙 저장소
 * - contextualRules: Map<ruleId, rule> - 컨텍스트 규칙 저장소
 * - vectorClient: VectorClient 인스턴스
 * - llmService: LLMService 인스턴스
 * 
 * 생명주기:
 * 1. new DevelopmentGuidelineChecker()
 * 2. await initialize()
 * 3. await checkCode() - 반복 호출 가능
 * 
 * @class
 * 
 * # TODO: Python 클래스로 변환 시 타입 힌팅 추가
 * # PERFORMANCE: 규칙 캐싱 및 인덱싱으로 검색 최적화
 */
export class DevelopmentGuidelineChecker {
  /**
   * 생성자: 규칙 저장소 및 클라이언트 초기화
   * 
   * 초기화 항목:
   * 1. staticRules Map 생성 (정규식/AST 기반 빠른 검사용)
   * 2. contextualRules Map 생성 (LLM 기반 의미론적 검사용)
   * 3. VectorClient 인스턴스 생성 (가이드라인 로드)
   * 4. LLMService 인스턴스 생성 (컨텍스트 분석)
   * 
   * @constructor
   * 
   * # NOTE: 생성자는 동기적, 실제 초기화는 initialize() 호출 필요
   */
  constructor() {
    // 정적 규칙 저장소 - regex/AST 기반 빠른 검사
    this.staticRules = new Map();
    
    // 컨텍스트 규칙 저장소 - LLM 기반 의미론적 검사
    this.contextualRules = new Map();
    
    // VectorDB 클라이언트 - 가이드라인 규칙 로드
    this.vectorClient = new VectorClient();
    
    // LLM 서비스 - 컨텍스트 기반 분석에 사용
    this.llmService = new LLMService();
  }

  /**
   * checkType 값 정규화
   * 
   * LLM이 출력하는 다양한 checkType 값을 Checker가 처리할 수 있는 값으로 변환
   * 
   * 매핑:
   * - static_analysis → regex
   * - regex_with_validation → combined
   * - 나머지는 그대로 유지
   * - 알 수 없는 값은 regex로 폴백
   * 
   * @param {string} checkType - 원본 checkType 값
   * @returns {string} 정규화된 checkType
   */
  normalizeCheckType(checkType) {
    const mapping = {
      'static_analysis': 'regex',
      'regex_with_validation': 'combined',
      'regex': 'regex',
      'ast': 'ast',
      'combined': 'combined',
      'llm_contextual': 'llm_contextual'
    };
    return mapping[checkType] || 'regex';
  }

  /**
   * 단일 패턴을 RegExp 객체로 변환
   * 
   * 지원하는 입력 형식:
   * 1. RegExp 객체 → 그대로 반환
   * 2. 문자열 → new RegExp(str, 'g')
   * 3. { pattern, flags } → new RegExp(pattern, flags)
   * 4. { pattern, flags, description } → new RegExp(pattern, flags)
   * 5. { type, pattern, description } → new RegExp(pattern, 'g') (LLM 레거시 형식)
   * 
   * @param {any} p - 패턴 (다양한 형식)
   * @param {string} ruleId - 로깅용 규칙 ID
   * @returns {RegExp|null} RegExp 객체 또는 null (변환 실패 시)
   */
  normalizePattern(p, ruleId) {
    // Case 1: 이미 RegExp 객체
    if (p instanceof RegExp) {
      return p;
    }

    // Case 2: 문자열
    if (typeof p === 'string') {
      const trimmed = p.trim();
      if (!trimmed || trimmed.length < 2) {
        return null;  // 빈 문자열 또는 너무 짧은 패턴
      }
      try {
        return new RegExp(trimmed, 'g');
      } catch (error) {
        console.warn(`  ⚠️ [${ruleId}] 정규식 생성 실패: "${trimmed}" - ${error.message}`);
        return null;
      }
    }

    // Case 3: 객체 (pattern 필드 필수)
    if (typeof p === 'object' && p !== null) {
      const patternStr = p.pattern;

      // pattern 필드 없으면 무효
      if (!patternStr || typeof patternStr !== 'string') {
        return null;
      }

      const trimmed = patternStr.trim();
      if (!trimmed || trimmed.length < 2) {
        return null;
      }

      // 너무 광범위한 패턴 필터링
      const tooGeneric = ['.+', '.*', '\\w+', '\\w*', '\\s+', '\\s*', 
                          '[a-z]+', '[A-Z]+', '[a-zA-Z]+', '\\d+', '\\d*'];
      if (tooGeneric.includes(trimmed)) {
        console.debug(`  ⏭️ [${ruleId}] 광범위한 패턴 스킵: "${trimmed}"`);
        return null;
      }

      try {
        return new RegExp(trimmed, p.flags || 'g');
      } catch (error) {
        console.warn(`  ⚠️ [${ruleId}] 정규식 생성 실패: "${trimmed}" - ${error.message}`);
        return null;
      }
    }

    return null;
  }

  /**
   * patterns 배열을 antiPatterns/goodPatterns 구조로 정규화
   * 
   * 입력 형식 처리:
   * 1. 기존 patterns 배열 → antiPatterns로 변환 (하위 호환성)
   * 2. antiPatterns/goodPatterns가 이미 있으면 정규화만 수행
   * 3. { type: 'negative', pattern } → antiPatterns
   * 4. { type: 'positive', pattern } → goodPatterns
   * 
   * @param {object} guideline - 원본 가이드라인 객체
   * @param {string} ruleId - 로깅용 규칙 ID
   * @returns {object} { antiPatterns: RegExp[], goodPatterns: RegExp[] }
   */
  normalizePatternGroups(guideline, ruleId) {
    const result = {
      antiPatterns: [],
      goodPatterns: []
    };

    // Case 1: 이미 antiPatterns/goodPatterns가 있는 경우 (새 형식)
    if (guideline.antiPatterns && Array.isArray(guideline.antiPatterns)) {
      guideline.antiPatterns.forEach(p => {
        const regex = this.normalizePattern(p, ruleId);
        if (regex) {
          result.antiPatterns.push({
            regex,
            description: p.description || ''
          });
        }
      });
    }

    if (guideline.goodPatterns && Array.isArray(guideline.goodPatterns)) {
      guideline.goodPatterns.forEach(p => {
        const regex = this.normalizePattern(p, ruleId);
        if (regex) {
          result.goodPatterns.push({
            regex,
            description: p.description || ''
          });
        }
      });
    }

    // Case 2: 기존 patterns 배열 처리 (하위 호환성)
    if (guideline.patterns && Array.isArray(guideline.patterns)) {
      guideline.patterns.forEach(p => {
        // type: 'positive'/'negative' 구분
        if (typeof p === 'object' && p.type) {
          const regex = this.normalizePattern(p, ruleId);
          if (regex) {
            if (p.type === 'positive') {
              result.goodPatterns.push({ regex, description: p.description || '' });
            } else {
              // negative 또는 기타 → antiPatterns
              result.antiPatterns.push({ regex, description: p.description || '' });
            }
          }
        } else {
          // type 없으면 antiPatterns로 (기존 동작 호환)
          const regex = this.normalizePattern(p, ruleId);
          if (regex) {
            result.antiPatterns.push({ regex, description: '' });
          }
        }
      });
    }

    return result;
  }

  /**
   * astHints 필드명 정규화
   * 
   * 변환:
   * - nodeType (단수) → nodeTypes (복수, 배열)
   * - checkPoints → checkConditions
   * 
   * @param {object} astHints - 원본 astHints
   * @returns {object} 정규화된 astHints
   */
  normalizeAstHints(astHints) {
    if (!astHints || typeof astHints !== 'object') {
      return null;
    }

    const normalized = {};

    // nodeType → nodeTypes (배열로 변환)
    if (astHints.nodeTypes && Array.isArray(astHints.nodeTypes)) {
      normalized.nodeTypes = astHints.nodeTypes;
    } else if (astHints.nodeType) {
      // 단수형을 배열로 변환
      normalized.nodeTypes = Array.isArray(astHints.nodeType) 
        ? astHints.nodeType 
        : [astHints.nodeType];
    }

    // checkPoints → checkConditions
    if (astHints.checkConditions && Array.isArray(astHints.checkConditions)) {
      normalized.checkConditions = astHints.checkConditions;
    } else if (astHints.checkPoints && Array.isArray(astHints.checkPoints)) {
      normalized.checkConditions = astHints.checkPoints;
    }

    // 기타 필드 유지
    if (astHints.excludeContexts) {
      normalized.excludeContexts = astHints.excludeContexts;
    }
    if (astHints.checkTarget) {
      normalized.checkTarget = astHints.checkTarget;
    }

    return Object.keys(normalized).length > 0 ? normalized : null;
  }

  /**
   * message 필드 생성 (없을 경우 폴백)
   * 
   * 우선순위:
   * 1. message 필드가 있으면 사용
   * 2. title + "규칙을 위반했습니다"
   * 3. description 첫 문장
   * 4. 기본 메시지
   * 
   * @param {object} guideline - 가이드라인 객체
   * @returns {string} 위반 메시지
   */
  generateMessage(guideline) {
    if (guideline.message && guideline.message.trim()) {
      return guideline.message;
    }
    if (guideline.title) {
      return `${guideline.title} 규칙을 위반했습니다`;
    }
    if (guideline.description) {
      const firstSentence = guideline.description.split(/[.\n]/)[0];
      return firstSentence.substring(0, 100).trim() || '코딩 가이드라인을 위반했습니다';
    }
    return '코딩 가이드라인을 위반했습니다';
  }

  /**
   * 개발가이드 룰 초기화 프로세스
   * 
   * 내부 흐름:
   * 1. loadGuidelineRules() 호출 → VectorClient.searchGuidelines()
   * 2. VectorDB에서 가이드라인 규칙 로드
   * 3. checkType에 따라 staticRules/contextualRules에 분류 저장
   * 4. loadContextualGuidelines() 호출 → 하드코딩된 컨텍스트 규칙 추가
   * 5. 로드 실패 시 initializeDefaultRules()로 폴백
   * 
   * @async
   * @returns {Promise<void>}
   * 
   * @example
   * const checker = new DevelopmentGuidelineChecker();
   * await checker.initialize();
   * 
   * # TODO: Python 변환 시 async/await → asyncio로 변경
   * # PERFORMANCE: 규칙 로드 시간 측정 및 캐싱 적용
   */
  async initialize() {
    logger.info('📋 개발가이드 룰 로딩 중...');

    // VectorDB에서 규칙 로드 (정적 + 컨텍스트)
    await this.loadGuidelineRules();
    
    // 하드코딩된 컨텍스트 규칙 로드
    await this.loadContextualGuidelines();

    logger.info(`✅ 개발가이드 룰 로딩 완료: 정적 ${this.staticRules.size}개, 맥락적 ${this.contextualRules.size}개`);
  }

/**
   * VectorDB에서 가이드라인 규칙 로드 및 정규화
   * 
   * 수정 사항:
   * 1. checkType 정규화 (static_analysis → regex 등)
   * 2. patterns → antiPatterns/goodPatterns 변환
   * 3. astHints 필드명 정규화
   * 4. message 폴백 처리
   * 5. contextual 규칙에 id 필드 추가
   */
  async loadGuidelineRules() {
    try {
      const guidelines = await this.vectorClient.searchGuidelines();

      if (guidelines && guidelines.length > 0) {
        let staticCount = 0;
        let contextualCount = 0;
        let normalizedCount = 0;

        guidelines.forEach(guideline => {
          // ─────────────────────────────────────────────────────────
          // Step 1: checkType 정규화
          // ─────────────────────────────────────────────────────────
          const originalCheckType = guideline.checkType;
          const normalizedCheckType = this.normalizeCheckType(originalCheckType);

          if (originalCheckType !== normalizedCheckType) {
            console.debug(`  📝 checkType 정규화: ${guideline.ruleId} (${originalCheckType} → ${normalizedCheckType})`);
            normalizedCount++;
          }

          // ─────────────────────────────────────────────────────────
          // Step 2: LLM 컨텍스트 규칙 처리
          // ─────────────────────────────────────────────────────────
          if (normalizedCheckType === 'llm_contextual') {
            // keywords 검증 및 폴백
            let keywords = guideline.keywords;
            if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
              // title과 description에서 키워드 추출 시도
              keywords = this.extractKeywordsFromText(guideline.title, guideline.description);
              if (keywords.length === 0) {
                console.warn(`  ⚠️ [${guideline.ruleId}] keywords 없음 - 규칙 스킵`);
                return;  // 키워드 없으면 스킵
              }
            }

            // examples 검증
            let examples = guideline.examples;
            if (!examples || typeof examples !== 'object') {
              examples = { good: [], bad: [] };
            }
            if (!Array.isArray(examples.good)) examples.good = [];
            if (!Array.isArray(examples.bad)) examples.bad = [];

            this.contextualRules.set(guideline.ruleId, {
              id: guideline.ruleId,  // id 필드 추가 (프롬프트에서 사용)
              ruleId: guideline.ruleId,
              title: guideline.title,
              category: guideline.category || 'general',
              checkType: 'llm_contextual',
              description: guideline.description || '',
              severity: guideline.severity || 'MEDIUM',
              keywords: keywords,
              examples: examples,
              businessRules: guideline.businessRules || []
            });
            contextualCount++;
          }
          // ─────────────────────────────────────────────────────────
          // Step 3: 정적 규칙 처리 (regex, ast, combined)
          // ─────────────────────────────────────────────────────────
          else {
            // patterns/antiPatterns/goodPatterns 정규화
            const patternGroups = this.normalizePatternGroups(guideline, guideline.ruleId);

            // astHints 정규화
            const normalizedAstHints = this.normalizeAstHints(guideline.astHints);

            // message 생성
            const message = this.generateMessage(guideline);

            // 유효성 검증
            const hasPatterns = patternGroups.antiPatterns.length > 0 || patternGroups.goodPatterns.length > 0;
            const hasAstHints = normalizedAstHints && normalizedAstHints.nodeTypes;

            // regex 타입인데 패턴 없으면 스킵
            if (normalizedCheckType === 'regex' && !hasPatterns) {
              console.warn(`  ⚠️ [${guideline.ruleId}] regex 규칙이지만 유효한 패턴 없음 - 스킵`);
              return;
            }

            // ast 타입인데 astHints 없으면 스킵
            if (normalizedCheckType === 'ast' && !hasAstHints) {
              console.warn(`  ⚠️ [${guideline.ruleId}] ast 규칙이지만 astHints 없음 - 스킵`);
              return;
            }

            // combined 타입은 둘 중 하나라도 있어야 함
            if (normalizedCheckType === 'combined' && !hasPatterns && !hasAstHints) {
              console.warn(`  ⚠️ [${guideline.ruleId}] combined 규칙이지만 패턴과 astHints 모두 없음 - 스킵`);
              return;
            }

            // 특수 규칙용 커스텀 검증기 설정
            let customValidator = null;
            if (guideline.ruleId === 'code_style.3_7_3' ||
                guideline.title?.includes('Cast Operator')) {
              customValidator = (line) => {
                if (/\w+\s*\([^)]*\)\s*\./.test(line)) return false;
                if (/^\s*(if|while|for|switch)\s*\(/.test(line)) return false;
                return /\(\s*[A-Z][a-zA-Z0-9<>]*\s*\)\s+[a-zA-Z_]/.test(line);
              };
            }

            // 정적 규칙 저장
            this.staticRules.set(guideline.ruleId, {
              id: guideline.ruleId,
              title: guideline.title,
              category: guideline.category || 'general',
              checkType: normalizedCheckType,
              antiPatterns: patternGroups.antiPatterns,
              goodPatterns: patternGroups.goodPatterns,
              // 하위 호환성: patterns도 유지 (antiPatterns의 regex만)
              patterns: patternGroups.antiPatterns.map(p => p.regex),
              astHints: normalizedAstHints,
              severity: guideline.severity || 'MEDIUM',
              message: message,
              examples: guideline.examples || { good: [], bad: [] },
              customValidator: customValidator
            });
            staticCount++;
          }
        });

        logger.info(`  📊 가이드라인 로드 완료: 정적 ${staticCount}개, 컨텍스트 ${contextualCount}개`);
        if (normalizedCount > 0) {
          logger.info(`  📊 checkType 정규화: ${normalizedCount}개 규칙 변환됨`);
        }
      } else {
        this.initializeDefaultRules();
      }
    } catch (error) {
      console.warn('가이드라인 룰 로딩 실패, 기본 룰 사용:', error.message);
      this.initializeDefaultRules();
    }
  }

  /**
   * 텍스트에서 키워드 추출 (keywords 폴백용)
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
                          'try', 'catch', 'Exception', 'throw'];
    javaKeywords.forEach(kw => {
      if (text.toLowerCase().includes(kw.toLowerCase())) {
        keywords.add(kw);
      }
    });

    return Array.from(keywords).slice(0, 10);
  }

  /**
   * 기본 정적 규칙 초기화 (개선 버전)
   * 
   * antiPatterns/goodPatterns 형식 사용
   */
  initializeDefaultRules() {
    const defaultStaticRules = [
      {
        id: '3.3.1.1.3',
        title: '4칸 공백 들여쓰기',
        category: 'formatting',
        checkType: 'regex',
        antiPatterns: [
          { regex: /\t/g, description: '탭 문자 사용' }
        ],
        goodPatterns: [],
        patterns: [/\t/g],  // 하위 호환
        severity: 'LOW',
        message: '탭 대신 4칸 공백을 사용해야 합니다'
      },
      {
        id: '3.3.7.6.1',
        title: '메서드명과 괄호 사이 공백 금지',
        category: 'formatting',
        checkType: 'regex',
        antiPatterns: [
          { regex: /\w\s+\(/g, description: '메서드명과 괄호 사이 공백' }
        ],
        goodPatterns: [],
        patterns: [/\w\s+\(/g],
        severity: 'LOW',
        message: '메서드 이름과 괄호 사이에 공백이 있습니다'
      },
      {
        id: '3.3.1.1.2',
        title: '라인 길이 제한',
        category: 'formatting',
        checkType: 'regex',
        antiPatterns: [
          { regex: /.{101,}/, description: '100자 초과' }
        ],
        goodPatterns: [],
        patterns: [/.{101,}/],
        severity: 'LOW',
        message: '한 라인이 100자를 초과합니다'
      },
      {
        id: '3.3.5.3',
        title: '한 라인에 하나의 변수만 선언',
        category: 'code_style',
        checkType: 'regex',
        antiPatterns: [
          { regex: /^\s*(int|long|double|float|String|boolean|char|byte|short)\s+\w+\s*,\s*\w+/, description: '한 줄에 여러 변수 선언' }
        ],
        goodPatterns: [],
        patterns: [/\w+\s+\w+.*,.*\w+/],
        severity: 'MEDIUM',
        message: '한 라인에 하나의 변수만 선언해야 합니다'
      },
      {
        id: 'code_style.3_7_3',
        title: 'Cast Operator 공백 규칙',
        category: 'code_style',
        checkType: 'regex',
        antiPatterns: [
          { regex: /\(\s*[A-Z][a-zA-Z0-9<>]*\s*\)\s{2,}[a-zA-Z_]/g, description: '캐스트 후 공백 2개 이상' },
          { regex: /\(\s+[A-Z][a-zA-Z0-9<>]*\s+\)\s*[a-zA-Z_]/g, description: '캐스트 괄호 내부 공백' }
        ],
        goodPatterns: [],
        patterns: [
          /\(\s*[A-Z][a-zA-Z0-9<>]*\s*\)\s{2,}[a-zA-Z_]/g,
          /\(\s+[A-Z][a-zA-Z0-9<>]*\s+\)\s*[a-zA-Z_]/g
        ],
        severity: 'LOW',
        message: 'Cast 연산자 사용 시 공백을 최소화해야 합니다',
        customValidator: (line) => {
          if (/\w+\s*\([^)]*\)\s*\./.test(line)) return false;
          if (/^\s*(if|while|for|switch)\s*\(/.test(line)) return false;
          return /\(\s*[A-Z][a-zA-Z0-9<>]*\s*\)\s+[a-zA-Z_]/.test(line);
        }
      },
      {
        id: 'trailing_whitespace',
        title: '줄 끝 공백',
        category: 'formatting',
        checkType: 'regex',
        antiPatterns: [
          { regex: /\s+$/, description: '라인 끝 공백' }
        ],
        goodPatterns: [],
        patterns: [/\s+$/],
        severity: 'LOW',
        message: '줄 끝에 불필요한 공백이 있습니다'
      },
      {
        id: 'multiple_spaces',
        title: '다중 공백',
        category: 'formatting',
        checkType: 'regex',
        antiPatterns: [
          { regex: /[^\s]\s{2,}[^\s*]/, description: '연속 공백 (들여쓰기/주석 제외)' }
        ],
        goodPatterns: [],
        patterns: [/\s{2,}/],
        severity: 'LOW',
        message: '불필요한 다중 공백이 있습니다'
      }
    ];

    defaultStaticRules.forEach(rule => {
      this.staticRules.set(rule.id, rule);
    });

    logger.info(`  📋 기본 규칙 로드: ${defaultStaticRules.length}개`);
  }

  /**
   * 컨텍스트 기반 가이드라인 로드 (하드코딩)
   * 
   * LLM을 활용하여 검사하는 복잡한 규칙들:
   * 1. LData/LMultiData 키 명명 규칙
   *    - DB 컬럼명을 소문자로 변환하여 사용
   *    - 예: REG_DATE → reg_date
   * 
   * 2. 비즈니스 로직과 UI 로직 분리
   *    - Controller는 Service 호출만
   *    - Service에서 비즈니스 로직 처리
   * 
   * 3. 변수 명명 규칙
   *    - camelCase 사용
   *    - 루프 변수: inx, jnx, knx (i, j, k 사용 금지)
   * 
   * 특징:
   * - keywords로 적용 가능성 사전 필터링
   * - 좋은 예시/나쁜 예시 포함 (LLM 학습용)
   */
  async loadContextualGuidelines() {
    const contextualGuidelines = [
      {
        id: 'naming_ldata_convention',
        title: 'LData/LMultiData 키 명명 규칙',
        category: 'naming_convention',
        checkType: 'llm_contextual',
        description: `DB의 테이블과 연관있는 LData/LMultiData는 아래와 같은 명명 규칙을 따른다.
- select쿼리수행의 결과 ResultSet을 저장하는 LMultiData의 Key는 해당 DB column의이름을 소문자로 변환하여 저장한다.`,
        severity: 'MEDIUM',
        keywords: ['LData', 'LMultiData', 'Key', 'ResultSet', 'DB column'],
        examples: {
          good: ['lMultiData.getString("reg_date")', 'lData.setString("user_id", userId)'],
          bad: ['lMultiData.getString("REG_DATE")', 'lData.setString("USER_ID", userId)']
        }
      },
      {
        id: 'business_logic_separation',
        title: '비즈니스 로직과 UI 로직 분리',
        category: 'architecture',
        checkType: 'llm_contextual',
        description: `비즈니스 로직은 UI 컴포넌트와 분리되어야 하며, 별도의 Service 클래스에 구현되어야 한다.`,
        severity: 'HIGH',
        keywords: ['Controller', 'Service', 'business logic', '@Controller', '@Service'],
        examples: {
          good: ['@Controller에서 @Service 호출', 'Service 클래스에서 비즈니스 로직 처리'],
          bad: ['Controller에서 직접 DB 접근', 'Controller에서 복잡한 계산 로직']
        }
      },
      {
        id: 'variable_naming_convention',
        title: '변수 명명 규칙',
        category: 'naming_convention',
        checkType: 'llm_contextual',
        description: `변수명은 camelCase를 사용하며, 의미가 명확해야 한다.
- 루프 변수는 inx, jnx, knx 형식을 사용하며 i, j, k를 사용하지 않는다.`,
        severity: 'MEDIUM',
        keywords: ['for', 'while', 'int i', 'int j', 'int k'],
        examples: {
          good: ['for (int inx = 0; inx < count; inx++)', 'String userName = "test"'],
          bad: ['for (int i = 0; i < count; i++)', 'String strUserName = "test"']
        }
      }
    ];

    contextualGuidelines.forEach(guideline => {
      this.contextualRules.set(guideline.id, guideline);
    });
  }

  /**
   * 전체 규칙 검사 실행 (정적 + 컨텍스트)
   * 
   * 실행 흐름:
   * 1. 정적 규칙 검사
   *    - 모든 staticRules 순회
   *    - 개별 규칙 검사 실행
   *    - 중복 제거 (같은 위치 동일 규칙)
   * 
   * 2. 컨텍스트 규칙 검사 (옵션)
   *    - skipContextual이 아니면 실행
   *    - LLM 기반 심층 분석
   * 
   * 3. 결과 병합 및 반환
   * 
   * @param {string} sourceCode - 검사할 소스코드
   * @param {object} astAnalysis - AST 분석 결과
   * @param {object} options - 옵션
   *   - skipContextual: 컨텍스트 검사 생략 여부
   * @returns {array} 위반사항 목록
   */
  async checkRules(sourceCode, astAnalysis, options = {}) {
    const violations = [];

    // Step 1: 정적 규칙 검사 (regex, ast, combined)
    for (const [ruleId, rule] of this.staticRules) {
      try {
        const ruleViolations = await this.checkSingleRule(sourceCode, rule, astAnalysis);
        violations.push(...ruleViolations);
      } catch (error) {
        console.warn(`정적 룰 검사 실패 (${ruleId}): ${error.message}`);
      }
    }

    // Step 2: 중복 제거 (같은 라인, 같은 규칙, 같은 컬럼)
    const uniqueViolations = this.deduplicateViolations(violations);
    logger.info(`  📊 정적 검사: ${violations.length}개 → 중복 제거 후 ${uniqueViolations.length}개`);

    // Step 3: 컨텍스트 규칙 검사 (LLM 기반)
    let contextualViolations = [];
    if (!options.skipContextual) {
      contextualViolations = await this.checkContextualRules(sourceCode, astAnalysis);
    }

    return [...uniqueViolations, ...contextualViolations];
  }

  /**
   * 위반사항 중복 제거
   * 
   * 중복 기준: 라인 번호 + 규칙 ID + 컬럼 위치
   * - 같은 위치에서 같은 규칙이 여러 번 탐지된 경우 하나만 유지
   * - Map을 사용하여 O(n) 시간복잡도로 중복 제거
   * 
   * @returns {array} 중복이 제거된 위반사항 배열
   */
  deduplicateViolations(violations) {
    const seen = new Map();

    return violations.filter(violation => {
      // 고유 키 생성: "라인-규칙ID-컬럼"
      const key = `${violation.line}-${violation.ruleId}-${violation.column}`;
      if (seen.has(key)) {
        return false;  // 이미 본 위반사항은 제외
      }
      seen.set(key, true);
      return true;
    });
  }

  /**
   * 개별 정적 규칙 검사 실행
   * 
   * 규칙 타입별 분기:
   * - regex: 정규표현식 패턴 매칭
   * - ast: AST 구조 분석
   * - combined: regex 후 AST로 검증 (이중 검사)
   * 
   * @returns {array} 해당 규칙의 위반사항
   */
  async checkSingleRule(sourceCode, rule, astAnalysis) {
    const violations = [];

    try {
      if (rule.checkType === 'regex') {
        violations.push(...this.checkRegexRule(sourceCode, rule));
      } else if (rule.checkType === 'ast') {
        violations.push(...this.checkAstRule(sourceCode, rule, astAnalysis));
      } else if (rule.checkType === 'combined') {
        violations.push(...this.checkCombinedRule(sourceCode, rule, astAnalysis));
      }
    } catch (error) {
      console.warn(`  ⚠️ 정적 룰 검사 실패 (${rule.id}): ${error.message}`);
    }

    return violations;
  }

  /**
   * 정규표현식 기반 규칙 검사 (개선 버전)
   * 
   * 검사 로직:
   * 1. antiPatterns: 매칭되면 위반 (나쁜 패턴)
   * 2. goodPatterns: 하나도 안 맞으면 위반 (좋은 패턴이 없음)
   * 3. 하위 호환성: 기존 patterns 배열도 antiPatterns로 처리
   * 
   * @param {string} sourceCode - 검사할 소스코드
   * @param {object} rule - 규칙 객체
   * @returns {array} 위반사항 배열
   */
  checkRegexRule(sourceCode, rule) {
    const violations = [];
    const lines = sourceCode.split('\n');

    // antiPatterns 가져오기 (새 형식 또는 하위 호환)
    const antiPatterns = rule.antiPatterns || [];
    
    // goodPatterns 가져오기
    const goodPatterns = rule.goodPatterns || [];

    // 기존 patterns 배열 호환 (antiPatterns가 없을 때만)
    let legacyPatterns = [];
    if (antiPatterns.length === 0 && rule.patterns && Array.isArray(rule.patterns)) {
      legacyPatterns = rule.patterns.map(p => {
        if (p instanceof RegExp) return { regex: p, description: '' };
        if (typeof p === 'string') {
          try { return { regex: new RegExp(p, 'g'), description: '' }; }
          catch { return null; }
        }
        if (typeof p === 'object' && p.pattern) {
          try { return { regex: new RegExp(p.pattern, p.flags || 'g'), description: p.description || '' }; }
          catch { return null; }
        }
        return null;
      }).filter(p => p !== null);
    }

    // 실제 사용할 antiPatterns
    const effectiveAntiPatterns = antiPatterns.length > 0 ? antiPatterns : legacyPatterns;

    // 유효성 검증
    if (effectiveAntiPatterns.length === 0 && goodPatterns.length === 0) {
      console.warn(`  ⚠️ 룰 ${rule.id}에 유효한 패턴이 없음`);
      return violations;
    }

    // 각 라인에 대해 검사
    lines.forEach((line, index) => {
      const lineNum = index + 1;
      const trimmedLine = line.trim();

      // 빈 라인은 스킵 (goodPatterns 검사 시 오탐 방지)
      if (!trimmedLine) return;

      // 커스텀 검증기가 있고 통과하지 못하면 스킵
      if (rule.customValidator && !rule.customValidator(line)) {
        return;
      }

      // ─────────────────────────────────────────────────────────
      // 1. antiPatterns 검사: 매칭되면 위반
      // ─────────────────────────────────────────────────────────
      for (const ap of effectiveAntiPatterns) {
        const regex = ap.regex || ap;  // RegExp 직접 또는 객체
        if (!(regex instanceof RegExp)) continue;

        try {
          regex.lastIndex = 0;
          if (regex.test(line)) {
            // 중복 체크
            const alreadyReported = violations.some(v =>
              v.line === lineNum && v.ruleId === rule.id
            );

            if (!alreadyReported) {
              regex.lastIndex = 0;
              violations.push({
                ruleId: rule.id,
                title: rule.title,
                category: rule.category,
                severity: rule.severity,
                message: rule.message || ap.description || `${rule.title} 규칙 위반`,
                line: lineNum,
                column: line.search(regex),
                matchType: 'anti-pattern',
                patternDescription: ap.description || '',
                fixable: true,
                source: 'development_guideline'
              });
              break;  // 한 라인에서 하나의 위반만 보고
            }
          }
          regex.lastIndex = 0;
        } catch (error) {
          console.warn(`  ⚠️ 룰 ${rule.id} antiPattern 테스트 실패:`, error.message);
        }
      }

      // ─────────────────────────────────────────────────────────
      // 2. goodPatterns 검사: 하나도 안 맞으면 위반
      // ─────────────────────────────────────────────────────────
      if (goodPatterns.length > 0) {
        // 이 라인이 goodPatterns 검사 대상인지 확인
        // (특정 컨텍스트에서만 적용해야 할 수 있음)
        const shouldCheckGoodPattern = this.shouldCheckGoodPattern(line, rule);
        
        if (shouldCheckGoodPattern) {
          let hasGoodMatch = false;

          for (const gp of goodPatterns) {
            const regex = gp.regex || gp;
            if (!(regex instanceof RegExp)) continue;

            try {
              regex.lastIndex = 0;
              if (regex.test(line)) {
                hasGoodMatch = true;
                break;
              }
              regex.lastIndex = 0;
            } catch (error) {
              console.warn(`  ⚠️ 룰 ${rule.id} goodPattern 테스트 실패:`, error.message);
            }
          }

          if (!hasGoodMatch) {
            // 중복 체크
            const alreadyReported = violations.some(v =>
              v.line === lineNum && v.ruleId === rule.id
            );

            if (!alreadyReported) {
              violations.push({
                ruleId: rule.id,
                title: rule.title,
                category: rule.category,
                severity: rule.severity,
                message: rule.message || `${rule.title} 규칙을 따르지 않았습니다`,
                line: lineNum,
                column: 0,
                matchType: 'missing-good-pattern',
                fixable: true,
                source: 'development_guideline'
              });
            }
          }
        }
      }
    });

    return violations;
  }

  /**
   * goodPatterns 검사 대상 라인인지 확인
   * 
   * 모든 라인에 대해 goodPatterns를 검사하면 오탐이 많아짐
   * 규칙의 특성에 따라 특정 라인만 검사해야 함
   * 
   * @param {string} line - 검사할 라인
   * @param {object} rule - 규칙 객체
   * @returns {boolean} 검사 대상 여부
   */
  shouldCheckGoodPattern(line, rule) {
    // 기본적으로 빈 라인, 주석, import 문은 제외
    const trimmed = line.trim();
    
    // 빈 라인
    if (!trimmed) return false;
    
    // 주석
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      return false;
    }
    
    // import/package 문
    if (trimmed.startsWith('import ') || trimmed.startsWith('package ')) {
      return false;
    }

    // 규칙별 특수 처리
    // 예: 들여쓰기 규칙은 코드 라인만 검사
    if (rule.category === 'formatting' && rule.title?.includes('들여쓰기')) {
      // 코드 시작 라인만 (공백 제외한 내용이 있는 라인)
      return trimmed.length > 0;
    }

    // 기본: 검사 대상
    return true;
  }

  /**
   * AST 기반 규칙 검사
   * 
   * AST(Abstract Syntax Tree)를 활용한 구조적 검사:
   * - 정규식으로 검출하기 어려운 구조적 문제 탐지
   * - 코드 의미를 이해한 정확한 검증
   * 
   * 카테고리별 검사:
   * - naming_convention: 클래스/메서드 명명 규칙
   * - code_style: 메서드 길이, 복잡도 등
   * - error_handling: 빈 catch 블록 등
   * - 기타: 일반적인 AST 패턴 검사
   * 
   * @returns {array} AST 검사 위반사항
   */
  checkAstRule(sourceCode, rule, astAnalysis) {
    const violations = [];

    // AST 분석 결과 유효성 확인
    if (!astAnalysis || !astAnalysis.success) {
      console.warn(`  ⚠️ AST 분석 실패: ${rule.id}`);
      return violations;
    }

    // AST 힌트가 없으면 검사 불가
    if (!rule.astHints || !rule.astHints.nodeTypes) {
      return violations;
    }

    const lines = sourceCode.split('\n');

    try {
      // 카테고리별 특화 검사 실행
      switch (rule.category) {
        case 'naming_convention':
          violations.push(...this.checkNamingConventions(astAnalysis, rule, lines));
          break;

        case 'code_style':
          violations.push(...this.checkCodeStyleAST(astAnalysis, rule, lines));
          break;

        case 'error_handling':
          violations.push(...this.checkErrorHandling(astAnalysis, rule, lines));
          break;

        default:
          violations.push(...this.checkGenericAST(astAnalysis, rule, lines));
      }
    } catch (error) {
      console.warn(`  ⚠️ AST 규칙 검사 오류 (${rule.id}): ${error.message}`);
    }

    return violations;
  }

  /**
   * 명명 규칙 검사 (AST 기반)
   * 
   * 검사 항목:
   * 1. 클래스명 검사
   *    - PascalCase 규칙 준수 여부
   *    - 첫 글자 대문자, 이후 camelCase
   * 
   * 2. 메서드명 검사
   *    - camelCase 규칙 준수 여부
   *    - 첫 글자 소문자, getter/setter 패턴 검증
   * 
   * AST 활용:
   * - classes 배열에서 클래스 정보 추출
   * - methods 배열에서 메서드 정보 추출
   * - 정확한 라인 번호 확인
   * 
   * @returns {array} 명명 규칙 위반사항
   */
  checkNamingConventions(astAnalysis, rule, lines) {
    const violations = [];

    if (astAnalysis.classes) {
      astAnalysis.classes.forEach(cls => {
        // 클래스명 검사
        if (rule.title.includes('클래스') || rule.title.includes('Class')) {
          if (cls.name && !this.isValidClassName(cls.name)) {
            violations.push({
              ruleId: rule.id,
              title: rule.title,
              category: rule.category,
              severity: rule.severity,
              message: `클래스명 '${cls.name}'이(가) 명명 규칙을 위반합니다`,
              line: cls.line || 1,
              column: 0,
              fixable: true,
              source: 'development_guideline'
            });
          }
        }

        // 메서드명 검사
        if (cls.methods && (rule.title.includes('메서드') || rule.title.includes('Method'))) {
          cls.methods.forEach(method => {
            if (method.name && !this.isValidMethodName(method.name)) {
              violations.push({
                ruleId: rule.id,
                title: rule.title,
                category: rule.category,
                severity: rule.severity,
                message: `메서드명 '${method.name}'이(가) 명명 규칙을 위반합니다`,
                line: method.line || 1,
                column: 0,
                fixable: true,
                source: 'development_guideline'
              });
            }
          });
        }
      });
    }

    return violations;
  }

  /**
   * 코드 스타일 검사 (AST 기반)
   * 
   * 검사 항목:
   * - 메서드 길이: 50줄 초과 여부
   * - 메서드 복잡도: cyclomatic complexity (향후 확장)
   * - 중첩 깊이: 너무 깊은 중첩 구조 (향후 확장)
   * 
   * AST 활용:
   * - method.startLine, method.endLine으로 정확한 길이 계산
   * - 정규식보다 정확한 구조 분석
   * 
   * @returns {array} 코드 스타일 위반사항
   */
  checkCodeStyleAST(astAnalysis, rule, lines) {
    const violations = [];

    if (astAnalysis.classes) {
      astAnalysis.classes.forEach(cls => {
        if (cls.methods) {
          cls.methods.forEach(method => {
            // 메서드 길이 검사
            if (rule.title.includes('길이') || rule.title.includes('length')) {
              const methodLength = (method.endLine || 0) - (method.startLine || 0);
              if (methodLength > 50) {
                violations.push({
                  ruleId: rule.id,
                  title: rule.title,
                  category: rule.category,
                  severity: rule.severity,
                  message: `메서드 '${method.name}'의 길이가 너무 깁니다 (${methodLength}줄)`,
                  line: method.startLine || 1,
                  column: 0,
                  fixable: false,  // 구조 변경 필요하므로 자동 수정 불가
                  source: 'development_guideline'
                });
              }
            }
          });
        }
      });
    }

    return violations;
  }

  /**
   * 에러 처리 검사 (AST 기반)
   * 
   * 검사 항목:
   * - 빈 catch 블록: catch (e) {} 패턴 탐지
   * - 예외 무시: 로깅/처리 없는 catch
   * - 부적절한 예외 처리 (향후 확장)
   * 
   * 검사 방법:
   * - AST에서 메서드 범위 확인
   * - 해당 메서드 코드에서 빈 catch 패턴 검색
   * - 정규식 패턴: catch\s*\([^)]+\)\s*\{\s*\}
   * 
   * @returns {array} 에러 처리 위반사항
   */
  checkErrorHandling(astAnalysis, rule, lines) {
    const violations = [];

    if (astAnalysis.classes) {
      astAnalysis.classes.forEach(cls => {
        if (cls.methods) {
          cls.methods.forEach(method => {
            if (rule.title.includes('catch') || rule.title.includes('예외')) {
              // 메서드 코드 추출
              const methodCode = lines.slice(
                (method.startLine || 1) - 1,
                method.endLine || lines.length
              ).join('\n');

              // 빈 catch 블록 패턴 검사
              const emptyCatchPattern = /catch\s*\([^)]+\)\s*\{\s*\}/g;
              if (emptyCatchPattern.test(methodCode)) {
                violations.push({
                  ruleId: rule.id,
                  title: rule.title,
                  category: rule.category,
                  severity: rule.severity,
                  message: '빈 catch 블록이 발견되었습니다',
                  line: method.startLine || 1,
                  column: 0,
                  fixable: false,  // 예외 처리 로직 추가 필요
                  source: 'development_guideline'
                });
              }
            }
          });
        }
      });
    }

    return violations;
  }

  /**
   * 일반 AST 패턴 검사
   * 
   * astHints 기반 범용 검사:
   * - nodeTypes: 검사할 AST 노드 타입
   * - checkConditions: 확인할 조건 목록
   * 
   * 현재 지원:
   * - MethodDeclaration: 메서드 선언 노드
   * 
   * 향후 확장 가능:
   * - ClassDeclaration, IfStatement, ForStatement 등
   * 
   * @returns {array} 일반 AST 위반사항
   */
  checkGenericAST(astAnalysis, rule, lines) {
    const violations = [];

    if (rule.astHints && rule.astHints.nodeTypes) {
      rule.astHints.nodeTypes.forEach(nodeType => {
        if (nodeType === 'MethodDeclaration' && astAnalysis.classes) {
          astAnalysis.classes.forEach(cls => {
            if (cls.methods) {
              cls.methods.forEach(method => {
                // 규칙의 체크 조건 확인
                if (rule.astHints.checkConditions) {
                  rule.astHints.checkConditions.forEach(condition => {
                    violations.push({
                      ruleId: rule.id,
                      title: rule.title,
                      category: rule.category,
                      severity: rule.severity,
                      message: `${condition}을(를) 확인하세요`,
                      line: method.startLine || 1,
                      column: 0,
                      fixable: false,
                      source: 'development_guideline'
                    });
                  });
                }
              });
            }
          });
        }
      });
    }

    return violations;
  }

  /**
   * 복합 규칙 검사 (Regex + AST 이중 검증)
   * 
   * 검사 프로세스:
   * 1. Regex로 1차 스크리닝
   *    - 빠르게 의심 구간 탐지
   * 
   * 2. AST로 2차 검증
   *    - false positive 제거
   *    - 주석, 문자열 내부 매칭 제외
   *    - 실제 코드 구조 확인
   * 
   * 장점:
   * - Regex의 속도 + AST의 정확도
   * - 오탐 최소화
   * 
   * @returns {array} 복합 검사 위반사항
   */
  checkCombinedRule(sourceCode, rule, astAnalysis) {
    const violations = [];

    try {
      // Step 1: Regex로 1차 검사
      const regexViolations = this.checkRegexRule(sourceCode, rule);

      // 매칭이 없으면 종료
      if (regexViolations.length === 0) {
        return violations;
      }

      // Step 2: AST로 2차 검증
      if (astAnalysis && astAnalysis.success) {
        regexViolations.forEach(violation => {
          // AST 구조와 대조하여 실제 위반인지 확인
          const isRealViolation = this.validateViolationWithAST(
            violation,
            astAnalysis,
            sourceCode
          );

          if (isRealViolation) {
            violations.push(violation);
          }
        });
      } else {
        // AST 분석 실패 시 regex 결과 그대로 사용
        violations.push(...regexViolations);
      }
    } catch (error) {
      console.warn(`  ⚠️ 복합 규칙 검사 오류 (${rule.id}): ${error.message}`);
    }

    return violations;
  }

  /**
   * AST를 이용한 위반사항 검증 (false positive 제거)
   * 
   * 검증 항목:
   * 1. 주석/문자열 내부 여부 확인
   *    - 주석 내 매칭은 실제 코드가 아님
   *    - 문자열 리터럴 내 매칭 제외
   * 
   * 2. 메서드 범위 확인
   *    - 실제 메서드 코드 내부인지 확인
   *    - import, 주석 등 메타 영역 제외
   * 
   * @returns {boolean} 실제 위반 여부
   */
  validateViolationWithAST(violation, astAnalysis, sourceCode) {
    const lines = sourceCode.split('\n');
    const line = lines[violation.line - 1] || '';

    // 주석이나 문자열 내부인지 확인
    if (this.isInCommentOrString(line, violation.column)) {
      return false;  // 주석/문자열 내부는 false positive
    }

    // 메서드 범위 내부인지 확인
    if (astAnalysis.classes) {
      for (const cls of astAnalysis.classes) {
        if (cls.methods) {
          for (const method of cls.methods) {
            // 위반 라인이 메서드 범위 내에 있는지 확인
            if (violation.line >= (method.startLine || 0) &&
              violation.line <= (method.endLine || 999999)) {
              return true;  // 실제 메서드 코드 내부
            }
          }
        }
      }
    }

    // 클래스/메서드 외부 코드도 유효한 위반으로 간주
    return true;
  }

  /**
   * 주석 또는 문자열 내부 여부 확인
   * 
   * 검사 방법:
   * 1. 한 줄 주석 확인: // 이후는 주석
   * 2. 블록 주석 확인: \/* *\/ 내부인지 확인
   * 3. 문자열 리터럴 확인: 홀수 개의 따옴표 = 문자열 내부
   * 
   * 제한사항:
   * - 멀티라인 블록 주석은 정확히 탐지 못할 수 있음
   * - 이스케이프된 따옴표(\")는 고려하지 않음
   * 
   * @param {string} line - 검사할 라인
   * @param {number} column - 검사할 컬럼 위치
   * @returns {boolean} 주석/문자열 내부 여부
   */
  isInCommentOrString(line, column) {
    // 컬럼 이전 부분만 추출
    const beforeColumn = line.substring(0, column);

    // 한 줄 주석 확인
    if (beforeColumn.includes('//')) {
      return true;
    }

    // 블록 주석 확인 (시작했지만 끝나지 않음)
    if (beforeColumn.includes('/*') && !beforeColumn.includes('*/')) {
      return true;
    }

    // 문자열 리터럴 확인 (홀수 개의 따옴표)
    const singleQuotes = (beforeColumn.match(/'/g) || []).length;
    const doubleQuotes = (beforeColumn.match(/"/g) || []).length;

    if (singleQuotes % 2 === 1 || doubleQuotes % 2 === 1) {
      return true;  // 문자열 내부
    }

    return false;
  }

  /**
   * 유효한 클래스명 검증
   * 
   * 규칙: PascalCase
   * - 첫 글자 대문자
   * - 이후 영문자/숫자 조합
   * - 특수문자/공백 불가
   * 
   * 예: UserService, OrderController (O)
   *    userService, user_service (X)
   */
  isValidClassName(name) {
    return /^[A-Z][a-zA-Z0-9]*$/.test(name);
  }

  /**
   * 유효한 메서드명 검증
   * 
   * 규칙: camelCase
   * - 첫 글자 소문자
   * - 이후 영문자/숫자 조합
   * - getter/setter 패턴 제외 (get/set/is로 시작하고 대문자 이어짐)
   * 
   * 예: getUserName, calculateTotal (O)
   *    GetUserName, get_user_name (X)
   */
  isValidMethodName(name) {
    return /^[a-z][a-zA-Z0-9]*$/.test(name) && !name.match(/^(get|set|is)[A-Z]/);
  }

  /**
   * LLM 기반 컨텍스트 규칙 검사
   * 
   * 실행 프로세스:
   * 1. 적용 가능한 규칙 필터링
   *    - keywords로 코드와 규칙 매칭
   *    - 불필요한 LLM 호출 최소화
   * 
   * 2. 배치 처리 (3개씩)
   *    - API 호출 횟수 최적화
   *    - Rate limiting 고려
   * 
   * 3. 배치 실패 시 개별 처리
   *    - 부분 실패 허용
   *    - 각 규칙 독립적으로 재시도
   * 
   * 4. Rate limiting (1초 대기)
   *    - API 과부하 방지
   * 
   * @returns {array} 컨텍스트 규칙 위반사항
   */
  async checkContextualRules(sourceCode, astAnalysis) {
    logger.info('  🤖 LLM 기반 맥락적 가이드라인 검사 시작...');

    const violations = [];
    
    // Step 1: keywords 기반 적용 가능한 규칙 필터링
    const applicableRules = this.filterApplicableContextualRules(sourceCode);
    if (applicableRules.length === 0) {
      logger.info('    해당 코드에 적용 가능한 맥락적 가이드라인 없음');
      return violations;
    }

    logger.info(`    적용 가능한 맥락적 가이드라인: ${applicableRules.length}개`);

    // Step 2: 배치 처리 (3개씩 묶어서 처리)
    const batchSize = 3;
    for (let i = 0; i < applicableRules.length; i += batchSize) {
      const batch = applicableRules.slice(i, i + batchSize);

      try {
        // 배치 단위 LLM 검사
        const batchViolations = await this.checkContextualRulesBatch(sourceCode, batch);
        violations.push(...batchViolations);
      } catch (error) {
        console.warn(`    맥락적 규칙 배치 검사 실패: ${error.message}`);

        // Step 3: 배치 실패 시 개별 처리로 폴백
        for (const rule of batch) {
          try {
            const individualViolations = await this.checkSingleContextualRule(sourceCode, rule);
            violations.push(...individualViolations);
          } catch (individualError) {
            console.warn(`    개별 맥락적 규칙 검사 실패 (${rule.id}): ${individualError.message}`);
          }
        }
      }

      // Step 4: Rate limiting (마지막 배치가 아니면 대기)
      if (i + batchSize < applicableRules.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    logger.info(`    맥락적 가이드라인 검사 완료: ${violations.length}개 위반 발견`);
    return violations;
  }

  /**
   * 적용 가능한 컨텍스트 규칙 필터링 (개선 버전)
   * 
   * 수정 사항:
   * - keywords 없을 때 에러 방지
   * - keywords 배열 검증
   * 
   * @param {string} sourceCode - 소스 코드
   * @returns {array} 적용 가능한 규칙 목록
   */
  filterApplicableContextualRules(sourceCode) {
    const applicable = [];
    const lowerCode = sourceCode.toLowerCase();

    for (const [ruleId, rule] of this.contextualRules) {
      // keywords 검증
      if (!rule.keywords || !Array.isArray(rule.keywords) || rule.keywords.length === 0) {
        console.warn(`  ⚠️ [${ruleId}] keywords 없음 - 필터링에서 제외`);
        continue;
      }

      // 규칙의 키워드 중 하나라도 코드에 포함되어 있는지 확인
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
   * 컨텍스트 규칙 배치 검사 (개선 버전)
   */
  async checkContextualRulesBatch(sourceCode, rules) {
    // 각 규칙의 정보를 프롬프트 형식으로 변환
    const rulesDescription = rules.map(rule => {
      // id 필드 안전하게 접근
      const ruleId = rule.id || rule.ruleId || 'unknown';
      
      // examples 안전하게 접근
      const goodExamples = rule.examples?.good || [];
      const badExamples = rule.examples?.bad || [];
      
      return `
### ${rule.title} (${ruleId})
${rule.description || ''}

올바른 예시:
${goodExamples.map(ex => `- ${ex}`).join('\n') || '- (없음)'}

잘못된 예시:  
${badExamples.map(ex => `- ${ex}`).join('\n') || '- (없음)'}
`;
    }).join('\n---\n');

    // LLM 프롬프트 구성
    const prompt = `다음 Java 코드가 제시된 개발 가이드라인들을 준수하는지 검사해주세요.

## 검사 대상 코드:
\`\`\`java
${this.truncateCode(sourceCode, 2000)}
\`\`\`

## 적용할 가이드라인들:
${rulesDescription}

## 검사 결과 형식:
각 가이드라인에 대해 위반사항이 있으면 다음 JSON 형식으로 응답해주세요:

\`\`\`json
{
  "violations": [
    {
      "ruleId": "규칙 ID",
      "title": "규칙 제목",
      "violation": true,
      "line": 위반 라인 번호,
      "description": "구체적인 위반 내용 설명",
      "suggestion": "수정 제안"
    }
  ]
}
\`\`\`

위반사항이 없으면 violations 배열을 빈 배열로 반환해주세요.`;

    // LLM 호출
    const response = await this.llmService.generateCompletion(prompt, {
      temperature: 0.1,
      num_predict: 1000
    });

    return this.parseLLMContextualResponse(response, rules);
  }

  /**
   * 단일 컨텍스트 규칙 검사 (LLM 호출)
   * 
   * 배치 검사 실패 시 사용:
   * - 개별 규칙만 검사
   * - 더 짧은 프롬프트
   * - 더 빠른 응답
   * 
   * 프롬프트 구조:
   * - 코드 (최대 2000자)
   * - 단일 가이드라인 정보
   * - 예시 (good/bad)
   * - JSON 응답 형식
   * 
   * @returns {array} 단일 규칙 위반사항
   */
  async checkSingleContextualRule(sourceCode, rule) {
    const prompt = `다음 Java 코드가 개발 가이드라인을 준수하는지 검사해주세요.

## 검사 대상 코드:
\`\`\`java
${this.truncateCode(sourceCode, 2000)}
\`\`\`

## 가이드라인: ${rule.title}
${rule.description}

올바른 예시:
${rule.examples.good.map(ex => `- ${ex}`).join('\n')}

잘못된 예시:
${rule.examples.bad.map(ex => `- ${ex}`).join('\n')}

## 검사 결과:
위반사항이 있으면 구체적인 라인 번호와 위반 내용을 JSON 형식으로 제시해주세요.
위반사항이 없으면 {"violations": []} 로 응답해주세요.

\`\`\`json
{
  "violations": [
    {
      "line": 라인번호,
      "description": "위반 내용",
      "suggestion": "수정 제안"
    }
  ]
}
\`\`\``;

    const response = await this.llmService.generateCompletion(prompt, {
      temperature: 0.1,
      num_predict: 800
    });

    // JSON 파싱
    const parsed = this.llmService.llmClient.cleanAndExtractJSON(response);

    if (!parsed || !parsed.violations) {
      console.warn(`    LLM 응답 파싱 실패: ${rule.id}`);
      return [];
    }

    // 위반사항을 표준 형식으로 변환
    return parsed.violations.map(violation => ({
      ruleId: rule.id,
      title: rule.title,
      category: rule.category,
      severity: rule.severity,
      message: violation.description,
      line: violation.line || 1,
      column: 0,
      fixable: true,
      suggestion: violation.suggestion,
      source: 'llm_contextual'
    }));
  }

  /**
   * LLM 배치 응답 파싱
   * 
   * 파싱 프로세스:
   * 1. JSON 추출 및 정제
   * 2. violations 배열 확인
   * 3. 각 위반사항 검증:
   *    - ruleId로 규칙 매칭
   *    - violation = true인 것만 처리
   * 4. 표준 위반 형식으로 변환
   * 
   * 에러 처리:
   * - JSON 파싱 실패 시 빈 배열 반환
   * - 부분 실패 허용 (일부만 파싱 성공)
   * 
   * @returns {array} 파싱된 위반사항
   */
  parseLLMContextualResponse(response, rules) {
    const violations = [];

    try {
      // LLM 응답에서 JSON 추출 (마크다운 코드 블록 제거 등)
      const parsed = this.llmService.llmClient.cleanAndExtractJSON(response);

      if (parsed && parsed.violations && Array.isArray(parsed.violations)) {
        parsed.violations.forEach(violation => {
          // 규칙 ID로 원본 규칙 찾기
          const rule = rules.find(r => r.id === violation.ruleId);
          
          // 실제 위반(violation = true)이고 규칙이 존재하는 경우만 추가
          if (rule && violation.violation === true) {
            violations.push({
              ruleId: violation.ruleId,
              title: violation.title || rule.title,
              category: rule.category,
              severity: rule.severity,
              message: violation.description,
              line: violation.line || 1,
              column: 0,
              fixable: true,
              suggestion: violation.suggestion,
              source: 'llm_contextual'
            });
          }
        });
      }
    } catch (error) {
      console.warn('    LLM 배치 응답 파싱 실패:', error.message);
    }

    return violations;
  }

  /**
   * 코드 길이 제한 (LLM 컨텍스트 크기 제한)
   * 
   * 제한 이유:
   * - LLM 토큰 제한 (일반적으로 4K-8K)
   * - 응답 속도 최적화
   * - API 비용 절감
   * 
   * 잘라내기 전략:
   * - 라인 단위로 잘라냄 (코드 구조 유지)
   * - 최대 길이 초과 시 "// ... (코드 생략)" 추가
   * 
   * @param {string} code - 원본 코드
   * @param {number} maxLength - 최대 길이
   * @returns {string} 잘라낸 코드
   */
  truncateCode(code, maxLength) {
    if (code.length <= maxLength) return code;

    const lines = code.split('\n');
    let truncated = '';

    for (const line of lines) {
      // 다음 라인 추가 시 maxLength 초과하면 중단
      if (truncated.length + line.length + 1 > maxLength) {
        truncated += '\n// ... (코드 생략)';
        break;
      }
      truncated += (truncated ? '\n' : '') + line;
    }

    return truncated;
  }

  /**
   * 가이드라인 텍스트 import (향후 확장)
   * 
   * 기능:
   * - 텍스트 형식의 가이드라인 문서 파싱
   * - 자동으로 규칙 추출 및 저장
   * - VectorDB에 저장
   * 
   * 사용 시나리오:
   * - 회사 개발 가이드 문서 자동 등록
   * - 규칙 업데이트 자동화
   * 
   * @param {string} guidelineText - 가이드라인 텍스트
   */
  async importGuidelineText(guidelineText) {
    logger.info('📄 개발가이드 텍스트 파싱 중...');

    // 텍스트를 섹션별로 파싱
    const sections = this.parseGuidelineText(guidelineText);

    // 각 섹션을 규칙으로 저장
    for (const section of sections) {
      if (section.type === 'contextual') {
        await this.storeContextualGuideline(section);
      } else {
        await this.storeStaticGuideline(section);
      }
    }

    logger.info(`✅ 가이드라인 import 완료: ${sections.length}개 규칙`);
  }

  /**
   * 가이드라인 텍스트 파싱
   * 
   * 파싱 규칙:
   * - 챕터 번호 패턴: "3.3.1.1.3 제목" 형식
   * - 각 챕터를 하나의 섹션으로 분리
   * - 규칙 타입 자동 판단 (contextual vs static)
   * 
   * @returns {array} 파싱된 섹션 목록
   */
  parseGuidelineText(text) {
    const sections = [];
    const lines = text.split('\n');

    let currentSection = null;

    for (const line of lines) {
      // 챕터 번호 패턴 매칭: "3.3.1.1.3 제목" 형식
      const chapterMatch = line.match(/^(\d+\.\d+\.\d+\.\d+)\s+(.+)$/);
      if (chapterMatch) {
        // 이전 섹션이 있으면 저장
        if (currentSection) {
          sections.push(currentSection);
        }

        // 새 섹션 시작
        currentSection = {
          id: chapterMatch[1],           // 챕터 번호 (예: 3.3.1.1.3)
          title: chapterMatch[2],         // 제목
          content: line,                  // 전체 내용 (누적)
          type: this.determineRuleType(line)  // 규칙 타입 판단
        };
      } else if (currentSection) {
        // 현재 섹션에 내용 추가
        currentSection.content += '\n' + line;
      }
    }

    // 마지막 섹션 저장
    if (currentSection) {
      sections.push(currentSection);
    }

    return sections;
  }

  /**
   * 규칙 타입 자동 판단
   * 
   * 판단 기준:
   * - 'contextual' 타입:
   *   - "명명 규칙" 포함 (비즈니스 도메인 의존적)
   *   - "분리" 포함 (아키텍처 패턴)
   *   - "로직" 포함 (복잡한 규칙)
   * 
   * - 'static' 타입:
   *   - 위 키워드가 없는 경우
   *   - 단순 포맷팅, 스타일 규칙
   * 
   * @returns {string} 'contextual' 또는 'static'
   */
  determineRuleType(content) {
    if (content.includes('명명 규칙') || content.includes('분리') || content.includes('로직')) {
      return 'contextual';
    } else {
      return 'static';
    }
  }

  /**
   * 컨텍스트 가이드라인 저장 (VectorDB)
   * 
   * 저장 프로세스:
   * - 섹션 정보를 contextualRules 형식으로 변환
   * - VectorDB에 임베딩과 함께 저장
   * - 향후 검색 및 매칭에 사용
   * 
   * TODO: VectorDB 저장 로직 구현
   */
  async storeContextualGuideline(section) {
    logger.info(`맥락적 가이드라인 저장: ${section.id}`);
    // TODO: VectorDB 저장 로직
  }

  /**
   * 정적 가이드라인 저장 (VectorDB)
   * 
   * 저장 프로세스:
   * - 섹션에서 정규식 패턴 추출
   * - staticRules 형식으로 변환
   * - VectorDB에 저장
   * 
   * TODO: 패턴 자동 추출 및 저장 로직 구현
   */
  async storeStaticGuideline(section) {
    logger.info(`정적 가이드라인 저장: ${section.id}`);
    // TODO: VectorDB 저장 로직
  }
}