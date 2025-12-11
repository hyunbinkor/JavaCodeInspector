/**
 * 개발가이드 전용 검사기 (Layer1: DevelopmentGuidelineChecker)
 * 
 * 금융권 Java 코드 정적 분석 시스템의 Layer1 컴포넌트
 * 
 * v2.1 아키텍처 (이원화 지원):
 * ┌─────────────────────────────────────────────────────────────┐
 * │                    개발가이드 규칙                           │
 * ├─────────────────────────┬───────────────────────────────────┤
 * │   정적 규칙 (Static)    │    컨텍스트 규칙 (Contextual)       │
 * │   → SonarQube (보류)    │    → LLM 전담 (활성)               │
 * └─────────────────────────┴───────────────────────────────────┘
 * 
 * 이원화 전략:
 * - 정적 규칙: SonarQube 연동 예정 (담당자 협의 후)
 *   - 현재: skipStaticRules=true로 스킵 가능
 *   - 향후: SonarQube API 연동
 * 
 * - 컨텍스트 규칙: LLM 전담
 *   - 통합 프롬프트로 일괄 처리 (효율성)
 *   - 가이드 해석 전용 모델 사용 (gpt-oss:120b)
 * 
 * @module DevelopmentGuidelineChecker
 * @version 2.1.0 - 이원화 지원
 */
