/**
 * 규칙 매처 (RuleMatcher)
 * 
 * 코드 프로파일의 태그와 규칙의 tagCondition을 매칭하여 위반 탐지
 * 
 * @module matcher/RuleMatcher
 * @version 1.0.0
 */

import { TagExpressionEvaluator, getTagExpressionEvaluator } from './TagExpressionEvaluator.js';
import logger from '../utils/loggerUtils.js';

/**
 * 규칙 매칭 결과
 * @typedef {Object} MatchResult
 * @property {string} ruleId - 규칙 ID
 * @property {boolean} matched - 매칭 여부 (true = 위반)
 * @property {string} expression - 매칭된 표현식
 * @property {string[]} matchedTags - 매칭된 태그
 * @property {string[]} unmatchedTags - 매칭되지 않은 태그
 * @property {number} priority - 우선순위 점수
 * @property {Object} rule - 원본 규칙 정보
 */

/**
 * 규칙 매처 클래스
 */
export class RuleMatcher {
  constructor() {
    /** @type {TagExpressionEvaluator} 표현식 평가기 */
    this.expressionEvaluator = null;
    
    /** @type {boolean} 초기화 완료 여부 */
    this.initialized = false;

    /** @type {Object} 우선순위 가중치 */
    this.priorityWeights = {
      severity: {
        CRITICAL: 100,
        HIGH: 70,
        MEDIUM: 40,
        LOW: 20
      },
      category: {
        security: 30,
        resource_management: 25,
        architecture: 20,
        performance: 15,
        code_smell: 10,
        exception_handling: 15,
        naming: 5
      },
      tagMatch: 10  // 매칭된 태그당 추가 점수
    };
  }

  /**
   * 초기화
   * 
   * @returns {Promise<boolean>}
   */
  async initialize() {
    if (this.initialized) {
      return true;
    }

    this.expressionEvaluator = getTagExpressionEvaluator();
    this.initialized = true;
    
    logger.info('✅ RuleMatcher 초기화 완료');
    return true;
  }

  /**
   * 규칙 매칭 수행 (메인 메서드)
   * 
   * @param {Object} codeProfile - 코드 프로파일
   * @param {Object[]} rules - 규칙 배열
   * @param {Object} options - 옵션
   * @returns {Object} { violations: MatchResult[], filtered: Object, stats: Object }
   */
  async matchRules(codeProfile, rules, options = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    const startTime = Date.now();
    const {
      skipUntagged = true,        // tagCondition 없는 규칙 스킵
      minPriority = 0,            // 최소 우선순위
      maxResults = 100,           // 최대 결과 수
      sortByPriority = true       // 우선순위 정렬
    } = options;

    const tags = codeProfile.tags instanceof Set 
      ? codeProfile.tags 
      : new Set(codeProfile.tags);

    const violations = [];
    const filtered = {
      noTagCondition: 0,
      notMatched: 0,
      lowPriority: 0
    };

    for (const rule of rules) {
      // 1. tagCondition 확인
      const tagCondition = rule.tagCondition?.expression || rule.tagCondition;
      
      if (!tagCondition) {
        if (skipUntagged) {
          filtered.noTagCondition++;
          continue;
        }
        // tagCondition 없으면 기본적으로 적용 대상으로 간주
        violations.push(this.createMatchResult(rule, {
          result: true,
          matchedTags: [],
          unmatchedTags: []
        }, tags));
        continue;
      }

      // 2. 표현식 평가
      const evalResult = this.expressionEvaluator.evaluate(tagCondition, tags);

      if (!evalResult.result) {
        filtered.notMatched++;
        continue;
      }

      // 3. 우선순위 계산
      const priority = this.calculatePriority(rule, evalResult, codeProfile);

      if (priority < minPriority) {
        filtered.lowPriority++;
        continue;
      }

      // 4. 매칭 결과 생성
      const matchResult = this.createMatchResult(rule, evalResult, tags, priority);
      violations.push(matchResult);
    }

    // 5. 정렬 및 제한
    if (sortByPriority) {
      violations.sort((a, b) => b.priority - a.priority);
    }

    const finalViolations = violations.slice(0, maxResults);

    const elapsed = Date.now() - startTime;
    const stats = {
      totalRules: rules.length,
      violations: finalViolations.length,
      filtered,
      processingTimeMs: elapsed
    };

    logger.info(`✅ 규칙 매칭 완료: ${finalViolations.length}개 위반 탐지 (${elapsed}ms)`);
    logger.info(`   - 전체: ${rules.length}개 → tagCondition 없음: ${filtered.noTagCondition}개, 미매칭: ${filtered.notMatched}개`);

    return {
      violations: finalViolations,
      filtered,
      stats
    };
  }

