/**
 * 규칙-태그 매퍼 (RuleTagMapper)
 * 
 * TagRequirementAnalyzer의 분석 결과(필요 태그 목록)를 받아서
 * tagCondition 표현식을 자동 생성합니다.
 * 
 * 표현식 생성 전략:
 * 1. 복합 태그 우선: 이미 정의된 복합 태그가 있으면 활용
 * 2. 논리 조합: 필수 태그는 AND, 선택 태그는 OR
 * 3. 부정 조건: 안전 패턴 태그가 없어야 위반인 경우 NOT 사용
 * 
 * @module analyzer/RuleTagMapper
 * @version 1.0.0
 */

import { getTagDefinitionLoader } from '../profiler/TagDefinitionLoader.js';
import { getTagExpressionEvaluator } from '../matcher/TagExpressionEvaluator.js';
import logger from '../utils/loggerUtils.js';

/**
 * 매핑 결과
 * @typedef {Object} MappingResult
 * @property {string} ruleId - 규칙 ID
 * @property {string} tagCondition - 생성된 태그 조합 표현식
 * @property {string} strategy - 사용된 전략
 * @property {number} complexity - 표현식 복잡도
 * @property {boolean} validated - 유효성 검증 통과 여부
 */

export class RuleTagMapper {
  constructor() {
    /** @type {import('../profiler/TagDefinitionLoader.js').TagDefinitionLoader} */
    this.tagLoader = null;
    
    /** @type {import('../matcher/TagExpressionEvaluator.js').TagExpressionEvaluator} */
    this.evaluator = null;
    
    /** @type {import('../clients/llmClient.js').LLMClient} */
    this.llmClient = null;
    
    /** @type {boolean} */
    this.initialized = false;

    /** @type {Map<string, string>} 카테고리별 기본 복합 태그 */
    this.categoryDefaultTags = new Map();
    // 안전한 방식으로 Map 초기화
    this.categoryDefaultTags.set('resource_management', 'RESOURCE_LEAK_RISK');
    this.categoryDefaultTags.set('security', 'SQL_INJECTION_RISK');
    this.categoryDefaultTags.set('security_vulnerability', 'SQL_INJECTION_RISK');
    this.categoryDefaultTags.set('exception_handling', 'POOR_ERROR_HANDLING');
    this.categoryDefaultTags.set('performance', 'N_PLUS_ONE_RISK');
    this.categoryDefaultTags.set('error_handling', 'POOR_ERROR_HANDLING');
    this.categoryDefaultTags.set('logging', 'POOR_ERROR_HANDLING');
    this.categoryDefaultTags.set('transaction', 'HAS_TRANSACTIONAL');
    this.categoryDefaultTags.set('database', 'RESOURCE_LEAK_RISK');
    this.categoryDefaultTags.set('sql', 'SQL_INJECTION_RISK');
    this.categoryDefaultTags.set('architecture', 'IS_CONTROLLER');
    this.categoryDefaultTags.set('api', 'IS_CONTROLLER');
    this.categoryDefaultTags.set('performance_issue', 'N_PLUS_ONE_RISK');
    
    // contextType 매핑 추가
    this.categoryDefaultTags.set('overview', 'CONTEXT_DOCUMENT');  // 문서 개요
    this.categoryDefaultTags.set('scope', 'CONTEXT_DOCUMENT');  // 적용 범위
    this.categoryDefaultTags.set('terminology', 'CONTEXT_DOCUMENT');  // 용어 정의
    this.categoryDefaultTags.set('consensus', 'CONTEXT_DOCUMENT');  // 합의 사항
    this.categoryDefaultTags.set('guideline', 'CONTEXT_DOCUMENT');  // 가이드라인
    this.categoryDefaultTags.set('rule', 'CONTEXT_DOCUMENT');  // 규칙
    this.categoryDefaultTags.set('context', 'CONTEXT_DOCUMENT');  // 컨텍스트

    /** @type {Map<string, string>} 태그 조합 → 복합 태그 역매핑 */
    this.compoundTagReverseMap = new Map();
  }

