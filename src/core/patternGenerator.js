/**
 * 패턴 데이터셋 생성기 (PatternDatasetGenerator)
 * 
 * 이슈 코드를 분석하여 VectorDB 저장용 패턴 데이터셋 생성
 * - 안티패턴 + 권장패턴 쌍 생성
 * - 다차원 임베딩 벡터 생성 (480차원)
 * - 프레임워크 컨텍스트 분석
 * - 관련 패턴 유사도 계산
 * 
 * 패턴 생성 프로세스 (6단계):
 * 1. generateBasicPatternWithLLM() → LLM으로 기본 패턴 생성
 *    - anti_pattern: 문제 있는 코드 템플릿
 *    - recommended_pattern: 권장 코드 템플릿
 *    - impact_analysis: 영향 분석
 * 
 * 2. extractAndAnalyzeFrameworkContext() → 프레임워크 분석
 *    - extractAnnotations() → @Annotation 추출
 *    - extractCustomClasses() → 커스텀 클래스 추출
 *    - LLMClient.generateFrameworkAnalysis() → 탐지 규칙 생성
 * 
 * 3. analyzeRelatedPatterns() → 기존 패턴과 유사도 계산
 *    - calculatePatternSimilarity() → 카테고리 기반 유사도
 *    - determineRelationshipType() → 관계 타입 결정
 * 
 * 4. generateEmbeddings() → 480차원 임베딩 생성
 *    - embedAstStructure() → 구문적 임베딩 (128차원)
 *    - embedCodeSemantics() → 의미론적 임베딩 (256차원)
 *    - embedFrameworkUsage() → 프레임워크 임베딩 (64차원)
 *    - embedBusinessContext() → 비즈니스 임베딩 (32차원)
 *    - combineEmbeddings() → 480차원 통합
 * 
 * 5. combineFinalDataset() → 최종 데이터셋 조합
 *    - issue_record_id 생성 (CATEGORY_timestamp_random)
 *    - metadata, anti_pattern, recommended_pattern 병합
 *    - framework_context, related_patterns, embeddings 추가
 * 
 * 6. validateAndEnhanceDataset() → 검증 및 품질 점수 계산
 *    - 필수 필드 검증
 *    - 품질 점수 계산 (0.0 ~ 1.0)
 *    - VectorClient.storePattern() → VectorDB 저장
 * 
 * 임베딩 벡터 구조 (480차원):
 * - syntactic_embedding: 128차원 (AST 구조)
 * - semantic_embedding: 256차원 (코드 의미)
 * - framework_embedding: 64차원 (프레임워크 사용)
 * - context_embedding: 32차원 (비즈니스 컨텍스트)
 * 
 * 품질 점수 기준:
 * - metadata.title 존재: +0.1
 * - anti_pattern.code_template 존재: +0.1
 * - recommended_pattern.code_template 존재: +0.1
 * - embeddings.combined_embedding 존재: +0.2
 * - framework_context 존재: +0.1
 * - impact_analysis 존재: +0.1
 * - detection_rules 존재: +0.1
 * - related_patterns 존재: +0.1
 * - validation_status 존재: +0.05
 * - issue_record_id 존재: +0.05
 * → 최대 1.0
 * 
 * @module PatternDatasetGenerator
 * @requires CodeEmbeddingGenerator - 코드 임베딩 생성
 * @requires LLMClient - vLLM 기반 패턴 분석
 * @requires VectorClient - Qdrant/Weaviate 저장
 * 
 * # TODO: Node.js → Python 변환 (FastAPI + Pydantic)
 * # TODO: uuid → Python uuid4
 * # TODO: CodeEmbeddingGenerator → Python 임베딩 생성기
 * # TODO: LLMClient → vLLM Python SDK
 * # NOTE: 임베딩 차원 검증 필수 (128+256+64+32=480)
 * # NOTE: NaN, Infinity 체크 필수 (벡터 품질 보장)
 * # PERFORMANCE: 임베딩 생성 병렬화 (asyncio.gather)
 * # PERFORMANCE: 대량 패턴 저장 시 배치 upsert
 */