import { VectorClient } from '../clients/vectorClient.js';
import { LLMService } from '../clients/llmService.js';
import logger from '../utils/loggerUtils.js';

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
  }

  /**
   * 개발가이드 룰 초기화 프로세스
   */
  async initialize() {
    logger.info('📋 개발가이드 룰 로딩 중...');

    // VectorDB에서 규칙 로드
    await this.loadGuidelineRules();

    logger.info(`✅ 개발가이드 룰 로딩 완료:`);
    logger.info(`   - 컨텍스트 규칙 (LLM): ${this.contextualRules.size}개`);
    logger.info(`   - 정적 규칙 (SonarQube 예정): ${this.staticRules.size}개`);
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
            checkType: guideline.checkType || 'llm_contextual'
          };

          // checkType에 따라 분류
          const isStaticRule = ['regex', 'ast', 'combined', 'static_analysis'].includes(guideline.checkType);
          
          if (isStaticRule) {
            this.staticRules.set(guideline.ruleId, rule);
          } else {
            // llm_contextual 또는 알 수 없는 타입은 컨텍스트 규칙으로
            this.contextualRules.set(guideline.ruleId, rule);
          }
        });

        logger.info(`  📊 가이드라인 분류 완료:`);
        logger.info(`     - 컨텍스트(LLM): ${this.contextualRules.size}개`);
        logger.info(`     - 정적(SonarQube): ${this.staticRules.size}개`);
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
        checkType: 'llm_contextual'
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
        checkType: 'llm_contextual'
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
        checkType: 'llm_contextual'
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
   * @param {string} sourceCode - 검사할 소스코드
   * @param {object} astAnalysis - AST 분석 결과
   * @param {object} options - 검사 옵션
   *   - skipStaticRules: 정적 규칙 검사 스킵 (SonarQube 연동 시 true)
   *   - skipContextual: 컨텍스트 규칙 검사 스킵
   *   - useUnifiedPrompt: 통합 프롬프트 사용 (기본: true)
   * @returns {Promise<array>} 위반사항 배열
   */
  async checkRules(sourceCode, astAnalysis, options = {}) {
    const violations = [];

    // Step 1: 정적 규칙 검사 (SonarQube 연동 전까지 선택적)
    if (!options.skipStaticRules && this.staticRules.size > 0) {
      logger.info('  ⚠️ 정적 규칙 검사는 SonarQube 연동 후 지원 예정');
      // TODO: SonarQube 연동 시 구현
      // const staticViolations = await this.checkStaticRulesWithSonarQube(sourceCode);
      // violations.push(...staticViolations);
    }

    // Step 2: 컨텍스트 규칙 검사 (LLM 전담)
    if (!options.skipContextual) {
      const useUnified = options.useUnifiedPrompt !== false; // 기본: true
      
      let contextualViolations;
      if (useUnified) {
        // 통합 프롬프트 방식 (효율적)
        contextualViolations = await this.checkContextualRulesUnified(sourceCode, astAnalysis);
      } else {
        // 배치 방식 (기존)
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
  // 컨텍스트 규칙 검사 (LLM 전담)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * 통합 프롬프트 방식 - 모든 규칙을 한 번에 검사
   * 
   * 장점:
   * - LLM 호출 횟수 최소화 (1회)
   * - 규칙 간 맥락 공유
   * - 일관된 판단
   * 
   * @param {string} sourceCode - 소스 코드
   * @param {object} astAnalysis - AST 분석 결과
   * @returns {Promise<array>} 위반사항 배열
   */
  async checkContextualRulesUnified(sourceCode, astAnalysis) {
    logger.info('  🤖 LLM 통합 가이드라인 검사 시작...');

    // 적용 가능한 규칙 필터링
    const applicableRules = this.filterApplicableRules(sourceCode);
    if (applicableRules.length === 0) {
      logger.info('    해당 코드에 적용 가능한 가이드라인 없음');
      return [];
    }

    logger.info(`    적용 가능한 가이드라인: ${applicableRules.length}개`);

    // 통합 프롬프트 생성
    const prompt = this.buildUnifiedPrompt(sourceCode, applicableRules, astAnalysis);

    try {
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
4. 구체적인 수정 방안을 제시하세요

## 응답 형식 (JSON만 출력)
\`\`\`json
{
  "violations": [
    {
      "ruleId": "규칙 ID (예: CTX-001)",
      "line": 위반_라인번호,
      "severity": "CRITICAL|HIGH|MEDIUM|LOW",
      "description": "구체적인 위반 내용",
      "suggestion": "수정 방법"
    }
  ],
  "summary": {
    "totalChecked": ${rules.length},
    "totalViolations": 위반_개수,
    "criticalCount": CRITICAL_개수
  }
}
\`\`\`

위반사항이 없으면 violations를 빈 배열로 반환하세요.
JSON만 출력하고 다른 설명은 포함하지 마세요.`;
  }

  /**
   * 통합 프롬프트 응답 파싱
   */
  parseUnifiedResponse(response, rules) {
    const violations = [];

    try {
      const parsed = this.llmService.llmClient.cleanAndExtractJSON(response);

      if (parsed && parsed.violations && Array.isArray(parsed.violations)) {
        parsed.violations.forEach(v => {
          // 규칙 ID로 원본 규칙 찾기
          const rule = rules.find(r => r.ruleId === v.ruleId || r.id === v.ruleId);
          
          if (rule) {
            violations.push({
              ruleId: v.ruleId,
              title: rule.title,
              category: rule.category,
              severity: v.severity || rule.severity,
              message: v.description,
              line: v.line || 1,
              column: 0,
              fixable: true,
              suggestion: v.suggestion,
              source: 'llm_unified'
            });
          }
        });
      }

      // 요약 로깅
      if (parsed?.summary) {
        logger.info(`    📊 검사 요약: ${parsed.summary.totalChecked}개 규칙, ${parsed.summary.totalViolations}개 위반`);
      }
    } catch (error) {
      logger.warn('    통합 응답 파싱 실패:', error.message);
    }

    return violations;
  }

  /**
   * 배치 방식 - 규칙을 그룹으로 나누어 검사 (폴백용)
   */
  async checkContextualRulesBatch(sourceCode) {
    logger.info('  🤖 LLM 배치 가이드라인 검사 시작...');

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
   * 적용 가능한 규칙 필터링
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

## 응답 형식 (JSON):
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
      model: this.guidelineModel,
      temperature: 0.1,
      num_predict: 800
    });

    const parsed = this.llmService.llmClient.cleanAndExtractJSON(response);

    if (!parsed || !parsed.violations) {
      return [];
    }

    return parsed.violations.map(v => ({
      ruleId: rule.id,
      title: rule.title,
      category: rule.category,
      severity: rule.severity,
      message: v.description,
      line: v.line || 1,
      column: 0,
      fixable: true,
      suggestion: v.suggestion,
      source: 'llm_single'
    }));
  }

  /**
   * 배치 응답 파싱
   */
  parseBatchResponse(response, rules) {
    const violations = [];

    try {
      const parsed = this.llmService.llmClient.cleanAndExtractJSON(response);

      if (parsed && parsed.violations && Array.isArray(parsed.violations)) {
        parsed.violations.forEach(v => {
          const rule = rules.find(r => r.id === v.ruleId || r.ruleId === v.ruleId);
          
          if (rule && v.violation === true) {
            violations.push({
              ruleId: v.ruleId,
              title: v.title || rule.title,
              category: rule.category,
              severity: rule.severity,
              message: v.description,
              line: v.line || 1,
              column: 0,
              fixable: true,
              suggestion: v.suggestion,
              source: 'llm_batch'
            });
          }
        });
      }
    } catch (error) {
      logger.warn('    배치 응답 파싱 실패:', error.message);
    }

    return violations;
  }

  /**
   * 코드 길이 제한
   */
  truncateCode(code, maxLength) {
    if (code.length <= maxLength) return code;

    const lines = code.split('\n');
    let truncated = '';

    for (const line of lines) {
      if (truncated.length + line.length + 1 > maxLength) {
        truncated += '\n// ... (코드 생략)';
        break;
      }
      truncated += (truncated ? '\n' : '') + line;
    }

    return truncated;
  }
}