  /**
   * 초기화
   * 
   * @param {Object} options - 옵션
   * @returns {Promise<boolean>}
   */
  async initialize(options = {}) {
    if (this.initialized) return true;

    logger.info('🔗 RuleTagMapper 초기화 중...');

    this.tagLoader = getTagDefinitionLoader();
    await this.tagLoader.initialize();

    this.evaluator = getTagExpressionEvaluator();

    this.llmClient = options.llmClient || null;

    // 복합 태그 역매핑 구축
    this.buildCompoundTagReverseMap();

    this.initialized = true;
    logger.info('✅ RuleTagMapper 초기화 완료');

    return true;
  }

  /**
   * 복합 태그 역매핑 구축
   * 예: "USES_CONNECTION && !HAS_TRY_WITH_RESOURCES" → "RESOURCE_LEAK_RISK"
   */
  buildCompoundTagReverseMap() {
    const compoundTags = this.tagLoader ? this.tagLoader.getCompoundTags() : null;
    
    // null/undefined 방어
    if (!compoundTags || typeof compoundTags !== 'object') {
      logger.warn('⚠️ 복합 태그 정의가 없습니다.');
      return;
    }
    
    // Object.entries 안전하게 호출
    let entries;
    try {
      entries = Object.entries(compoundTags);
    } catch (e) {
      logger.warn(`⚠️ 복합 태그 순회 실패: ${e.message}`);
      return;
    }
    
    for (const entry of entries) {
      if (!entry || !Array.isArray(entry) || entry.length < 2) continue;
      
      const [name, def] = entry;
      if (!def || !def.expression) continue;
      
      // 표현식의 정규화된 형태를 키로 사용
      const normalizedExpr = this.normalizeExpression(def.expression);
      this.compoundTagReverseMap.set(normalizedExpr, name);
    }
  }

  /**
   * 표현식 정규화 (비교용)
   */
  normalizeExpression(expr) {
    return expr
      .replace(/\s+/g, ' ')
      .replace(/\(\s+/g, '(')
      .replace(/\s+\)/g, ')')
      .trim()
      .toUpperCase();
  }

  /**
   * 단일 규칙에 대한 tagCondition 생성 (메인 메서드)
   * 
   * @param {Object} analysisResult - TagRequirementAnalyzer의 분석 결과
   * @param {Object} options - 옵션
   * @param {boolean} options.useLLM - 모든 규칙에 LLM 사용
   * @param {boolean} options.llmFallback - 폴백 시에만 LLM 자동 사용
   * @param {boolean} options.preferCompound - 복합 태그 우선
   * @returns {Promise<MappingResult>}
   */
  async generateTagCondition(analysisResult, options = {}) {
    const { useLLM = false, llmFallback = false, preferCompound = true } = options;

    logger.info(`  🔗 tagCondition 생성: ${analysisResult.ruleId}`);

    // Step 0: 단일 태그면 바로 사용
    if (analysisResult.requiredTags.length === 1) {
      const singleTag = analysisResult.requiredTags[0];
      if (this.isValidTag(singleTag)) {
        return this.createResult(analysisResult, singleTag, 'single_tag');
      }
    }

    // Step 1: 복합 태그 매칭 (필수 태그 기반)
    if (preferCompound) {
      const compoundMatch = this.findBestCompoundTag(analysisResult);
      if (compoundMatch) {
        return this.createResult(analysisResult, compoundMatch, 'compound_tag');
      }
    }

    // Step 2: 규칙 기반 조합 전략
    const ruleBasedExpr = this.buildExpressionRuleBased(analysisResult);
    if (ruleBasedExpr) {
      return this.createResult(analysisResult, ruleBasedExpr, 'rule_based');
    }

    // Step 3: LLM 기반 조합 전략 (명시적 사용)
    if (useLLM && this.llmClient) {
      const llmExpr = await this.buildExpressionLLMBased(analysisResult);
      if (llmExpr) {
        return this.createResult(analysisResult, llmExpr, 'llm_based');
      }
    }

    // Step 4: 폴백 전 LLM 자동 시도 (llmFallback 옵션)
    if (llmFallback && this.llmClient) {
      logger.info(`  🤖 폴백 상황 - LLM 자동 시도: ${analysisResult.ruleId}`);
      const llmExpr = await this.buildExpressionLLMBased(analysisResult);
      if (llmExpr) {
        return this.createResult(analysisResult, llmExpr, 'llm_fallback');
      }
    }

    // Step 5: 단순 조합 (최종 폴백)
    const fallbackExpr = this.buildSimpleExpression(analysisResult);
    return this.createResult(analysisResult, fallbackExpr, 'fallback');
  }

