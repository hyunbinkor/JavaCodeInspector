import weaviate, { ApiKey } from 'weaviate-ts-client';
import { config } from '../config.js';
import { v4 as uuidv4 } from 'uuid';

export class WeaviateClient {
  constructor() {
    this.client = this.initializeClient();
    this.codePatternClassName = 'CodePattern';
    this.guidelineClassName = 'CodingGuideline';
  }

  initializeClient() {
    const clientConfig = {
      scheme: config.weaviate.url.startsWith('https') ? 'https' : 'http',
      host: config.weaviate.url.replace(/^https?:\/\//, ''),
    };

    // localhost나 127.0.0.1인지 확인하여 로컬 환경 여부 판단
    const isLocal = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(clientConfig.host);

    // API 키가 설정되어 있고, 환경변수로 API 키 인증이 명시되어 있으며, 로컬 환경이 아닌 경우에만 API 키 인증 적용
    if (config.weaviate.apiKey && process.env.WEAVIATE_AUTH === 'api-key' && !isLocal) {
      clientConfig.apiKey = new ApiKey(config.weaviate.apiKey);
      console.log('🔐 API Key 인증 사용');
    } else {
      console.log('🔓 익명 접근 모드 (로컬 환경)');
    }

    return weaviate.client(clientConfig);
  }

  async initializeSchema() {
    try {
      // Weaviate에서 현재 저장된 스키마 정보 가져오기
      const schema = await this.client.schema.getter().do();
      const existingClasses = schema.classes.map(c => c.class);

      // CodePattern 스키마가 이미 존재하는지 확인
      if (existingClasses.includes('CodePattern')) {
        console.log('✅ 기존 CodePattern 스키마 확인됨');

        // 기존 스키마가 필수 속성들을 모두 포함하고 있는지 호환성 검증
        const existingSchema = schema.classes.find(c => c.class === 'CodePattern');
        const isCompatible = this.validateSchemaCompatibility(existingSchema);

        if (isCompatible) {
          console.log('✅ 기존 스키마 호환 가능, 재생성 건너뛰기');
        } else {
          console.warn('⚠️ 스키마 비호환: 수동 마이그레이션 필요');
          console.warn('⚠️ 데이터 손실 방지를 위해 스키마 삭제하지 않음');
          // 데이터 보존을 위해 경고만 출력하고 스키마는 삭제하지 않음
        }
      } else {
        // 스키마가 없는 경우에만 새로 생성
        console.log('🔨 CodePattern 스키마 생성 중...');
        await this.createCodePatternSchema();
        console.log('✅ CodePattern 스키마 생성 완료');
      }

      // CodingGuideline 스키마도 동일한 로직으로 처리
      if (existingClasses.includes('CodingGuideline')) {
        console.log('✅ 기존 CodingGuideline 스키마 확인됨');
      } else {
        console.log('🔨 CodingGuideline 스키마 생성 중...');
        await this.createCodingGuidelineSchema();
        console.log('✅ CodingGuideline 스키마 생성 완료');
      }

      console.log('✅ 모든 스키마 초기화 완료');
    } catch (error) {
      console.error('❌ 스키마 초기화 실패:', error.message);
      throw error;
    }
  }

  validateSchemaCompatibility(existingSchema) {
    // 기존 스키마에 필수 속성들이 모두 존재하는지 확인
    const requiredProperties = [
      'issueRecordId',
      'title',
      'category',
      'severity'
    ];

    const existingProperties = existingSchema.properties.map(p => p.name);
    const hasAllRequired = requiredProperties.every(prop =>
      existingProperties.includes(prop)
    );

    return hasAllRequired;
  }

  createCodePatternSchema() {
    return this.client.schema
      .classCreator()
      .withClass({
        class: this.codePatternClassName,
        description: 'Java code pattern dataset for quality analysis',
        vectorizer: 'none',  // 중요: 수동 벡터 주입 사용
        properties: [
          {
            name: 'issueRecordId',
            dataType: ['text'],
            description: 'Unique issue record identifier'
          },
          {
            name: 'patternData',
            dataType: ['text'],
            description: 'Complete pattern data as JSON'
          },
          {
            name: 'title',
            dataType: ['text'],
            description: 'Issue title'
          },
          {
            name: 'category',
            dataType: ['text'],
            description: 'Pattern category'
          },
          {
            name: 'severity',
            dataType: ['text'],
            description: 'Issue severity level'
          },
          {
            name: 'tags',
            dataType: ['text[]'],
            description: 'Pattern tags'
          },
          {
            name: 'antiPatternCode',
            dataType: ['text'],
            description: 'Problematic code template'
          },
          {
            name: 'recommendedPatternCode',
            dataType: ['text'],
            description: 'Recommended code template'
          },
          {
            name: 'semanticSignature',
            dataType: ['text'],
            description: 'Semantic pattern signature'
          },
          {
            name: 'frameworkVersion',
            dataType: ['text'],
            description: 'Framework version'
          },
          {
            name: 'occurrenceFrequency',
            dataType: ['int'],
            description: 'Historical occurrence frequency'
          },
          {
            name: 'qualityScore',
            dataType: ['number'],
            description: 'Data quality score'
          },
          {
            name: 'astSignature',
            dataType: ['text'],
            description: 'AST structure signature for pattern matching'
          },
          {
            name: 'astNodeTypes',
            dataType: ['text[]'],
            description: 'AST node types found in code'
          },
          {
            name: 'cyclomaticComplexity',
            dataType: ['int'],
            description: 'Cyclomatic complexity from AST analysis'
          },
          {
            name: 'maxDepth',
            dataType: ['int'],
            description: 'Maximum nesting depth from AST'
          }
        ]
      })
      .do();  // ✅ 이 부분이 핵심!
  }

  createCodingGuidelineSchema() {
    // Docker 컨테이너 내부에서 실행 중인지 환경변수로 확인
    const isDockerEnvironment = process.env.DOCKER_ENV === 'true' ||
      process.env.WEAVIATE_HOST?.includes('weaviate');

    // Docker 내부에서는 서비스명(ollama)으로 접근, 외부에서는 host.docker.internal 사용
    const ollamaEndpoint = isDockerEnvironment ?
      'http://ollama:11434' :
      'http://host.docker.internal:11434';

    console.log(`🔧 Ollama endpoint 설정: ${ollamaEndpoint}`);

    return this.client.schema
      .classCreator()
      .withClass({
        class: this.guidelineClassName,
        description: 'Development guideline rules for code quality checking',
        vectorizer: 'text2vec-ollama',
        moduleConfig: {
          'text2vec-ollama': {
            apiEndpoint: ollamaEndpoint,
            model: 'nomic-embed-text'
          }
        },
        properties: [
          {
            name: 'ruleId',
            dataType: ['text'],
            description: 'Unique rule identifier (e.g., 3.3.7.6.1)'
          },
          {
            name: 'ruleTitle',
            dataType: ['text'],
            description: 'Human readable rule title',
            moduleConfig: {
              'text2vec-ollama': {
                skip: false,
                vectorizePropertyName: true
              }
            }
          },
          {
            name: 'category',
            dataType: ['text'],
            description: 'Rule category (formatting, naming_convention, architecture, etc.)'
          },
          {
            name: 'checkType',
            dataType: ['text'],
            description: 'Check method: regex, ast, llm_contextual, combined'
          },
          {
            name: 'description',
            dataType: ['text'],
            description: 'Detailed rule description for contextual rules',
            moduleConfig: {
              'text2vec-ollama': {
                skip: false,
                vectorizePropertyName: true
              }
            }
          },
          {
            name: 'keywords',
            dataType: ['text[]'],
            description: 'Keywords for relevance filtering'
          },
          {
            name: 'severity',
            dataType: ['text'],
            description: 'Rule severity: LOW, MEDIUM, HIGH, CRITICAL'
          },
          {
            name: 'examples',
            dataType: ['text'],
            description: 'Good and bad examples as JSON string'
          },
          {
            name: 'patterns',
            dataType: ['text[]'],
            description: 'Regex patterns for static checking'
          },
          {
            name: 'message',
            dataType: ['text'],
            description: 'Violation message template'
          },
          {
            name: 'parentChapter',
            dataType: ['text'],
            description: 'Parent chapter reference'
          },
          {
            name: 'isActive',
            dataType: ['boolean'],
            description: 'Rule is active for checking'
          }
        ]
      })
      .do();
  }

  // CodePattern 데이터를 Weaviate에 저장
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

      console.log(`✅ 패턴 저장 완료: ${dataset.issue_record_id}`);
    } catch (error) {
      console.error(`패턴 저장 오류 (${dataset.issue_record_id}):`, error.message);
      throw error;
    }
  }

  // 벡터 유사도 기반으로 유사한 코드 패턴 검색
  async searchSimilarPatterns(queryVector, limit = 5, threshold = 0.7) {
    try {
      const result = await this.client.graphql
        .get()
        .withClassName(this.codePatternClassName)
        .withFields('issueRecordId title category severity semanticSignature qualityScore astSignature cyclomaticComplexity maxDepth patternData')
        .withNearVector({
          vector: queryVector,
          certainty: threshold
        })
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
      console.error('유사 패턴 검색 오류:', error.message);
      return [];
    }
  }

  // 저장된 모든 패턴 조회 (최대 limit 개수까지)
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
      console.error('전체 패턴 조회 오류:', error.message);
      return [];
    }
  }

  // 가이드라인 데이터를 Weaviate에 저장
  async storeGuideline(guideline) {
    try {
      const id = uuidv4();

      // patterns 배열의 각 요소를 문자열로 변환 (객체인 경우 설명 포함하여 변환)
      const patternsArray = (guideline.patterns || []).map(p => {
        if (typeof p === 'string') return p;
        if (typeof p === 'object' && p.pattern) {
          return p.description ?
            `${p.pattern} (${p.description})` :
            p.pattern;
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

      console.log(`✅ 가이드라인 저장 완료: ${guideline.ruleId}`);
      return id;
    } catch (error) {
      console.error(`가이드라인 저장 오류 (${guideline.ruleId}):`, error.message);
      throw error;
    }
  }

  // 필터 조건에 맞는 가이드라인 검색 (카테고리, 체크타입, 활성화 상태 등)
  async searchGuidelines(filters = {}) {
    try {
      let query = this.client.graphql
        .get()
        .withClassName(this.guidelineClassName)
        .withFields('ruleId ruleTitle category checkType description keywords severity examples patterns message isActive');

      // 카테고리 필터 적용
      if (filters.category) {
        query = query.withWhere({
          path: ['category'],
          operator: 'Equal',
          valueString: filters.category
        });
      }

      // 체크 타입 필터 적용
      if (filters.checkType) {
        query = query.withWhere({
          path: ['checkType'],
          operator: 'Equal',
          valueString: filters.checkType
        });
      }

      // 활성화 상태 필터 적용
      if (filters.isActive !== undefined) {
        query = query.withWhere({
          path: ['isActive'],
          operator: 'Equal',
          valueBoolean: filters.isActive
        });
      }

      const result = await query.withLimit(filters.limit || 100).do();
      const guidelines = result.data?.Get?.[this.guidelineClassName] || [];

      return guidelines.map(guideline => ({
        ruleId: guideline.ruleId,
        title: guideline.ruleTitle,
        category: guideline.category,
        checkType: guideline.checkType,
        description: guideline.description,
        keywords: guideline.keywords,
        severity: guideline.severity,
        examples: this.parseExamples(guideline.examples),
        patterns: guideline.patterns,
        message: guideline.message,
        isActive: guideline.isActive
      }));
    } catch (error) {
      console.error('가이드라인 검색 오류:', error.message);
      return [];
    }
  }

  // 키워드 배열로 관련 가이드라인 검색 (OR 조건)
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
      return guidelines.map(guideline => ({
        ruleId: guideline.ruleId,
        title: guideline.ruleTitle,
        category: guideline.category,
        checkType: guideline.checkType,
        description: guideline.description,
        keywords: guideline.keywords,
        severity: guideline.severity,
        examples: this.parseExamples(guideline.examples),
        patterns: guideline.patterns,
        message: guideline.message
      }));
    } catch (error) {
      console.error('키워드 기반 가이드라인 검색 오류:', error.message);
      return [];
    }
  }

  // 특정 가이드라인의 활성화 상태 변경
  async updateGuidelineStatus(ruleId, isActive) {
    try {
      // ruleId로 가이드라인의 내부 ID 찾기
      const searchResult = await this.client.graphql
        .get()
        .withClassName(this.guidelineClassName)
        .withFields('_additional { id }')
        .withWhere({
          path: ['ruleId'],
          operator: 'Equal',
          valueString: ruleId
        })
        .withLimit(1)
        .do();

      const guidelines = searchResult.data?.Get?.[this.guidelineClassName];
      if (!guidelines || guidelines.length === 0) {
        throw new Error(`가이드라인을 찾을 수 없습니다: ${ruleId}`);
      }

      const guidelineId = guidelines[0]._additional.id;

      // isActive 속성 업데이트
      await this.client.data
        .updater()
        .withClassName(this.guidelineClassName)
        .withId(guidelineId)
        .withProperties({ isActive })
        .do();

      console.log(`✅ 가이드라인 상태 업데이트 완료: ${ruleId} -> ${isActive}`);
    } catch (error) {
      console.error(`가이드라인 상태 업데이트 오류 (${ruleId}):`, error.message);
      throw error;
    }
  }

  // 특정 가이드라인 삭제
  async deleteGuideline(ruleId) {
    try {
      // ruleId로 가이드라인의 내부 ID 찾기
      const searchResult = await this.client.graphql
        .get()
        .withClassName(this.guidelineClassName)
        .withFields('_additional { id }')
        .withWhere({
          path: ['ruleId'],
          operator: 'Equal',
          valueString: ruleId
        })
        .withLimit(1)
        .do();

      const guidelines = searchResult.data?.Get?.[this.guidelineClassName];
      if (!guidelines || guidelines.length === 0) {
        throw new Error(`가이드라인을 찾을 수 없습니다: ${ruleId}`);
      }

      const guidelineId = guidelines[0]._additional.id;

      // Weaviate에서 가이드라인 삭제
      await this.client.data
        .deleter()
        .withClassName(this.guidelineClassName)
        .withId(guidelineId)
        .do();

      console.log(`✅ 가이드라인 삭제 완료: ${ruleId}`);
    } catch (error) {
      console.error(`가이드라인 삭제 오류 (${ruleId}):`, error.message);
      throw error;
    }
  }

  // 여러 가이드라인을 한 번에 일괄 저장
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

  // AST 시그니처로 패턴 검색 (부분 일치)
  async searchByASTPattern(astSignature, limit = 5) {
    try {
      const result = await this.client.graphql
        .get()
        .withClassName(this.codePatternClassName)
        .withFields('issueRecordId title category astSignature cyclomaticComplexity maxDepth')
        .withWhere({
          path: ['astSignature'],
          operator: 'Like',
          valueText: `*${astSignature}*`
        })
        .withLimit(limit)
        .do();

      return result.data?.Get?.[this.codePatternClassName] || [];
    } catch (error) {
      console.error('AST 패턴 검색 오류:', error.message);
      return [];
    }
  }

  // 순환 복잡도 범위로 패턴 검색
  async searchByComplexity(minComplexity, maxComplexity, limit = 10) {
    try {
      const result = await this.client.graphql
        .get()
        .withClassName(this.codePatternClassName)
        .withFields('issueRecordId title category cyclomaticComplexity maxDepth qualityScore')
        .withWhere({
          operator: 'And',
          operands: [
            {
              path: ['cyclomaticComplexity'],
              operator: 'GreaterThanEqual',
              valueInt: minComplexity
            },
            {
              path: ['cyclomaticComplexity'],
              operator: 'LessThanEqual',
              valueInt: maxComplexity
            }
          ]
        })
        .withLimit(limit)
        .do();

      return result.data?.Get?.[this.codePatternClassName] || [];
    } catch (error) {
      console.error('복잡도 기반 검색 오류:', error.message);
      return [];
    }
  }

  // 특정 패턴 삭제
  async deletePattern(patternId) {
    try {
      await this.client.data.deleter().withClassName(this.codePatternClassName).withId(patternId).do();
      console.log(`✅ 패턴 삭제 완료: ${patternId}`);
    } catch (error) {
      console.error(`패턴 삭제 오류 (${patternId}):`, error.message);
      throw error;
    }
  }

  // Weaviate 서버 연결 상태 확인
  async checkConnection() {
    try {
      await this.client.misc.metaGetter().do();
      console.log('✅ Weaviate 연결 성공');
      return true;
    } catch (error) {
      console.error('Weaviate 연결 실패:', error.message);
      return false;
    }
  }

  // JSON 문자열로 저장된 examples를 객체로 파싱
  parseExamples(examplesString) {
    try {
      return JSON.parse(examplesString || '{}');
    } catch (error) {
      return {};
    }
  }

  // 시스템에 저장된 데이터 통계 조회
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
      console.error('시스템 상태 조회 오류:', error.message);
      return {
        codePatterns: 0,
        guidelines: 0,
        totalObjects: 0
      };
    }
  }

  // 특정 클래스에 저장된 객체 개수 조회
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