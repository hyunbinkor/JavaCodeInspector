/**
 * LLM 추상화 계층 (LLMAbstractionLayer)
 * 
 * Ollama와 vLLM 간의 API 차이를 흡수하여 일관된 인터페이스 제공
 * 
 * 주요 기능:
 * 1. 환경별 자동 감지 (external/internal)
 * 2. 모델명 정규화 (Ollama ↔ vLLM 변환)
 * 3. API 파라미터 변환 및 표준화
 * 4. 응답 형식 통일
 * 5. 에러 처리 및 재시도 로직
 * 
 * 사용 예시:
 * ```javascript
 * const llmLayer = new LLMAbstractionLayer(config);
 * const response = await llmLayer.generateCompletion(prompt, {
 *   temperature: 0.1,
 *   max_tokens: 2000
 * });
 * ```
 * 
 * @module LLMAbstractionLayer
 */

import { config } from '../config/config.js';
import logger from '../utils/loggerUtils.js';

export class LLMAbstractionLayer {
  /**
   * 생성자: LLM 추상화 계층 초기화
   * 
   * @param {Object} customConfig - 선택적 커스텀 설정 (테스트용)
   */
  constructor(customConfig = null) {
    const cfg = customConfig || config;

    // 환경 감지 (NODE_ENV 또는 설정 기반)
    this.environment = process.env.NODE_ENV || cfg.environment || 'external';

    // LLM Provider 결정 (external: ollama, internal: vllm)
    this.provider = this.environment === 'internal' ? 'vllm' :
      (cfg.llm.provider || 'ollama');

    // Provider별 설정 로드
    if (this.provider === 'ollama') {
      this.baseURL = cfg.llm.ollama.baseUrl;
      this.model = cfg.llm.ollama.model;
      this.timeout = cfg.llm.ollama.timeout || 180000;
      this.maxRetries = cfg.llm.maxRetries || 3;
    } else if (this.provider === 'vllm') {
      this.baseURL = cfg.llm.vllm.baseUrl;
      this.model = this.normalizeModelName(cfg.llm.vllm.model);
      this.timeout = cfg.llm.vllm.timeout || 180000;
      this.maxRetries = cfg.llm.maxRetries || 3;
    }

    logger.info(`🔧 LLM 추상화 계층 초기화`);
    logger.info(`  📍 환경: ${this.environment}`);
    logger.info(`  🔌 Provider: ${this.provider}`);
    logger.info(`  🤖 모델: ${this.model}`);
    logger.info(`  🔗 서버: ${this.baseURL}`);
  }

  /**
   * 모델명 정규화 (환경별 변환)
   * 
   * Ollama 모델명 → vLLM 모델명 매핑
   * 
   * @param {string} model - 원본 모델명
   * @returns {string} 정규화된 모델명
   */
  normalizeModelName(model) {
    if (this.provider === 'vllm') {
      const modelMapping = {
        'qwen3-coder:30b': 'Qwen/Qwen3-Coder-30B-A3B-Instruct-FP8',
        'gpt-oss:120b': 'openai/gpt-oss-120b',
      };

      return modelMapping[model] || model;
    }

    return model;
  }

