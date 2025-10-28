import { QdrantClient } from '@qdrant/js-client-rest';
import { config } from '../../config.js';
import { v4 as uuidv4 } from 'uuid';
import logger from '../../utils/loggerUtils.js'

/**
 * Qdrant Vector DB Adapter
 */
export class QdrantAdapter {
  constructor() {
    this.client = this.initializeClient();
    this.codePatternCollectionName = config.vector.qdrant.collectionNamePattern
      .replace('{type}', 'pattern');
    this.guidelineCollectionName = config.vector.qdrant.collectionNamePattern
      .replace('{type}', 'guideline');
    this.vectorDimensions = config.vector.qdrant.vectorDimensions;
  }

  initializeClient() {
    const qdrantConfig = config.vector.qdrant;
    const url = qdrantConfig.url;
    
    const clientOptions = { url };
    
    // API 키가 있으면 추가
    if (qdrantConfig.apiKey) {
      clientOptions.apiKey = qdrantConfig.apiKey;
      logger.info('🔐 Qdrant API Key 인증 사용');
    } else {
      logger.info('🔓 Qdrant 익명 접근 모드');
    }

    return new QdrantClient(clientOptions);
  }

  async initializeSchema() {
    try {
      // CodePattern 컬렉션 처리
      const patternExists = await this.collectionExists(this.codePatternCollectionName);
      if (patternExists) {
        logger.info(`✅ 기존 ${this.codePatternCollectionName} 컬렉션 확인됨`);
      } else {
        logger.info(`🔨 ${this.codePatternCollectionName} 컬렉션 생성 중...`);
        await this.createCodePatternCollection();
        logger.info(`✅ ${this.codePatternCollectionName} 컬렉션 생성 완료`);
      }

      // Guideline 컬렉션 처리
      const guidelineExists = await this.collectionExists(this.guidelineCollectionName);
      if (guidelineExists) {
        logger.info(`✅ 기존 ${this.guidelineCollectionName} 컬렉션 확인됨`);
      } else {
        logger.info(`🔨 ${this.guidelineCollectionName} 컬렉션 생성 중...`);
        await this.createGuidelineCollection();
        logger.info(`✅ ${this.guidelineCollectionName} 컬렉션 생성 완료`);
      }

      logger.info('✅ 모든 컬렉션 초기화 완료');
    } catch (error) {
      logger.error('❌ 컬렉션 초기화 실패:', error.message);
      throw error;
    }
  }

  async collectionExists(collectionName) {
    try {
      const collections = await this.client.getCollections();
      return collections.collections.some(c => c.name === collectionName);
    } catch (error) {
      logger.error(`컬렉션 존재 확인 오류 (${collectionName}):`, error.message);
      return false;
    }
  }

  async createCodePatternCollection() {
    const indexParams = config.vector.qdrant.indexParams;
    
    logger.info(`📋 CodePattern 컬렉션 생성 파라미터:`);
    logger.info(`   - 벡터 차원: ${this.vectorDimensions}`);
    logger.info(`   - 거리 측정: Cosine`);
    logger.info(`   - HNSW M: ${indexParams.m}`);
    logger.info(`   - HNSW EF: ${indexParams.ef_construct}`);
    
    await this.client.createCollection(this.codePatternCollectionName, {
      vectors: {
        size: this.vectorDimensions,
        distance: 'Cosine',
        hnsw_config: {
          m: indexParams.m,
          ef_construct: indexParams.ef_construct
        }
      },
      optimizers_config: {
        default_segment_number: 2
      },
      replication_factor: 1
    });

    // 인덱스 생성
    await this.createPayloadIndices(this.codePatternCollectionName, [
      'issueRecordId',
      'category',
      'severity',
      'cyclomaticComplexity'
    ]);
  }

  async createGuidelineCollection() {
    const indexParams = config.vector.qdrant.indexParams;
    
    logger.info(`📋 Guideline 컬렉션 생성 파라미터:`);
    logger.info(`   - 벡터 차원: ${this.vectorDimensions}`);
    logger.info(`   - 거리 측정: Cosine`);
    
    await this.client.createCollection(this.guidelineCollectionName, {
      vectors: {
        size: this.vectorDimensions,
        distance: 'Cosine',
        hnsw_config: {
          m: indexParams.m,
          ef_construct: indexParams.ef_construct
        }
      },
      optimizers_config: {
        default_segment_number: 2
      },
      replication_factor: 1
    });

    // 인덱스 생성
    await this.createPayloadIndices(this.guidelineCollectionName, [
      'ruleId',
      'category',
      'checkType',
      'isActive'
    ]);
  }

