/**
 * 패턴 데이터셋 생성기 (PatternDatasetGenerator)
 * 
 * 이슈 코드를 분석하여 VectorDB 저장용 패턴 데이터셋 생성
 * 
 * @module PatternDatasetGenerator
 * @requires CodeEmbeddingGenerator - 코드 임베딩 생성
 * @requires LLMClient - vLLM 기반 패턴 분석
 * @requires VectorClient - Qdrant/Weaviate 저장
 */
import { v4 as uuidv4 } from 'uuid';
import { CodeEmbeddingGenerator } from '../embeddings/codeEmbedding.js';
import { LLMClient } from '../clients/llmClient.js';
import { VectorClient } from '../clients/vectorClient.js';
import { config } from '../config.js';
import logger from '../utils/loggerUtils.js';

export class PatternDatasetGenerator {
  constructor() {
    this.llmClient = new LLMClient();
    this.vectorClient = new VectorClient();
    this.embeddingGenerator = new CodeEmbeddingGenerator();
    this.existingPatterns = [];
  }

  async initialize() {
    logger.info('🚀 패턴 생성기 초기화 중...');

    // LLM과 Vector DB 서버 연결 상태 확인
    const llmConnected = await this.llmClient.checkConnection();
    const vectorConnected = await this.vectorClient.checkConnection();

    if (!llmConnected || !vectorConnected) {
      throw new Error('서비스 연결 실패');
    }

    // Vector DB 스키마/컬렉션이 없으면 생성
    await this.vectorClient.initializeSchema();

    // ===== 🆕 추가: 임베딩 생성기 초기화 =====
    await this.embeddingGenerator.initialize();

    // 유사도 비교를 위해 Vector DB에 저장된 기존 패턴들을 로드
    await this.loadExistingPatterns();

    logger.info('✅ 패턴 생성기 초기화 완료');
  }

  async generatePatternDataset(issueData) {
    logger.info(`🔍 이슈 처리 시작: ${issueData.issueId}`);

    try {
      // Step 1: LLM을 사용하여 안티패턴과 권장패턴의 기본 구조 생성
      logger.info('🔎 Step 1: 기본 패턴 생성');
      const basicPattern = await this.generateBasicPatternWithLLM(issueData);

      // Step 2: 코드에서 프레임워크 관련 어노테이션과 커스텀 클래스 추출 후 LLM으로 분석
      logger.info('⚙️ Step 2: 프레임워크 컨텍스트 분석');
      const frameworkContext = await this.extractAndAnalyzeFrameworkContext(issueData);

      // Step 3: 기존 패턴들과 유사도를 계산하여 관련 패턴 목록 생성
      logger.info('🔗 Step 3: 관련 패턴 분석');
      const relatedPatterns = await this.analyzeRelatedPatterns(basicPattern, issueData);

      // Step 4: 구문적, 의미론적, 프레임워크, 비즈니스 컨텍스트 임베딩 벡터 생성 및 결합
      logger.info('🧮 Step 4: 임베딩 벡터 생성');
      const embeddings = await this.generateEmbeddings(issueData.problematicCode, basicPattern);

      // Step 5: LLM 생성 정보, 임베딩, 프레임워크 컨텍스트 등을 하나의 데이터셋으로 병합
      logger.info('✅ Step 5: 최종 데이터셋 조합');
      const finalDataset = this.combineFinalDataset(
        issueData, basicPattern, frameworkContext, relatedPatterns, embeddings
      );

      // Step 6: 필수 필드 존재 여부 검증 및 품질 점수 계산
      logger.info('💾 Step 6: 검증 및 저장');
      const validatedDataset = this.validateAndEnhanceDataset(finalDataset);

      // 완성된 패턴 데이터를 Vector DB에 저장 (Weaviate 또는 Qdrant)
      await this.vectorClient.storePattern(validatedDataset);

      logger.info(`✨ 완성: ${validatedDataset.issue_record_id}`);
      return validatedDataset;

    } catch (error) {
      logger.error(`❌ 패턴 생성 실패 (${issueData.issueId}):`, error.message);
      throw error;
    }
  }

  async generateBasicPatternWithLLM(issueData) {
    try {
      const basicPattern = await this.llmClient.generateBasicPattern(issueData);
      logger.info('  ✅ LLM 기본 패턴 생성 완료');
      return basicPattern;
    } catch (error) {
      console.warn('  ⚠️ LLM 기본 패턴 생성 실패, 폴백 사용');
      return this.createFallbackPattern(issueData);
    }
  }

