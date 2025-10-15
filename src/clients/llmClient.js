import https from 'https';
import http from 'http';
import { config } from '../config.js';

// AWS SDK를 동적으로 import하여 Bedrock Runtime 클라이언트 사용 준비
let AWS;
try {
  AWS = await import('@aws-sdk/client-bedrock-runtime');
  console.log('✅ AWS Bedrock SDK 로드 완료');
} catch (error) {
  console.warn('⚠️ AWS Bedrock SDK를 찾을 수 없습니다. Bedrock API 사용 불가');
}

/**
 * 통합 LLM 클라이언트
 * Bedrock (Claude, DeepSeek-R1), Ollama, 향후 vLLM 등 지원
 */
export class LLMClient {
  constructor(customConfig = {}) {
    this.config = {
      ...config.llm,
      ...customConfig
    };

    console.log(`\n=== LLM 제공자: ${this.config.provider.toUpperCase()} ===`);

    // 모델 ID에 'deepseek' 문자열 포함 여부 확인
    this.detectDeepSeekR1Model();

    // 제공자별 클라이언트 초기화 실행
    this.initializeLLMClient();
  }

  /**
   * 설정된 모델이 DeepSeek-R1인지 감지
   * DeepSeek-R1일 경우 전용 API 포맷 사용을 위한 플래그 설정
   */
  detectDeepSeekR1Model() {
    const modelId = this.config.bedrock?.modelId;
    if (modelId && (modelId.includes('deepseek') || modelId.includes('DeepSeek'))) {
      this.config.bedrock.isDeepSeekR1 = true;
      console.log('✅ DeepSeek-R1 모델 감지됨');
    } else {
      if (!this.config.bedrock) this.config.bedrock = {};
      this.config.bedrock.isDeepSeekR1 = false;
    }
  }

  /**
   * 설정된 제공자에 따라 적절한 LLM 클라이언트 초기화
   * bedrock 또는 ollama에 따라 분기 처리
   */
  async initializeLLMClient() {
    if (this.config.provider === 'bedrock') {
      await this.initializeBedrockClient();
    } else if (this.config.provider === 'ollama') {
      await this.initializeOllamaClient();
    } else {
      throw new Error(`지원하지 않는 LLM 제공자: ${this.config.provider}`);
    }
  }

  /**
   * AWS Bedrock 클라이언트를 생성하고 리전 설정
   * BedrockRuntimeClient 인스턴스 생성 및 모델 정보 출력
   */
  async initializeBedrockClient() {
    if (AWS) {
      try {
        const { BedrockRuntimeClient } = AWS;
        this.bedrockClient = new BedrockRuntimeClient({
          region: this.config.bedrock.region
        });

        console.log('✅ Bedrock 클라이언트 초기화 완료');
        console.log(`모델: ${this.config.bedrock.modelId.split('/').pop()}`);
        console.log(`지역: ${this.config.bedrock.region}`);

        if (this.config.bedrock.isDeepSeekR1) {
          console.log('🔥 DeepSeek-R1 전용 API 형식 사용');
        }
      } catch (error) {
        console.warn('⚠️ Bedrock 클라이언트 초기화 실패:', error.message);
        this.bedrockClient = null;
      }
    } else {
      console.warn('⚠️ AWS SDK가 설치되지 않았습니다.');
      this.bedrockClient = null;
    }
  }

  /**
   * Ollama 서버 연결 정보를 객체로 저장
   * baseUrl, 모델명, 타임아웃 설정 보관
   */
  async initializeOllamaClient() {
    this.ollamaClient = {
      baseUrl: this.config.ollama.baseUrl,
      model: this.config.ollama.model,
      timeout: this.config.ollama.timeout || 180000
    };

    console.log(`✅ Ollama 클라이언트 초기화 완료`);
    console.log(`URL: ${this.ollamaClient.baseUrl}`);
    console.log(`모델: ${this.ollamaClient.model}`);
    console.log(`타임아웃: ${this.ollamaClient.timeout}ms`);
  }

  /**
   * 현재 설정된 제공자의 API 연결 상태를 테스트
   * bedrock 또는 ollama 테스트 메서드로 분기
   */
  async checkConnection() {
    console.log(`🔍 ${this.config.provider.toUpperCase()} 연결 확인 중...`);

    if (this.config.provider === 'bedrock') {
      return await this.testBedrockConnection();
    } else if (this.config.provider === 'ollama') {
      return await this.testOllamaConnection();
    }

    return false;
  }