  async createPayloadIndices(collectionName, fieldNames) {
    for (const fieldName of fieldNames) {
      try {
        await this.client.createPayloadIndex(collectionName, {
          field_name: fieldName,
          field_schema: 'keyword'
        });
      } catch (error) {
        console.warn(`인덱스 생성 경고 (${fieldName}):`, error.message);
      }
    }
  }

  async storePattern(dataset) {
    try {
      const id = uuidv4();
      
      // 벡터 준비
      let vector = dataset.embeddings?.combined_embedding;
      
      // 벡터 존재 여부 확인
      if (!vector || !Array.isArray(vector)) {
        console.warn(`⚠️ 벡터가 없어 더미 벡터 생성: ${dataset.issue_record_id}`);
        vector = this.createDummyVector();
      }
      
      // 벡터 차원 검증 (조정하지 않음)
      if (vector.length !== this.vectorDimensions) {
        logger.error(`❌ 벡터 차원 불일치: ${vector.length} !== ${this.vectorDimensions}`);
        logger.error(`   패턴 ID: ${dataset.issue_record_id}`);
        logger.error(`   ⚠️ 임베딩 생성 로직을 확인하세요`);
        
        // 에러 대신 경고만 표시하고 더미 벡터 사용
        console.warn(`   더미 벡터로 대체하여 저장 진행`);
        vector = this.createDummyVector();
      }
      
      // 벡터 유효성 검증
      if (!this.validateVector(vector)) {
        logger.error(`❌ 벡터에 유효하지 않은 값 포함: ${dataset.issue_record_id}`);
        throw new Error('Vector contains NaN, Infinity, or non-numeric values');
      }
      
      logger.info(`📊 벡터 정보: 차원=${vector.length}, 범위=[${Math.min(...vector).toFixed(4)}, ${Math.max(...vector).toFixed(4)}]`);

      // Payload 준비 - 모든 배열을 JSON 문자열로 변환
      const payload = {
        issueRecordId: dataset.issue_record_id,
        patternData: JSON.stringify(dataset),
        title: (dataset.metadata?.title || '').substring(0, 500), // 길이 제한
        category: dataset.metadata?.category || 'general',
        severity: dataset.metadata?.severity || 'MEDIUM',
        tags: JSON.stringify(dataset.metadata?.tags || []),
        antiPatternCode: (dataset.anti_pattern?.code_template || '').substring(0, 5000),
        recommendedPatternCode: (dataset.recommended_pattern?.code_template || '').substring(0, 5000),
        semanticSignature: (dataset.anti_pattern?.pattern_signature?.semantic_signature || '').substring(0, 500),
        frameworkVersion: dataset.framework_context?.framework_version || 'unknown',
        occurrenceFrequency: Number(dataset.impact_analysis?.historical_data?.occurrence_frequency ?? 1),
        qualityScore: Number(dataset.validation_info?.quality_score ?? 0),
        astSignature: (dataset.embeddings?.ast_analysis?.signature || '').substring(0, 5000),
        astNodeTypes: JSON.stringify(dataset.embeddings?.ast_analysis?.nodeTypes || []),
        cyclomaticComplexity: Number(dataset.embeddings?.ast_analysis?.cyclomaticComplexity ?? 1),
        maxDepth: Number(dataset.embeddings?.ast_analysis?.maxDepth ?? 1)
      };

      logger.info(`📦 Payload 크기: ${JSON.stringify(payload).length} bytes`);

      const point = {
        id,
        vector,
        payload
      };

      logger.info(`💾 Qdrant에 저장 시도 중... (컬렉션: ${this.codePatternCollectionName})`);

      await this.client.upsert(this.codePatternCollectionName, {
        wait: true,
        points: [point]
      });

      logger.info(`✅ 패턴 저장 완료: ${dataset.issue_record_id}`);
    } catch (error) {
      logger.error(`❌ 패턴 저장 오류 (${dataset.issue_record_id}):`);
      logger.error(`   메시지: ${error.message}`);
      logger.error(`   상태 코드: ${error.status || 'N/A'}`);
      
      if (error.data) {
        logger.error('   상세 오류:', JSON.stringify(error.data, null, 2));
      }
      
      // 스택 트레이스 출력
      if (error.stack) {
        logger.error('   스택:', error.stack.split('\n').slice(0, 3).join('\n'));
      }
      
      throw error;
    }
  }