  /**
   * 매칭 결과 객체 생성
   * 
   * @param {Object} rule - 규칙
   * @param {Object} evalResult - 평가 결과
   * @param {Set<string>} tags - 코드 태그
   * @param {number} priority - 우선순위
   * @returns {MatchResult}
   */
  createMatchResult(rule, evalResult, tags, priority = 0) {
    return {
      ruleId: rule.ruleId || rule.id,
      title: rule.title,
      description: rule.description,
      matched: evalResult.result,
      expression: evalResult.expression || '',
      matchedTags: evalResult.matchedTags || [],
      unmatchedTags: evalResult.unmatchedTags || [],
      priority,
      severity: rule.severity || 'MEDIUM',
      category: rule.category || 'unknown',
      message: rule.message || rule.description,
      suggestion: rule.suggestion || rule.recommendation,
      rule: {
        ruleId: rule.ruleId || rule.id,
        severity: rule.severity,
        category: rule.category,
        checkType: rule.checkType
      }
    };
  }

  /**
   * 우선순위 점수 계산
   * 
   * @param {Object} rule - 규칙
   * @param {Object} evalResult - 평가 결과
   * @param {Object} codeProfile - 코드 프로파일
   * @returns {number} 우선순위 점수
   */
  calculatePriority(rule, evalResult, codeProfile) {
    let score = 0;

    // 1. 심각도 기반
    const severity = (rule.severity || 'MEDIUM').toUpperCase();
    score += this.priorityWeights.severity[severity] || 40;

    // 2. 카테고리 기반
    const category = (rule.category || '').toLowerCase();
    score += this.priorityWeights.category[category] || 10;

    // 3. 매칭된 태그 수 기반
    const matchedCount = evalResult.matchedTags?.length || 0;
    score += matchedCount * this.priorityWeights.tagMatch;

    // 4. 코드 위험도 기반
    if (codeProfile.riskLevel === 'critical') score += 20;
    else if (codeProfile.riskLevel === 'high') score += 10;

    // 5. 복합 태그 매칭 보너스
    const compoundMatches = Object.entries(codeProfile.compoundTags || {})
      .filter(([_, v]) => v.matched)
      .length;
    score += compoundMatches * 15;

    return score;
  }

  /**
   * 빠른 사전 필터링
   * (태그 조합 평가 전에 필수 태그로 빠르게 필터)
   * 
   * @param {Set<string>} codeTags - 코드 태그
   * @param {Object[]} rules - 규칙 배열
   * @returns {Object[]} 필터링된 규칙 배열
   */
  prefilterRules(codeTags, rules) {
    return rules.filter(rule => {
      const tagCondition = rule.tagCondition?.expression || rule.tagCondition;
      
      if (!tagCondition) return true;  // tagCondition 없으면 통과

      // 필수 태그 추출 (AND로만 연결된 태그)
      const requiredTags = this.expressionEvaluator.getRequiredTags(tagCondition);
      
      if (requiredTags.length === 0) return true;  // 필수 태그 없으면 통과

      // 필수 태그 중 하나라도 없으면 제외
      return requiredTags.every(tag => codeTags.has(tag));
    });
  }

  /**
   * 카테고리별 위반 그룹화
   * 
   * @param {MatchResult[]} violations - 위반 목록
   * @returns {Object} 카테고리 → 위반 배열
   */
  groupByCategory(violations) {
    const grouped = {};

    for (const violation of violations) {
      const category = violation.category || 'unknown';
      if (!grouped[category]) {
        grouped[category] = [];
      }
      grouped[category].push(violation);
    }

    return grouped;
  }