  /**
   * 유효한 태그인지 확인
   */
  isValidTag(tagName) {
    return this.tagLoader.getTagDefinition(tagName) !== null ||
           this.tagLoader.getCompoundTag(tagName) !== null;
  }

  /**
   * 가장 적합한 복합 태그 찾기 (개선된 버전)
   * 
   * @param {Object} analysisResult - 분석 결과
   * @returns {string|null} 매칭된 복합 태그명 또는 null
   */
  findBestCompoundTag(analysisResult) {
    if (!analysisResult || !analysisResult.requiredTags) {
      return null;
    }
    
    const requiredTags = new Set(analysisResult.requiredTags);
    const compoundTags = this.tagLoader ? this.tagLoader.getCompoundTags() : null;
    const category = analysisResult.category;

    // null/undefined 방어
    if (!compoundTags || typeof compoundTags !== 'object') {
      return null;
    }

    // Object.entries 안전하게 호출
    let entries;
    try {
      entries = Object.entries(compoundTags);
    } catch (e) {
      return null;
    }

    // 1. 필수 태그에 이미 복합 태그가 포함되어 있으면 바로 반환
    for (const tagName of requiredTags) {
      if (compoundTags[tagName]) {
        return tagName;
      }
    }

    // 2. 필수 태그와 가장 관련성 높은 복합 태그 찾기 (카테고리 무관)
    let bestMatch = null;
    let bestScore = 0;

    for (const entry of entries) {
      if (!entry || !Array.isArray(entry) || entry.length < 2) continue;
      
      const [name, def] = entry;
      if (!def || !def.expression) continue;
      
      const compoundDeps = this.extractTagsFromExpression(def.expression);
      
      // 점수 계산: 필수 태그와의 교집합
      const matchingTags = compoundDeps.filter(dep => {
        const cleanDep = dep.replace(/^!/, '');
        return requiredTags.has(cleanDep);
      });
      
      if (matchingTags.length === 0) continue;

      // 기본 점수: 매칭률
      let score = matchingTags.length / compoundDeps.length;
      
      // 카테고리 일치 보너스
      const compoundCategory = this.getCompoundTagCategory(name);
      if (compoundCategory === category) {
        score += 0.2;
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = name;
      }
    }

    // 40% 이상 매칭되어야 복합 태그 사용
    return bestScore >= 0.4 ? bestMatch : null;
  }

  /**
   * 표현식에서 태그명 추출
   * @param {string} expression - 태그 표현식
   * @returns {string[]} 태그명 배열
   */
  extractTagsFromExpression(expression) {
    if (!expression) return [];
    // 태그명 패턴: 대문자와 언더스코어로 구성
    const tagPattern = /[A-Z][A-Z0-9_]*/g;
    const matches = expression.match(tagPattern) || [];
    // 중복 제거
    return [...new Set(matches)];
  }

  /**
   * 복합 태그의 카테고리 추론
   */
  getCompoundTagCategory(compoundTagName) {
    const categoryMap = {
      'RESOURCE_LEAK_RISK': 'resource_management',
      'SQL_INJECTION_RISK': 'security',
      'N_PLUS_ONE_RISK': 'performance',
      'POOR_ERROR_HANDLING': 'exception_handling'
    };
    return categoryMap[compoundTagName] || null;
  }

  /**
   * 카테고리 기본 태그 반환
   */
  getCategoryDefaultTag(category) {
    return this.categoryDefaultTags.get(category) || null;
  }

