/**
 * 코드 프로파일러 (CodeProfiler)
 * 
 * Java 코드를 분석하여 태그 기반 프로파일 생성
 * Tier 1 (정규식/AST) + Tier 2 (LLM) 통합
 * 
 * @module profiler/CodeProfiler
 * @version 1.0.0
 */

import { TagExtractor } from './TagExtractor.js';
import { getTagDefinitionLoader } from './TagDefinitionLoader.js';
import { JavaASTParser } from '../ast/javaAstParser.js';
import { LLMClient } from '../clients/llmClient.js';
import logger from '../utils/loggerUtils.js';

/**
 * 코드 프로파일 객체
 * @typedef {Object} CodeProfile
 * @property {Set<string>} tags - 추출된 태그 집합
 * @property {Map<string, Object>} tagDetails - 태그별 상세 정보
 * @property {string[]} categories - 코드 카테고리
 * @property {string} riskLevel - 위험 수준 (low/medium/high/critical)
 * @property {Object} compoundTags - 복합 태그 평가 결과
 * @property {Object} metadata - 메타데이터
 * @property {Object} stats - 통계 정보
 */

/**
 * 코드 프로파일러 클래스
 */
export class CodeProfiler {
  constructor() {
    /** @type {TagExtractor} 태그 추출기 */
    this.tagExtractor = null;
    
    /** @type {TagDefinitionLoader} 태그 정의 로더 */
    this.definitionLoader = null;
    
    /** @type {JavaASTParser} Java AST 파서 */
    this.astParser = null;
    
    /** @type {LLMClient} LLM 클라이언트 (Tier 2용) */
    this.llmClient = null;
    
    /** @type {boolean} 초기화 완료 여부 */
    this.initialized = false;

    /** @type {Object} 설정 */
    this.config = {
      enableTier2: true,           // Tier 2 (LLM) 활성화
      tier2BatchSize: 5,           // LLM 배치 크기
      tier2Temperature: 0,         // LLM 온도 (결정론적)
      tier2MaxTokens: 1000,        // LLM 최대 토큰
      tier2Model: 'qwen3-coder:30b' // Tier 2 모델
    };
  }

  /**
   * 초기화
   * 
   * @param {Object} options - 초기화 옵션
   * @returns {Promise<boolean>} 초기화 성공 여부
   */
  async initialize(options = {}) {
    if (this.initialized) {
      return true;
    }

    try {
      logger.info('🔧 CodeProfiler 초기화 중...');

      // 설정 병합
      this.config = { ...this.config, ...options };

      // 태그 추출기 초기화
      this.tagExtractor = new TagExtractor();
      await this.tagExtractor.initialize();

      // 태그 정의 로더 (싱글톤)
      this.definitionLoader = getTagDefinitionLoader();

      // AST 파서 초기화
      this.astParser = new JavaASTParser();

      // LLM 클라이언트 초기화 (Tier 2용)
      if (this.config.enableTier2) {
        this.llmClient = new LLMClient();
        const llmConnected = await this.llmClient.checkConnection();
        if (!llmConnected) {
          logger.warn('⚠️ LLM 연결 실패 - Tier 2 비활성화');
          this.config.enableTier2 = false;
        }
      }

      this.initialized = true;
      logger.info('✅ CodeProfiler 초기화 완료');
      logger.info(`   - Tier 2 (LLM): ${this.config.enableTier2 ? '활성화' : '비활성화'}`);

      return true;

    } catch (error) {
      logger.error(`❌ CodeProfiler 초기화 실패: ${error.message}`);
      return false;
    }
  }