  async extractAndAnalyzeFrameworkContext(issueData) {
    const detectedAnnotations = this.extractAnnotations(issueData.problematicCode);
    const detectedClasses = this.extractCustomClasses(issueData.problematicCode);

    try {
      const frameworkAnalysis = await this.llmClient.generateFrameworkAnalysis(
        issueData, detectedAnnotations, detectedClasses
      );
      logger.info('  ✅ 프레임워크 분석 완료');
      return frameworkAnalysis;
    } catch (error) {
      console.warn('  ⚠️ 프레임워크 분석 실패, 폴백 사용');
      return this.createFallbackFrameworkContext(detectedAnnotations, detectedClasses);
    }
  }

  async analyzeRelatedPatterns(basicPattern, issueData) {
    const relatedPatterns = [];
    const currentCategory = basicPattern.metadata?.category || '';

    for (const existingPattern of this.existingPatterns) {
      const similarity = this.calculatePatternSimilarity(basicPattern, existingPattern);

      if (similarity > 0.6) {
        const relationshipType = this.determineRelationshipType(basicPattern, existingPattern, similarity);

        relatedPatterns.push({
          pattern_id: existingPattern.issueRecordId,
          relationship_type: relationshipType,
          similarity_score: Math.round(similarity * 100) / 100
        });
      }
    }

    logger.info(`  ✅ 관련 패턴 분석 완료: ${relatedPatterns.length}개 발견`);
    return relatedPatterns.slice(0, 5);
  }

  // ===== 🆕 변경: generateEmbeddings() 메서드 =====
  async generateEmbeddings(code, patternInfo) {
    const src = (typeof code === 'string' && code.trim().length > 0) ? code : '// no code';

    logger.info('  📊 임베딩 생성 시작...');

    // ===== 🆕 변경: options로 category와 metaInfo 전달 =====
    const options = {
      category: patternInfo.category || patternInfo.metadata?.category || 'resource_management',
      metaInfo: patternInfo.metaInfo || {}
    };

    // CodeEmbeddingGenerator가 내부에서 Enhanced 모드 여부를 판단
    const embeddings = await this.embeddingGenerator.generateEmbeddings(src, options);

    // 품질 점수 확인
    const qualityScore = embeddings.embedding_metadata?.quality_metrics?.quality_score || 0;
    const minQualityScore = config.embedding?.minQualityScore || 50;

    if (qualityScore < minQualityScore) {
      logger.warn(`     ⚠️ 임베딩 품질 낮음: ${qualityScore}/100 (최소: ${minQualityScore})`);
    }

    return embeddings;
  }

