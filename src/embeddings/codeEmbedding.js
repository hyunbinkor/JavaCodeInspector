/**
 * Code Embedding Generator
 * 
 * Java 코드를 다차원 벡터로 변환하여 의미적 유사도 계산 가능하게 함
 * 
 * 임베딩 구조 (512차원):
 * - syntactic_embedding: 128차원 (AST 구조 - 클래스/메서드/변수)
 * - semantic_embedding: 256차원 (코드 의미 - 기능/로직)
 * - framework_embedding: 64차원 (프레임워크 사용 - Spring/MyBatis)
 * - context_embedding: 64차원 (비즈니스 컨텍스트 - 도메인 지식)
 * 
 * v2.0 업데이트:
 * - LLM 기반 의미론적 임베딩 지원 (gpt-oss:120b)
 * - 카테고리별 가중치 적용
 * - 메타 정보 활용 (비즈니스 컨텍스트 64차원으로 확장)
 * - 임베딩 품질 점수 계산
 * 
 * @module CodeEmbeddingGenerator
 */

import { JavaASTParser } from './javaAstParser.js';
import { LLMAbstractionLayer } from '../clients/llmAbstractionLayer.js';
import { GuidelineContextLoader } from '../utils/guidelineContextLoader.js';
import { MetaInfoManager } from '../utils/metaInfoManager.js';
import { config } from '../config.js';
import logger from '../utils/loggerUtils.js';
import fs from 'fs/promises';
import path from 'path';

export class CodeEmbeddingGenerator {
  constructor() {
    // AST 파서 (구문적 임베딩용)
    this.astParser = new JavaASTParser();
    
    // 임베딩 차원 설정 (Enhanced 모드에 따라 변경)
    const isEnhanced = config.embedding?.enableEnhancedEmbedding ?? false;
    this.syntacticDim = 128;
    this.semanticDim = 256;
    this.frameworkDim = 64;
    this.contextDim = isEnhanced ? 64 : 32;  // Enhanced: 64, 기본: 32
    this.totalDim = this.syntacticDim + this.semanticDim + this.frameworkDim + this.contextDim;
    
    // LLM 클라이언트 (의미론적 임베딩용)
    this.llmClient = null;
    this.enableLLMEmbedding = false;
    
    // 개발가이드 로더 (LLM 컨텍스트용)
    this.guidelineLoader = null;
    
    // 메타 정보 관리자 (비즈니스 컨텍스트용)
    this.metaInfoManager = null;
    this.enableMetaInfo = false;
    
    // 임베딩 가중치 설정
    this.embeddingWeights = null;
    
    // 캐시
    this.guidelineContextCache = new Map();
    this.semanticAnalysisCache = new Map();
    
    logger.info(`📐 임베딩 차원 설정: ${this.totalDim}차원 (${this.syntacticDim}+${this.semanticDim}+${this.frameworkDim}+${this.contextDim})`);
  }

  /**
   * 초기화
   */
  async initialize() {
    logger.info('🚀 Code Embedding Generator 초기화 중...');
    
    // Enhanced 모드 확인
    const isEnhanced = config.embedding?.enableEnhancedEmbedding ?? false;
    this.enableLLMEmbedding = config.embedding?.enableLLMEmbedding ?? false;
    this.enableMetaInfo = config.embedding?.enableMetaInfo ?? false;
    
    if (isEnhanced) {
      logger.info('  ✨ Enhanced 모드 활성화');
      
      try {
        // LLM 클라이언트 초기화 (의미론적 임베딩용)
        if (this.enableLLMEmbedding) {
          this.llmClient = new LLMAbstractionLayer();
          logger.info('  ✅ LLM 클라이언트 초기화 완료');
        }
        
        // 개발가이드 로더 초기화
        this.guidelineLoader = new GuidelineContextLoader();
        await this.guidelineLoader.initialize();
        logger.info('  ✅ 개발가이드 컨텍스트 로드 완료');
        
        // 메타 정보 관리자 초기화 (선택적)
        if (this.enableMetaInfo) {
          this.metaInfoManager = new MetaInfoManager();
          await this.metaInfoManager.initialize();
          logger.info('  ✅ 메타 정보 테이블 로드 완료');
        }
        
        // 가중치 설정 로드
        this.embeddingWeights = await this.loadEmbeddingWeights();
        logger.info('  ✅ 임베딩 가중치 설정 로드 완료');
        
      } catch (error) {
        logger.warn('  ⚠️ Enhanced 기능 초기화 실패, 기본 모드로 전환:', error.message);
        this.enableLLMEmbedding = false;
        this.enableMetaInfo = false;
      }
    } else {
      logger.info('  📦 기본 모드 (정규식 기반)');
    }
    
    logger.info('✅ Code Embedding Generator 초기화 완료');
  }