  /**
   * 코드 프로파일 생성 (메인 메서드)
   * 
   * @param {string} sourceCode - Java 소스 코드
   * @param {Object} options - 옵션
   * @param {boolean} [options.enableTier2=true] - Tier 2 활성화
   * @param {boolean} [options.includeCompound=true] - 복합 태그 포함
   * @returns {Promise<CodeProfile>} 코드 프로파일
   */
  async generateProfile(sourceCode, options = {}) {
    if (!this.initialized) {
      await this.initialize();
    }

    const startTime = Date.now();
    const opts = {
      enableTier2: this.config.enableTier2,
      includeCompound: true,
      ...options
    };

    logger.info('📊 코드 프로파일 생성 시작...');

    // 1. AST 파싱
    logger.debug('  AST 파싱 중...');
    const astResult = this.astParser.parseJavaCode(sourceCode);

    // 2. Tier 1 태그 추출 (정규식/AST)
    logger.debug('  Tier 1 태그 추출 중...');
    const tier1Result = await this.tagExtractor.extractTags(sourceCode, astResult);

    // 3. Tier 2 필요 여부 판단 및 실행
    let tier2Result = { tags: new Set(), details: new Map() };
    if (opts.enableTier2 && this.config.enableTier2) {
      const needsTier2 = this.needsTier2Tagging(tier1Result.tags);
      if (needsTier2.needed) {
        logger.debug(`  Tier 2 태그 추출 중... (${needsTier2.tags.length}개 태그)`);
        tier2Result = await this.extractTier2Tags(sourceCode, tier1Result.tags, needsTier2.tags);
      }
    }

    // 4. 태그 병합
    const allTags = new Set([...tier1Result.tags, ...tier2Result.tags]);
    const allDetails = new Map([...tier1Result.details, ...tier2Result.details]);

    // 5. 복합 태그 평가
    let compoundTags = {};
    if (opts.includeCompound) {
      compoundTags = this.evaluateCompoundTags(allTags);
      
      // 매칭된 복합 태그를 태그 집합에 추가 (규칙 매칭에서 사용 가능)
      for (const [name, result] of Object.entries(compoundTags)) {
        if (result.matched) {
          allTags.add(name);
          allDetails.set(name, {
            matched: true,
            source: 'compound',
            expression: result.expression,
            severity: result.severity,
            confidence: 1.0
          });
        }
      }
    }

    // 6. 카테고리 및 위험도 추론
    const categories = this.inferCategories(allTags);
    const riskLevel = this.assessRisk(allTags, compoundTags);

    // 7. 메타데이터 구성
    const metadata = this.extractMetadata(sourceCode, astResult);

    const elapsed = Date.now() - startTime;

    const profile = {
      tags: allTags,
      tagDetails: allDetails,
      categories,
      riskLevel,
      compoundTags,
      metadata,
      stats: {
        tier1Tags: tier1Result.tags.size,
        tier2Tags: tier2Result.tags.size,
        totalTags: allTags.size,
        compoundTags: Object.keys(compoundTags).filter(k => compoundTags[k].matched).length,
        processingTimeMs: elapsed,
        tier1TimeMs: tier1Result.stats?.extractionTimeMs || 0
      }
    };

    logger.info(`✅ 코드 프로파일 생성 완료 (${elapsed}ms)`);
    logger.info(`   - Tier 1: ${profile.stats.tier1Tags}개`);
    logger.info(`   - Tier 2: ${profile.stats.tier2Tags}개`);
    logger.info(`   - 복합 태그: ${profile.stats.compoundTags}개`);
    logger.info(`   - 위험 수준: ${riskLevel}`);

    return profile;
  }

  /**
   * Tier 2 태깅 필요 여부 판단
   * 
   * @param {Set<string>} tier1Tags - Tier 1 태그 집합
   * @returns {Object} { needed: boolean, tags: string[] }
   */
  needsTier2Tagging(tier1Tags) {
    const requiredTier2Tags = this.definitionLoader.getRequiredTier2Tags(tier1Tags);
    
    return {
      needed: requiredTier2Tags.length > 0,
      tags: requiredTier2Tags
    };
  }

