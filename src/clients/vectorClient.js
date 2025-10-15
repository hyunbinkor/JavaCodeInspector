import { config } from '../config.js';
import { WeaviateAdapter } from './adapters/weaviateAdapter.js';
import { QdrantAdapter } from './adapters/qdrantAdapter.js';

/**
 * 통합 Vector DB 클라이언트
 * Weaviate와 Qdrant를 설정에 따라 선택적으로 사용
 * 외부에서는 항상 VectorClient만 사용하면 됨
 */
export class VectorClient {
  constructor() {
    this.provider = config.vector.provider;
    this.adapter = this.initializeAdapter();
    this.codePatternName = config.vector.codePatternName;
    this.guidelineName = config.vector.guidelineName;
    
    console.log(`\n=== Vector DB 제공자: ${this.provider.toUpperCase()} ===`);
  }

  /**
   * 설정된 provider에 따라 적절한 adapter 초기화
   */
  initializeAdapter() {
    switch (this.provider) {
      case 'weaviate':
        return new WeaviateAdapter();
      case 'qdrant':
        return new QdrantAdapter();
      default:
        throw new Error(`지원하지 않는 Vector DB provider: ${this.provider}`);
    }
  }

  /**
   * 스키마/컬렉션 초기화
   */
  async initializeSchema() {
    console.log('📋 Vector DB 스키마 초기화 중...');
    return await this.adapter.initializeSchema();
  }

  /**
   * 연결 상태 확인
   */
  async checkConnection() {
    return await this.adapter.checkConnection();
  }

  /**
   * CodePattern 저장
   */
  async storePattern(dataset) {
    return await this.adapter.storePattern(dataset);
  }

  /**
   * 벡터 유사도 기반 패턴 검색
   */
  async searchSimilarPatterns(queryVector, limit = 5, threshold = null) {
    const similarityThreshold = threshold ?? config.vector.similarityThreshold;
    return await this.adapter.searchSimilarPatterns(queryVector, limit, similarityThreshold);
  }

  /**
   * 모든 패턴 조회
   */
  async getAllPatterns(limit = 100) {
    return await this.adapter.getAllPatterns(limit);
  }

  /**
   * 패턴 삭제
   */
  async deletePattern(patternId) {
    return await this.adapter.deletePattern(patternId);
  }

  /**
   * AST 패턴으로 검색
   */
  async searchByASTPattern(astSignature, limit = 5) {
    return await this.adapter.searchByASTPattern(astSignature, limit);
  }

  /**
   * 순환 복잡도 범위로 검색
   */
  async searchByComplexity(minComplexity, maxComplexity, limit = 10) {
    return await this.adapter.searchByComplexity(minComplexity, maxComplexity, limit);
  }

  /**
   * Guideline 저장
   */
  async storeGuideline(guideline) {
    return await this.adapter.storeGuideline(guideline);
  }

  /**
   * Guideline 검색 (필터 조건)
   */
  async searchGuidelines(filters = {}) {
    return await this.adapter.searchGuidelines(filters);
  }

  /**
   * 키워드 기반 Guideline 검색
   */
  async searchGuidelinesByKeywords(keywords, limit = 10) {
    return await this.adapter.searchGuidelinesByKeywords(keywords, limit);
  }

  /**
   * Guideline 상태 업데이트
   */
  async updateGuidelineStatus(ruleId, isActive) {
    return await this.adapter.updateGuidelineStatus(ruleId, isActive);
  }

  /**
   * Guideline 삭제
   */
  async deleteGuideline(ruleId) {
    return await this.adapter.deleteGuideline(ruleId);
  }

  /**
   * 배치 Guideline import
   */
  async batchImportGuidelines(guidelines) {
    console.log(`📥 가이드라인 배치 import 시작: ${guidelines.length}개`);

    const results = {
      success: 0,
      failed: 0,
      errors: []
    };

    for (const guideline of guidelines) {
      try {
        await this.storeGuideline(guideline);
        results.success++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          ruleId: guideline.ruleId,
          error: error.message
        });
        console.error(`가이드라인 저장 오류 (${guideline.ruleId}):`, error.message);
      }
    }

    console.log(`✅ 배치 import 완료: 성공 ${results.success}개, 실패 ${results.failed}개`);

    if (results.errors.length > 0) {
      console.log('실패한 가이드라인들:');
      results.errors.forEach(({ ruleId, error }) => {
        console.log(`  - ${ruleId}: ${error}`);
      });
    }

    return results;
  }

  /**
   * 시스템 통계 조회
   */
  async getSystemStats() {
    return await this.adapter.getSystemStats();
  }

  /**
   * Provider 정보 반환
   */
  getProviderInfo() {
    return {
      provider: this.provider,
      codePatternName: this.codePatternName,
      guidelineName: this.guidelineName
    };
  }

  /**
   * 하위 호환성을 위한 별칭 메서드들
   */
  
  // weaviateClient의 codePatternClassName 속성 호환
  get codePatternClassName() {
    return this.codePatternName;
  }

  // weaviateClient의 guidelineClassName 속성 호환
  get guidelineClassName() {
    return this.guidelineName;
  }

  // parseExamples 메서드 (adapter에서 사용되지만 외부 호출 가능성 대비)
  parseExamples(examplesString) {
    try {
      return JSON.parse(examplesString || '{}');
    } catch (error) {
      return {};
    }
  }

  // getClassObjectCount 메서드 (하위 호환성)
  async getClassObjectCount(className) {
    // getSystemStats를 사용하여 구현
    const stats = await this.getSystemStats();
    if (className === this.codePatternName) {
      return stats.codePatterns;
    } else if (className === this.guidelineName) {
      return stats.guidelines;
    }
    return 0;
  }
}