/**
 * LLM 서비스 수정 버전
 * 
 * 주요 변경점:
 * 1. LLMClient 대신 LLMAbstractionLayer 직접 사용
 * 2. Provider 감지 및 자동 전환
 * 3. 하위 호환성 유지 (기존 코드 영향 최소화)
 */

import { config } from '../config.js';
import { LLMAbstractionLayer } from './llmAbstractionLayer.js';
import logger from '../utils/loggerUtils.js';

export class LLMService {
  constructor() {

    this.llmLayer = new LLMAbstractionLayer(config);

    // 하위 호환성을 위한 속성들
    this.baseUrl = this.llmLayer.baseURL;
    this.model = this.llmLayer.model;
    this.provider = this.llmLayer.provider;
    this.isQwen3 = this.model && this.model.toLowerCase().includes('qwen');

    logger.info(`🔧 LLM 서비스 초기화 완료`);
    logger.info(`   📍 Provider: ${this.provider}`);
    logger.info(`   🤖 모델: ${this.model}`);
    
    if (this.isQwen3) {
      logger.info('🔥 Qwen3 최적화 모드 활성화');
    }
  }

  /**
   * 서비스 초기화
   */
  async initialize() {
    try {
      await this.llmLayer.checkConnection();
      logger.info('✅ LLM 서비스 초기화 및 연결 확인 완료');
      return true;
    } catch (error) {
      logger.error('❌ LLM 서비스 초기화 실패:', error.message);
      throw error;
    }
  }

  /**
   * LLM Completion 생성 (통합 인터페이스)
   * 
   * 기존 코드와의 호환성을 위해 동일한 시그니처 유지
   */
  async generateCompletion(prompt, options = {}) {
    // 기존: return await this.llmClient.generateCompletion(prompt, options);
    // 변경:
    return await this.llmLayer.generateCompletion(prompt, options);
  }

  /**
   * 연결 테스트
   */
  async checkConnection() {
    return await this.llmLayer.checkConnection();
  }

  /**
   * llmClient 접근 (하위 호환성)
   * 
   * 기존 코드에서 this.llmService.llmClient.cleanAndExtractJSON() 형태로
   * 호출하는 경우를 위한 Proxy
   */
  get llmClient() {
    return {
      cleanAndExtractJSON: (response) => {
        return this.llmLayer.cleanAndExtractJSON(response);
      },
      generateCompletion: (prompt, options) => {
        return this.llmLayer.generateCompletion(prompt, options);
      },
      checkConnection: () => {
        return this.llmLayer.checkConnection();
      }
    };
  }