  /**
   * 태그가 분석 결과와 관련 있는지 확인
   */
  isTagRelevant(tagName, analysisResult) {
    const compoundDef = this.tagLoader.getCompoundTag(tagName);
    if (!compoundDef) return false;

    const deps = this.evaluator.dependsOnTags(compoundDef.expression);
    const requiredSet = new Set(analysisResult.requiredTags);

    // 의존 태그 중 하나라도 필수 태그에 있으면 관련있음
    return deps.some(dep => requiredSet.has(dep.replace(/^!/, '')));
  }

  /**
   * 규칙 기반 표현식 생성
   * 
   * @param {Object} analysisResult - 분석 결과
   * @returns {string|null}
   */
  buildExpressionRuleBased(analysisResult) {
    const { requiredTags, optionalTags, category } = analysisResult;

    if (requiredTags.length === 0) return null;

    // 단일 태그
    if (requiredTags.length === 1 && optionalTags.length === 0) {
      return requiredTags[0];
    }

    // 복수 필수 태그 → AND 조합
    if (requiredTags.length > 1 && optionalTags.length === 0) {
      return requiredTags.join(' && ');
    }

    // 필수 + 선택 태그 → 필수는 AND, 선택은 OR로 그룹핑
    if (optionalTags.length > 0) {
      const requiredPart = requiredTags.length > 1 
        ? `(${requiredTags.join(' && ')})` 
        : requiredTags[0];

      // 선택 태그는 보통 정밀도를 높이는 용도이므로 AND로 연결
      // 하지만 대안 조건이면 OR 사용
      const optionalPart = optionalTags.length > 1
        ? `(${optionalTags.join(' || ')})`
        : optionalTags[0];

      return `${requiredPart} && ${optionalPart}`;
    }

    // 카테고리별 특수 패턴
    return this.buildCategorySpecificExpression(requiredTags, category);
  }

  /**
   * 카테고리별 특수 표현식 패턴
   */
  buildCategorySpecificExpression(tags, category) {
    // 리소스 관리: 리소스 사용 && 안전 패턴 미사용
    if (category === 'resource_management') {
      const resourceTags = tags.filter(t => 
        t.startsWith('USES_') || t.includes('RESOURCE')
      );
      if (resourceTags.length > 0) {
        const safeTags = ['HAS_TRY_WITH_RESOURCES', 'HAS_FINALLY_CLOSE'];
        const usedSafeTags = tags.filter(t => safeTags.includes(t));
        
        if (usedSafeTags.length === 0) {
          // 안전 태그가 분석 결과에 없으면, 부정 조건 추가
          return `(${resourceTags.join(' || ')}) && !HAS_TRY_WITH_RESOURCES`;
        }
      }
    }

    // 보안: SQL 연결 && PreparedStatement 미사용
    if (category === 'security' || category === 'security_vulnerability') {
      if (tags.includes('HAS_SQL_CONCATENATION')) {
        return 'HAS_SQL_CONCATENATION && !USES_PREPARED_STATEMENT';
      }
    }

    // 예외 처리: 빈 catch 또는 포괄적 catch
    if (category === 'exception_handling') {
      const exceptionTags = tags.filter(t => 
        t.includes('CATCH') || t.includes('EXCEPTION')
      );
      if (exceptionTags.length > 1) {
        return exceptionTags.join(' || ');
      }
    }

    // 기본: 단순 AND 조합
    return tags.join(' && ');
  }

  /**
   * LLM 기반 표현식 생성
   * 
   * @param {Object} analysisResult - 분석 결과
   * @returns {Promise<string|null>}
   */
  async buildExpressionLLMBased(analysisResult) {
    if (!this.llmClient) return null;

    const prompt = this.buildMappingPrompt(analysisResult);

    try {
      const response = await this.llmClient.generateCompletion(prompt, {
        temperature: 0.1,
        max_tokens: 2000
      });

      return this.parseMappingResponse(response);
    } catch (error) {
      logger.warn(`  ⚠️ LLM 매핑 실패: ${error.message}`);
      return null;
    }
  }