  /**
   * 벡터 유효성 검증
   */
  validateVector(vector) {
    if (!Array.isArray(vector) || vector.length === 0) {
      return false;
    }
    
    return vector.every(v => {
      return typeof v === 'number' && 
             !isNaN(v) && 
             isFinite(v);
    });
  }

  async searchSimilarPatterns(queryVector, limit = 5, threshold = 0.7) {
    try {
      // 검색 벡터 검증
      if (!this.validateVector(queryVector)) {
        logger.error('❌ 검색 벡터가 유효하지 않음');
        return [];
      }
      
      logger.info(`🔍 검색 시작: 차원=${queryVector.length}, threshold=${threshold}, limit=${limit}`);
      logger.info(`🔍 벡터 샘플: [${queryVector.slice(0, 5).map(v => v.toFixed(4)).join(', ')}...]`);
      
      const searchResult = await this.client.search(this.codePatternCollectionName, {
        vector: queryVector,
        limit,
        score_threshold: threshold,
        with_payload: true,
        with_vector: false  // 결과에 벡터 포함 안 함 (성능 향상)
      });

      logger.info(`✅ 검색 완료: ${searchResult.length}개 결과 발견`);
      
      if (searchResult.length > 0) {
        logger.info(`   최고 점수: ${searchResult[0].score.toFixed(4)}`);
        logger.info(`   최저 점수: ${searchResult[searchResult.length - 1].score.toFixed(4)}`);
      }

      return searchResult.map(result => ({
        id: result.payload.issueRecordId,
        title: result.payload.title,
        category: result.payload.category,
        severity: result.payload.severity,
        semanticSignature: result.payload.semanticSignature,
        astSignature: result.payload.astSignature,
        cyclomaticComplexity: result.payload.cyclomaticComplexity,
        maxDepth: result.payload.maxDepth,
        qualityScore: result.payload.qualityScore,
        score: result.score,
        fullData: JSON.parse(result.payload.patternData || '{}')
      }));
    } catch (error) {
      logger.error('❌ 유사 패턴 검색 오류:', error.message);
      if (error.data) {
        logger.error('   상세:', JSON.stringify(error.data, null, 2));
      }
      return [];
    }
  }

  async getAllPatterns(limit = 100) {
    try {
      const scrollResult = await this.client.scroll(this.codePatternCollectionName, {
        limit,
        with_payload: true,
        with_vector: false
      });

      return scrollResult.points.map(point => ({
        issueRecordId: point.payload.issueRecordId,
        title: point.payload.title,
        category: point.payload.category,
        severity: point.payload.severity
      }));
    } catch (error) {
      logger.error('전체 패턴 조회 오류:', error.message);
      return [];
    }
  }

  async storeGuideline(guideline) {
    try {
      const id = uuidv4();
      
      // patterns 배열을 JSON 문자열로 변환
      const patternsArray = (guideline.patterns || []).map(p => {
        if (typeof p === 'string') return p;
        if (typeof p === 'object' && p.pattern) {
          return p.description ? `${p.pattern} (${p.description})` : p.pattern;
        }
        return JSON.stringify(p);
      });

      // 벡터 준비 및 차원 검증
      let vector = guideline.embedding || this.createDummyVector();
      if (vector.length !== this.vectorDimensions) {
        console.warn(`⚠️ 벡터 차원 불일치: ${vector.length} -> ${this.vectorDimensions} (더미 벡터 사용)`);
        vector = this.createDummyVector();
      }
      
      // 벡터 검증 및 정규화
      if (!this.validateVector(vector)) {
        console.warn(`⚠️ 가이드라인 벡터 유효하지 않음, 더미 벡터 사용`);
        vector = this.createDummyVector();
      }

      const point = {
        id,
        vector,
        payload: {
          ruleId: guideline.ruleId,
          ruleTitle: guideline.title,
          category: guideline.category,
          checkType: guideline.checkType,
          description: guideline.description || '',
          keywords: JSON.stringify(guideline.keywords || []), // 배열을 JSON 문자열로
          severity: guideline.severity,
          examples: JSON.stringify(guideline.examples || {}),
          patterns: JSON.stringify(patternsArray), // 배열을 JSON 문자열로
          message: guideline.message || '',
          parentChapter: guideline.parentChapter || '',
          isActive: guideline.isActive !== false
        }
      };

      await this.client.upsert(this.guidelineCollectionName, {
        wait: true,
        points: [point]
      });

      logger.info(`✅ 가이드라인 저장 완료: ${guideline.ruleId}`);
      return id;
    } catch (error) {
      logger.error(`가이드라인 저장 오류 (${guideline.ruleId}):`, error.message);
      if (error.data) {
        logger.error('상세 오류:', JSON.stringify(error.data, null, 2));
      }
      throw error;
    }
  }