  /**
   * Bedrock API에 간단한 테스트 요청을 보내 연결 확인
   * "Hello" 메시지로 응답 수신 여부 검증
   */
  async testBedrockConnection() {
    if (!this.bedrockClient) {
      console.warn('⚠️ Bedrock 클라이언트가 초기화되지 않았습니다.');
      return false;
    }

    try {
      console.log('Bedrock 연결 테스트 중...');
      const testPrompt = "Hello, respond with just 'OK'";
      const response = await this.callBedrockAPI(testPrompt);

      if (response && response.length > 0) {
        console.log('✅ Bedrock 연결 성공');
        return true;
      }
    } catch (error) {
      console.warn(`⚠️ Bedrock 연결 테스트 실패: ${error.message}`);
    }

    return false;
  }

  /**
   * Ollama 서버의 /api/tags 엔드포인트로 사용 가능한 모델 목록 조회
   * 설정된 모델이 목록에 있는지 확인
   */
  async testOllamaConnection() {
    try {
      console.log('Ollama 서버 연결 테스트 중...');

      const response = await this.makeHttpRequest(
        `${this.config.ollama.baseUrl}/api/tags`,
        'GET',
        null,
        {},
        10000
      );

      if (response && response.models) {
        const modelNames = response.models.map(m => m.name);
        console.log(`✅ Ollama 서버 연결 성공. 사용 가능한 모델: ${modelNames.slice(0, 3).join(', ')}${modelNames.length > 3 ? '...' : ''}`);

        const configuredModel = this.config.ollama.model;
        const modelExists = modelNames.some(name => name.startsWith(configuredModel.split(':')[0]));

        if (modelExists) {
          console.log(`✅ 설정된 모델 '${configuredModel}' 사용 가능`);
        } else {
          console.warn(`⚠️ 설정된 모델 '${configuredModel}'을 찾을 수 없습니다.`);
        }

        return true;
      }
    } catch (error) {
      console.warn(`⚠️ Ollama 서버 연결 실패: ${error.message}`);
      return false;
    }
  }

  /**
   * 설정된 제공자에 따라 적절한 완성 생성 메서드 호출
   * bedrock 또는 ollama 완성 생성으로 분기
   */
  async generateCompletion(prompt, options = {}) {
    if (this.config.provider === 'bedrock') {
      return await this.generateBedrockCompletion(prompt, options);
    } else if (this.config.provider === 'ollama') {
      return await this.generateOllamaCompletion(prompt, options);
    }
  }

  /**
   * Bedrock API 호출을 최대 재시도 횟수만큼 반복 시도
   * 실패 시 지수 백오프로 재시도 간격 증가
   */
  async generateBedrockCompletion(prompt, options = {}) {
    const maxRetries = this.config.maxRetries || 3;
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`🔄 BEDROCK API 호출 시도 ${attempt}/${maxRetries}...`);

        const response = await this.callBedrockAPI(prompt, options);

        console.log(`✅ BEDROCK API 호출 성공 (시도 ${attempt})`);
        console.log(`📏 응답 길이: ${response?.length || 0}자`);

        if (!response || response.trim() === '') {
          console.log('⚠️ 응답이 비어있습니다. 다시 시도합니다.');
          throw new Error('Empty response received');
        }

