/**
 * 태그 요구사항 분석기 (TagRequirementAnalyzer)
 * 
 * 가이드라인 규칙을 분석하여 탐지에 필요한 태그 목록을 추출합니다.
 * LLM을 사용하여 규칙 설명에서 코드 패턴을 파악하고,
 * 기존 태그 정의와 매칭합니다.
 * 
 * @module analyzer/TagRequirementAnalyzer
 * @version 1.0.0
 */

import { getTagDefinitionLoader } from '../profiler/TagDefinitionLoader.js';
import logger from '../utils/loggerUtils.js';

/**
 * 태그 요구사항 분석 결과
 * @typedef {Object} TagRequirementResult
 * @property {string} ruleId - 규칙 ID
 * @property {string[]} requiredTags - 필수 태그 목록
 * @property {string[]} optionalTags - 선택적 태그 목록
 * @property {string[]} suggestedNewTags - 새로 정의가 필요한 태그
 * @property {number} confidence - 분석 신뢰도 (0-1)
 * @property {string} reasoning - 분석 근거
 */

export class TagRequirementAnalyzer {
  constructor() {
    /** @type {import('../profiler/TagDefinitionLoader.js').TagDefinitionLoader} */
    this.tagLoader = null;
    
    /** @type {import('../clients/llmClient.js').LLMClient} */
    this.llmClient = null;
    
    /** @type {boolean} */
    this.initialized = false;
    
    /** @type {Map<string, string[]>} 카테고리별 관련 태그 캐시 */
    this.categoryTagCache = new Map();
    
    /** @type {Map<string, string[]>} 키워드-태그 매핑 */
    this.keywordTagMapping = new Map();
  }

  /**
   * 초기화
   * 
   * @param {Object} options - 옵션
   * @param {Object} [options.llmClient] - LLM 클라이언트 (없으면 규칙 기반만 사용)
   * @returns {Promise<boolean>}
   */
  async initialize(options = {}) {
    if (this.initialized) return true;

    logger.info('🔍 TagRequirementAnalyzer 초기화 중...');

    // 태그 정의 로더 초기화
    this.tagLoader = getTagDefinitionLoader();
    await this.tagLoader.initialize();

    // LLM 클라이언트 (선택적)
    this.llmClient = options.llmClient || null;

    // 키워드-태그 매핑 구축
    this.buildKeywordTagMapping();

    this.initialized = true;
    logger.info('✅ TagRequirementAnalyzer 초기화 완료');
    
    return true;
  }

  /**
   * 키워드-태그 매핑 테이블 구축
   * 규칙 텍스트에서 빠르게 관련 태그를 찾기 위함
   */
  buildKeywordTagMapping() {
    // 기본 키워드 매핑 (우선순위가 높은 것을 먼저)
    const mappings = {
      // 보안 관련 (높은 우선순위)
      'sql injection': ['SQL_INJECTION_RISK'],
      'sql 인젝션': ['SQL_INJECTION_RISK'],
      'preparedstatement': ['USES_PREPARED_STATEMENT'],
      '문자열 연결': ['HAS_SQL_CONCATENATION'],
      'string concatenation': ['HAS_SQL_CONCATENATION'],
      '비밀번호': ['HAS_HARDCODED_PASSWORD'],
      'password': ['HAS_HARDCODED_PASSWORD'],
      'secret': ['HAS_HARDCODED_PASSWORD'],
      'api_key': ['HAS_HARDCODED_PASSWORD'],
      '하드코딩': ['HAS_HARDCODED_PASSWORD'],
      'xss': ['HAS_XSS_RISK'],
      
      // 리소스 관련
      'connection': ['USES_CONNECTION'],
      'statement': ['USES_STATEMENT'],
      'resultset': ['USES_RESULTSET'],
      'close': ['HAS_FINALLY_CLOSE', 'HAS_TRY_WITH_RESOURCES'],
      'try-with-resources': ['HAS_TRY_WITH_RESOURCES'],
      'finally': ['HAS_FINALLY_CLOSE'],
      'stream': ['USES_STREAM'],
      '리소스 누수': ['RESOURCE_LEAK_RISK'],
      'resource leak': ['RESOURCE_LEAK_RISK'],
      
      // 아키텍처 관련
      'controller': ['IS_CONTROLLER'],
      '@controller': ['IS_CONTROLLER'],
      '@restcontroller': ['IS_CONTROLLER'],
      'service': ['IS_SERVICE'],
      '@service': ['IS_SERVICE'],
      'repository': ['IS_REPOSITORY'],
      '@repository': ['IS_REPOSITORY'],
      'dao': ['IS_DAO'],
      'entity': ['IS_ENTITY'],
      '@transactional': ['HAS_TRANSACTIONAL'],
      'transactional': ['HAS_TRANSACTIONAL'],
      
      // 예외 처리 관련
      '빈 catch': ['HAS_EMPTY_CATCH'],
      'empty catch': ['HAS_EMPTY_CATCH'],
      'catch': ['HAS_EMPTY_CATCH', 'HAS_GENERIC_CATCH'],
      'exception': ['HAS_GENERIC_CATCH'],
      '예외': ['HAS_GENERIC_CATCH'],
      '포괄적 예외': ['HAS_GENERIC_CATCH'],
      'catch(exception': ['HAS_GENERIC_CATCH'],
      
      // 성능 관련
      'n+1': ['N_PLUS_ONE_RISK', 'HAS_DB_CALL_IN_LOOP'],
      'n + 1': ['N_PLUS_ONE_RISK', 'HAS_DB_CALL_IN_LOOP'],
      '루프': ['HAS_LOOP'],
      'loop': ['HAS_LOOP'],
      '반복문': ['HAS_LOOP'],
      'for': ['HAS_LOOP'],
      'while': ['HAS_LOOP'],
      '루프 내 db': ['HAS_DB_CALL_IN_LOOP'],
      
      // 로깅 관련
      'logging': ['HAS_LOGGING'],
      'logger': ['HAS_LOGGING'],
      '로깅': ['HAS_LOGGING'],
      '로그': ['HAS_LOGGING']
    };

    for (const [keyword, tags] of Object.entries(mappings)) {
      this.keywordTagMapping.set(keyword.toLowerCase(), tags);
    }
  }