  /**
   * Tier 2 태그 추출 (LLM 기반)
   * 
   * @param {string} sourceCode - 소스 코드
   * @param {Set<string>} tier1Tags - Tier 1 태그 집합
   * @param {string[]} tagsToEvaluate - 평가할 Tier 2 태그 목록
   * @returns {Promise<Object>} { tags: Set, details: Map }
   */
  async extractTier2Tags(sourceCode, tier1Tags, tagsToEvaluate) {
    const tags = new Set();
    const details = new Map();

    if (!this.llmClient || tagsToEvaluate.length === 0) {
      return { tags, details };
    }

    try {
      // 태그 정의 조회
      const tagDefinitions = tagsToEvaluate.map(tagName => {
        const def = this.definitionLoader.getTagDefinition(tagName);
        return def ? { name: tagName, ...def } : null;
      }).filter(Boolean);

      // 프롬프트 생성
      const prompt = this.buildTier2Prompt(sourceCode, tier1Tags, tagDefinitions);

      // LLM 호출
      const response = await this.llmClient.generateCompletion(prompt, {
        model: this.config.tier2Model,
        temperature: this.config.tier2Temperature,
        max_tokens: this.config.tier2MaxTokens
      });

      // 응답 파싱
      const parsed = this.parseTier2Response(response);

      for (const result of parsed) {
        if (result.value === true) {
          tags.add(result.tagName);
          details.set(result.tagName, {
            matched: true,
            confidence: result.confidence || 0.8,
            evidence: result.evidence,
            source: 'llm'
          });
        }
      }

    } catch (error) {
      logger.warn(`⚠️ Tier 2 태그 추출 실패: ${error.message}`);
    }

    return { tags, details };
  }

  /**
   * Tier 2 LLM 프롬프트 생성
   * 
   * @param {string} sourceCode - 소스 코드
   * @param {Set<string>} tier1Tags - Tier 1 태그
   * @param {Object[]} tagDefinitions - 평가할 태그 정의
   * @returns {string} 프롬프트
   */
  buildTier2Prompt(sourceCode, tier1Tags, tagDefinitions) {
    const tier1List = Array.from(tier1Tags).join(', ');
    
    const tagDescriptions = tagDefinitions.map((tag, i) => {
      const criteria = tag.detection?.criteria || tag.description;
      return `${i + 1}. ${tag.name}\n   - 설명: ${tag.description}\n   - 판단 기준: ${criteria}`;
    }).join('\n\n');

    // 코드가 너무 길면 앞부분만 사용
    const maxCodeLength = 3000;
    const truncatedCode = sourceCode.length > maxCodeLength
      ? sourceCode.substring(0, maxCodeLength) + '\n// ... (truncated)'
      : sourceCode;

    return `당신은 금융권 Java 코드 분석 전문가입니다.

주어진 코드를 분석하여 각 태그의 해당 여부를 판단해주세요.

## 판단 원칙
1. 보수적으로 판단: 확실하지 않으면 false
2. 코드만 보고 판단: 추측하지 마세요
3. 각 태그 독립적으로: 다른 태그 결과에 영향받지 마세요

## 금융권 용어
- DAO: Data Access Object, 데이터베이스 접근 담당 (*DAO, *Dao 패턴)
- Service: 비즈니스 로직 담당 (*Service, *Svc 패턴)
- 명명 규칙: 조회(sel*/get*), 등록(reg*/add*), 수정(mod*/upd*), 삭제(del*/remove*)

## 코드

\`\`\`java
${truncatedCode}
\`\`\`

## 이미 확인된 정보 (Tier 1)
${tier1List || '없음'}

## 판단할 태그

${tagDescriptions}

## 응답 형식 (JSON만 출력)

\`\`\`json
{
  "evaluatedTags": [
    {
      "tagName": "태그명",
      "value": true 또는 false,
      "confidence": 0.0-1.0,
      "evidence": "판단 근거"
    }
  ]
}
\`\`\`

JSON만 출력하세요.`;
  }