        return response;

      } catch (error) {
        lastError = error;
        console.error(`❌ 시도 ${attempt} 실패:`, error.message);

        if (attempt < maxRetries) {
          const delay = 2000 * Math.pow(1.5, attempt - 1);
          console.log(`⏳ ${delay / 1000}초 후 재시도...`);
          await this.sleep(delay);
        }
      }
    }

    throw new Error(`Bedrock 생성 실패 (${maxRetries}번 시도): ${lastError.message}`);
  }

  /**
   * Ollama API 호출을 재시도 로직과 함께 수행
   * 프롬프트 길이에 따라 타임아웃 및 토큰 수 동적 조정
   */
  async generateOllamaCompletion(prompt, options = {}) {
    const maxRetries = this.config.maxRetries || 2;
    const baseTimeout = options.timeout || this.config.ollama.timeout || 90000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`🔄 OLLAMA API 호출 시도 ${attempt}/${maxRetries}...`);

        const timeoutMs = Math.min(baseTimeout + (attempt * 60000), 600000);
        const adjustedOptions = this.adjustOptionsForLargeRequest(prompt, options);

        const requestBody = {
          model: this.config.ollama.model,
          prompt: prompt,
          stream: false,
          options: {
            temperature: adjustedOptions.temperature || 0.1,
            num_predict: adjustedOptions.num_predict || 2000,
            top_p: 0.9,
            top_k: 40,
            repeat_penalty: 1.1,
            presence_penalty: 0.0,
            frequency_penalty: 0.0
          }
        };

        console.log(`   📊 요청 설정: 프롬프트 ${prompt.length}자, 토큰 ${requestBody.options.num_predict}, 타임아웃 ${timeoutMs}ms`);

        const response = await this.makeHttpRequestStable(
          `${this.config.ollama.baseUrl}/api/generate`,
          'POST',
          requestBody,
          {
            'Content-Type': 'application/json',
            'Connection': 'close',
            'User-Agent': 'Code-Pattern-Analyzer/1.0'
          },
          timeoutMs
        );

        if (!response || !response.response) {
          throw new Error('올바르지 않은 응답 형식');
        }

        console.log(`✅ OLLAMA API 호출 성공 (시도 ${attempt})`);
        console.log(`📏 응답 길이: ${response.response.length}자`);
        return response.response;

      } catch (error) {
        console.log(`❌ 시도 ${attempt} 실패: ${this.getErrorDescription(error)}`);

        if (attempt < maxRetries) {
          let delay;
          if (error.message.includes('ECONNRESET')) {
            delay = Math.min(10000 + (attempt * 10000), 30000);
          } else if (error.message.includes('timeout')) {
            delay = Math.min(5000 + (attempt * 5000), 20000);
          } else {
            delay = Math.min(3000 + (attempt * 2000), 15000);
          }

          console.log(`⏳ ${delay / 1000}초 후 재시도...`);
          await this.sleep(delay);

          if (error.message.includes('ECONNRESET') && attempt === 1) {
            console.log('🔄 연결 재설정 감지, 서버 안정화 대기...');
            await this.sleep(15000);
          }
        } else {
          throw new Error(`LLM 생성 실패 (${maxRetries}번 시도): ${this.getErrorDescription(error)}`);
        }
      }
    }
  }

  /**
   * Bedrock API InvokeModel 명령 실행
   * DeepSeek-R1과 Claude 모델에 따라 요청 body 형식 분기 처리
   */
  async callBedrockAPI(prompt, options = {}) {
    if (!this.bedrockClient) {
      throw new Error('Bedrock 클라이언트가 초기화되지 않았습니다.');
    }

    try {
      const { InvokeModelCommand } = AWS;
      let params;

      if (this.config.bedrock.isDeepSeekR1) {
        const formattedPrompt = this.formatDeepSeekR1Prompt(prompt);
        params = {
          modelId: this.config.bedrock.modelId,
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({
            prompt: formattedPrompt,
            max_tokens: options.num_predict || this.config.bedrock.maxTokens,
            temperature: options.temperature || this.config.bedrock.temperature,
            top_p: 0.9
          })
        };
      } else {
        params = {
          modelId: this.config.bedrock.modelId,
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({
            anthropic_version: "bedrock-2023-05-31",
            max_tokens: options.num_predict || this.config.bedrock.maxTokens,
            messages: [{
              role: "user",
              content: prompt
            }],
            temperature: options.temperature || this.config.bedrock.temperature
          })
        };
      }

      const command = new InvokeModelCommand(params);
      const response = await this.bedrockClient.send(command);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));

      if (this.config.bedrock.isDeepSeekR1) {
        if (responseBody.choices && responseBody.choices[0] && responseBody.choices[0].text) {
          return responseBody.choices[0].text;
        } else if (responseBody.text) {
          return responseBody.text;
        } else {
          throw new Error('DeepSeek-R1 API 응답 형식이 올바르지 않습니다.');
        }
      } else {
        if (responseBody.content && responseBody.content[0] && responseBody.content[0].text) {
          return responseBody.content[0].text;
        } else {
          throw new Error('Claude API 응답 형식이 올바르지 않습니다.');
        }
      }
    } catch (error) {
      console.error('Bedrock API 호출 실패:', error.message);
      throw error;
    }
  }

  /**
   * DeepSeek-R1 모델에 필요한 프롬프트 포맷으로 변환
   * 특수 토큰으로 래핑하여 반환
   */
  formatDeepSeekR1Prompt(prompt) {
    return `<|begin▁of▁sentence|><|User|>${prompt}<|Assistant|>`;
  }

  /**
   * HTTP/HTTPS 요청을 Promise로 래핑하여 실행
   * 타임아웃, 에러 핸들링, 연결 재설정 처리 포함
   */
  async makeHttpRequestStable(url, method, data, headers = {}, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const isHttps = urlObj.protocol === 'https:';
      const httpModule = isHttps ? https : http;

      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: method,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Code-Pattern-Analyzer/1.0',
          'Connection': 'close',
          ...headers
        },
        timeout: timeout,
        keepAlive: false,
        agent: false,
      };

      const requestData = data ? JSON.stringify(data) : null;
      if (requestData) {
        options.headers['Content-Length'] = Buffer.byteLength(requestData);
      }

      let timeoutId;
      const req = httpModule.request(options, (res) => {
        let responseData = '';

        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        res.on('data', (chunk) => {
          responseData += chunk;
        });

        res.on('end', () => {
          try {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              const parsedResponse = JSON.parse(responseData);
              resolve(parsedResponse);
            } else {
              reject(new Error(`HTTP ${res.statusCode}: ${responseData.slice(0, 200)}`));
            }
          } catch (parseError) {
            reject(new Error(`JSON 파싱 실패: ${parseError.message}`));
          }
        });

        res.on('error', (error) => {
          reject(new Error(`응답 처리 오류: ${error.message}`));
        });
      });

      timeoutId = setTimeout(() => {
        req.destroy();
        reject(new Error(`요청 시간 초과 (${timeout}ms)`));
      }, timeout);

      req.on('error', (error) => {
        if (timeoutId) clearTimeout(timeoutId);

        if (error.code === 'ECONNRESET') {
          reject(new Error('연결 재설정 (서버 과부하 가능성)'));
        } else if (error.code === 'ECONNREFUSED') {
          reject(new Error('연결 거부 (Ollama 서비스 확인 필요)'));
        } else if (error.code === 'ETIMEDOUT') {
          reject(new Error('연결 시간 초과'));
        } else {
          reject(new Error(`요청 실패: ${error.message}`));
        }
      });

      req.on('socket', (socket) => {
        socket.on('error', (error) => {
          if (timeoutId) clearTimeout(timeoutId);
          reject(new Error(`소켓 오류: ${error.message}`));
        });

        socket.setTimeout(timeout, () => {
          req.destroy();
          reject(new Error('소켓 시간 초과'));
        });
      });

      if (requestData) {
        req.write(requestData);
      }

      req.end();
    });
  }

  /**
   * HTTP 요청 메서드 - makeHttpRequestStable을 호출하는 래퍼
   */
  async makeHttpRequest(url, method, data, headers = {}, timeout = 30000) {
    return this.makeHttpRequestStable(url, method, data, headers, timeout);
  }

  /**
   * 프롬프트 길이에 따라 생성 토큰 수와 temperature 동적 조정
   * 긴 프롬프트일수록 토큰 수 감소 및 temperature 낮춤
   */
  adjustOptionsForLargeRequest(prompt, options) {
    const promptLength = prompt.length;
    const adjustedOptions = { ...options };

    if (promptLength > 3000) {
      adjustedOptions.num_predict = Math.min(adjustedOptions.num_predict || 2500, 2000);
    }
    if (promptLength > 5000) {
      adjustedOptions.num_predict = Math.min(adjustedOptions.num_predict || 2000, 1500);
    }
    if (promptLength > 8000) {
      adjustedOptions.num_predict = Math.min(adjustedOptions.num_predict || 1500, 1200);
      adjustedOptions.temperature = Math.min(adjustedOptions.temperature || 0.1, 0.05);
    }
    if (promptLength > 12000) {
      adjustedOptions.num_predict = 800;
      adjustedOptions.temperature = 0.01;
    }

    return adjustedOptions;
  }

  /**
   * 에러 코드와 메시지를 사용자 친화적인 설명으로 변환
   */
  getErrorDescription(error) {
    if (error.name === 'AbortError' || error.message.includes('aborted')) {
      return '요청 시간 초과';
    } else if (error.message.includes('ECONNRESET')) {
      return '연결 재설정 (서버 과부하 가능성)';
    } else if (error.message.includes('ECONNREFUSED')) {
      return '연결 거부 (Ollama 서비스 확인 필요)';
    } else if (error.message.includes('ETIMEDOUT')) {
      return '연결 시간 초과';
    } else if (error.message.includes('timeout')) {
      return '타임아웃';
    } else if (error.message.includes('fetch failed')) {
      return '네트워크 연결 실패';
    } else if (error.code) {
      return `${error.code}: ${error.message}`;
    } else {
      return error.message;
    }
  }

  /**
   * LLM 응답에서 JSON 객체를 추출하고 정제
   * 제공자별 응답 형식에 맞게 전처리 후 JSON 파싱
   */
  cleanAndExtractJSON(response) {
    if (!response) return null;

    console.log('🔍 JSON 추출 시작...');
    console.log('원본 응답 길이:', response.length);

    let cleaned = response;

    if (this.config.provider === 'bedrock') {
      if (this.config.bedrock.isDeepSeekR1) {
        cleaned = this.cleanDeepSeekR1Response(cleaned);
      } else {
        cleaned = this.cleanBedrockResponse(cleaned);
      }
    } else if (this.config.provider === 'ollama') {
      cleaned = this.cleanOllamaResponse(cleaned);
    }

    return this.extractJSONFromText(cleaned);
  }

  /**
   * DeepSeek-R1 응답에서 <think> 태그 제거
   * 사고 과정 부분을 제외하고 실제 답변만 추출
   */
  cleanDeepSeekR1Response(response) {
    let cleaned = response;
    if (cleaned.includes('<think>')) {
      const thinkEndIndex = cleaned.lastIndexOf('</think>');
      if (thinkEndIndex !== -1) {
        cleaned = cleaned.substring(thinkEndIndex + 8).trim();
      }
    }
    cleaned = cleaned.replace(/<\|thinking\|>[\s\S]*?<\|\/thinking\|>/gi, '');
    cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '');
    return this.cleanCommonResponse(cleaned);
  }

  /**
   * Bedrock(Claude) 응답에서 마크다운 코드 블록 제거
   * ```json, ``` 등의 마크다운 형식 제거 후 JSON 추출
   */
  cleanBedrockResponse(response) {
    let cleaned = response;
    cleaned = cleaned.replace(/```json\s*/gi, '');
    cleaned = cleaned.replace(/```javascript\s*/gi, '');
    cleaned = cleaned.replace(/```\s*/g, '');
    cleaned = cleaned.replace(/`{3,}/g, '');
    cleaned = cleaned.trim();

    if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
      console.log('✅ Bedrock 응답이 이미 완전한 JSON입니다');
      return cleaned;
    }

    const jsonStart = cleaned.indexOf('{');
    if (jsonStart > 0) {
      cleaned = cleaned.substring(jsonStart);
    }
    const jsonEnd = cleaned.lastIndexOf('}');
    if (jsonEnd > 0 && jsonEnd < cleaned.length - 1) {
      cleaned = cleaned.substring(0, jsonEnd + 1);
    }
    return cleaned.trim();
  }

  /**
   * Ollama 응답에서 <think> 태그 제거 후 공통 정제 처리
   */
  cleanOllamaResponse(response) {
    let cleaned = response;
    cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '');
    return this.cleanCommonResponse(cleaned);
  }

  /**
   * 모든 제공자에 공통으로 적용되는 응답 정제
   * 마크다운 제거, JSON 객체 경계 찾기
   */
  cleanCommonResponse(response) {
    let cleaned = response;
    cleaned = cleaned.replace(/```json\s*/gi, '');
    cleaned = cleaned.replace(/```javascript\s*/gi, '');
    cleaned = cleaned.replace(/```\s*/g, '');
    cleaned = cleaned.replace(/`{3,}/g, '');
    cleaned = cleaned.trim();

    if (!cleaned.startsWith('{')) {
      const jsonStart = cleaned.indexOf('{');
      if (jsonStart > 0) {
        cleaned = cleaned.substring(jsonStart);
      }
    }

    if (!cleaned.endsWith('}')) {
      const jsonEnd = cleaned.lastIndexOf('}');
      if (jsonEnd > 0) {
        cleaned = cleaned.substring(0, jsonEnd + 1);
      }
    }

    return cleaned.trim();
  }

  /**
   * 텍스트에서 JSON 객체를 찾아 파싱
   * 여러 JSON 후보 중 가장 완전한 구조를 가진 것 선택
   */
  extractJSONFromText(text) {
    if (!text) {
      console.log('⚠️ 추출할 텍스트가 비어있습니다.');
      return null;
    }

    try {
      if (text.trim().startsWith('{') && text.trim().endsWith('}')) {
        try {
          const parsed = JSON.parse(text.trim());
          console.log('✅ 전체 텍스트 직접 파싱 성공');
          return parsed;
        } catch (directParseError) {
          console.log('전체 텍스트 직접 파싱 실패, 다른 방법 시도...');
        }
      }

      const jsonCandidates = [];
      let searchStart = 0;

      while (true) {
        const openIndex = text.indexOf('{', searchStart);
        if (openIndex === -1) break;

        let braceCount = 0;
        let endIndex = openIndex;

        for (let i = openIndex; i < text.length; i++) {
          if (text[i] === '{') braceCount++;
          if (text[i] === '}') braceCount--;
          if (braceCount === 0) {
            endIndex = i;
            break;
          }
        }

        if (braceCount === 0 && endIndex > openIndex) {
          const candidate = text.substring(openIndex, endIndex + 1);
          try {
            const parsed = JSON.parse(candidate);
            const fieldCount = this.countJSONFields(parsed);
            jsonCandidates.push({
              json: candidate,
              parsed: parsed,
              length: candidate.length,
              fieldCount: fieldCount,
              hasRequiredFields: this.hasRequiredPatternFields(parsed)
            });
          } catch (parseError) {
            // 파싱 실패한 후보는 무시
          }
        }
        searchStart = openIndex + 1;
      }

      if (jsonCandidates.length === 0) {
        console.log('❌ 유효한 JSON 후보를 찾을 수 없습니다.');
        return null;
      }

      console.log(`발견된 유효한 JSON 후보들: ${jsonCandidates.length}개`);

      let bestCandidate = null;
      const completePatterns = jsonCandidates.filter(c => c.hasRequiredFields);
      if (completePatterns.length > 0) {
        bestCandidate = completePatterns.sort((a, b) => b.length - a.length)[0];
        console.log(`✅ 완전한 패턴 후보 선택: 길이 ${bestCandidate.length}자, 필드 수 ${bestCandidate.fieldCount}개`);
      } else {
        bestCandidate = jsonCandidates.sort((a, b) => b.fieldCount - a.fieldCount)[0];
        console.log(`⚠️ 필드 수 기준 선택: 필드 수 ${bestCandidate.fieldCount}개`);
      }

      return bestCandidate.parsed;

    } catch (error) {
      console.error('❌ JSON 추출 중 오류:', error.message);
      return null;
    }
  }

  /**
   * JSON 객체의 중첩된 필드 개수를 재귀적으로 계산
   * 최대 깊이 제한으로 무한 재귀 방지
   */
  countJSONFields(obj, depth = 0, maxDepth = 3) {
    if (depth > maxDepth || obj === null || typeof obj !== 'object') {
      return 0;
    }

    let count = 0;
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        count++;
        if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
          count += this.countJSONFields(obj[key], depth + 1, maxDepth);
        }
      }
    }
    return count;
  }

  /**
   * 패턴 분석 결과가 필수 필드를 모두 포함하는지 검증
   * metadata, anti_pattern, recommended_pattern, impact_analysis 확인
   */
  hasRequiredPatternFields(obj) {
    const requiredFields = ['metadata', 'anti_pattern', 'recommended_pattern', 'impact_analysis'];
    const topLevelFields = Object.keys(obj);
    const hasAllRequired = requiredFields.every(field => topLevelFields.includes(field));

    if (hasAllRequired) {
      console.log('✅ 완전한 패턴 구조 발견:', topLevelFields);
      return true;
    }

    console.log(`⚠️ 불완전한 구조 - 있는 필드: [${topLevelFields.join(', ')}], 필요한 필드: [${requiredFields.join(', ')}]`);
    return false;
  }

  /**
   * 지정된 밀리초만큼 실행을 지연시키는 Promise 반환
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}