  async searchGuidelines(filters = {}) {
    try {
      const must = [];

      if (filters.category) {
        must.push({ key: 'category', match: { value: filters.category } });
      }

      if (filters.checkType) {
        must.push({ key: 'checkType', match: { value: filters.checkType } });
      }

      if (filters.isActive !== undefined) {
        must.push({ key: 'isActive', match: { value: filters.isActive } });
      }

      const scrollResult = await this.client.scroll(this.guidelineCollectionName, {
        filter: must.length > 0 ? { must } : undefined,
        limit: filters.limit || 100,
        with_payload: true,
        with_vector: false
      });

      return scrollResult.points.map(point => ({
        ruleId: point.payload.ruleId,
        title: point.payload.ruleTitle,
        category: point.payload.category,
        checkType: point.payload.checkType,
        description: point.payload.description,
        keywords: this.parseJSON(point.payload.keywords), // JSON 파싱
        severity: point.payload.severity,
        examples: this.parseExamples(point.payload.examples),
        patterns: this.parseJSON(point.payload.patterns), // JSON 파싱
        message: point.payload.message,
        isActive: point.payload.isActive
      }));
    } catch (error) {
      logger.error('가이드라인 검색 오류:', error.message);
      return [];
    }
  }

  async searchGuidelinesByKeywords(keywords, limit = 10) {
    try {
      // Qdrant에서는 JSON 문자열로 저장되어 있어서 텍스트 검색으로 변경
      const should = keywords.map(keyword => ({
        key: 'keywords',
        match: { text: keyword }
      }));

      const scrollResult = await this.client.scroll(this.guidelineCollectionName, {
        filter: { should },
        limit,
        with_payload: true,
        with_vector: false
      });

      return scrollResult.points.map(point => ({
        ruleId: point.payload.ruleId,
        title: point.payload.ruleTitle,
        category: point.payload.category,
        checkType: point.payload.checkType,
        description: point.payload.description,
        keywords: this.parseJSON(point.payload.keywords), // JSON 파싱
        severity: point.payload.severity,
        examples: this.parseExamples(point.payload.examples),
        patterns: this.parseJSON(point.payload.patterns), // JSON 파싱
        message: point.payload.message
      }));
    } catch (error) {
      logger.error('키워드 기반 가이드라인 검색 오류:', error.message);
      return [];
    }
  }

  async updateGuidelineStatus(ruleId, isActive) {
    try {
      const searchResult = await this.client.scroll(this.guidelineCollectionName, {
        filter: {
          must: [{ key: 'ruleId', match: { value: ruleId } }]
        },
        limit: 1,
        with_payload: true
      });

      if (searchResult.points.length === 0) {
        throw new Error(`가이드라인을 찾을 수 없습니다: ${ruleId}`);
      }

      const point = searchResult.points[0];
      
      await this.client.setPayload(this.guidelineCollectionName, {
        payload: { isActive },
        points: [point.id]
      });

      logger.info(`✅ 가이드라인 상태 업데이트 완료: ${ruleId} -> ${isActive}`);
    } catch (error) {
      logger.error(`가이드라인 상태 업데이트 오류 (${ruleId}):`, error.message);
      throw error;
    }
  }

  async deleteGuideline(ruleId) {
    try {
      const searchResult = await this.client.scroll(this.guidelineCollectionName, {
        filter: {
          must: [{ key: 'ruleId', match: { value: ruleId } }]
        },
        limit: 1
      });

      if (searchResult.points.length === 0) {
        throw new Error(`가이드라인을 찾을 수 없습니다: ${ruleId}`);
      }

      const point = searchResult.points[0];
      
      await this.client.delete(this.guidelineCollectionName, {
        points: [point.id]
      });

      logger.info(`✅ 가이드라인 삭제 완료: ${ruleId}`);
    } catch (error) {
      logger.error(`가이드라인 삭제 오류 (${ruleId}):`, error.message);
      throw error;
    }
  }

