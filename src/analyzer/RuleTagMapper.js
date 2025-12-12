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
    this.categoryDefaultTags = new Map([
      ['resource_management', 'RESOURCE_LEAK_RISK'],
      ['security', 'SQL_INJECTION_RISK'],
      ['security_vulnerability', 'SQL_INJECTION_RISK'],
      ['exception_handling', 'POOR_ERROR_HANDLING'],
      ['performance', 'N_PLUS_ONE_RISK']
    ]);

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
    const compoundTags = this.tagLoader.getCompoundTags();
    
    for (const [name, def] of Object.entries(compoundTags)) {
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
   * @returns {Promise<MappingResult>}
   */
  async generateTagCondition(analysisResult, options = {}) {
    const { useLLM = false, preferCompound = true } = options;

    logger.info(`  🔗 tagCondition 생성: ${analysisResult.ruleId}`);

    // Step 1: 복합 태그 우선 전략
    if (preferCompound) {
      const compoundMatch = this.findMatchingCompoundTag(analysisResult);
      if (compoundMatch) {
        return this.createResult(analysisResult, compoundMatch, 'compound_tag');
      }
    }

    // Step 2: 카테고리 기본 태그 전략
    const categoryDefault = this.getCategoryDefaultTag(analysisResult.category);
    if (categoryDefault && this.isTagRelevant(categoryDefault, analysisResult)) {
      return this.createResult(analysisResult, categoryDefault, 'category_default');
    }

    // Step 3: 규칙 기반 조합 전략
    const ruleBasedExpr = this.buildExpressionRuleBased(analysisResult);
    if (ruleBasedExpr) {
      return this.createResult(analysisResult, ruleBasedExpr, 'rule_based');
    }

    // Step 4: LLM 기반 조합 전략 (선택적)
    if (useLLM && this.llmClient) {
      const llmExpr = await this.buildExpressionLLMBased(analysisResult);
      if (llmExpr) {
        return this.createResult(analysisResult, llmExpr, 'llm_based');
      }
    }

    // Step 5: 단순 조합 (폴백)
    const fallbackExpr = this.buildSimpleExpression(analysisResult);
    return this.createResult(analysisResult, fallbackExpr, 'fallback');
  }

  /**
   * 매칭되는 복합 태그 찾기
   * 
   * @param {Object} analysisResult - 분석 결과
   * @returns {string|null} 매칭된 복합 태그명 또는 null
   */
  findMatchingCompoundTag(analysisResult) {
    const requiredTags = new Set(analysisResult.requiredTags);
    const compoundTags = this.tagLoader.getCompoundTags();
    const category = analysisResult.category;

    // 1. 필수 태그에 이미 복합 태그가 포함되어 있는지 확인
    for (const tagName of requiredTags) {
      if (compoundTags[tagName]) {
        return tagName;
      }
    }

    // 2. 카테고리에 맞는 복합 태그 우선 선택
    const categoryCompoundMap = {
      'resource_management': 'RESOURCE_LEAK_RISK',
      'security': 'SQL_INJECTION_RISK',
      'security_vulnerability': 'SQL_INJECTION_RISK',
      'exception_handling': 'POOR_ERROR_HANDLING',
      'performance': 'N_PLUS_ONE_RISK'
    };

    const preferredCompound = categoryCompoundMap[category];
    if (preferredCompound && compoundTags[preferredCompound]) {
      // 카테고리 기반 복합 태그의 의존 태그가 하나라도 있으면 사용
      const compoundDeps = this.extractTagsFromExpression(compoundTags[preferredCompound].expression);
      const hasRelevantTag = compoundDeps.some(dep => 
        requiredTags.has(dep) || requiredTags.has(dep.replace(/^!/, ''))
      );
      if (hasRelevantTag) {
        return preferredCompound;
      }
    }

    // 3. 필수 태그와 가장 많이 겹치는 복합 태그 찾기
    let bestMatch = null;
    let bestScore = 0;

    for (const [name, def] of Object.entries(compoundTags)) {
      const compoundDeps = this.extractTagsFromExpression(def.expression);
      
      // 매칭 점수 계산: 겹치는 태그 수 / 복합 태그 의존 태그 수
      const matchingTags = compoundDeps.filter(dep => 
        requiredTags.has(dep) || requiredTags.has(dep.replace(/^!/, ''))
      );
      
      if (matchingTags.length > 0) {
        const score = matchingTags.length / compoundDeps.length;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = name;
        }
      }
    }

    // 50% 이상 매칭되어야 사용
    return bestScore >= 0.5 ? bestMatch : null;
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
        max_tokens: 500
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
아래 규칙 정보와 필요 태그 목록을 바탕으로, 이 규칙 위반을 탐지하기 위한 
tagCondition 표현식을 생성해주세요.

## 규칙 정보
- **ID**: ${analysisResult.ruleId}
- **제목**: ${analysisResult.title}
- **카테고리**: ${analysisResult.category}

## 필요 태그
- **필수**: [${analysisResult.requiredTags.join(', ')}]
- **선택**: [${analysisResult.optionalTags.join(', ')}]

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
    const { requiredTags } = analysisResult;

    if (requiredTags.length === 0) {
      // 태그가 없으면 카테고리 기반 기본값
      const defaultTag = this.getCategoryDefaultTag(analysisResult.category);
      return defaultTag || 'UNKNOWN_CONDITION';
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

    logger.info(`🔗 ${analysisResults.length}개 규칙 tagCondition 생성 중...`);

    for (const result of analysisResults) {
      const mapping = await this.generateTagCondition(result, options);
      results.push(mapping);
    }

    logger.info(`✅ 매핑 완료: ${results.filter(r => r.validated).length}/${results.length}개 유효`);

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
    const mappingMap = new Map(mappings.map(m => [m.ruleId, m]));

    return rules.map(rule => {
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
    const summary = {
      total: mappings.length,
      validated: mappings.filter(m => m.validated).length,
      invalid: mappings.filter(m => !m.validated).length,
      byStrategy: {}
    };

    for (const m of mappings) {
      summary.byStrategy[m.strategy] = (summary.byStrategy[m.strategy] || 0) + 1;
    }

    console.log('\n=== 매핑 결과 요약 ===');
    console.log(`총 규칙: ${summary.total}개`);
    console.log(`유효: ${summary.validated}개`);
    console.log(`무효: ${summary.invalid}개`);
    console.log('\n전략별:');
    for (const [strategy, count] of Object.entries(summary.byStrategy)) {
      console.log(`  - ${strategy}: ${count}개`);
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