  /**
   * 가중치 설정 로드
   */
  async loadEmbeddingWeights() {
    try {
      const weightsPath = path.join(process.cwd(), 'config', 'embedding-weights.json');
      const content = await fs.readFile(weightsPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      logger.warn('  ⚠️ 가중치 설정 파일 없음, 기본값 사용');
      return this.getDefaultWeights();
    }
  }

  /**
   * 기본 가중치 반환
   */
  getDefaultWeights() {
    return {
      resource_management: { syntactic: 0.15, semantic: 0.60, framework: 0.15, context: 0.10 },
      security_vulnerability: { syntactic: 0.10, semantic: 0.50, framework: 0.30, context: 0.10 },
      performance_issue: { syntactic: 0.20, semantic: 0.40, framework: 0.25, context: 0.15 },
      exception_handling: { syntactic: 0.15, semantic: 0.55, framework: 0.20, context: 0.10 },
      code_quality: { syntactic: 0.20, semantic: 0.45, framework: 0.20, context: 0.15 },
      _default: { syntactic: 0.20, semantic: 0.50, framework: 0.20, context: 0.10 }
    };
  }

  /**
   * ========== 메인 메서드: 임베딩 생성 ==========
   * 
   * @param {string} code - Java 소스 코드
   * @param {Object} options - 옵션
   * @param {string} options.category - 카테고리 (resource_management 등)
   * @param {Object} options.metaInfo - 메타 정보 (선택적)
   * @returns {Object} 임베딩 결과
   */
  async generateEmbeddings(code, options = {}) {
    const category = options.category || 'resource_management';
    const metaInfo = options.metaInfo || {};
    const src = (typeof code === 'string' && code.trim().length > 0) ? code : '// no code';
    
    logger.info('  📊 임베딩 생성 시작...');
    logger.info(`     카테고리: ${category}`);
    logger.info(`     차원: ${this.totalDim} (${this.syntacticDim}+${this.semanticDim}+${this.frameworkDim}+${this.contextDim})`);
    
    let syntacticEmbedding, semanticEmbedding, frameworkEmbedding, contextEmbedding;
    
    try {
      // 1. 구문적 임베딩 (128차원) - 기존 방식 유지
      logger.info('  🔧 구문적 임베딩 (128차원)...');
      syntacticEmbedding = await this.embedAstStructure(src);
      this.validateEmbedding(syntacticEmbedding, 128, 'syntactic');
      logger.info('     ✅ 구문적 임베딩 완료');
      
      // 2. 의미론적 임베딩 (256차원) - LLM 또는 정규식
      logger.info('  🧠 의미론적 임베딩 (256차원)...');
      if (this.enableLLMEmbedding && this.llmClient) {
        semanticEmbedding = await this.embedCodeSemanticsWithLLM(src, category);
        logger.info('     ✅ 의미론적 임베딩 완료 (LLM)');
      } else {
        semanticEmbedding = await this.embedCodeSemantics(src);
        logger.info('     ✅ 의미론적 임베딩 완료 (Regex)');
      }
      this.validateEmbedding(semanticEmbedding, 256, 'semantic');
      
      // 3. 프레임워크 임베딩 (64차원) - 기존 방식 유지
      logger.info('  ⚙️ 프레임워크 임베딩 (64차원)...');
      frameworkEmbedding = await this.embedFrameworkUsage(src);
      this.validateEmbedding(frameworkEmbedding, 64, 'framework');
      logger.info('     ✅ 프레임워크 임베딩 완료');
      
      // 4. 비즈니스 임베딩 (32 or 64차원) - 메타 정보 통합
      logger.info(`  🏢 비즈니스 컨텍스트 임베딩 (${this.contextDim}차원)...`);
      if (this.enableMetaInfo && Object.keys(metaInfo).length > 0) {
        contextEmbedding = await this.embedBusinessContextWithMeta(src, metaInfo);
        logger.info('     ✅ 비즈니스 임베딩 완료 (메타 정보 포함)');
      } else {
        const base32 = await this.embedBusinessContext(src);
        // Enhanced 모드면 64차원으로 확장, 아니면 32차원 유지
        contextEmbedding = this.contextDim === 64 
          ? [...base32, ...new Array(32).fill(0)] 
          : base32;
        logger.info('     ✅ 비즈니스 임베딩 완료');
      }
      this.validateEmbedding(contextEmbedding, this.contextDim, 'context');
      
    } catch (error) {
      logger.error('  ❌ 임베딩 생성 실패:', error.message);
      throw error;
    }
    
    // 5. 임베딩 결합 (카테고리별 가중치 적용)
    logger.info(`  🔗 임베딩 결합 (${this.totalDim}차원)...`);
    const combinedEmbedding = this.combineEmbeddingsWithWeights(
      { syntactic: syntacticEmbedding, semantic: semanticEmbedding, 
        framework: frameworkEmbedding, context: contextEmbedding },
      category
    );
    
    if (!Array.isArray(combinedEmbedding) || combinedEmbedding.length !== this.totalDim) {
      throw new Error(`Invalid combined embedding: expected ${this.totalDim}, got ${combinedEmbedding?.length}`);
    }
    
    logger.info(`     ✅ 결합 완료: ${this.totalDim}차원`);
    
    // 임베딩 품질 평가
    const qualityScore = this.calculateEmbeddingQuality(combinedEmbedding);
    logger.info(`     품질 점수: ${qualityScore}/100`);
    
    if (qualityScore < (config.embedding?.minQualityScore || 50)) {
      logger.warn(`     ⚠️ 임베딩 품질 낮음: ${qualityScore}/100`);
    }
    
    // 6. AST 분석 정보
    logger.info('  🌳 AST 분석 정보 추출...');
    const astAnalysis = await this.extractASTAnalysis(src);
    
    return {
      combined_embedding: combinedEmbedding,
      component_embeddings: {
        syntactic_embedding: syntacticEmbedding,
        semantic_embedding: semanticEmbedding,
        framework_embedding: frameworkEmbedding,
        context_embedding: contextEmbedding
      },
      embedding_metadata: {
        embedding_version: this.enableLLMEmbedding ? 'v2.0-llm' : 'v1.0-regex',
        created_timestamp: new Date().toISOString(),
        model_version: 'CodeEmbedding-2.0.0',
        llm_model: this.enableLLMEmbedding ? this.llmClient?.model : null,
        dimensions: {
          syntactic: this.syntacticDim,
          semantic: this.semanticDim,
          framework: this.frameworkDim,
          context: this.contextDim,
          combined: this.totalDim
        },
        quality_metrics: {
          quality_score: qualityScore,
          non_zero_ratio: combinedEmbedding.filter(v => v !== 0).length / this.totalDim,
          vector_magnitude: Math.sqrt(combinedEmbedding.reduce((sum, v) => sum + v * v, 0)),
          min_value: Math.min(...combinedEmbedding),
          max_value: Math.max(...combinedEmbedding)
        },
        applied_weights: this.embeddingWeights?.[category] || this.embeddingWeights?.['_default'],
        category: category,
        meta_info_used: Object.keys(metaInfo).length > 0
      },
      ast_analysis: astAnalysis
    };
  }

  /**
   * 임베딩 검증
   */
  validateEmbedding(embedding, expectedDim, name) {
    if (!Array.isArray(embedding) || embedding.length !== expectedDim) {
      throw new Error(`Invalid ${name} embedding: expected ${expectedDim}, got ${embedding?.length}`);
    }
    if (embedding.some(v => !isFinite(v))) {
      throw new Error(`${name} embedding contains NaN or Infinity`);
    }
  }

  /**
   * ========== 1. 구문적 임베딩 (AST 기반) ==========
   */
  async embedAstStructure(codePattern) {
    const embedding = new Array(this.syntacticDim).fill(0);
    
    // AST 파싱 시도
    let astAnalysis = null;
    try {
      const result = this.astParser.parseJavaCode(codePattern);
      if (result.success) {
        astAnalysis = result.analysis;
      }
    } catch (error) {
      // AST 실패 시 정규식으로 폴백
    }
    
    if (astAnalysis) {
      // AST 기반 임베딩
      return this.astBasedStructuralEmbedding(astAnalysis, codePattern);
    } else {
      // 정규식 기반 폴백
      return this.regexBasedStructuralEmbedding(codePattern);
    }
  }

  astBasedStructuralEmbedding(astAnalysis, codePattern) {
    const embedding = new Array(this.syntacticDim).fill(0);
    let index = 0;
    
    // 0-15차원: 노드 타입 분포
    const nodeTypes = astAnalysis.nodeTypes || [];
    const nodeTypeCounts = {};
    for (const type of nodeTypes) {
      nodeTypeCounts[type] = (nodeTypeCounts[type] || 0) + 1;
    }
    
    const commonTypes = ['class', 'method', 'variable', 'if', 'for', 'while', 'try', 'catch'];
    commonTypes.forEach(type => {
      if (index < 16) {
        embedding[index++] = Math.min((nodeTypeCounts[type] || 0) / 10.0, 1.0);
      }
    });
    
    // 16-31차원: 복잡도 지표
    embedding[index++] = Math.min((astAnalysis.cyclomaticComplexity || 1) / 20.0, 1.0);
    embedding[index++] = Math.min((astAnalysis.maxDepth || 1) / 10.0, 1.0);
    embedding[index++] = Math.min((astAnalysis.methodDeclarations?.length || 0) / 10.0, 1.0);
    embedding[index++] = Math.min((astAnalysis.classDeclarations?.length || 0) / 5.0, 1.0);
    
    while (index < this.syntacticDim) embedding[index++] = 0;
    
    return embedding;
  }

  regexBasedStructuralEmbedding(codePattern) {
    const embedding = new Array(this.syntacticDim).fill(0);
    const nodeTypes = this.extractNodeTypes(codePattern);
    const complexity = this.calculateComplexity(codePattern);
    
    let index = 0;
    
    // 노드 타입 분포
    const typeCounts = {};
    for (const type of nodeTypes) {
      typeCounts[type] = (typeCounts[type] || 0) + 1;
    }
    
    const commonTypes = ['class', 'method', 'variable', 'if', 'for', 'while'];
    commonTypes.forEach(type => {
      if (index < 16) {
        embedding[index++] = Math.min((typeCounts[type] || 0) / 10.0, 1.0);
      }
    });
    
    // 복잡도 지표
    embedding[index++] = Math.min(complexity.lines / 100.0, 1.0);
    embedding[index++] = Math.min(complexity.depth / 10.0, 1.0);
    embedding[index++] = Math.min(complexity.branches / 20.0, 1.0);
    
    while (index < this.syntacticDim) embedding[index++] = 0;
    
    return embedding;
  }

  /**
   * ========== 2. 의미론적 임베딩 ==========
   */
  
  /**
   * 2-1. LLM 기반 의미론적 임베딩
   */
  async embedCodeSemanticsWithLLM(code, category) {
    // 캐시 확인
    const cacheKey = `${category}_${this.hashCode(code)}`;
    if (this.semanticAnalysisCache.has(cacheKey)) {
      logger.info('     💾 캐시된 분석 결과 사용');
      return this.semanticAnalysisCache.get(cacheKey);
    }
    
    try {
      // 개발가이드 컨텍스트 로드
      const guidelineContext = await this.guidelineLoader.getContextForCategory(category);
      
      // LLM 프롬프트 생성
      const prompt = this.buildSemanticAnalysisPrompt(code, guidelineContext);
      
      // LLM 호출
      logger.info('     🤖 LLM 분석 중...');
      const response = await this.llmClient.generateCompletion(prompt, {
        model: 'gpt-oss:120b',
        temperature: 0.1,
        max_tokens: 1500
      });
      
      // JSON 파싱
      const cleanedResponse = response.replace(/```json\n?|```\n?/g, '').trim();
      const analysis = JSON.parse(cleanedResponse);
      
      // 256차원 벡터로 변환
      const embedding = this.convertSemanticAnalysisToVector(analysis);
      
      // 캐시 저장
      this.semanticAnalysisCache.set(cacheKey, embedding);
      
      return embedding;
    } catch (error) {
      logger.warn(`     ⚠️ LLM 분석 실패, 정규식 기반으로 폴백: ${error.message}`);
      return await this.embedCodeSemantics(code);
    }
  }

  /**
   * LLM 프롬프트 생성
   */
  buildSemanticAnalysisPrompt(code, guidelineContext) {
    return `당신은 금융권 Java 코드 품질 전문가입니다.
다음 개발 가이드를 참고하여 코드를 분석하세요.

=== 개발 가이드 ===
${guidelineContext.text}

주요 규칙:
${guidelineContext.rules.map(r => `- ${r.title}: ${r.description}`).join('\n')}

=== 분석 대상 코드 ===
\`\`\`java
${code}
\`\`\`

=== 출력 형식 (JSON만) ===
{
  "resource_management": {
    "lifecycle_completeness": 0.0,
    "leak_risk_score": 0.0,
    "proper_cleanup": false,
    "resource_types": []
  },
  "security_patterns": {
    "sql_injection_risk": 0.0,
    "xss_risk": 0.0,
    "input_validation": 0.0,
    "sensitive_data_handling": 0.0
  },
  "performance_concerns": {
    "n_plus_one_risk": 0.0,
    "loop_complexity": 0.0,
    "caching_usage": 0.0,
    "batch_processing": false
  },
  "code_quality": {
    "error_handling": 0.0,
    "readability": 0.0,
    "maintainability": 0.0,
    "guideline_compliance": 0.0
  },
  "business_logic": {
    "domain_relevance": [],
    "operation_type": [],
    "transaction_handling": 0.0,
    "business_rule_validation": 0.0
  }
}`;
  }

  /**
   * LLM 분석 결과 → 256차원 벡터 변환
   */
  convertSemanticAnalysisToVector(analysis) {
    const vector = new Array(256).fill(0);
    let idx = 0;
    
    // Resource management: 0-63
    vector[idx++] = analysis.resource_management?.lifecycle_completeness || 0;
    vector[idx++] = analysis.resource_management?.leak_risk_score || 0;
    vector[idx++] = analysis.resource_management?.proper_cleanup ? 1.0 : 0.0;
    
    const resourceTypes = ['Connection', 'Statement', 'ResultSet', 'InputStream', 'OutputStream'];
    resourceTypes.forEach(type => {
      vector[idx++] = (analysis.resource_management?.resource_types || []).includes(type) ? 1.0 : 0.0;
    });
    while (idx < 64) vector[idx++] = 0;
    
    // Security: 64-127
    vector[idx++] = analysis.security_patterns?.sql_injection_risk || 0;
    vector[idx++] = analysis.security_patterns?.xss_risk || 0;
    vector[idx++] = analysis.security_patterns?.input_validation || 0;
    vector[idx++] = analysis.security_patterns?.sensitive_data_handling || 0;
    while (idx < 128) vector[idx++] = 0;
    
    // Performance: 128-191
    vector[idx++] = analysis.performance_concerns?.n_plus_one_risk || 0;
    vector[idx++] = analysis.performance_concerns?.loop_complexity || 0;
    vector[idx++] = analysis.performance_concerns?.caching_usage || 0;
    vector[idx++] = analysis.performance_concerns?.batch_processing ? 1.0 : 0.0;
    while (idx < 192) vector[idx++] = 0;
    
    // Code quality: 192-223
    vector[idx++] = analysis.code_quality?.error_handling || 0;
    vector[idx++] = analysis.code_quality?.readability || 0;
    vector[idx++] = analysis.code_quality?.maintainability || 0;
    vector[idx++] = analysis.code_quality?.guideline_compliance || 0;
    while (idx < 224) vector[idx++] = 0;
    
    // Business logic: 224-255
    const domains = ['user_management', 'financial', 'order_processing', 'content_management'];
    domains.forEach(domain => {
      vector[idx++] = (analysis.business_logic?.domain_relevance || []).includes(domain) ? 1.0 : 0.0;
    });
    
    const operations = ['create', 'read', 'update', 'delete'];
    operations.forEach(op => {
      vector[idx++] = (analysis.business_logic?.operation_type || []).includes(op) ? 1.0 : 0.0;
    });
    
    vector[idx++] = analysis.business_logic?.transaction_handling || 0;
    vector[idx++] = analysis.business_logic?.business_rule_validation || 0;
    while (idx < 256) vector[idx++] = 0;
    
    return vector;
  }

  /**
   * 2-2. 정규식 기반 의미론적 임베딩 (기존 방식)
   */
  async embedCodeSemantics(codePattern) {
    try {
      const astResult = this.astParser.parseJavaCode(codePattern);
      if (astResult.success && astResult.analysis) {
        return this.astBasedSemanticEmbedding(astResult.analysis, codePattern);
      }
    } catch (error) {
      // AST 실패 시 정규식으로 폴백
    }
    return this.regexBasedSemanticEmbedding(codePattern);
  }

  astBasedSemanticEmbedding(astAnalysis, codePattern) {
    const embedding = new Array(this.semanticDim).fill(0);
    let index = 0;
    
    // CRUD 패턴
    const crudPatterns = this.analyzeCrudPatterns(astAnalysis.methodDeclarations || []);
    Object.values(crudPatterns).forEach(score => {
      if (index < 8) embedding[index++] = score;
    });
    
    // 리소스 관리
    embedding[index++] = Math.min((astAnalysis.resourceLifecycles?.length || 0) / 5.0, 1.0);
    embedding[index++] = Math.min((astAnalysis.resourceLeakRisks?.length || 0) / 3.0, 1.0);
    
    // 보안
    embedding[index++] = Math.min((astAnalysis.securityPatterns?.length || 0) / 3.0, 1.0);
    
    // 성능
    embedding[index++] = Math.min((astAnalysis.performanceIssues?.length || 0) / 3.0, 1.0);
    
    while (index < this.semanticDim) embedding[index++] = 0;
    
    return embedding;
  }

  regexBasedSemanticEmbedding(codePattern) {
    const embedding = new Array(this.semanticDim).fill(0);
    const codeLower = codePattern.toLowerCase();
    let index = 0;
    
    // CRUD 패턴
    const crudKeywords = {
      create: ['insert', 'create', 'add', 'new'],
      read: ['select', 'get', 'find', 'query'],
      update: ['update', 'set', 'modify', 'change'],
      delete: ['delete', 'remove', 'drop']
    };
    
    Object.entries(crudKeywords).forEach(([operation, keywords]) => {
      if (index < 8) {
        const score = keywords.reduce((sum, kw) => sum + (codeLower.includes(kw) ? 1 : 0), 0);
        embedding[index++] = Math.min(score / keywords.length, 1.0);
      }
    });
    
    // 위험 패턴
    const riskPatterns = this.detectSemanticPatterns(codePattern);
    Object.values(riskPatterns).forEach((score, i) => {
      if (index < this.semanticDim) {
        embedding[index++] = score;
      }
    });
    
    while (index < this.semanticDim) embedding[index++] = 0;
    
    return embedding;
  }

  /**
   * ========== 3. 프레임워크 임베딩 (기존 방식 유지) ==========
   */
  async embedFrameworkUsage(codePattern) {
    const embedding = new Array(this.frameworkDim).fill(0);
    const codeLower = codePattern.toLowerCase();
    let index = 0;
    
    // Spring 어노테이션
    const springAnnotations = [
      '@component', '@service', '@repository', '@controller',
      '@autowired', '@transactional', '@requestmapping', '@getmapping'
    ];
    springAnnotations.forEach((annotation) => {
      if (index < 16) {
        embedding[index++] = codeLower.includes(annotation) ? 1.0 : 0.0;
      }
    });
    
    // JPA 어노테이션
    const jpaAnnotations = ['@entity', '@table', '@column', '@id', '@generatedvalue'];
    jpaAnnotations.forEach((annotation) => {
      if (index < 32) {
        embedding[index++] = codeLower.includes(annotation) ? 1.0 : 0.0;
      }
    });
    
    // 커스텀 프레임워크
    const customPatterns = ['@databasetransaction', '@businesslogic', '@cacheenabled'];
    customPatterns.forEach((pattern) => {
      if (index < this.frameworkDim) {
        embedding[index++] = codeLower.includes(pattern) ? 1.0 : 0.0;
      }
    });
    
    while (index < this.frameworkDim) embedding[index++] = 0;
    
    return embedding;
  }

  /**
   * ========== 4. 비즈니스 컨텍스트 임베딩 ==========
   */
  
  /**
   * 4-1. 메타 정보 포함 (64차원)
   */
  async embedBusinessContextWithMeta(code, metaInfo) {
    const embedding = new Array(64).fill(0);
    
    // 0-31: 기존 비즈니스 도메인
    const domainEmbedding = await this.embedBusinessContext(code);
    embedding.splice(0, 32, ...domainEmbedding);
    
    // 32-63: 메타 정보 기반
    try {
      const metaAnalysis = await this.analyzeMetaInfo(metaInfo);
      embedding[32] = metaAnalysis.business_criticality || 0;
      embedding[33] = metaAnalysis.compliance_sensitivity || 0;
      embedding[34] = metaAnalysis.team_expertise_level || 0;
      embedding[35] = metaAnalysis.framework_maturity || 0;
      embedding[36] = metaAnalysis.production_readiness || 0;
    } catch (error) {
      logger.warn('     ⚠️ 메타 정보 분석 실패');
    }
    
    return embedding;
  }

  async analyzeMetaInfo(metaInfo) {
    if (!this.llmClient) {
      // LLM 없으면 간단한 규칙 기반
      return {
        business_criticality: metaInfo.business_criticality || 0.5,
        compliance_sensitivity: metaInfo.compliance_level === 'HIGH' ? 0.9 : 0.5,
        team_expertise_level: 0.7,
        framework_maturity: 0.8,
        production_readiness: metaInfo.production_status === 'production' ? 1.0 : 0.5
      };
    }
    
    const prompt = `메타 정보 평가 (0.0~1.0, JSON만):
프로젝트: ${metaInfo.project_name || 'N/A'}
모듈: ${metaInfo.module_name || 'N/A'}
팀: ${metaInfo.developer_team || 'N/A'}
규제: ${metaInfo.compliance_level || 'N/A'}

{"business_criticality": 0.0, "compliance_sensitivity": 0.0, "team_expertise_level": 0.0, "framework_maturity": 0.0, "production_readiness": 0.0}`;

    const response = await this.llmClient.generateCompletion(prompt, {
      model: 'gpt-oss:120b',
      temperature: 0.1,
      max_tokens: 200
    });
    
    const cleaned = response.replace(/```json\n?|```\n?/g, '').trim();
    return JSON.parse(cleaned);
  }

  /**
   * 4-2. 기본 비즈니스 임베딩 (32차원)
   */
  async embedBusinessContext(codePattern) {
    const embedding = new Array(32).fill(0);
    const codeLower = codePattern.toLowerCase();
    
    // 비즈니스 도메인
    const businessDomains = {
      user_management: ['user', 'account', 'profile', 'authentication', 'login'],
      financial: ['payment', 'transaction', 'money', 'balance', 'transfer'],
      order_processing: ['order', 'cart', 'checkout', 'shipping', 'product'],
      content_management: ['article', 'post', 'comment', 'publish', 'content']
    };
    
    let index = 0;
    Object.entries(businessDomains).forEach(([domain, keywords]) => {
      if (index < 8) {
        const score = keywords.reduce((sum, kw) => sum + (codeLower.includes(kw) ? 1 : 0), 0);
        embedding[index++] = Math.min(score / keywords.length, 1.0);
      }
    });
    
    // 복잡도 키워드
    const complexityKeywords = ['validate', 'process', 'calculate', 'transform'];
    complexityKeywords.forEach((kw) => {
      if (index < 32) {
        embedding[index++] = codeLower.includes(kw) ? 1.0 : 0.0;
      }
    });
    
    while (index < 32) embedding[index++] = 0;
    
    return embedding;
  }

  /**
   * ========== 5. 임베딩 결합 (가중치 적용) ==========
   */
  combineEmbeddingsWithWeights(embeddings, category) {
    const weights = this.embeddingWeights?.[category] || 
                    this.embeddingWeights?.['_default'] || 
                    { syntactic: 0.20, semantic: 0.50, framework: 0.20, context: 0.10 };
    
    // 가중치 적용
    const weighted = [
      ...embeddings.syntactic.map(v => v * weights.syntactic),
      ...embeddings.semantic.map(v => v * weights.semantic),
      ...embeddings.framework.map(v => v * weights.framework),
      ...embeddings.context.map(v => v * weights.context)
    ];
    
    // L2 정규화
    const norm = Math.sqrt(weighted.reduce((sum, v) => sum + v * v, 0));
    return norm > 0 ? weighted.map(v => v / norm) : weighted;
  }

  combineEmbeddings(embeddings) {
    // 기존 메서드 (가중치 없음) - 하위 호환성 유지
    const combined = [
      ...embeddings.syntactic,
      ...embeddings.semantic,
      ...embeddings.framework,
      ...embeddings.context
    ];
    
    const norm = Math.sqrt(combined.reduce((sum, v) => sum + v * v, 0));
    return norm > 0 ? combined.map(v => v / norm) : combined;
  }

  /**
   * ========== 6. 임베딩 품질 평가 ==========
   */
  calculateEmbeddingQuality(embedding) {
    const nonZeroCount = embedding.filter(v => v !== 0).length;
    const nonZeroRatio = nonZeroCount / embedding.length;
    
    const variance = this.calculateVariance(embedding);
    const magnitude = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
    
    // 품질 점수: 0이 아닌 값 비율(40%) + 분산(30%) + 크기(30%)
    const qualityScore = (
      nonZeroRatio * 40 +
      Math.min(variance, 1.0) * 30 +
      Math.min(magnitude, 1.0) * 30
    );
    
    return Math.round(qualityScore);
  }

  calculateVariance(arr) {
    const mean = arr.reduce((sum, v) => sum + v, 0) / arr.length;
    const variance = arr.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / arr.length;
    return variance;
  }

  /**
   * ========== 유틸리티 메서드 ==========
   */
  
  extractNodeTypes(code) {
    const nodeTypes = [];
    const patterns = {
      'class': /class\s+\w+/g,
      'method': /\w+\s*\([^)]*\)\s*\{/g,
      'variable': /\w+\s+\w+\s*=/g,
      'if': /if\s*\(/g,
      'for': /for\s*\(/g,
      'while': /while\s*\(/g
    };
    
    Object.entries(patterns).forEach(([type, pattern]) => {
      const matches = code.match(pattern) || [];
      for (let i = 0; i < matches.length; i++) {
        nodeTypes.push(type);
      }
    });
    
    return nodeTypes;
  }

  calculateComplexity(code) {
    const lines = code.split('\n').length;
    const depth = this.calculateNestingDepth(code);
    const branches = (code.match(/if|for|while|switch/g) || []).length;
    return { lines, depth, branches };
  }

  calculateNestingDepth(code) {
    let maxDepth = 0;
    let currentDepth = 0;
    for (const char of code) {
      if (char === '{') {
        currentDepth++;
        maxDepth = Math.max(maxDepth, currentDepth);
      } else if (char === '}') {
        currentDepth--;
      }
    }
    return maxDepth;
  }

  detectSemanticPatterns(code) {
    const patterns = {};
    const codeLower = code.toLowerCase();
    
    if (codeLower.includes('getconnection') && !codeLower.includes('close')) {
      patterns.resource_leak_risk = 0.8;
    }
    if (codeLower.includes('executequery') && code.includes('+')) {
      patterns.sql_injection_risk = 0.9;
    }
    if ((codeLower.includes('for') || codeLower.includes('while')) && codeLower.includes('query')) {
      patterns.n_plus_one_risk = 0.7;
    }
    
    return patterns;
  }

  analyzeCrudPatterns(methodDeclarations) {
    const patterns = { create: 0, read: 0, update: 0, delete: 0 };
    
    for (const method of methodDeclarations) {
      const name = (method.name || '').toLowerCase();
      if (name.includes('insert') || name.includes('create') || name.includes('add')) {
        patterns.create = Math.min(patterns.create + 0.3, 1.0);
      }
      if (name.includes('select') || name.includes('get') || name.includes('find')) {
        patterns.read = Math.min(patterns.read + 0.3, 1.0);
      }
      if (name.includes('update') || name.includes('set') || name.includes('modify')) {
        patterns.update = Math.min(patterns.update + 0.3, 1.0);
      }
      if (name.includes('delete') || name.includes('remove')) {
        patterns.delete = Math.min(patterns.delete + 0.3, 1.0);
      }
    }
    
    return patterns;
  }

  hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  async extractASTAnalysis(code) {
    try {
      const astResult = this.astParser?.parseJavaCode(code);
      if (astResult?.success && astResult.analysis) {
        const signature = this.astParser.generateASTSignature(astResult.analysis);
        return {
          success: true,
          nodeTypes: astResult.analysis.nodeTypes || [],
          cyclomaticComplexity: astResult.analysis.cyclomaticComplexity ?? 1,
          maxDepth: astResult.analysis.maxDepth ?? 1,
          signature: JSON.stringify(signature || {}),
          resourceLeakRisks: astResult.analysis.resourceLeakRisks || [],
          securityPatterns: astResult.analysis.securityPatterns || [],
          performanceIssues: astResult.analysis.performanceIssues || [],
          methodDeclarations: astResult.analysis.methodDeclarations || [],
          classDeclarations: astResult.analysis.classDeclarations || []
        };
      }
    } catch (error) {
      logger.warn('     ⚠️ AST 분석 오류:', error.message);
    }
    
    return {
      success: false,
      nodeTypes: [],
      cyclomaticComplexity: 1,
      maxDepth: 1,
      signature: '',
      resourceLeakRisks: [],
      securityPatterns: [],
      performanceIssues: [],
      methodDeclarations: [],
      classDeclarations: []
    };
  }
}