  /**
   * Tier 2 LLM 응답 파싱
   * 
   * @param {string} response - LLM 응답
   * @returns {Object[]} 파싱된 결과 배열
   */
  parseTier2Response(response) {
    try {
      // JSON 블록 추출
      const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : response;

      // JSON 파싱
      const cleaned = jsonStr.replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);

      return parsed.evaluatedTags || [];

    } catch (error) {
      logger.warn(`Tier 2 응답 파싱 실패: ${error.message}`);
      return [];
    }
  }

  /**
   * 복합 태그 평가
   * 
   * @param {Set<string>} tags - 태그 집합
   * @returns {Object} 복합 태그 평가 결과
   */
  evaluateCompoundTags(tags) {
    const compoundDefs = this.definitionLoader.getCompoundTags();
    const results = {};

    for (const [name, def] of Object.entries(compoundDefs)) {
      const expression = def.expression;
      const matched = this.evaluateTagExpression(expression, tags);

      results[name] = {
        matched,
        expression,
        description: def.description,
        severity: def.severity
      };
    }

    return results;
  }

  /**
   * 태그 표현식 평가 (간단한 버전)
   * 
   * @param {string} expression - 태그 조합 표현식
   * @param {Set<string>} tags - 태그 집합
   * @returns {boolean} 평가 결과
   */
  evaluateTagExpression(expression, tags) {
    try {
      // 태그명을 true/false로 치환
      let evalStr = expression;
      
      // 모든 태그명 추출 (대문자_언더스코어 패턴)
      const tagPattern = /[A-Z][A-Z0-9_]*/g;
      const foundTags = expression.match(tagPattern) || [];
      
      // 고유 태그명만
      const uniqueTags = [...new Set(foundTags)];
      
      // 긴 태그명부터 치환 (부분 매칭 방지)
      uniqueTags.sort((a, b) => b.length - a.length);
      
      for (const tagName of uniqueTags) {
        const hasTag = tags.has(tagName);
        // 단어 경계로 치환
        evalStr = evalStr.replace(new RegExp(`\\b${tagName}\\b`, 'g'), hasTag.toString());
      }

      // 안전한 평가 (&&, ||, !, (), true, false만 허용)
      if (!/^[\s()&|!truefalse]+$/i.test(evalStr.replace(/true|false/gi, ''))) {
        logger.warn(`안전하지 않은 표현식: ${expression}`);
        return false;
      }

      // eval 대신 Function 사용
      return new Function(`return ${evalStr}`)();

    } catch (error) {
      logger.warn(`표현식 평가 실패: ${expression} - ${error.message}`);
      return false;
    }
  }

  /**
   * 코드 카테고리 추론
   * 
   * @param {Set<string>} tags - 태그 집합
   * @returns {string[]} 카테고리 배열
   */
  inferCategories(tags) {
    const categories = new Set();

    // 구조 카테고리
    if (tags.has('IS_CONTROLLER')) categories.add('controller');
    if (tags.has('IS_SERVICE')) categories.add('service');
    if (tags.has('IS_REPOSITORY') || tags.has('IS_DAO')) categories.add('data-access');
    if (tags.has('IS_ENTITY')) categories.add('entity');

    // 기술 카테고리
    if (tags.has('USES_CONNECTION') || tags.has('USES_STATEMENT')) categories.add('jdbc');
    if (tags.has('USES_JPA_REPOSITORY')) categories.add('jpa');
    if (tags.has('HAS_TRANSACTIONAL')) categories.add('transactional');

    // 금융권 카테고리
    if (tags.has('USES_LDATA') || tags.has('USES_LMULTIDATA')) categories.add('financial-framework');

    // 문제 카테고리
    if (tags.has('HAS_SQL_CONCATENATION')) categories.add('security-risk');
    if (tags.has('HAS_EMPTY_CATCH')) categories.add('error-handling-issue');
    if (tags.has('HAS_DB_CALL_IN_LOOP')) categories.add('performance-issue');

    return Array.from(categories);
  }

  /**
   * 위험 수준 평가
   * 
   * @param {Set<string>} tags - 태그 집합
   * @param {Object} compoundTags - 복합 태그 결과
   * @returns {string} 위험 수준 (low/medium/high/critical)
   */
  assessRisk(tags, compoundTags) {
    let riskScore = 0;

    // 복합 태그 기반 위험도
    for (const [name, result] of Object.entries(compoundTags)) {
      if (result.matched) {
        switch (result.severity) {
          case 'CRITICAL': riskScore += 10; break;
          case 'HIGH': riskScore += 5; break;
          case 'MEDIUM': riskScore += 2; break;
          case 'LOW': riskScore += 1; break;
        }
      }
    }

    // 개별 태그 기반 위험도
    const criticalTags = ['HAS_SQL_CONCATENATION', 'HAS_HARDCODED_PASSWORD'];
    const highTags = ['HAS_EMPTY_CATCH', 'HAS_DB_CALL_IN_LOOP', 'LAYER_VIOLATION'];
    const mediumTags = ['HAS_GENERIC_CATCH', 'COMPLEXITY_HIGH', 'NESTING_DEEP'];

    for (const tag of criticalTags) {
      if (tags.has(tag)) riskScore += 8;
    }
    for (const tag of highTags) {
      if (tags.has(tag)) riskScore += 4;
    }
    for (const tag of mediumTags) {
      if (tags.has(tag)) riskScore += 2;
    }

    // 리소스 관리 위험
    const usesResource = tags.has('USES_CONNECTION') || 
                        tags.has('USES_STATEMENT') || 
                        tags.has('USES_RESULTSET') ||
                        tags.has('USES_STREAM');
    const hasResourceManagement = tags.has('HAS_TRY_WITH_RESOURCES') || 
                                  tags.has('HAS_CLOSE_IN_FINALLY');
    
    if (usesResource && !hasResourceManagement) {
      riskScore += 6;
    }

    // 위험 수준 결정
    if (riskScore >= 15) return 'critical';
    if (riskScore >= 8) return 'high';
    if (riskScore >= 3) return 'medium';
    return 'low';
  }

  /**
   * 코드 메타데이터 추출
   * 
   * @param {string} sourceCode - 소스 코드
   * @param {Object} astResult - AST 결과
   * @returns {Object} 메타데이터
   */
  extractMetadata(sourceCode, astResult) {
    const lines = sourceCode.split('\n');
    
    // 클래스명 추출
    const classMatch = sourceCode.match(/class\s+(\w+)/);
    const className = classMatch ? classMatch[1] : 'Unknown';

    // 패키지명 추출
    const packageMatch = sourceCode.match(/package\s+([\w.]+)/);
    const packageName = packageMatch ? packageMatch[1] : '';

    return {
      className,
      packageName,
      lineCount: lines.length,
      methodCount: astResult?.analysis?.methodDeclarations?.length || 0,
      hasMainMethod: /public\s+static\s+void\s+main\s*\(/.test(sourceCode),
      astParsed: astResult?.success || false
    };
  }

  /**
   * 프로파일을 JSON으로 직렬화
   * 
   * @param {CodeProfile} profile - 코드 프로파일
   * @returns {Object} JSON 객체
   */
  profileToJSON(profile) {
    return {
      tags: Array.from(profile.tags),
      tagDetails: Object.fromEntries(profile.tagDetails),
      categories: profile.categories,
      riskLevel: profile.riskLevel,
      compoundTags: profile.compoundTags,
      metadata: profile.metadata,
      stats: profile.stats
    };
  }

  /**
   * 간략한 프로파일 요약
   * 
   * @param {CodeProfile} profile - 코드 프로파일
   * @returns {string} 요약 문자열
   */
  summarizeProfile(profile) {
    const tags = Array.from(profile.tags);
    const matchedCompound = Object.entries(profile.compoundTags)
      .filter(([_, v]) => v.matched)
      .map(([k, _]) => k);

    return `
=== 코드 프로파일 요약 ===
클래스: ${profile.metadata.className}
패키지: ${profile.metadata.packageName || '(default)'}
라인 수: ${profile.metadata.lineCount}

위험 수준: ${profile.riskLevel.toUpperCase()}
카테고리: ${profile.categories.join(', ') || '없음'}

태그 (${tags.length}개):
  ${tags.slice(0, 15).join(', ')}${tags.length > 15 ? ` ... (+${tags.length - 15}개)` : ''}

복합 태그 (${matchedCompound.length}개):
  ${matchedCompound.join(', ') || '없음'}

처리 시간: ${profile.stats.processingTimeMs}ms
`.trim();
  }
}

export default CodeProfiler;