  async searchByASTPattern(astSignature, limit = 5) {
    try {
      const scrollResult = await this.client.scroll(this.codePatternCollectionName, {
        filter: {
          must: [{
            key: 'astSignature',
            match: { text: astSignature }
          }]
        },
        limit,
        with_payload: true,
        with_vector: false
      });

      return scrollResult.points.map(point => ({
        issueRecordId: point.payload.issueRecordId,
        title: point.payload.title,
        category: point.payload.category,
        astSignature: point.payload.astSignature,
        cyclomaticComplexity: point.payload.cyclomaticComplexity,
        maxDepth: point.payload.maxDepth
      }));
    } catch (error) {
      logger.error('AST 패턴 검색 오류:', error.message);
      return [];
    }
  }

  async searchByComplexity(minComplexity, maxComplexity, limit = 10) {
    try {
      const scrollResult = await this.client.scroll(this.codePatternCollectionName, {
        filter: {
          must: [
            {
              key: 'cyclomaticComplexity',
              range: {
                gte: minComplexity,
                lte: maxComplexity
              }
            }
          ]
        },
        limit,
        with_payload: true,
        with_vector: false
      });

      return scrollResult.points.map(point => ({
        issueRecordId: point.payload.issueRecordId,
        title: point.payload.title,
        category: point.payload.category,
        cyclomaticComplexity: point.payload.cyclomaticComplexity,
        maxDepth: point.payload.maxDepth,
        qualityScore: point.payload.qualityScore
      }));
    } catch (error) {
      logger.error('복잡도 기반 검색 오류:', error.message);
      return [];
    }
  }

  async deletePattern(patternId) {
    try {
      await this.client.delete(this.codePatternCollectionName, {
        points: [patternId]
      });
      logger.info(`✅ 패턴 삭제 완료: ${patternId}`);
    } catch (error) {
      logger.error(`패턴 삭제 오류 (${patternId}):`, error.message);
      throw error;
    }
  }

  async checkConnection() {
    try {
      await this.client.getCollections();
      logger.info('✅ Qdrant 연결 성공');
      return true;
    } catch (error) {
      logger.error('Qdrant 연결 실패:', error.message);
      return false;
    }
  }

  parseExamples(examplesString) {
    try {
      return JSON.parse(examplesString || '{}');
    } catch (error) {
      return {};
    }
  }

  parseJSON(jsonString) {
    try {
      return JSON.parse(jsonString || '[]');
    } catch (error) {
      return [];
    }
  }

  async getSystemStats() {
    try {
      const patternInfo = await this.client.getCollection(this.codePatternCollectionName);
      const guidelineInfo = await this.client.getCollection(this.guidelineCollectionName);

      return {
        codePatterns: patternInfo.points_count || 0,
        guidelines: guidelineInfo.points_count || 0,
        totalObjects: (patternInfo.points_count || 0) + (guidelineInfo.points_count || 0)
      };
    } catch (error) {
      logger.error('시스템 상태 조회 오류:', error.message);
      return { codePatterns: 0, guidelines: 0, totalObjects: 0 };
    }
  }

  createDummyVector() {
    // 벡터가 없을 경우 더미 벡터 생성 (모든 값이 0)
    return new Array(this.vectorDimensions).fill(0);
  }

  /**
   * 두 벡터의 코사인 유사도 계산 (디버깅용)
   */
  calculateCosineSimilarity(vec1, vec2) {
    if (vec1.length !== vec2.length) {
      throw new Error('Vector dimensions must match');
    }
    
    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;
    
    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      norm1 += vec1[i] * vec1[i];
      norm2 += vec2[i] * vec2[i];
    }
    
    const magnitude = Math.sqrt(norm1) * Math.sqrt(norm2);
    
    if (magnitude === 0) return 0;
    
    return dotProduct / magnitude;
  }

  /**
   * 벡터 통계 출력 (디버깅용)
   */
  printVectorStats(vector, label = 'Vector') {
    const stats = {
      dimension: vector.length,
      min: Math.min(...vector),
      max: Math.max(...vector),
      mean: vector.reduce((a, b) => a + b, 0) / vector.length,
      nonZeroCount: vector.filter(v => v !== 0).length,
      zeroRatio: vector.filter(v => v === 0).length / vector.length
    };
    
    logger.info(`📊 ${label} 통계:`);
    logger.info(`   차원: ${stats.dimension}`);
    logger.info(`   범위: [${stats.min.toFixed(4)}, ${stats.max.toFixed(4)}]`);
    logger.info(`   평균: ${stats.mean.toFixed(4)}`);
    logger.info(`   0이 아닌 값: ${stats.nonZeroCount} (${((1-stats.zeroRatio)*100).toFixed(1)}%)`);
    
    return stats;
  }
}