  /**
   * 단일 규칙 분석 (메인 메서드)
   * 
   * @param {Object} rule - 분석할 규칙
   * @param {Object} options - 옵션
   * @returns {Promise<TagRequirementResult>}
   */
  async analyzeRule(rule, options = {}) {
    const { useLLM = true } = options;

    logger.info(`  🔍 규칙 분석: ${rule.ruleId || rule.title}`);

    // Step 1: 규칙 기반 분석 (빠름, 항상 실행)
    const ruleBasedResult = this.analyzeRuleBased(rule);

    // Step 2: LLM 기반 분석 (정확함, 선택적)
    let llmResult = null;
    if (useLLM && this.llmClient) {
      llmResult = await this.analyzeLLMBased(rule);
    }

    // Step 3: 결과 병합
    return this.mergeResults(rule, ruleBasedResult, llmResult);
  }

  /**
   * 규칙 기반 분석 (키워드 매칭)
   * 
   * @param {Object} rule - 규칙
   * @returns {Object} 분석 결과
   */
  analyzeRuleBased(rule) {
    const text = this.extractRuleText(rule).toLowerCase();
    const foundTags = new Set();
    const matchedKeywords = [];

    // 키워드 매칭
    for (const [keyword, tags] of this.keywordTagMapping) {
      if (text.includes(keyword)) {
        tags.forEach(t => foundTags.add(t));
        matchedKeywords.push(keyword);
      }
    }

    // 카테고리 기반 추가 태그
    const categoryTags = this.getTagsByRuleCategory(rule.category);
    categoryTags.forEach(t => foundTags.add(t));

    // 기존 keywords 필드 활용
    if (rule.keywords && Array.isArray(rule.keywords)) {
      for (const kw of rule.keywords) {
        const kwLower = kw.toLowerCase();
        if (this.keywordTagMapping.has(kwLower)) {
          this.keywordTagMapping.get(kwLower).forEach(t => foundTags.add(t));
        }
      }
    }

    return {
      tags: Array.from(foundTags),
      matchedKeywords,
      confidence: this.calculateConfidence(foundTags.size, matchedKeywords.length)
    };
  }

  /**
   * LLM 기반 분석 (정확한 분석)
   * 
   * @param {Object} rule - 규칙
   * @returns {Promise<Object|null>}
   */
  async analyzeLLMBased(rule) {
    if (!this.llmClient) return null;

    const availableTags = this.getAvailableTagsForPrompt();
    const prompt = this.buildAnalysisPrompt(rule, availableTags);

    try {
      const response = await this.llmClient.generateCompletion(prompt, {
        temperature: 0.1,
        max_tokens: 1000
      });

      return this.parseAnalysisResponse(response);
    } catch (error) {
      logger.warn(`  ⚠️ LLM 분석 실패: ${error.message}`);
      return null;
    }
  }

