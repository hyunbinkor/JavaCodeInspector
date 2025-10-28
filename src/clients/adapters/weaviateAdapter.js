import weaviate, { ApiKey } from 'weaviate-ts-client';
import { config } from '../../config.js';
import { v4 as uuidv4 } from 'uuid';
import logger from '../../utils/loggerUtils.js'

/**
 * Weaviate Vector DB Adapter
 */
export class WeaviateAdapter {
  constructor() {
    this.client = this.initializeClient();
    this.codePatternClassName = config.vector.codePatternName;
    this.guidelineClassName = config.vector.guidelineName;
  }

  initializeClient() {
    const weaviateConfig = config.vector.weaviate;
    const clientConfig = {
      scheme: weaviateConfig.url.startsWith('https') ? 'https' : 'http',
      host: weaviateConfig.url.replace(/^https?:\/\//, ''),
    };

    // localhost나 127.0.0.1인지 확인하여 로컬 환경 여부 판단
    const isLocal = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(clientConfig.host);

    // API 키가 설정되어 있고, useAuth가 true이며, 로컬 환경이 아닌 경우에만 API 키 인증 적용
    if (weaviateConfig.apiKey && weaviateConfig.useAuth && !isLocal) {
      clientConfig.apiKey = new ApiKey(weaviateConfig.apiKey);
      logger.info('🔐 API Key 인증 사용');
    } else {
      logger.info('🔓 익명 접근 모드 (로컬 환경)');
    }

    return weaviate.client(clientConfig);
  }

  async initializeSchema() {
    try {
      const schema = await this.client.schema.getter().do();
      const existingClasses = schema.classes.map(c => c.class);

      // CodePattern 스키마 처리
      if (existingClasses.includes(this.codePatternClassName)) {
        logger.info(`✅ 기존 ${this.codePatternClassName} 스키마 확인됨`);
        const existingSchema = schema.classes.find(c => c.class === this.codePatternClassName);
        const isCompatible = this.validateSchemaCompatibility(existingSchema);

        if (!isCompatible) {
          console.warn('⚠️ 스키마 비호환: 수동 마이그레이션 필요');
          console.warn('⚠️ 데이터 손실 방지를 위해 스키마 삭제하지 않음');
        }
      } else {
        logger.info(`🔨 ${this.codePatternClassName} 스키마 생성 중...`);
        await this.createCodePatternSchema();
        logger.info(`✅ ${this.codePatternClassName} 스키마 생성 완료`);
      }

      // CodingGuideline 스키마 처리
      if (existingClasses.includes(this.guidelineClassName)) {
        logger.info(`✅ 기존 ${this.guidelineClassName} 스키마 확인됨`);
      } else {
        logger.info(`🔨 ${this.guidelineClassName} 스키마 생성 중...`);
        await this.createCodingGuidelineSchema();
        logger.info(`✅ ${this.guidelineClassName} 스키마 생성 완료`);
      }

      logger.info('✅ 모든 스키마 초기화 완료');
    } catch (error) {
      logger.error('❌ 스키마 초기화 실패:', error.message);
      throw error;
    }
  }

  validateSchemaCompatibility(existingSchema) {
    const requiredProperties = ['issueRecordId', 'title', 'category', 'severity'];
    const existingProperties = existingSchema.properties.map(p => p.name);
    return requiredProperties.every(prop => existingProperties.includes(prop));
  }

  createCodePatternSchema() {
    return this.client.schema
      .classCreator()
      .withClass({
        class: this.codePatternClassName,
        description: 'Java code pattern dataset for quality analysis',
        vectorizer: 'none',
        properties: [
          { name: 'issueRecordId', dataType: ['text'], description: 'Unique issue record identifier' },
          { name: 'patternData', dataType: ['text'], description: 'Complete pattern data as JSON' },
          { name: 'title', dataType: ['text'], description: 'Issue title' },
          { name: 'category', dataType: ['text'], description: 'Pattern category' },
          { name: 'severity', dataType: ['text'], description: 'Issue severity level' },
          { name: 'tags', dataType: ['text[]'], description: 'Pattern tags' },
          { name: 'antiPatternCode', dataType: ['text'], description: 'Problematic code template' },
          { name: 'recommendedPatternCode', dataType: ['text'], description: 'Recommended code template' },
          { name: 'semanticSignature', dataType: ['text'], description: 'Semantic pattern signature' },
          { name: 'frameworkVersion', dataType: ['text'], description: 'Framework version' },
          { name: 'occurrenceFrequency', dataType: ['int'], description: 'Historical occurrence frequency' },
          { name: 'qualityScore', dataType: ['number'], description: 'Data quality score' },
          { name: 'astSignature', dataType: ['text'], description: 'AST structure signature' },
          { name: 'astNodeTypes', dataType: ['text[]'], description: 'AST node types' },
          { name: 'cyclomaticComplexity', dataType: ['int'], description: 'Cyclomatic complexity' },
          { name: 'maxDepth', dataType: ['int'], description: 'Maximum nesting depth' }
        ]
      })
      .do();
  }

  createCodingGuidelineSchema() {
    const weaviateConfig = config.vector.weaviate;
    
    return this.client.schema
      .classCreator()
      .withClass({
        class: this.guidelineClassName,
        description: 'Development guideline rules for code quality checking',
        vectorizer: 'text2vec-ollama',
        moduleConfig: {
          'text2vec-ollama': {
            apiEndpoint: weaviateConfig.ollamaEndpoint,
            model: weaviateConfig.embeddingModel
          }
        },
        properties: [
          { name: 'ruleId', dataType: ['text'], description: 'Unique rule identifier' },
          { name: 'ruleTitle', dataType: ['text'], description: 'Human readable rule title', 
            moduleConfig: { 'text2vec-ollama': { skip: false, vectorizePropertyName: true } } },
          { name: 'category', dataType: ['text'], description: 'Rule category' },
          { name: 'checkType', dataType: ['text'], description: 'Check method' },
          { name: 'description', dataType: ['text'], description: 'Detailed rule description',
            moduleConfig: { 'text2vec-ollama': { skip: false, vectorizePropertyName: true } } },
          { name: 'keywords', dataType: ['text[]'], description: 'Keywords for relevance filtering' },
          { name: 'severity', dataType: ['text'], description: 'Rule severity' },
          { name: 'examples', dataType: ['text'], description: 'Good and bad examples as JSON' },
          { name: 'patterns', dataType: ['text[]'], description: 'Regex patterns' },
          { name: 'message', dataType: ['text'], description: 'Violation message template' },
          { name: 'parentChapter', dataType: ['text'], description: 'Parent chapter reference' },
          { name: 'isActive', dataType: ['boolean'], description: 'Rule is active' }
        ]
      })
      .do();
  }

  async storePattern(dataset) {
    try {
      const id = uuidv4();
      const props = {
        issueRecordId: dataset.issue_record_id,
        patternData: JSON.stringify(dataset),
        title: dataset.metadata?.title || '',
        category: dataset.metadata?.category || 'general',
        severity: dataset.metadata?.severity || 'MEDIUM',
        tags: dataset.metadata?.tags || [],
        antiPatternCode: dataset.anti_pattern?.code_template || '',
        recommendedPatternCode: dataset.recommended_pattern?.code_template || '',
        semanticSignature: dataset.anti_pattern?.pattern_signature?.semantic_signature || '',
        frameworkVersion: dataset.framework_context?.framework_version || 'unknown',
        occurrenceFrequency: dataset.impact_analysis?.historical_data?.occurrence_frequency ?? 1,
        qualityScore: dataset.validation_info?.quality_score ?? 0,
        astSignature: dataset.embeddings?.ast_analysis?.signature || '',
        astNodeTypes: dataset.embeddings?.ast_analysis?.nodeTypes || [],
        cyclomaticComplexity: dataset.embeddings?.ast_analysis?.cyclomaticComplexity ?? 1,
        maxDepth: dataset.embeddings?.ast_analysis?.maxDepth ?? 1,
      };

      await this.client.data
        .creator()
        .withClassName(this.codePatternClassName)
        .withId(id)
        .withProperties(props)
        .withVector(dataset.embeddings?.combined_embedding || undefined)
        .do();

      logger.info(`✅ 패턴 저장 완료: ${dataset.issue_record_id}`);
    } catch (error) {
      logger.error(`패턴 저장 오류 (${dataset.issue_record_id}):`, error.message);
      throw error;
    }
  }

  async searchSimilarPatterns(queryVector, limit = 5, threshold = 0.7) {
    try {
      const result = await this.client.graphql
        .get()
        .withClassName(this.codePatternClassName)
        .withFields('issueRecordId title category severity semanticSignature qualityScore astSignature cyclomaticComplexity maxDepth patternData')
        .withNearVector({ vector: queryVector, distance: 1 - threshold })
        .withLimit(limit)
        .do();

      const patterns = result.data?.Get?.[this.codePatternClassName] || [];

      return patterns.map(pattern => ({
        id: pattern.issueRecordId,
        title: pattern.title,
        category: pattern.category,
        severity: pattern.severity,
        semanticSignature: pattern.semanticSignature,
        astSignature: pattern.astSignature,
        cyclomaticComplexity: pattern.cyclomaticComplexity,
        maxDepth: pattern.maxDepth,
        qualityScore: pattern.qualityScore,
        fullData: JSON.parse(pattern.patternData || '{}')
      }));
    } catch (error) {
      logger.error('유사 패턴 검색 오류:', error.message);
      return [];
    }
  }

  async getAllPatterns(limit = 100) {
    try {
      const result = await this.client.graphql
        .get()
        .withClassName(this.codePatternClassName)
        .withFields('issueRecordId title category severity')
        .withLimit(limit)
        .do();

      return result.data?.Get?.[this.codePatternClassName] || [];
    } catch (error) {
      logger.error('전체 패턴 조회 오류:', error.message);
      return [];
    }
  }

  async storeGuideline(guideline) {
    try {
      const id = uuidv4();
      const patternsArray = (guideline.patterns || []).map(p => {
        if (typeof p === 'string') return p;
        if (typeof p === 'object' && p.pattern) {
          return p.description ? `${p.pattern} (${p.description})` : p.pattern;
        }
        return JSON.stringify(p);
      });

      const props = {
        ruleId: guideline.ruleId,
        ruleTitle: guideline.title,
        category: guideline.category,
        checkType: guideline.checkType,
        description: guideline.description || '',
        keywords: guideline.keywords || [],
        severity: guideline.severity,
        examples: JSON.stringify(guideline.examples || {}),
        patterns: patternsArray,
        message: guideline.message || '',
        parentChapter: guideline.parentChapter || '',
        isActive: guideline.isActive !== false
      };

      await this.client.data
        .creator()
        .withClassName(this.guidelineClassName)
        .withId(id)
        .withProperties(props)
        .do();

      logger.info(`✅ 가이드라인 저장 완료: ${guideline.ruleId}`);
      return id;
    } catch (error) {
      logger.error(`가이드라인 저장 오류 (${guideline.ruleId}):`, error.message);
      throw error;
    }
  }

  async searchGuidelines(filters = {}) {
    try {
      let query = this.client.graphql
        .get()
        .withClassName(this.guidelineClassName)
        .withFields('ruleId ruleTitle category checkType description keywords severity examples patterns message isActive');

      if (filters.category) {
        query = query.withWhere({ path: ['category'], operator: 'Equal', valueString: filters.category });
      }

      if (filters.checkType) {
        query = query.withWhere({ path: ['checkType'], operator: 'Equal', valueString: filters.checkType });
      }

      if (filters.isActive !== undefined) {
        query = query.withWhere({ path: ['isActive'], operator: 'Equal', valueBoolean: filters.isActive });
      }

      const result = await query.withLimit(filters.limit || 100).do();
      const guidelines = result.data?.Get?.[this.guidelineClassName] || [];

      return guidelines.map(g => ({
        ruleId: g.ruleId,
        title: g.ruleTitle,
        category: g.category,
        checkType: g.checkType,
        description: g.description,
        keywords: g.keywords,
        severity: g.severity,
        examples: this.parseExamples(g.examples),
        patterns: g.patterns,
        message: g.message,
        isActive: g.isActive
      }));
    } catch (error) {
      logger.error('가이드라인 검색 오류:', error.message);
      return [];
    }
  }

  async searchGuidelinesByKeywords(keywords, limit = 10) {
    try {
      const result = await this.client.graphql
        .get()
        .withClassName(this.guidelineClassName)
        .withFields('ruleId ruleTitle category checkType description keywords severity examples patterns message')
        .withWhere({
          operator: 'Or',
          operands: keywords.map(keyword => ({
            path: ['keywords'],
            operator: 'ContainsAny',
            valueString: [keyword]
          }))
        })
        .withLimit(limit)
        .do();

      const guidelines = result.data?.Get?.[this.guidelineClassName] || [];
      return guidelines.map(g => ({
        ruleId: g.ruleId,
        title: g.ruleTitle,
        category: g.category,
        checkType: g.checkType,
        description: g.description,
        keywords: g.keywords,
        severity: g.severity,
        examples: this.parseExamples(g.examples),
        patterns: g.patterns,
        message: g.message
      }));
    } catch (error) {
      logger.error('키워드 기반 가이드라인 검색 오류:', error.message);
      return [];
    }
  }

  async updateGuidelineStatus(ruleId, isActive) {
    try {
      const searchResult = await this.client.graphql
        .get()
        .withClassName(this.guidelineClassName)
        .withFields('_additional { id }')
        .withWhere({ path: ['ruleId'], operator: 'Equal', valueString: ruleId })
        .withLimit(1)
        .do();

      const guidelines = searchResult.data?.Get?.[this.guidelineClassName];
      if (!guidelines || guidelines.length === 0) {
        throw new Error(`가이드라인을 찾을 수 없습니다: ${ruleId}`);
      }

      const guidelineId = guidelines[0]._additional.id;

      await this.client.data
        .updater()
        .withClassName(this.guidelineClassName)
        .withId(guidelineId)
        .withProperties({ isActive })
        .do();

      logger.info(`✅ 가이드라인 상태 업데이트 완료: ${ruleId} -> ${isActive}`);
    } catch (error) {
      logger.error(`가이드라인 상태 업데이트 오류 (${ruleId}):`, error.message);
      throw error;
    }
  }

  async deleteGuideline(ruleId) {
    try {
      const searchResult = await this.client.graphql
        .get()
        .withClassName(this.guidelineClassName)
        .withFields('_additional { id }')
        .withWhere({ path: ['ruleId'], operator: 'Equal', valueString: ruleId })
        .withLimit(1)
        .do();

      const guidelines = searchResult.data?.Get?.[this.guidelineClassName];
      if (!guidelines || guidelines.length === 0) {
        throw new Error(`가이드라인을 찾을 수 없습니다: ${ruleId}`);
      }

      const guidelineId = guidelines[0]._additional.id;

      await this.client.data
        .deleter()
        .withClassName(this.guidelineClassName)
        .withId(guidelineId)
        .do();

      logger.info(`✅ 가이드라인 삭제 완료: ${ruleId}`);
    } catch (error) {
      logger.error(`가이드라인 삭제 오류 (${ruleId}):`, error.message);
      throw error;
    }
  }

  async searchByASTPattern(astSignature, limit = 5) {
    try {
      const result = await this.client.graphql
        .get()
        .withClassName(this.codePatternClassName)
        .withFields('issueRecordId title category astSignature cyclomaticComplexity maxDepth')
        .withWhere({ path: ['astSignature'], operator: 'Like', valueText: `*${astSignature}*` })
        .withLimit(limit)
        .do();

      return result.data?.Get?.[this.codePatternClassName] || [];
    } catch (error) {
      logger.error('AST 패턴 검색 오류:', error.message);
      return [];
    }
  }

  async searchByComplexity(minComplexity, maxComplexity, limit = 10) {
    try {
      const result = await this.client.graphql
        .get()
        .withClassName(this.codePatternClassName)
        .withFields('issueRecordId title category cyclomaticComplexity maxDepth qualityScore')
        .withWhere({
          operator: 'And',
          operands: [
            { path: ['cyclomaticComplexity'], operator: 'GreaterThanEqual', valueInt: minComplexity },
            { path: ['cyclomaticComplexity'], operator: 'LessThanEqual', valueInt: maxComplexity }
          ]
        })
        .withLimit(limit)
        .do();

      return result.data?.Get?.[this.codePatternClassName] || [];
    } catch (error) {
      logger.error('복잡도 기반 검색 오류:', error.message);
      return [];
    }
  }

  async deletePattern(patternId) {
    try {
      await this.client.data.deleter()
        .withClassName(this.codePatternClassName)
        .withId(patternId)
        .do();
      logger.info(`✅ 패턴 삭제 완료: ${patternId}`);
    } catch (error) {
      logger.error(`패턴 삭제 오류 (${patternId}):`, error.message);
      throw error;
    }
  }

  async checkConnection() {
    try {
      await this.client.misc.metaGetter().do();
      logger.info('✅ Weaviate 연결 성공');
      return true;
    } catch (error) {
      logger.error('Weaviate 연결 실패:', error.message);
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

  async getSystemStats() {
    try {
      const codePatternCount = await this.getClassObjectCount(this.codePatternClassName);
      const guidelineCount = await this.getClassObjectCount(this.guidelineClassName);

      return {
        codePatterns: codePatternCount,
        guidelines: guidelineCount,
        totalObjects: codePatternCount + guidelineCount
      };
    } catch (error) {
      logger.error('시스템 상태 조회 오류:', error.message);
      return { codePatterns: 0, guidelines: 0, totalObjects: 0 };
    }
  }

  async getClassObjectCount(className) {
    try {
      const result = await this.client.graphql
        .aggregate()
        .withClassName(className)
        .withFields('meta { count }')
        .do();

      return result.data?.Aggregate?.[className]?.[0]?.meta?.count || 0;
    } catch (error) {
      return 0;
    }
  }
}