import { v4 as uuidv4 } from 'uuid';
import { CodeEmbeddingGenerator } from '../embeddings/codeEmbedding.js';
import { LLMClient } from '../clients/llmClient.js';
import { VectorClient } from '../clients/vectorClient.js';
import logger from '../utils/loggerUtils.js';

/**
 * 패턴 데이터셋 생성기 클래스
 * 
 * 내부 구조:
 * - llmClient: LLMClient 인스턴스 (패턴 분석)
 * - vectorClient: VectorClient 인스턴스 (VectorDB 저장)
 * - embeddingGenerator: CodeEmbeddingGenerator 인스턴스 (임베딩 생성)
 * - existingPatterns: Array - 기존 패턴 목록 (유사도 비교용)
 * 
 * 생명주기:
 * 1. new PatternDatasetGenerator()
 * 2. await initialize() - LLM/VectorDB 연결 및 기존 패턴 로드
 * 3. await generatePatternDataset(issueData) - 패턴 생성 및 저장
 * 
 * @class
 * 
 * # TODO: Python 클래스 변환 시 타입 힌팅 추가
 * # PERFORMANCE: existingPatterns 캐싱 (1시간 TTL)
 */
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

    // 유사도 비교를 위해 Vector DB에 저장된 기존 패턴들을 로드
    await this.loadExistingPatterns();

    logger.info('✅ 초기화 완료');
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
      // LLM에 이슈 데이터를 전달하여 안티패턴, 권장패턴, 영향 분석 등을 생성
      const basicPattern = await this.llmClient.generateBasicPattern(issueData);
      logger.info('  ✅ LLM 기본 패턴 생성 완료');
      return basicPattern;
    } catch (error) {
      // LLM 호출 실패 시 최소한의 정보로 폴백 패턴 생성
      console.warn('  ⚠️ LLM 기본 패턴 생성 실패, 폴백 사용');
      return this.createFallbackPattern(issueData);
    }
  }

  async extractAndAnalyzeFrameworkContext(issueData) {
    // 정규식을 사용하여 코드에서 어노테이션(@Annotation)과 커스텀 클래스 추출
    const detectedAnnotations = this.extractAnnotations(issueData.problematicCode);
    const detectedClasses = this.extractCustomClasses(issueData.problematicCode);

    try {
      // 추출된 프레임워크 요소를 LLM에 전달하여 탐지 규칙과 적용 가능한 컴포넌트 분석
      const frameworkAnalysis = await this.llmClient.generateFrameworkAnalysis(
        issueData, detectedAnnotations, detectedClasses
      );
      logger.info('  ✅ 프레임워크 분석 완료');
      return frameworkAnalysis;
    } catch (error) {
      // LLM 분석 실패 시 추출된 정보만으로 기본 컨텍스트 생성
      console.warn('  ⚠️ 프레임워크 분석 실패, 폴백 사용');
      return this.createFallbackFrameworkContext(detectedAnnotations, detectedClasses);
    }
  }

  async analyzeRelatedPatterns(basicPattern, issueData) {
    const relatedPatterns = [];
    const currentCategory = basicPattern.metadata?.category || '';

    // 기존 패턴들과 현재 패턴의 카테고리 및 특성을 비교하여 유사도 계산
    for (const existingPattern of this.existingPatterns) {
      const similarity = this.calculatePatternSimilarity(basicPattern, existingPattern);

      // 유사도가 0.6 이상인 패턴들만 관련 패턴으로 선정
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
    // 유사도가 높은 상위 5개만 반환
    return relatedPatterns.slice(0, 5);
  }

  async generateEmbeddings(code, patternInfo) {
    // 빈 코드가 입력되는 경우를 방지하여 기본값 설정
    const src = (typeof code === 'string' && code.trim().length > 0) ? code : '// no code';

    logger.info('  📊 임베딩 생성 시작...');
    logger.info('     구조: 구문(128) + 의미(256) + 프레임워크(64) + 비즈니스(32) = 480차원');
    
    // 각 임베딩 생성
    let syntacticEmbedding = [];
    let semanticEmbedding = [];
    let frameworkEmbedding = [];
    let contextEmbedding = [];
    
    try {
      logger.info('  🔧 구문적 임베딩 (128차원)...');
      syntacticEmbedding = await this.embeddingGenerator.embedAstStructure(src);
      if (!Array.isArray(syntacticEmbedding) || syntacticEmbedding.length !== 128) {
        throw new Error(`Invalid syntactic embedding: expected 128, got ${syntacticEmbedding?.length}`);
      }
      logger.info('     ✅ 구문적 임베딩 완료');
    } catch (e) {
      console.warn('     ⚠️ 구문적 임베딩 실패, 기본 벡터 사용:', e.message);
      syntacticEmbedding = new Array(128).fill(0);
    }

    try {
      logger.info('  🧠 의미론적 임베딩 (256차원)...');
      semanticEmbedding = await this.embeddingGenerator.embedCodeSemantics(src);
      if (!Array.isArray(semanticEmbedding) || semanticEmbedding.length !== 256) {
        throw new Error(`Invalid semantic embedding: expected 256, got ${semanticEmbedding?.length}`);
      }
      logger.info('     ✅ 의미론적 임베딩 완료');
    } catch (e) {
      console.warn('     ⚠️ 의미론적 임베딩 실패, 기본 벡터 사용:', e.message);
      semanticEmbedding = new Array(256).fill(0);
    }

    try {
      logger.info('  ⚙️ 프레임워크 임베딩 (64차원)...');
      frameworkEmbedding = await this.embeddingGenerator.embedFrameworkUsage(src);
      if (!Array.isArray(frameworkEmbedding) || frameworkEmbedding.length !== 64) {
        throw new Error(`Invalid framework embedding: expected 64, got ${frameworkEmbedding?.length}`);
      }
      logger.info('     ✅ 프레임워크 임베딩 완료');
    } catch (e) {
      console.warn('     ⚠️ 프레임워크 임베딩 실패, 기본 벡터 사용:', e.message);
      frameworkEmbedding = new Array(64).fill(0);
    }

    try {
      logger.info('  🏢 비즈니스 컨텍스트 임베딩 (32차원)...');
      contextEmbedding = await this.embeddingGenerator.embedBusinessContext(src);
      if (!Array.isArray(contextEmbedding) || contextEmbedding.length !== 32) {
        throw new Error(`Invalid context embedding: expected 32, got ${contextEmbedding?.length}`);
      }
      logger.info('     ✅ 비즈니스 임베딩 완료');
    } catch (e) {
      console.warn('     ⚠️ 컨텍스트 임베딩 실패, 기본 벡터 사용:', e.message);
      contextEmbedding = new Array(32).fill(0);
    }

    logger.info('  🔗 임베딩 결합 (480차원)...');
    let combinedEmbedding = [];
    try {
      combinedEmbedding = this.embeddingGenerator.combineEmbeddings({
        syntactic: syntacticEmbedding,
        semantic: semanticEmbedding,
        framework: frameworkEmbedding,
        context: contextEmbedding
      });
      
      if (!Array.isArray(combinedEmbedding) || combinedEmbedding.length !== 480) {
        throw new Error(`Invalid combined embedding: expected 480, got ${combinedEmbedding?.length}`);
      }
      
      // NaN, Infinity 체크
      if (combinedEmbedding.some(v => !isFinite(v))) {
        throw new Error('Combined embedding contains NaN or Infinity');
      }
      
      logger.info(`     ✅ 결합 완료: 480차원 (${syntacticEmbedding.length}+${semanticEmbedding.length}+${frameworkEmbedding.length}+${contextEmbedding.length})`);
      logger.info(`     벡터 범위: [${Math.min(...combinedEmbedding).toFixed(4)}, ${Math.max(...combinedEmbedding).toFixed(4)}]`);
      
      // 0이 아닌 값 비율 확인
      const nonZeroCount = combinedEmbedding.filter(v => v !== 0).length;
      const nonZeroRatio = (nonZeroCount / 480 * 100).toFixed(1);
      logger.info(`     0이 아닌 값: ${nonZeroCount}/480 (${nonZeroRatio}%)`);
      
      if (nonZeroCount === 0) {
        console.warn('     ⚠️ 경고: 모든 값이 0인 벡터 생성됨 (더미 벡터)');
      }
      
    } catch (e) {
      console.warn('     ⚠️ 임베딩 결합 실패, 기본 벡터 사용:', e.message);
      combinedEmbedding = new Array(480).fill(0);
    }

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
        embedding_version: 'v1.0',
        created_timestamp: new Date().toISOString(),
        model_version: 'CustomEmbedding-1.0.0',
        dimensions: {
          syntactic: syntacticEmbedding.length,
          semantic: semanticEmbedding.length,
          framework: frameworkEmbedding.length,
          context: contextEmbedding.length,
          combined: combinedEmbedding.length
        },
        quality_metrics: {
          non_zero_ratio: combinedEmbedding.filter(v => v !== 0).length / 480,
          vector_magnitude: Math.sqrt(combinedEmbedding.reduce((sum, v) => sum + v * v, 0)),
          min_value: Math.min(...combinedEmbedding),
          max_value: Math.max(...combinedEmbedding)
        }
      },
      ast_analysis: astAnalysis
    };
  }

  async extractASTAnalysis(code) {
    try {
      // Java 코드를 AST로 파싱하여 노드 타입, 순환복잡도, 깊이 등 분석
      const astResult = this.embeddingGenerator?.astParser?.parseJavaCode(code);
      if (astResult?.success && astResult.analysis) {
        // AST 구조를 해시 기반 시그니처로 변환하여 패턴 비교에 활용
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
    // AST 파싱 실패 시 빈 기본값 반환
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
    // 카테고리에 따라 레코드 ID 접두사 결정 (예: RESOURCE_, SECURITY_)
    const categoryPrefix = this.getCategoryPrefix(basicPattern.metadata?.category || '');
    const recordId = this.generateRecordId(categoryPrefix);

    return {
      issue_record_id: recordId,

      // LLM이 생성한 안티패턴, 권장패턴, 영향 분석 등의 정보
      ...basicPattern,

      // 프로그래밍 방식으로 생성한 임베딩 벡터와 관련 패턴 목록
      embeddings,
      related_patterns: relatedPatterns,

      // 프레임워크 컨텍스트 및 탐지 규칙 정보 병합
      ...frameworkContext,

      // 생성 및 수정 시간 등 메타데이터 보완
      metadata: {
        ...basicPattern.metadata,
        created_date: issueData.createdDate || new Date().toISOString(),
        last_updated: new Date().toISOString()
      },

      // 시스템 생성 데이터임을 표시하고 초기 품질 점수 계산
      validation_info: {
        reviewed_by: 'system_generated',
        review_date: new Date().toISOString().split('T')[0],
        validation_status: 'DRAFT',
        quality_score: this.calculateInitialQualityScore(basicPattern, issueData)
      }
    };
  }

  validateAndEnhanceDataset(dataset) {
    // 패턴 데이터셋에 반드시 포함되어야 할 필드 목록 정의
    const requiredFields = [
      'issue_record_id', 'metadata', 'anti_pattern',
      'recommended_pattern', 'impact_analysis', 'embeddings'
    ];

    // 필수 필드가 누락된 경우 기본값으로 채워넣음
    for (const field of requiredFields) {
      if (!dataset[field]) {
        console.warn(`⚠️ 필수 필드 누락: ${field}`);
        dataset[field] = this.createDefaultField(field);
      }
    }

    // 데이터 완성도를 기반으로 품질 점수 재계산 (0.0 ~ 1.0)
    const qualityScore = this.calculateFinalQualityScore(dataset);
    dataset.validation_info.quality_score = qualityScore;

    logger.info(`  📊 최종 품질 점수: ${qualityScore.toFixed(2)}`);

    return dataset;
  }

  // === 헬퍼 메서드들 ===

  extractAnnotations(code) {
    // 정규식으로 @Annotation 형태의 모든 어노테이션 추출
    const annotationPattern = /@([A-Za-z][A-Za-z0-9_]*)/g;
    const matches = code.match(annotationPattern) || [];
    // 중복 제거하여 반환
    return [...new Set(matches)];
  }

  extractCustomClasses(code) {
    // extends, implements, 타입 선언 패턴에서 클래스명 추출
    const patterns = [
      /extends\s+([A-Z][A-Za-z0-9_]*)/g,
      /implements\s+([A-Z][A-Za-z0-9_]*)/g,
      /(?:private|public|protected)?\s*([A-Z][A-Za-z0-9_]*)\s+\w+/g
    ];

    const classes = new Set();
    // Java 표준 라이브러리 클래스는 제외
    const standardClasses = new Set(['String', 'Integer', 'Long', 'Double', 'Boolean', 'List', 'Map', 'Set']);

    patterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(code)) !== null) {
        if (!standardClasses.has(match[1])) {
          classes.add(match[1]);
        }
      }
    });

    return Array.from(classes);
  }

  calculatePatternSimilarity(pattern1, pattern2) {
    // 두 패턴의 카테고리를 비교하여 유사도 점수 계산
    const category1 = pattern1.metadata?.category || '';
    const category2 = pattern2.category || '';

    // 같은 카테고리면 높은 유사도(0.8), 다르면 낮은 유사도(0.3) 반환
    if (category1 === category2) {
      return 0.8;
    }
    return 0.3;
  }

  determineRelationshipType(pattern1, pattern2, similarity) {
    // 유사도 점수에 따라 관계 타입 결정
    if (similarity > 0.9) return 'similar';          // 매우 유사
    if (similarity > 0.7) return 'complementary';    // 보완적
    return 'related';                                 // 관련됨
  }

  generateRecordId(prefix) {
    // 타임스탬프 뒤 6자리 + 랜덤 3자리를 조합하여 고유 ID 생성
    const timestamp = Date.now().toString().slice(-6);
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `${prefix}_${timestamp}_${random}`;
  }

  getCategoryPrefix(category) {
    // 패턴 카테고리를 레코드 ID 접두사로 매핑
    const prefixMap = {
      'resource_management': 'RESOURCE',
      'security_vulnerability': 'SECURITY',
      'performance_issue': 'PERF',
      'framework_misuse': 'FRAMEWORK',
      'business_logic_error': 'BUSINESS',
      'exception_handling': 'EXCEPTION',
      'concurrency_issue': 'CONCURRENCY',
      'architecture_violation': 'ARCH'
    };
    return prefixMap[category] || 'GENERAL';
  }

  calculateInitialQualityScore(basicPattern, issueData) {
    let score = 0.5; // 기본 점수

    // 각 필드의 존재 여부에 따라 점수 가산 (최대 1.0)
    if (basicPattern.metadata?.title) score += 0.1;
    if (basicPattern.anti_pattern?.code_template) score += 0.1;
    if (basicPattern.recommended_pattern?.code_template) score += 0.1;
    if (issueData.occurrenceCount > 1) score += 0.1;  // 재발 이슈는 품질 높음
    if (basicPattern.impact_analysis?.production_impact) score += 0.1;

    return Math.min(score, 1.0);
  }

  calculateFinalQualityScore(dataset) {
    let score = 0.0;
    let totalChecks = 10;

    // 각 섹션의 완성도를 체크하여 품질 점수 계산
    if (dataset.metadata?.title) score += 0.1;
    if (dataset.anti_pattern?.code_template) score += 0.1;
    if (dataset.recommended_pattern?.code_template) score += 0.1;
    if (dataset.embeddings?.combined_embedding?.length > 0) score += 0.2;  // 임베딩 가중치 높음
    if (dataset.framework_context?.framework_version) score += 0.1;
    if (dataset.impact_analysis?.production_impact) score += 0.1;
    if (dataset.detection_rules?.ast_rules?.length > 0) score += 0.1;
    if (dataset.related_patterns?.length > 0) score += 0.1;
    if (dataset.validation_info?.validation_status) score += 0.05;
    if (dataset.issue_record_id) score += 0.05;

    return Math.min(score, 1.0);
  }

  createDefaultField(fieldName) {
    // 필수 필드가 누락된 경우 사용할 기본값 정의
    const defaults = {
      'metadata': { title: '', category: 'resource_management', severity: 'MEDIUM', tags: [] },
      'anti_pattern': { code_template: '', pattern_signature: { semantic_signature: '', regex_patterns: [] } },
      'recommended_pattern': { code_template: '', pattern_name: '', implementation_guide: { best_practices: [] } },
      'impact_analysis': { production_impact: { failure_scenarios: [] }, historical_data: { occurrence_frequency: 1 } },
      'embeddings': { 
        combined_embedding: new Array(480).fill(0), 
        component_embeddings: {
          syntactic_embedding: new Array(128).fill(0),
          semantic_embedding: new Array(256).fill(0),
          framework_embedding: new Array(64).fill(0),
          context_embedding: new Array(32).fill(0)
        }
      }
    };

    return defaults[fieldName] || {};
  }

  async loadExistingPatterns() {
    try {
      // Vector DB에서 저장된 모든 패턴을 조회하여 메모리에 로드
      this.existingPatterns = await this.vectorClient.getAllPatterns();
      logger.info(`📚 기존 패턴 로드: ${this.existingPatterns.length}개`);
    } catch (error) {
      // 조회 실패 시 빈 배열로 초기화하여 계속 진행
      console.warn('⚠️ 기존 패턴 로드 실패:', error.message);
      this.existingPatterns = [];
    }
  }

  createFallbackPattern(issueData) {
    // LLM 호출 실패 시 최소한의 정보로 기본 패턴 객체 생성
    return {
      metadata: {
        title: issueData.title || '코딩 패턴 이슈',
        category: 'resource_management',
        severity: issueData.severity || 'MEDIUM',
        tags: ['fallback', 'generated']
      },
      anti_pattern: {
        code_template: issueData.problematicCode || '// 문제 코드',
        pattern_signature: {
          semantic_signature: 'unknown_pattern',
          regex_patterns: []
        }
      },
      recommended_pattern: {
        code_template: issueData.fixedCode || '// 수정된 코드',
        pattern_name: 'fallback_pattern',
        implementation_guide: {
          best_practices: ['코드 리뷰 필요']
        }
      },
      impact_analysis: {
        production_impact: {
          failure_scenarios: ['unknown']
        },
        historical_data: {
          occurrence_frequency: issueData.occurrenceCount || 1
        }
      }
    };
  }

  createFallbackFrameworkContext(annotations, classes) {
    // LLM 프레임워크 분석 실패 시 추출된 정보만으로 기본 컨텍스트 생성
    return {
      detection_rules: {
        ast_rules: [],
        semantic_rules: []
      },
      framework_context: {
        framework_version: 'unknown',
        applicable_components: {
          custom_annotations: annotations,
          custom_classes: classes,
          framework_apis: []
        }
      }
    };
  }
}