  /**
   * LLM 프롬프트 생성
   * 
   * @param {Object} rule - 규칙
   * @param {string} availableTags - 사용 가능한 태그 목록
   * @returns {string}
   */
  buildAnalysisPrompt(rule, availableTags) {
    const ruleText = this.extractRuleText(rule);

    return `당신은 Java 코드 품질 전문가입니다.
아래 개발 가이드라인 규칙을 분석하여, 이 규칙을 탐지하기 위해 필요한 코드 태그를 식별해주세요.

## 분석할 규칙
- **ID**: ${rule.ruleId || 'N/A'}
- **제목**: ${rule.title || 'N/A'}
- **설명**: ${rule.description || 'N/A'}
- **카테고리**: ${rule.category || 'N/A'}
- **심각도**: ${rule.severity || 'N/A'}
${rule.examples?.bad ? `- **잘못된 예시**: ${rule.examples.bad[0]}` : ''}
${rule.examples?.good ? `- **올바른 예시**: ${rule.examples.good[0]}` : ''}

## 사용 가능한 태그 목록
${availableTags}

## 분석 지침
1. 규칙을 위반하는 코드를 탐지하려면 어떤 태그가 있어야 하는지 생각하세요.
2. 필수 태그: 규칙 위반 탐지에 반드시 필요한 태그
3. 선택적 태그: 있으면 더 정확한 탐지가 가능한 태그
4. 새 태그 제안: 기존 태그로 부족하면 새 태그 이름 제안

## 응답 형식 (JSON)
\`\`\`json
{
  "requiredTags": ["TAG1", "TAG2"],
  "optionalTags": ["TAG3"],
  "suggestedNewTags": [],
  "reasoning": "이 규칙은 ... 때문에 TAG1, TAG2가 필요합니다."
}
\`\`\`

JSON만 반환하세요.`;
  }

  /**
   * 사용 가능한 태그 목록 문자열 생성
   * 
   * @returns {string}
   */
  getAvailableTagsForPrompt() {
    const tags = this.tagLoader.getAllTagNames();
    const compoundTags = Object.keys(this.tagLoader.getCompoundTags());
    
    const tagDescriptions = tags.map(name => {
      const def = this.tagLoader.getTagDefinition(name);
      return `- ${name}: ${def.description}`;
    });

    const compoundDescriptions = compoundTags.map(name => {
      const def = this.tagLoader.getCompoundTag(name);
      return `- ${name} (복합): ${def.description}`;
    });

    return [...tagDescriptions, ...compoundDescriptions].join('\n');
  }

  /**
   * LLM 응답 파싱
   * 
   * @param {string} response - LLM 응답
   * @returns {Object|null}
   */
  parseAnalysisResponse(response) {
    try {
      // JSON 블록 추출
      const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : response;
      
      // { } 사이 추출
      const braceMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (!braceMatch) return null;

      const parsed = JSON.parse(braceMatch[0]);
      
      return {
        requiredTags: parsed.requiredTags || [],
        optionalTags: parsed.optionalTags || [],
        suggestedNewTags: parsed.suggestedNewTags || [],
        reasoning: parsed.reasoning || ''
      };
    } catch (error) {
      logger.warn(`  ⚠️ 응답 파싱 실패: ${error.message}`);
      return null;
    }
  }

  /**
   * 규칙 기반/LLM 기반 결과 병합
   * 
   * @param {Object} rule - 원본 규칙
   * @param {Object} ruleBasedResult - 규칙 기반 결과
   * @param {Object|null} llmResult - LLM 결과
   * @returns {TagRequirementResult}
   */
  mergeResults(rule, ruleBasedResult, llmResult) {
    const requiredTags = new Set(ruleBasedResult.tags);
    const optionalTags = new Set();
    const suggestedNewTags = new Set();
    let reasoning = `키워드 매칭: [${ruleBasedResult.matchedKeywords.join(', ')}]`;
    let confidence = ruleBasedResult.confidence;

    if (llmResult) {
      // LLM 필수 태그 추가
      llmResult.requiredTags.forEach(t => {
        if (this.isValidTag(t)) {
          requiredTags.add(t);
        }
      });

      // LLM 선택적 태그 추가
      llmResult.optionalTags.forEach(t => {
        if (this.isValidTag(t) && !requiredTags.has(t)) {
          optionalTags.add(t);
        }
      });

      // 새 태그 제안
      llmResult.suggestedNewTags.forEach(t => suggestedNewTags.add(t));

      // 신뢰도 및 근거 업데이트
      confidence = Math.min(confidence + 0.2, 1.0);
      reasoning += `\nLLM 분석: ${llmResult.reasoning}`;
    }

    return {
      ruleId: rule.ruleId || rule.id,
      title: rule.title,
      category: rule.category,
      requiredTags: Array.from(requiredTags),
      optionalTags: Array.from(optionalTags),
      suggestedNewTags: Array.from(suggestedNewTags),
      confidence,
      reasoning
    };
  }

