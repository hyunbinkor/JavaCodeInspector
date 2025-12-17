/**
 * Rule Converter
 * 
 * AST 기반 규칙을 Unified Rule Schema로 변환합니다.
 * 기존 규칙의 마이그레이션과 신규 규칙 생성을 모두 지원합니다.
 * 
 * 주요 기능:
 * 1. AST Rule → Unified Rule 변환
 * 2. checkType 자동 결정 (llm_with_ast 등)
 * 3. astDescription, checkPoints 자동 생성
 * 4. 기존 규칙 마이그레이션 (originalCheckType 보존)
 * 
 * 사용 예시:
 * ```javascript
 * const converter = new RuleConverter();
 * 
 * // 기존 AST 규칙 마이그레이션
 * const unifiedRule = converter.migrateRule(existingAstRule);
 * 
 * // 신규 규칙 생성 시 보강
 * const enhancedRule = converter.enhanceRule(newRule);
 * ```
 * 
 * @module RuleConverter
 * @version 1.0.0
 */

import { AstHintsConverter } from './astHintsConverter.js';

/**
 * 규칙 변환기 클래스
 */
export class RuleConverter {
  /**
   * 생성자
   * @param {Object} options - 옵션
   */
  constructor(options = {}) {
    this.astHintsConverter = new AstHintsConverter(options);
    
    // checkType 결정 기준
    this.checkTypeRules = {
      // AST만으로 충분한 검사
      astOnly: [
        'checkEmpty',
        'maxLineCount',
        'maxCyclomaticComplexity',
        'maxNestingDepth',
        'maxParameters',
        'maxBodyStatements'
      ],
      // LLM 컨텍스트가 필요한 검사
      requiresLLM: [
        'businessLogic',
        'architecturePattern',
        'semanticNaming',
        'codeQuality'
      ]
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // 메인 변환 메서드
  // ═══════════════════════════════════════════════════════════════════

  /**
   * 기존 규칙을 Unified Schema로 마이그레이션
   * 
   * @param {Object} rule - 기존 규칙
   * @returns {Object} Unified Schema 규칙
   */
  migrateRule(rule) {
    // 이미 마이그레이션된 규칙은 스킵
    if (rule.originalCheckType) {
      console.log(`⏭️ [${rule.ruleId}] 이미 마이그레이션됨`);
      return rule;
    }

    const originalCheckType = rule.checkType;
    const newCheckType = this.determineNewCheckType(rule);

    console.log(`🔄 [${rule.ruleId}] 마이그레이션: ${originalCheckType} → ${newCheckType}`);

    // AST 정보 자연어 변환
    const { astDescription, checkPoints } = this.generateAstNaturalLanguage(rule);

    // 키워드 보강
    const keywords = this.enhanceKeywords(rule);

    return {
      ...rule,
      
      // 마이그레이션 추적
      originalCheckType,
      
      // 새 checkType
      checkType: newCheckType,
      
      // 자연어 변환 결과
      astDescription,
      checkPoints,
      
      // 보강된 키워드
      keywords,
      
      // 메타데이터 업데이트
      metadata: {
        ...rule.metadata,
        migratedAt: new Date().toISOString(),
        migratedFrom: originalCheckType
      }
    };
  }

  /**
   * 신규 규칙 또는 추출된 규칙 보강
   * 
   * @param {Object} rule - 규칙 객체
   * @param {Object} options - 옵션
   * @returns {Object} 보강된 규칙
   */
  enhanceRule(rule, options = {}) {
    const {
      forceRegenerate = false,  // astDescription 재생성 여부
      addKeywords = true         // 키워드 자동 추가 여부
    } = options;

    // checkType 결정
    if (!rule.checkType) {
      rule.checkType = this.determineNewCheckType(rule);
    }

    // AST 자연어 변환 (없거나 재생성 요청 시)
    if (!rule.astDescription || forceRegenerate) {
      const { astDescription, checkPoints } = this.generateAstNaturalLanguage(rule);
      rule.astDescription = astDescription;
      rule.checkPoints = checkPoints;
    }

    // 키워드 보강
    if (addKeywords) {
      rule.keywords = this.enhanceKeywords(rule);
    }

    return rule;
  }

  /**
   * 배치 마이그레이션
   * 
   * @param {Object[]} rules - 규칙 배열
   * @param {Object} options - 옵션
   * @returns {Object} { migrated, skipped, errors }
   */
  batchMigrate(rules, options = {}) {
    const { 
      skipMigrated = true,  // 이미 마이그레이션된 규칙 스킵
      dryRun = false        // 실제 변환 없이 시뮬레이션
    } = options;

    const result = {
      migrated: [],
      skipped: [],
      errors: []
    };

    for (const rule of rules) {
      try {
        // 이미 마이그레이션된 규칙 스킵
        if (skipMigrated && rule.originalCheckType) {
          result.skipped.push({
            ruleId: rule.ruleId,
            reason: 'already_migrated'
          });
          continue;
        }

        // 마이그레이션 대상이 아닌 규칙 스킵 (llm_contextual 등)
        if (!this.shouldMigrate(rule)) {
          result.skipped.push({
            ruleId: rule.ruleId,
            reason: 'not_migration_target',
            checkType: rule.checkType
          });
          continue;
        }

        if (dryRun) {
          result.migrated.push({
            ruleId: rule.ruleId,
            originalCheckType: rule.checkType,
            newCheckType: this.determineNewCheckType(rule),
            dryRun: true
          });
        } else {
          const migratedRule = this.migrateRule(rule);
          result.migrated.push(migratedRule);
        }

      } catch (error) {
        result.errors.push({
          ruleId: rule.ruleId,
          error: error.message
        });
      }
    }

    console.log(`\n📊 마이그레이션 결과:`);
    console.log(`   ✅ 마이그레이션: ${result.migrated.length}개`);
    console.log(`   ⏭️ 스킵: ${result.skipped.length}개`);
    console.log(`   ❌ 오류: ${result.errors.length}개`);

    return result;
  }

  // ═══════════════════════════════════════════════════════════════════
  // checkType 결정 로직
  // ═══════════════════════════════════════════════════════════════════

  /**
   * 규칙의 새 checkType 결정
   * 
   * @param {Object} rule - 규칙 객체
   * @returns {string} 새 checkType
   */
  determineNewCheckType(rule) {
    const { checkType, astHints, antiPatterns, goodPatterns, keywords, category } = rule;

    // 1. 이미 llm_with_ast인 경우 유지
    if (checkType === 'llm_with_ast') {
      return 'llm_with_ast';
    }

    // 2. llm_contextual은 그대로 유지
    if (checkType === 'llm_contextual') {
      return 'llm_contextual';
    }

    // 3. AST 기반 규칙 (ast, combined) → llm_with_ast로 변환
    if (checkType === 'ast' || checkType === 'combined') {
      // AST 힌트가 있으면 llm_with_ast
      if (astHints && Object.keys(astHints).length > 0) {
        return 'llm_with_ast';
      }
      // AST 힌트 없으면 llm_contextual로 변환
      return 'llm_contextual';
    }

    // 4. regex 규칙 분석
    if (checkType === 'regex') {
      // 패턴이 있고 AST 힌트도 있으면 llm_with_ast
      if ((antiPatterns?.length > 0 || goodPatterns?.length > 0) && 
          astHints && Object.keys(astHints).length > 0) {
        return 'llm_with_ast';
      }
      // 패턴만 있으면 regex 유지 (정적 분석 가능)
      if (antiPatterns?.length > 0 || goodPatterns?.length > 0) {
        return 'regex';
      }
      // 패턴 없으면 llm_contextual
      return 'llm_contextual';
    }

    // 5. 카테고리 기반 결정
    const llmCategories = [
      'architecture',
      'business_logic',
      'design_pattern',
      'naming_convention',  // 의미론적 명명은 LLM 필요
      'code_quality'
    ];

    if (llmCategories.includes(category)) {
      // AST 힌트가 있으면 llm_with_ast
      if (astHints && Object.keys(astHints).length > 0) {
        return 'llm_with_ast';
      }
      return 'llm_contextual';
    }

    // 6. 기본값
    return checkType || 'llm_contextual';
  }

  /**
   * 마이그레이션 대상 여부 확인
   * 
   * @param {Object} rule - 규칙 객체
   * @returns {boolean} 마이그레이션 대상 여부
   */
  shouldMigrate(rule) {
    const { checkType } = rule;

    // 마이그레이션 대상: ast, combined
    // (llm_contextual은 이미 LLM용이므로 마이그레이션 불필요)
    const migrationTargets = ['ast', 'combined'];
    
    // regex도 AST 힌트가 있으면 마이그레이션 대상
    if (checkType === 'regex' && rule.astHints && Object.keys(rule.astHints).length > 0) {
      return true;
    }

    return migrationTargets.includes(checkType);
  }

  // ═══════════════════════════════════════════════════════════════════
  // AST 자연어 변환
  // ═══════════════════════════════════════════════════════════════════

  /**
   * AST 정보를 자연어로 변환
   * 
   * @param {Object} rule - 규칙 객체
   * @returns {Object} { astDescription, checkPoints }
   */
  generateAstNaturalLanguage(rule) {
    const { astHints, title, category, description } = rule;

    // AST 힌트가 없으면 빈 결과
    if (!astHints || Object.keys(astHints).length === 0) {
      return {
        astDescription: null,
        checkPoints: []
      };
    }

    // AstHintsConverter로 변환
    const context = { title, category, description };
    const result = this.astHintsConverter.convert(astHints, context);

    // 규칙 제목 기반 체크포인트 추가
    if (title && result.checkPoints.length === 0) {
      result.checkPoints.push(`"${title}" 규칙을 준수하고 있는가?`);
    }

    return result;
  }

  // ═══════════════════════════════════════════════════════════════════
  // 키워드 보강
  // ═══════════════════════════════════════════════════════════════════

  /**
   * 키워드 자동 보강
   * 
   * @param {Object} rule - 규칙 객체
   * @returns {string[]} 보강된 키워드 배열
   */
  enhanceKeywords(rule) {
    const existingKeywords = new Set(rule.keywords || []);

    // 1. AST 힌트에서 키워드 추출
    if (rule.astHints) {
      const astKeywords = this.astHintsConverter.extractKeywords(rule.astHints);
      astKeywords.forEach(k => existingKeywords.add(k));
    }

    // 2. 제목에서 키워드 추출
    if (rule.title) {
      const titleKeywords = this.extractKeywordsFromText(rule.title);
      titleKeywords.forEach(k => existingKeywords.add(k));
    }

    // 3. 카테고리 관련 키워드 추가
    const categoryKeywords = this.getCategoryKeywords(rule.category);
    categoryKeywords.forEach(k => existingKeywords.add(k));

    // 4. 패턴에서 키워드 추출
    if (rule.antiPatterns || rule.goodPatterns) {
      const patternKeywords = this.extractKeywordsFromPatterns(rule);
      patternKeywords.forEach(k => existingKeywords.add(k));
    }

    return Array.from(existingKeywords).slice(0, 15); // 최대 15개
  }

  /**
   * 텍스트에서 키워드 추출
   * @private
   */
  extractKeywordsFromText(text) {
    const keywords = new Set();
    
    // Java 관련 키워드
    const javaKeywords = text.match(/\b(class|interface|method|public|private|try|catch|throw|Exception|null|void|String|int|boolean)\b/gi);
    if (javaKeywords) {
      javaKeywords.forEach(k => keywords.add(k.toLowerCase()));
    }

    // CamelCase/PascalCase 단어
    const camelWords = text.match(/[A-Z][a-z]+/g);
    if (camelWords) {
      camelWords.forEach(w => {
        if (w.length >= 3) keywords.add(w.toLowerCase());
      });
    }

    // 한글 명사 (2글자 이상)
    const koreanNouns = text.match(/[가-힣]{2,}/g);
    if (koreanNouns) {
      const stopWords = ['규칙', '검사', '확인', '사용', '필요', '경우'];
      koreanNouns.forEach(n => {
        if (!stopWords.includes(n)) keywords.add(n);
      });
    }

    return Array.from(keywords);
  }

  /**
   * 카테고리별 관련 키워드 반환
   * @private
   */
  getCategoryKeywords(category) {
    const categoryKeywordMap = {
      'naming_convention': ['naming', 'name', 'convention', '명명', '이름'],
      'error_handling': ['exception', 'catch', 'throw', 'error', '예외', '에러'],
      'code_style': ['style', 'format', 'indent', '스타일', '포맷'],
      'architecture': ['layer', 'service', 'controller', 'repository', '계층'],
      'resource_management': ['connection', 'close', 'resource', '리소스', '연결'],
      'security': ['sql', 'injection', 'xss', '보안', '취약점'],
      'documentation': ['javadoc', 'comment', '주석', '문서']
    };

    return categoryKeywordMap[category] || [];
  }

  /**
   * 패턴에서 키워드 추출
   * @private
   */
  extractKeywordsFromPatterns(rule) {
    const keywords = new Set();
    const patterns = [...(rule.antiPatterns || []), ...(rule.goodPatterns || [])];

    for (const pattern of patterns) {
      const patternStr = typeof pattern === 'string' ? pattern : pattern.pattern;
      if (!patternStr) continue;

      // 패턴에서 리터럴 문자열 추출
      const literals = patternStr.match(/[a-zA-Z]{3,}/g);
      if (literals) {
        literals.forEach(l => {
          // 정규식 메타 문자 제외
          if (!['class', 'public', 'private', 'void'].includes(l.toLowerCase())) {
            keywords.add(l.toLowerCase());
          }
        });
      }
    }

    return Array.from(keywords);
  }

  // ═══════════════════════════════════════════════════════════════════
  // 유틸리티 메서드
  // ═══════════════════════════════════════════════════════════════════

  /**
   * 변환 결과 검증
   * 
   * @param {Object} rule - 변환된 규칙
   * @returns {Object} { valid, errors }
   */
  validateConvertedRule(rule) {
    const errors = [];

    // 필수 필드 검증
    if (!rule.ruleId) errors.push('ruleId is required');
    if (!rule.title) errors.push('title is required');
    if (!rule.checkType) errors.push('checkType is required');

    // llm_with_ast인 경우 astHints 또는 astDescription 필요
    if (rule.checkType === 'llm_with_ast') {
      if (!rule.astHints && !rule.astDescription) {
        errors.push('llm_with_ast requires astHints or astDescription');
      }
    }

    // llm_contextual인 경우 keywords 필요
    if (rule.checkType === 'llm_contextual') {
      if (!rule.keywords || rule.keywords.length === 0) {
        errors.push('llm_contextual requires keywords');
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * 마이그레이션 통계 생성
   * 
   * @param {Object[]} rules - 규칙 배열
   * @returns {Object} 통계 객체
   */
  generateMigrationStats(rules) {
    const stats = {
      total: rules.length,
      byCheckType: {},
      migrationTargets: 0,
      alreadyMigrated: 0,
      withAstHints: 0,
      withAstDescription: 0
    };

    for (const rule of rules) {
      // checkType별 카운트
      const checkType = rule.checkType || 'unknown';
      stats.byCheckType[checkType] = (stats.byCheckType[checkType] || 0) + 1;

      // 마이그레이션 대상
      if (this.shouldMigrate(rule)) {
        stats.migrationTargets++;
      }

      // 이미 마이그레이션됨
      if (rule.originalCheckType) {
        stats.alreadyMigrated++;
      }

      // AST 힌트 보유
      if (rule.astHints && Object.keys(rule.astHints).length > 0) {
        stats.withAstHints++;
      }

      // AST 설명 보유
      if (rule.astDescription) {
        stats.withAstDescription++;
      }
    }

    return stats;
  }
}

export default RuleConverter;