  /**
   * 코드 이슈를 분석하여 패턴 JSON 생성
   * (기존 로직 유지)
   */
  async generateBasicPattern(issueData) {
    let lastError = null;

    const strategies = [
      { name: 'optimized', temp: 0.1, tokens: 2500 },
      { name: 'structured', temp: 0.05, tokens: 2000 },
      { name: 'simple', temp: 0.1, tokens: 1200 },
      { name: 'micro', temp: 0.1, tokens: 800 }
    ];

    for (let i = 0; i < strategies.length; i++) {
      const strategy = strategies[i];

      try {
        logger.info(`🎯 전략 ${i + 1}/${strategies.length}: ${strategy.name} (temp: ${strategy.temp}, tokens: ${strategy.tokens})`);

        const prompt = this.createBasicPatternPrompt(issueData, strategy.name);
        logger.info(`   📝 ${strategy.name} 전략 프롬프트 길이: ${prompt.length}자`);

        const options = {
          temperature: strategy.temp,
          num_predict: strategy.tokens,
          max_tokens: strategy.tokens,
          top_p: 0.9,
          repeat_penalty: 1.1
        };

        // 기존: const response = await this.llmClient.generateCompletion(prompt, options);
        // 변경:
        const response = await this.llmLayer.generateCompletion(prompt, options);
        logger.info('📋 LLM 응답에서 JSON 추출 중...');

        const extractedJSON = this.extractJSONWithMultipleMethods(response);

        if (extractedJSON && this.validatePatternStructure(extractedJSON)) {
          logger.info(`✅ 전략 ${strategy.name}으로 JSON 추출 성공`);
          return this.enhanceExtractedPattern(extractedJSON, issueData);
        } else {
          logger.info(`❌ 전략 ${strategy.name} JSON 추출 실패`);
        }

      } catch (error) {
        logger.error(`❌ 전략 ${strategy.name} 오류:`, error.message);
        lastError = error;

        if (i === 0) {
          logger.info('⏳ 첫 번째 전략 실패, 5초 후 다음 전략 시도...');
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
    }

    logger.info('⚠️ 모든 전략 실패, 폴백 패턴 사용');
    return this.createEnhancedFallbackPattern(issueData, lastError);
  }

  /**
   * 프레임워크 분석
   */
  async generateFrameworkAnalysis(issueData, detectedAnnotations, detectedClasses) {
    const prompt = this.createFrameworkAnalysisPrompt(
      issueData, detectedAnnotations, detectedClasses
    );

    try {
      // 기존: const response = await this.llmClient.generateCompletion(prompt, {...});
      // 변경:
      const response = await this.llmLayer.generateCompletion(prompt, {
        temperature: 0.1,
        num_predict: 2000,
        max_tokens: 2000
      });

      logger.info('📁 프레임워크 분석 결과에서 JSON 추출 중...');
      const extractedJSON = this.extractJSONWithMultipleMethods(response);

      if (extractedJSON) {
        logger.info('✅ 프레임워크 분석 JSON 추출 성공');
        return extractedJSON;
      } else {
        logger.info('❌ 프레임워크 분석 JSON 추출 실패, 폴백 사용');
        return this.createFallbackFrameworkContext(detectedAnnotations, detectedClasses);
      }

    } catch (error) {
      logger.error('❌ 프레임워크 분석 오류:', error.message);
      logger.info('⚠️ 폴백 분석 결과를 사용합니다');
      return this.createFallbackFrameworkContext(detectedAnnotations, detectedClasses);
    }
  }

  /**
   * 가이드라인 분석
   */
  async generateGuidelineAnalysis(prompt, options = {}) {
    logger.info('🧠 가이드라인 분석 요청 처리 중...');

    try {
      const response = await this.generateCompletion(prompt, {
        temperature: 0.1,
        num_predict: 2000,
        max_tokens: 2000,
        ...options
      });

      if (!response || response.trim() === '') {
        console.warn('⚠️ 빈 응답 수신');
        return null;
      }

      // 기존: const jsonResult = this.llmClient.cleanAndExtractJSON(response);
      // 변경:
      const jsonResult = this.llmLayer.cleanAndExtractJSON(response);

      if (!jsonResult) {
        console.warn('⚠️ JSON 추출 실패, 원본 응답 반환');
        return {
          enhancedGuideline: {
            checkType: 'static_analysis',
            enhancedDescription: response.substring(0, 300),
            businessRules: [],
            patterns: [],
            astHints: {},
            examples: { good: [], bad: [] },
            contextualChecks: []
          }
        };
      }

      return {
        enhancedGuideline: {
          checkType: jsonResult.checkType || 'static_analysis',
          enhancedDescription: jsonResult.enhancedDescription || jsonResult.description || '',
          businessRules: jsonResult.businessRules || [],
          patterns: jsonResult.patterns || [],
          astHints: jsonResult.astHints || {},
          examples: {
            good: jsonResult.examples?.good || [],
            bad: jsonResult.examples?.bad || []
          },
          contextualChecks: jsonResult.contextualChecks || []
        }
      };

    } catch (error) {
      logger.error('❌ 가이드라인 분석 중 오류:', error.message);
      throw error;
    }
  }

    /**
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * 이미지 분석 (Ollama Vision 모델 사용)
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * 
   * Ollama Vision API를 사용하여 이미지의 내용을 분석합니다.
   * 
   * @param {string} base64Image - Base64 인코딩된 이미지 데이터
   * @param {string} mimeType - 이미지 MIME 타입 (image/png, image/jpeg 등)
   * @param {string} prompt - 분석 요청 프롬프트
   * @returns {Promise<string>} 이미지 분석 결과 텍스트
   * 
   * @example
   * const result = await llmService.analyzeImage(
   *   imageBase64,
   *   'image/png',
   *   '이 다이어그램의 내용을 설명해주세요.'
   * );
   */
    async analyzeImage(base64Image, mimeType, prompt) {
      logger.info('🖼️ 이미지 분석 요청 처리 중...');
      
      try {
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        // Step 1: Provider 확인 (Ollama만 Vision 지원)
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        if (this.provider !== 'ollama') {
          logger.warn('⚠️ 이미지 분석은 Ollama Vision 모델만 지원됩니다.');
          logger.warn(`   현재 Provider: ${this.provider}`);
          return '[이미지 분석 미지원: Ollama 환경 필요]';
        }
        
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        // Step 2: Vision 모델 확인
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        const visionModels = ['llava', 'bakllava', 'llava-phi3', 'llava-llama3'];
        const isVisionModel = visionModels.some(vm => 
          this.model.toLowerCase().includes(vm)
        );
        
        if (!isVisionModel) {
          logger.warn(`⚠️ 현재 모델(${this.model})은 Vision을 지원하지 않습니다.`);
          logger.warn(`   Vision 모델로 전환하려면:`);
          logger.warn(`   1. docker exec -it code-pattern-ollama ollama pull llava`);
          logger.warn(`   2. config.js에서 model: 'llava' 설정`);
          return '[이미지 분석 미지원: Vision 모델 필요]';
        }
        
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        // Step 3: Ollama Vision API 호출
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        const response = await this.callOllamaVisionAPI(base64Image, mimeType, prompt);
        
        logger.info('✅ 이미지 분석 완료');
        logger.info(`   결과 길이: ${response.length}자`);
        
        return response;
        
      } catch (error) {
        logger.error('❌ 이미지 분석 중 오류:', error.message);
        logger.error(`   스택 트레이스:`, error.stack);
        return '[이미지 분석 실패]';
      }
    }
  
    /**
     * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     * Ollama Vision API 호출
     * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     * 
     * Ollama /api/generate 엔드포인트에 이미지와 프롬프트를 전송합니다.
     * 
     * API 요청 형식:
     * POST /api/generate
     * {
     *   "model": "llava",
     *   "prompt": "이미지를 설명해주세요",
     *   "images": ["base64_encoded_image"],
     *   "stream": false,
     *   "options": {
     *     "temperature": 0.1,
     *     "num_predict": 500
     *   }
     * }
     * 
     * API 응답 형식:
     * {
     *   "model": "llava",
     *   "created_at": "2025-01-26T...",
     *   "response": "이미지는 데이터 흐름도를 나타내는 다이어그램입니다...",
     *   "done": true
     * }
     * 
     * @param {string} base64Image - Base64 인코딩된 이미지 데이터
     * @param {string} mimeType - 이미지 MIME 타입
     * @param {string} prompt - 분석 요청 프롬프트
     * @returns {Promise<string>} 분석 결과 텍스트
     * @throws {Error} API 호출 실패 시
     */
    async callOllamaVisionAPI(base64Image, mimeType, prompt) {
      const controller = new AbortController();
      const timeoutMs = 60000; // 60초 (이미지 분석은 시간이 더 걸림)
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      
      try {
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        // 요청 본문 생성
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        const requestBody = {
          model: this.model,
          prompt: prompt,
          images: [base64Image], // Base64 이미지 배열
          stream: false,
          options: {
            temperature: 0.1, // 낮은 temperature로 일관된 분석
            num_predict: 500  // 이미지 설명은 길지 않으므로 500 토큰
          }
        };
        
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        // 로그 출력
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        logger.info(`📤 Ollama Vision API 호출:`);
        logger.info(`   URL: ${this.baseUrl}/api/generate`);
        logger.info(`   모델: ${this.model}`);
        logger.info(`   MIME 타입: ${mimeType}`);
        logger.info(`   이미지 크기: ${(base64Image.length / 1024).toFixed(2)} KB`);
        logger.info(`   프롬프트 길이: ${prompt.length}자`);
        logger.info(`   타임아웃: ${timeoutMs}ms`);
        
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        // API 호출
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        const response = await fetch(`${this.baseUrl}/api/generate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        });
        
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        // 응답 검증
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(
            `Ollama Vision API 오류: ${response.status} ${response.statusText}\n${errorText}`
          );
        }
        
        const data = await response.json();
        
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        // 응답 추출
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        if (!data.response) {
          logger.warn('⚠️ Ollama Vision API 응답에 response 필드 없음');
          logger.warn('   응답 데이터:', JSON.stringify(data, null, 2));
          return '[이미지 분석 결과 없음]';
        }
        
        logger.info('✅ Ollama Vision API 호출 성공');
        
        return data.response;
        
      } catch (error) {
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        // 에러 처리
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        if (error.name === 'AbortError') {
          logger.error(`❌ Ollama Vision API 타임아웃 (${timeoutMs}ms 초과)`);
          throw new Error('이미지 분석 타임아웃');
        }
        
        logger.error('❌ Ollama Vision API 호출 실패:', error.message);
        throw error;
        
      } finally {
        clearTimeout(timeoutId);
      }
    }

  /**
   * 여러 JSON 추출 방법을 순차적으로 시도
   */
  extractJSONWithMultipleMethods(response) {
    const methods = [
      () => this.llmLayer.cleanAndExtractJSON(response),
      () => this.extractJSONFromCodeBlocks(response),
      () => this.extractJSONWithRegex(response),
      () => this.extractJSONFromText(response)
    ];

    for (const method of methods) {
      try {
        const result = method();
        if (result && typeof result === 'object') {
          return result;
        }
      } catch (error) {
        continue;
      }
    }

    return null;
  }

  // ========================================
  // 나머지 헬퍼 메서드들은 기존 코드 그대로 유지
  // ========================================

  extractJSONFromCodeBlocks(response) {
    const codeBlockRegex = /```(?:json)?\s*\n?([\s\S]*?)\n?```/;
    const match = response.match(codeBlockRegex);
    
    if (match && match[1]) {
      try {
        return JSON.parse(match[1].trim());
      } catch (error) {
        return null;
      }
    }
    return null;
  }

  extractJSONWithRegex(response) {
    const jsonRegex = /\{[\s\S]*\}/;
    const match = response.match(jsonRegex);
    
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (error) {
        return null;
      }
    }
    return null;
  }

  extractJSONFromText(response) {
    try {
      const firstBrace = response.indexOf('{');
      const lastBrace = response.lastIndexOf('}');
      
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        const jsonStr = response.substring(firstBrace, lastBrace + 1);
        return JSON.parse(jsonStr);
      }
    } catch (error) {
      return null;
    }
    return null;
  }

  validatePatternStructure(pattern) {
    return pattern && 
           typeof pattern === 'object' &&
           (pattern.metadata || pattern.anti_pattern || pattern.recommended_pattern);
  }

  enhanceExtractedPattern(extractedJSON, issueData) {
    return {
      ...extractedJSON,
      _metadata: {
        extractedAt: new Date().toISOString(),
        provider: this.provider,
        model: this.model,
        sourceIssue: issueData.title || 'unknown'
      }
    };
  }

  createBasicPatternPrompt(issueData, strategy) {
    // 기존 프롬프트 로직 유지
    return `이슈 데이터를 분석하여 패턴 JSON을 생성하세요...`;
  }

  createFrameworkAnalysisPrompt(issueData, annotations, classes) {
    // 기존 프롬프트 로직 유지
    return `프레임워크 구성요소를 분석해주세요...`;
  }

  truncateCode(code, maxLength) {
    if (!code || code.length <= maxLength) return code;
    const truncated = code.substring(0, maxLength);
    const lastNewline = truncated.lastIndexOf('\n');
    return lastNewline > maxLength * 0.7 ?
      truncated.substring(0, lastNewline) + '\n// ... truncated' :
      truncated + '...';
  }

  createEnhancedFallbackPattern(issueData, error) {
    logger.info('🔧 향상된 폴백 패턴 생성 중...');
    return {
      metadata: {
        title: issueData.title || '자동 분석된 코딩 패턴 이슈',
        category: issueData.category || 'resource_management',
        severity: issueData.severity || 'MEDIUM',
        tags: ['fallback-generated', 'requires-review', this.provider]
      },
      _fallback_info: {
        reason: error ? error.message : 'All strategies failed',
        timestamp: new Date().toISOString(),
        model: this.model,
        provider: this.provider,
        requires_manual_review: true
      }
    };
  }

  createFallbackFrameworkContext(annotations, classes) {
    return {
      detection_rules: {
        ast_rules: [{
          rule_name: "fallback_ast_rule",
          rule_expression: ".*",
          confidence_score: 0.3
        }],
        semantic_rules: [{
          rule_name: "fallback_semantic_rule",
          rule_description: "기본 의미론적 규칙 - 수동 검토 필요",
          pattern_indicators: ["requires_manual_review"]
        }]
      },
      framework_context: {
        framework_version: 'unknown',
        applicable_components: {
          custom_annotations: annotations || [],
          custom_classes: classes || [],
          framework_apis: []
        }
      }
    };
  }

  analyzeCodeIssues(code, type) {
    const issues = [];
    if (!code || typeof code !== 'string') {
      return [`${type} analysis requires valid code`];
    }

    switch (type) {
      case 'missing':
        if (!code.includes('try') && !code.includes('catch')) {
          issues.push('예외 처리 누락');
        }
        if (!code.includes('close') && (code.includes('InputStream') || code.includes('Connection'))) {
          issues.push('리소스 해제 누락');
        }
        break;

      case 'incorrect':
        if (code.includes('== null')) {
          issues.push('null 체크 방식 개선 필요');
        }
        if (code.includes('printStackTrace()')) {
          issues.push('적절한 로깅 처리 필요');
        }
        break;

      case 'violations':
        if (code.includes('System.out.println')) {
          issues.push('프로덕션 환경에 부적절한 출력');
        }
        if (code.includes('Thread.sleep')) {
          issues.push('블로킹 방식의 대기 사용');
        }
        break;
    }

    return issues.length > 0 ? issues : [`${type} 분석 결과 없음`];
  }
}