  /**
   * 다중 규칙 배치 분석
   * 
   * @param {Object[]} rules - 규칙 배열
   * @param {Object} options - 옵션
   * @returns {Promise<TagRequirementResult[]>}
   */
  async analyzeRules(rules, options = {}) {
    const { batchSize = 5, useLLM = false } = options;
    const results = [];

    logger.info(`📊 ${rules.length}개 규칙 분석 시작...`);

    for (let i = 0; i < rules.length; i += batchSize) {
      const batch = rules.slice(i, i + batchSize);
      
      for (const rule of batch) {
        const result = await this.analyzeRule(rule, { useLLM });
        results.push(result);
      }

      logger.info(`  진행: ${Math.min(i + batchSize, rules.length)}/${rules.length}`);
    }

    logger.info(`✅ 분석 완료: ${results.length}개 규칙`);
    return results;
  }

  // ═══════════════════════════════════════════════════════════════════
  // 유틸리티 메서드
  // ═══════════════════════════════════════════════════════════════════

  /**
   * 규칙에서 텍스트 추출
   */
  extractRuleText(rule) {
    const parts = [
      rule.title || '',
      rule.description || '',
      rule.details || '',
      (rule.keywords || []).join(' '),
      (rule.examples?.bad || []).join(' '),
      (rule.examples?.good || []).join(' ')
    ];
    return parts.join(' ');
  }

  /**
   * 카테고리별 기본 태그 반환
   */
  getTagsByRuleCategory(category) {
    const categoryTagMap = {
      'resource_management': ['RESOURCE_LEAK_RISK'],
      'security': ['SQL_INJECTION_RISK', 'HAS_HARDCODED_PASSWORD'],
      'security_vulnerability': ['SQL_INJECTION_RISK'],
      'architecture': ['IS_CONTROLLER', 'IS_SERVICE', 'IS_DAO'],
      'exception_handling': ['HAS_EMPTY_CATCH', 'HAS_GENERIC_CATCH', 'POOR_ERROR_HANDLING'],
      'performance': ['N_PLUS_ONE_RISK', 'HAS_DB_CALL_IN_LOOP'],
      'performance_issue': ['N_PLUS_ONE_RISK']
    };

    return categoryTagMap[category] || [];
  }

  /**
   * 태그 유효성 검증
   */
  isValidTag(tagName) {
    return this.tagLoader.getTagDefinition(tagName) !== null ||
           this.tagLoader.getCompoundTag(tagName) !== null;
  }

  /**
   * 신뢰도 계산
   */
  calculateConfidence(tagCount, keywordCount) {
    if (tagCount === 0) return 0.1;
    if (tagCount === 1) return 0.4;
    if (tagCount === 2) return 0.6;
    if (tagCount >= 3 && keywordCount >= 2) return 0.8;
    return Math.min(0.5 + tagCount * 0.1, 0.9);
  }

  /**
   * 분석 결과 요약 출력
   */
  summarizeResults(results) {
    const summary = {
      total: results.length,
      withTags: results.filter(r => r.requiredTags.length > 0).length,
      noTags: results.filter(r => r.requiredTags.length === 0).length,
      needsNewTags: results.filter(r => r.suggestedNewTags.length > 0).length,
      avgConfidence: results.reduce((sum, r) => sum + r.confidence, 0) / results.length
    };

    console.log('\n=== 분석 결과 요약 ===');
    console.log(`총 규칙: ${summary.total}개`);
    console.log(`태그 매핑 성공: ${summary.withTags}개`);
    console.log(`태그 매핑 실패: ${summary.noTags}개`);
    console.log(`새 태그 필요: ${summary.needsNewTags}개`);
    console.log(`평균 신뢰도: ${(summary.avgConfidence * 100).toFixed(0)}%`);

    return summary;
  }
}

// 싱글톤
let instance = null;

export function getTagRequirementAnalyzer() {
  if (!instance) {
    instance = new TagRequirementAnalyzer();
  }
  return instance;
}

export default TagRequirementAnalyzer;