  /**
   * 심각도별 위반 그룹화
   * 
   * @param {MatchResult[]} violations - 위반 목록
   * @returns {Object} 심각도 → 위반 배열
   */
  groupBySeverity(violations) {
    const grouped = {
      CRITICAL: [],
      HIGH: [],
      MEDIUM: [],
      LOW: []
    };

    for (const violation of violations) {
      const severity = (violation.severity || 'MEDIUM').toUpperCase();
      if (grouped[severity]) {
        grouped[severity].push(violation);
      } else {
        grouped.MEDIUM.push(violation);
      }
    }

    return grouped;
  }

  /**
   * 위반 요약 생성
   * 
   * @param {MatchResult[]} violations - 위반 목록
   * @returns {Object} 요약 정보
   */
  summarizeViolations(violations) {
    const bySeverity = this.groupBySeverity(violations);
    const byCategory = this.groupByCategory(violations);

    return {
      total: violations.length,
      bySeverity: {
        critical: bySeverity.CRITICAL.length,
        high: bySeverity.HIGH.length,
        medium: bySeverity.MEDIUM.length,
        low: bySeverity.LOW.length
      },
      byCategory: Object.fromEntries(
        Object.entries(byCategory).map(([k, v]) => [k, v.length])
      ),
      topViolations: violations.slice(0, 5).map(v => ({
        ruleId: v.ruleId,
        title: v.title,
        severity: v.severity,
        priority: v.priority
      }))
    };
  }

  /**
   * 규칙의 tagCondition 유효성 검사
   * 
   * @param {Object[]} rules - 규칙 배열
   * @returns {Object} { valid: Object[], invalid: Object[] }
   */
  validateRuleExpressions(rules) {
    const valid = [];
    const invalid = [];

    for (const rule of rules) {
      const tagCondition = rule.tagCondition?.expression || rule.tagCondition;
      
      if (!tagCondition) {
        valid.push({ rule, hasCondition: false });
        continue;
      }

      const validation = this.expressionEvaluator.validate(tagCondition);
      
      if (validation.valid) {
        valid.push({ rule, hasCondition: true });
      } else {
        invalid.push({
          rule,
          expression: tagCondition,
          error: validation.error
        });
      }
    }

    return { valid, invalid };
  }

  /**
   * 특정 태그가 영향을 미치는 규칙 찾기
   * 
   * @param {string} tagName - 태그명
   * @param {Object[]} rules - 규칙 배열
   * @returns {Object[]} 해당 태그에 의존하는 규칙 배열
   */
  findRulesByTag(tagName, rules) {
    return rules.filter(rule => {
      const tagCondition = rule.tagCondition?.expression || rule.tagCondition;
      if (!tagCondition) return false;
      return this.expressionEvaluator.dependsOn(tagCondition, tagName);
    });
  }

  /**
   * 위반 결과를 LLM 검증용 형식으로 변환
   * 
   * @param {MatchResult[]} violations - 위반 목록
   * @returns {Object[]} LLM 검증용 형식
   */
  formatForLLMVerification(violations) {
    return violations.map(v => ({
      ruleId: v.ruleId,
      title: v.title,
      description: v.rule?.description || v.description,
      severity: v.severity,
      matchedCondition: v.expression,
      matchedTags: v.matchedTags,
      needsVerification: v.matchedTags.some(tag => 
        // LLM 태그가 포함된 경우 검증 필요
        tag.includes('CALLS_') || tag.includes('NAMING_') || tag.includes('LAYER_')
      )
    }));
  }
}

// 싱글톤 인스턴스
let instance = null;

/**
 * 싱글톤 인스턴스 반환
 * 
 * @returns {RuleMatcher}
 */
export function getRuleMatcher() {
  if (!instance) {
    instance = new RuleMatcher();
  }
  return instance;
}

export default RuleMatcher;