  /**
   * LLM 매핑 프롬프트 생성
   */
  buildMappingPrompt(analysisResult) {
    return `당신은 Java 코드 품질 전문가입니다.
아래 규칙 정보와 사용 가능한 태그 목록을 바탕으로, 이 규칙 위반을 탐지하기 위한 
tagCondition 표현식을 생성해주세요.

## 규칙 정보
- **ID**: ${analysisResult.ruleId}
- **제목**: ${analysisResult.title}
- **카테고리**: ${analysisResult.category}

## 사용 가능 태그
- **목록**: [${this.tagLoader.getAllTagNames().join(', ')}]

## 표현식 문법
- AND: &&
- OR: ||
- NOT: !
- 그룹: ()

## 예시
- "RESOURCE_LEAK_RISK"
- "IS_CONTROLLER && USES_CONNECTION"
- "(HAS_EMPTY_CATCH || HAS_GENERIC_CATCH) && !HAS_LOGGING"
- "HAS_SQL_CONCATENATION && !USES_PREPARED_STATEMENT"

## 지침
1. 최대한 간결하게 작성 (복합 태그 활용 권장)
2. 위반 조건을 정확히 표현 (false positive 최소화)
3. 표현식만 반환 (따옴표 없이)

tagCondition:`;
  }

  /**
   * LLM 응답에서 표현식 추출
   */
  parseMappingResponse(response) {
    // 줄바꿈으로 나누고 첫 번째 유효한 줄 사용
    const lines = response.split('\n').map(l => l.trim()).filter(l => l);
    
    for (const line of lines) {
      // tagCondition: 접두사 제거
      let expr = line.replace(/^tagCondition:\s*/i, '').trim();
      
      // 따옴표 제거
      expr = expr.replace(/^["']|["']$/g, '');
      
      // 유효성 검증
      if (this.validateExpression(expr)) {
        return expr;
      }
    }

    return null;
  }

  /**
   * 단순 표현식 생성 (폴백)
   */
  buildSimpleExpression(analysisResult) {
    const { requiredTags, category, ruleId } = analysisResult;

    if (requiredTags.length === 0) {
      // 태그가 없으면 카테고리 기반 기본값
      const normalizedCategory = (category || '').toLowerCase().replace(/[- ]/g, '_');
      const defaultTag = this.getCategoryDefaultTag(normalizedCategory);
      
      if (defaultTag) {
        return defaultTag;
      }
      
      // 정말 아무것도 없으면 경고 로그 출력
      logger.warn(`  ⚠️ ${ruleId}: 태그를 찾을 수 없음 (category: ${category})`);
      logger.warn(`     → 규칙을 수동으로 검토하거나 --llm 옵션을 사용하세요.`);
      
      // MANUAL_REVIEW 태그 반환 - 수동 검토 필요함을 표시
      return 'MANUAL_REVIEW_REQUIRED';
    }

    if (requiredTags.length === 1) {
      return requiredTags[0];
    }

    // 2개 이상이면 AND 조합
    return requiredTags.slice(0, 3).join(' && ');
  }

  /**
   * 표현식 유효성 검증
   */
  validateExpression(expr) {
    if (!expr || typeof expr !== 'string') return false;
    
    try {
      const validation = this.evaluator.validate(expr);
      return validation.valid;
    } catch {
      return false;
    }
  }

  /**
   * 결과 객체 생성
   */
  createResult(analysisResult, tagCondition, strategy) {
    const validated = this.validateExpression(tagCondition);
    const complexity = validated ? this.evaluator.complexity(tagCondition) : -1;

    return {
      ruleId: analysisResult.ruleId,
      title: analysisResult.title,
      category: analysisResult.category,
      tagCondition,
      strategy,
      complexity,
      validated,
      originalTags: {
        required: analysisResult.requiredTags,
        optional: analysisResult.optionalTags
      }
    };
  }

  /**
   * 다중 규칙 배치 매핑
   * 
   * @param {Object[]} analysisResults - 분석 결과 배열
   * @param {Object} options - 옵션
   * @returns {Promise<MappingResult[]>}
   */
  async generateTagConditions(analysisResults, options = {}) {
    const results = [];

    // null/undefined 방어 + 디버그 로그
    if (!analysisResults) {
      logger.warn('⚠️ analysisResults가 null/undefined입니다.');
      return results;
    }
    
    if (!Array.isArray(analysisResults)) {
      logger.warn(`⚠️ analysisResults가 배열이 아닙니다. 타입: ${typeof analysisResults}`);
      return results;
    }

    logger.info(`🔗 ${analysisResults.length}개 규칙 tagCondition 생성 중...`);

    for (let i = 0; i < analysisResults.length; i++) {
      let currentResult = null;
      let currentRuleId = `index-${i}`;
      
      try {
        currentResult = analysisResults[i];
        
        // 개별 결과 null 체크
        if (!currentResult) {
          logger.warn(`⚠️ 분석 결과 항목[${i}]이 null/undefined입니다.`);
          continue;
        }
        
        currentRuleId = currentResult.ruleId || currentResult.title || `index-${i}`;
        
        const mapping = await this.generateTagCondition(currentResult, options);
        if (mapping) {
          results.push(mapping);
        }
      } catch (error) {
        logger.warn(`⚠️ tagCondition 생성 실패 [${currentRuleId}]: ${error.message}`);
      }
    }

    logger.info(`✅ 매핑 완료: ${results.filter(r => r && r.validated).length}/${results.length}개 유효`);

    return results;
  }

  /**
   * 규칙에 tagCondition 적용
   * 
   * @param {Object[]} rules - 원본 규칙 배열
   * @param {MappingResult[]} mappings - 매핑 결과 배열
   * @returns {Object[]} tagCondition이 추가된 규칙 배열
   */
  applyMappingsToRules(rules, mappings) {
    // null/undefined 방어
    if (!Array.isArray(rules)) return [];
    if (!Array.isArray(mappings)) return rules;
    
    // null 항목 필터링 후 Map 생성 (안전한 방식)
    const mappingMap = new Map();
    for (const m of mappings) {
      if (m && m.ruleId) {
        mappingMap.set(m.ruleId, m);
      }
    }

    return rules.map(rule => {
      if (!rule) return rule;
      
      const ruleId = rule.ruleId || rule.id;
      const mapping = mappingMap.get(ruleId);

      if (mapping && mapping.validated) {
        return {
          ...rule,
          tagCondition: mapping.tagCondition,
          _tagMapping: {
            strategy: mapping.strategy,
            complexity: mapping.complexity,
            generatedAt: new Date().toISOString()
          }
        };
      }

      return rule;
    });
  }

  /**
   * 매핑 결과 요약 출력
   */
  summarizeMappings(mappings) {
    // null/undefined 방어
    if (!Array.isArray(mappings)) {
      console.log('\n=== 매핑 결과 요약 ===');
      console.log('매핑 결과가 없습니다.');
      return { total: 0, validated: 0, invalid: 0, byStrategy: {} };
    }
    
    // null 항목 필터링
    const validMappings = mappings.filter(m => m);
    
    const summary = {
      total: validMappings.length,
      validated: validMappings.filter(m => m.validated).length,
      invalid: validMappings.filter(m => !m.validated).length,
      byStrategy: {}
    };

    for (const m of validMappings) {
      if (m && m.strategy) {
        summary.byStrategy[m.strategy] = (summary.byStrategy[m.strategy] || 0) + 1;
      }
    }

    console.log('\n=== 매핑 결과 요약 ===');
    console.log(`총 규칙: ${summary.total}개`);
    console.log(`유효: ${summary.validated}개`);
    console.log(`무효: ${summary.invalid}개`);
    console.log('\n전략별:');
    
    const strategyEntries = Object.entries(summary.byStrategy);
    if (strategyEntries.length > 0) {
      for (const [strategy, count] of strategyEntries) {
        console.log(`  - ${strategy}: ${count}개`);
      }
    } else {
      console.log('  (없음)');
    }

    return summary;
  }
}

// 싱글톤
let instance = null;

export function getRuleTagMapper() {
  if (!instance) {
    instance = new RuleTagMapper();
  }
  return instance;
}

export default RuleTagMapper;