  /**
   * 통합 completion 생성 인터페이스
   * 
   * Provider에 관계없이 동일한 방식으로 호출 가능
   * 
   * @param {string} prompt - 입력 프롬프트
   * @param {Object} options - 생성 옵션
   * @param {number} options.temperature - Temperature (0.0~1.0)
   * @param {number} options.max_tokens - 최대 토큰 수
   * @param {number} options.num_predict - (Ollama 호환) max_tokens의 별칭
   * @returns {Promise<string>} LLM 응답 텍스트
   */
  async generateCompletion(prompt, options = {}) {
    const params = this.buildRequestParams(prompt, options);

    let lastError = null;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        logger.info(`🔄 LLM 호출 시도 ${attempt}/${this.maxRetries}`);

        if (this.provider === 'ollama') {
          return await this.callOllama(params);
        } else if (this.provider === 'vllm') {
          return await this.callVLLM(params);
        } else {
          throw new Error(`지원하지 않는 Provider: ${this.provider}`);
        }
      } catch (error) {
        lastError = error;
        logger.warn(`⚠️ LLM 호출 실패 (${attempt}/${this.maxRetries}): ${error.message}`);

        if (attempt < this.maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
          logger.info(`   ⏳ ${delay}ms 후 재시도...`);
          await this.sleep(delay);
        }
      }
    }

    throw new Error(`LLM 호출 최종 실패: ${lastError.message}`);
  }

  /**
   * 요청 파라미터 빌드 (Provider별 변환)
   * 
   * 통일된 옵션을 Provider별 API 형식으로 변환
   * 
   * @param {string} prompt - 프롬프트
   * @param {Object} options - 옵션
   * @returns {Object} Provider별 요청 파라미터
   */
  buildRequestParams(prompt, options) {
    // 공통 파라미터 추출
    const temperature = options.temperature ?? 0.1;
    const maxTokens = options.max_tokens || options.num_predict || 2000;

    if (this.provider === 'ollama') {
      return {
        model: this.model,
        prompt: prompt,
        temperature: temperature,
        num_predict: maxTokens,
        stream: false,
        options: {
          top_p: options.top_p || 3,
          repeat_penalty: options.repeat_penalty || 1.1
        }
      };
    } else if (this.provider === 'vllm') {
      // vLLM OpenAI 호환 API 형식
      return {
        model: this.model,
        messages: [
          {
            role: "system",
            content: "You are expert in Financial Core System Software Developer."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: temperature,
        max_tokens: maxTokens,
        top_p: options.top_p || 0.95,
        frequency_penalty: options.frequency_penalty || 0.0,
        presence_penalty: options.presence_penalty || 0.0,
        stop: options.stop || null
      };
    }

    return {};
  }

  /**
   * Ollama API 호출
   * 
   * @param {Object} params - 요청 파라미터
   * @returns {Promise<string>} 응답 텍스트
   */
  async callOllama(params) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseURL}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`Ollama API 오류: ${response.status} ${response.statusText} \n HOST: ${this.baseURL}/api/generate`);
      }

      const data = await response.json();

      // Ollama 응답 형식: { response: "..." }
      return data.response || '';

    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * vLLM API 호출 (OpenAI 호환 형식)
   * 
   * @param {Object} params - 요청 파라미터
   * @returns {Promise<string>} 응답 텍스트
   */
  async callVLLM(params) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseURL}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(params),
        signal: controller.signal
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`vLLM API 오류: ${response.status} - ${errorText}`);
      }

      const data = await response.json();

      // vLLM (OpenAI 호환) 응답 형식: { choices: [{ text: "..." }] }
      if (data.choices && data.choices.length > 0) {
        return data.choices[0].message.content || '';
      }

      throw new Error('vLLM 응답에 텍스트가 없습니다');

    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * 연결 상태 확인
   * 
   * @returns {Promise<boolean>} 연결 성공 여부
   */
  async checkConnection() {
    try {
      logger.info(`🔍 ${this.provider} 연결 테스트 중...`);

      const testPrompt = "Hello";
      const response = await this.generateCompletion(testPrompt, {
        temperature: 0.1,
        max_tokens: 100
      });

      if (response && response.length > 0) {
        logger.info(`✅ ${this.provider} 연결 성공`);
        return true;
      }

      throw new Error('빈 응답');

    } catch (error) {
      logger.error(`❌ ${this.provider} 연결 실패: ${error.message}`);
      throw error;
    }
  }

  /**
   * 비동기 sleep 유틸리티
   * 
   * @param {number} ms - 대기 시간 (밀리초)
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * JSON 응답 정제 및 추출
   * 
   * 마크다운 코드 블록, 특수문자 등을 제거하고 순수 JSON만 추출
   * 
   * @param {string} response - LLM 응답
   * @returns {Object|null} 파싱된 JSON 객체 또는 null
   */
  cleanAndExtractJSON(response) {
    if (!response || typeof response !== 'string') {
      return null;
    }

    try {
      // 1. 마크다운 코드 블록 제거
      let cleaned = response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

      // 2. 첫 { 찾기
      const firstBrace = cleaned.indexOf('{');
      if (firstBrace === -1) {
        return null;
      }

      // 3. 마지막 } 찾기
      const lastBrace = cleaned.lastIndexOf('}');
      if (lastBrace === -1) {
        return null;
      }

      // 4. JSON 부분만 추출
      const jsonStr = cleaned.substring(firstBrace, lastBrace + 1);

      // 5. 파싱 시도
      return JSON.parse(jsonStr);

    } catch (error) {
      logger.warn(`⚠️ JSON 파싱 실패: ${error.message}`);
      return null;
    }
  }
}