  async extractASTAnalysis(code) {
    try {
      const astResult = this.embeddingGenerator?.astParser?.parseJavaCode(code);
      if (astResult?.success && astResult.analysis) {
        const signature = this.embeddingGenerator.astParser.generateASTSignature(astResult.analysis);
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
      console.warn('     ⚠️ AST 분석 오류:', error.message);
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

  combineFinalDataset(issueData, basicPattern, frameworkContext, relatedPatterns, embeddings) {
    const categoryPrefix = this.getCategoryPrefix(basicPattern.metadata?.category || '');
    const recordId = this.generateRecordId(categoryPrefix);

    return {
      issue_record_id: recordId,
      ...basicPattern,
      embeddings,
      related_patterns: relatedPatterns,
      ...frameworkContext,
      metadata: {
        ...basicPattern.metadata,
        created_date: issueData.createdDate || new Date().toISOString(),
        last_updated: new Date().toISOString()
      },
      validation_info: {
        reviewed_by: 'system_generated',
        review_date: new Date().toISOString().split('T')[0],
        validation_status: 'DRAFT',
        quality_score: this.calculateInitialQualityScore(basicPattern, issueData)
      }
    };
  }

  validateAndEnhanceDataset(dataset) {
    const requiredFields = [
      'issue_record_id', 'metadata', 'anti_pattern',
      'recommended_pattern', 'impact_analysis', 'embeddings'
    ];

    for (const field of requiredFields) {
      if (!dataset[field]) {
        console.warn(`⚠️ 필수 필드 누락: ${field}`);
        dataset[field] = this.createDefaultField(field);
      }
    }

    const qualityScore = this.calculateFinalQualityScore(dataset);
    dataset.validation_info.quality_score = qualityScore;

    logger.info(`  📊 최종 품질 점수: ${qualityScore.toFixed(2)}`);

    return dataset;
  }

  // === 헬퍼 메서드들 ===

  extractAnnotations(code) {
    const annotationPattern = /@([A-Za-z][A-Za-z0-9_]*)/g;
    const matches = code.match(annotationPattern) || [];
    return [...new Set(matches)];
  }

  extractCustomClasses(code) {
    const patterns = [
      /extends\s+([A-Z][A-Za-z0-9_]*)/g,
      /implements\s+([A-Z][A-Za-z0-9_]*)/g,
      /(?:new|instanceof)\s+([A-Z][A-Za-z0-9_]*)/g
    ];

    const classes = new Set();
    for (const pattern of patterns) {
      const matches = code.matchAll(pattern);
      for (const match of matches) {
        if (match[1] && !this.isJavaStandardClass(match[1])) {
          classes.add(match[1]);
        }
      }
    }

    return Array.from(classes);
  }

  isJavaStandardClass(className) {
    const javaStandardPackages = ['String', 'Integer', 'Long', 'Double', 'Float', 'Boolean', 'Object', 'List', 'Map', 'Set', 'Collection', 'Exception'];
    return javaStandardPackages.includes(className);
  }

  calculatePatternSimilarity(pattern1, pattern2) {
    let score = 0;

    if (pattern1.metadata?.category === pattern2.metadata?.category) {
      score += 0.5;
    }

    const keywords1 = new Set(pattern1.metadata?.keywords || []);
    const keywords2 = new Set(pattern2.metadata?.keywords || []);
    const intersection = new Set([...keywords1].filter(x => keywords2.has(x)));
    const union = new Set([...keywords1, ...keywords2]);

    if (union.size > 0) {
      score += (intersection.size / union.size) * 0.3;
    }

    if (pattern1.metadata?.severity === pattern2.metadata?.severity) {
      score += 0.2;
    }

    return Math.min(score, 1.0);
  }

  determineRelationshipType(currentPattern, existingPattern, similarity) {
    if (similarity > 0.9) return 'duplicate';
    if (currentPattern.metadata?.category === existingPattern.metadata?.category) return 'similar_category';
    if (similarity > 0.75) return 'related';
    return 'loosely_related';
  }

  getCategoryPrefix(category) {
    const prefixMap = {
      'resource_management': 'RESOURCE',
      'security_vulnerability': 'SECURITY',
      'performance_issue': 'PERFORMANCE',
      'exception_handling': 'EXCEPTION',
      'code_quality': 'QUALITY'
    };
    return prefixMap[category] || 'GENERAL';
  }

  generateRecordId(prefix) {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `${prefix}_${timestamp}_${random}`;
  }

  calculateInitialQualityScore(basicPattern, issueData) {
    let score = 0;

    if (basicPattern.metadata?.title) score += 0.1;
    if (basicPattern.anti_pattern?.code_template) score += 0.1;
    if (basicPattern.recommended_pattern?.code_template) score += 0.1;
    if (basicPattern.impact_analysis) score += 0.1;
    if (issueData.problematicCode) score += 0.1;

    return Math.min(score, 1.0);
  }

  calculateFinalQualityScore(dataset) {
    let score = 0;

    if (dataset.metadata?.title) score += 0.1;
    if (dataset.anti_pattern?.code_template) score += 0.1;
    if (dataset.recommended_pattern?.code_template) score += 0.1;
    if (dataset.embeddings?.combined_embedding) score += 0.2;
    if (dataset.framework_context) score += 0.1;
    if (dataset.impact_analysis) score += 0.1;
    if (dataset.detection_rules) score += 0.1;
    if (dataset.related_patterns) score += 0.1;
    if (dataset.validation_info) score += 0.05;
    if (dataset.issue_record_id) score += 0.05;

    return Math.min(score, 1.0);
  }

  createDefaultField(field) {
    const defaults = {
      'issue_record_id': `UNKNOWN_${Date.now()}`,
      'metadata': { title: 'Unknown Pattern', category: 'code_quality' },
      'anti_pattern': { code_template: '// No template available' },
      'recommended_pattern': { code_template: '// No recommendation available' },
      'impact_analysis': { description: 'Not analyzed' },
      'embeddings': { combined_embedding: new Array(480).fill(0) }
    };
    return defaults[field] || {};
  }

  createFallbackPattern(issueData) {
    return {
      metadata: {
        title: issueData.title || 'Untitled Pattern',
        category: 'code_quality',
        severity: 'MEDIUM',
        keywords: []
      },
      anti_pattern: {
        code_template: issueData.problematicCode || '// No code',
        pattern_signature: {
          semantic_signature: [],
          regex_patterns: []
        }
      },
      recommended_pattern: {
        code_template: '// Recommendation not available',
        pattern_name: 'fallback_pattern'
      },
      impact_analysis: {
        description: 'Analysis not available - fallback pattern'
      }
    };
  }

  createFallbackFrameworkContext(annotations, classes) {
    return {
      framework_context: {
        detected_frameworks: [],
        detected_annotations: annotations,
        detected_custom_classes: classes,
        applicable_components: []
      },
      detection_rules: {
        keyword_indicators: [],
        structural_patterns: []
      }
    };
  }

  async loadExistingPatterns() {
    try {
      this.existingPatterns = await this.vectorClient.getAllPatterns();
      logger.info(`  📦 기존 패턴 로드: ${this.existingPatterns.length}개`);
    } catch (error) {
      console.warn('  ⚠️ 기존 패턴 로드 실패');
      this.existingPatterns = [];
    }
  }
}