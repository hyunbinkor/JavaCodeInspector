import { QdrantClient } from '@qdrant/js-client-rest';
import { config } from '../../config.js';
import { v4 as uuidv4 } from 'uuid';

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
      console.log('🔐 Qdrant API Key 인증 사용');
    } else {
      console.log('🔓 Qdrant 익명 접근 모드');
    }

    return new QdrantClient(clientOptions);
  }

  async initializeSchema() {
    try {
      // CodePattern 컬렉션 처리
      const patternExists = await this.collectionExists(this.codePatternCollectionName);
      if (patternExists) {
        console.log(`✅ 기존 ${this.codePatternCollectionName} 컬렉션 확인됨`);
      } else {
        console.log(`🔨 ${this.codePatternCollectionName} 컬렉션 생성 중...`);
        await this.createCodePatternCollection();
        console.log(`✅ ${this.codePatternCollectionName} 컬렉션 생성 완료`);
      }

      // Guideline 컬렉션 처리
      const guidelineExists = await this.collectionExists(this.guidelineCollectionName);
      if (guidelineExists) {
        console.log(`✅ 기존 ${this.guidelineCollectionName} 컬렉션 확인됨`);
      } else {
        console.log(`🔨 ${this.guidelineCollectionName} 컬렉션 생성 중...`);
        await this.createGuidelineCollection();
        console.log(`✅ ${this.guidelineCollectionName} 컬렉션 생성 완료`);
      }

      console.log('✅ 모든 컬렉션 초기화 완료');
    } catch (error) {
      console.error('❌ 컬렉션 초기화 실패:', error.message);
      throw error;
    }
  }

  async collectionExists(collectionName) {
    try {
      const collections = await this.client.getCollections();
      return collections.collections.some(c => c.name === collectionName);
    } catch (error) {
      console.error(`컬렉션 존재 확인 오류 (${collectionName}):`, error.message);
      return false;
    }
  }

  async createCodePatternCollection() {
    const indexParams = config.vector.qdrant.indexParams;
    
    console.log(`📋 CodePattern 컬렉션 생성 파라미터:`);
    console.log(`   - 벡터 차원: ${this.vectorDimensions}`);
    console.log(`   - 거리 측정: Cosine`);
    console.log(`   - HNSW M: ${indexParams.m}`);
    console.log(`   - HNSW EF: ${indexParams.ef_construct}`);
    
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
    
    console.log(`📋 Guideline 컬렉션 생성 파라미터:`);
    console.log(`   - 벡터 차원: ${this.vectorDimensions}`);
    console.log(`   - 거리 측정: Cosine`);
    
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
      
      // 벡터 준비 및 차원 검증
      let vector = dataset.embeddings?.combined_embedding || this.createDummyVector();
      
      console.log(`📊 벡터 정보: 원본 차원=${vector.length}, 목표 차원=${this.vectorDimensions}`);
      
      // 벡터 차원이 설정과 다르면 조정
      if (vector.length !== this.vectorDimensions) {
        console.warn(`⚠️ 벡터 차원 불일치: ${vector.length} -> ${this.vectorDimensions} (자동 조정)`);
        vector = this.adjustVectorDimension(vector, this.vectorDimensions);
        console.log(`✅ 벡터 차원 조정 완료: ${vector.length}`);
      }

      // 벡터가 유효한 숫자 배열인지 확인
      if (!Array.isArray(vector) || vector.some(v => typeof v !== 'number' || isNaN(v))) {
        console.error('❌ 잘못된 벡터 형식:', vector.slice(0, 5));
        throw new Error('Invalid vector format');
      }

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

      console.log(`📦 Payload 크기: ${JSON.stringify(payload).length} bytes`);

      const point = {
        id,
        vector,
        payload
      };

      console.log(`💾 Qdrant에 저장 시도 중... (컬렉션: ${this.codePatternCollectionName})`);

      await this.client.upsert(this.codePatternCollectionName, {
        wait: true,
        points: [point]
      });

      console.log(`✅ 패턴 저장 완료: ${dataset.issue_record_id}`);
    } catch (error) {
      console.error(`❌ 패턴 저장 오류 (${dataset.issue_record_id}):`);
      console.error(`   메시지: ${error.message}`);
      console.error(`   상태 코드: ${error.status || 'N/A'}`);
      
      if (error.data) {
        console.error('   상세 오류:', JSON.stringify(error.data, null, 2));
      }
      
      // 스택 트레이스 출력
      if (error.stack) {
        console.error('   스택:', error.stack.split('\n').slice(0, 3).join('\n'));
      }
      
      throw error;
    }
  }

  /**
   * 벡터 차원을 목표 차원에 맞게 조정
   */
  adjustVectorDimension(vector, targetDim) {
    if (vector.length === targetDim) {
      return vector;
    } else if (vector.length > targetDim) {
      // 차원이 크면 자르기
      return vector.slice(0, targetDim);
    } else {
      // 차원이 작으면 0으로 패딩
      return [...vector, ...new Array(targetDim - vector.length).fill(0)];
    }
  }

  async searchSimilarPatterns(queryVector, limit = 5, threshold = 0.7) {
    try {
      const searchResult = await this.client.search(this.codePatternCollectionName, {
        vector: queryVector,
        limit,
        score_threshold: threshold,
        with_payload: true
      });

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
      console.error('유사 패턴 검색 오류:', error.message);
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
      console.error('전체 패턴 조회 오류:', error.message);
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
        console.warn(`⚠️ 벡터 차원 불일치: ${vector.length} -> ${this.vectorDimensions} (자동 조정)`);
        vector = this.adjustVectorDimension(vector, this.vectorDimensions);
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

      console.log(`✅ 가이드라인 저장 완료: ${guideline.ruleId}`);
      return id;
    } catch (error) {
      console.error(`가이드라인 저장 오류 (${guideline.ruleId}):`, error.message);
      if (error.data) {
        console.error('상세 오류:', JSON.stringify(error.data, null, 2));
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
      console.error('가이드라인 검색 오류:', error.message);
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
      console.error('키워드 기반 가이드라인 검색 오류:', error.message);
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

      console.log(`✅ 가이드라인 상태 업데이트 완료: ${ruleId} -> ${isActive}`);
    } catch (error) {
      console.error(`가이드라인 상태 업데이트 오류 (${ruleId}):`, error.message);
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

      console.log(`✅ 가이드라인 삭제 완료: ${ruleId}`);
    } catch (error) {
      console.error(`가이드라인 삭제 오류 (${ruleId}):`, error.message);
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
      console.error('AST 패턴 검색 오류:', error.message);
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
      console.error('복잡도 기반 검색 오류:', error.message);
      return [];
    }
  }

  async deletePattern(patternId) {
    try {
      await this.client.delete(this.codePatternCollectionName, {
        points: [patternId]
      });
      console.log(`✅ 패턴 삭제 완료: ${patternId}`);
    } catch (error) {
      console.error(`패턴 삭제 오류 (${patternId}):`, error.message);
      throw error;
    }
  }

  async checkConnection() {
    try {
      await this.client.getCollections();
      console.log('✅ Qdrant 연결 성공');
      return true;
    } catch (error) {
      console.error('Qdrant 연결 실패:', error.message);
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
      console.error('시스템 상태 조회 오류:', error.message);
      return { codePatterns: 0, guidelines: 0, totalObjects: 0 };
    }
  }

  createDummyVector() {
    // 벡터가 없을 경우 더미 벡터 생성 (모든 값이 0)
    return new Array(this.vectorDimensions).fill(0);
  }
}