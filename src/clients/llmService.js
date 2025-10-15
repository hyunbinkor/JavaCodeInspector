import { config } from '../config.js';
import { LLMClient } from './llmClient.js';

/**
 * LLM 서비스 - 고수준 비즈니스 로직
 * 패턴 생성, 가이드라인 분석 등 도메인 특화 기능 제공
 */
export class LLMService {
  constructor() {
    this.llmClient = new LLMClient();

    // 기존 코드와의 하위 호환성을 위한 속성들
    this.baseUrl = config.llm.provider === 'ollama' ? config.llm.ollama.baseUrl : 'bedrock';
    this.model = config.llm.provider === 'ollama' ? config.llm.ollama.model : config.llm.bedrock.modelId;
    this.isQwen3 = this.model && this.model.toLowerCase().includes('qwen');

    console.log(`🔧 LLM 서비스 초기화 완료 (제공자: ${config.llm.provider})`);
    if (this.isQwen3) {
      console.log('🔥 Qwen3 최적화 모드 활성화');
    }
  }

  /**
   * 서비스 초기화 (비동기 작업 수행)
   * LLMClient 연결 테스트 등의 초기화 작업 수행
   */
  async initialize() {
    try {
      // LLMClient의 연결 테스트
      await this.llmClient.checkConnection();
      console.log('✅ LLM 서비스 초기화 및 연결 확인 완료');
      return true;
    } catch (error) {
      console.error('❌ LLM 서비스 초기화 실패:', error.message);
      throw error;
    }
  }

  /**
   * LLMClient의 generateCompletion을 직접 호출하는 래퍼 메서드
   * 하위 호환성을 위해 유지
   */
  async generateCompletion(prompt, options = {}) {
    return await this.llmClient.generateCompletion(prompt, options);
  }

  /**
   * LLMClient의 연결 테스트를 호출하는 래퍼 메서드
   */
  async checkConnection() {
    return await this.llmClient.checkConnection();
  }

  /**
   * 코드 이슈를 분석하여 패턴 JSON 생성
   * 4가지 전략을 순차적으로 시도하여 가장 먼저 성공한 결과 반환
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
        console.log(`🎯 전략 ${i + 1}/${strategies.length}: ${strategy.name} (temp: ${strategy.temp}, tokens: ${strategy.tokens})`);

        const prompt = this.createBasicPatternPrompt(issueData, strategy.name);
        console.log(`   📝 ${strategy.name} 전략 프롬프트 길이: ${prompt.length}자`);

        const options = {
          temperature: strategy.temp,
          num_predict: strategy.tokens,
          top_p: 0.9,
          repeat_penalty: 1.1
        };

        const response = await this.llmClient.generateCompletion(prompt, options);
        console.log('📋 LLM 응답에서 JSON 추출 중...');

        const extractedJSON = this.extractJSONWithMultipleMethods(response);

        if (extractedJSON && this.validatePatternStructure(extractedJSON)) {
          console.log(`✅ 전략 ${strategy.name}으로 JSON 추출 성공`);
          return this.enhanceExtractedPattern(extractedJSON, issueData);
        } else {
          console.log(`❌ 전략 ${strategy.name} JSON 추출 실패`);
        }

      } catch (error) {
        console.error(`❌ 전략 ${strategy.name} 오류:`, error.message);
        lastError = error;

        if (i === 0) {
          console.log('⏳ 첫 번째 전략 실패, 5초 후 다음 전략 시도...');
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
    }

    console.log('⚠️ 모든 전략 실패, 폴백 패턴 사용');
    return this.createEnhancedFallbackPattern(issueData, lastError);
  }

  /**
   * 감지된 프레임워크 구성요소를 분석하여 탐지 규칙 생성
   * 어노테이션과 클래스 정보를 기반으로 AST/의미론적 규칙 생성
   */
  async generateFrameworkAnalysis(issueData, detectedAnnotations, detectedClasses) {
    const prompt = this.createFrameworkAnalysisPrompt(
      issueData, detectedAnnotations, detectedClasses
    );

    try {
      const response = await this.llmClient.generateCompletion(prompt, {
        temperature: 0.1,
        num_predict: 2000
      });

      console.log('🔍 프레임워크 분석 결과에서 JSON 추출 중...');
      const extractedJSON = this.extractJSONWithMultipleMethods(response);

      if (extractedJSON) {
        console.log('✅ 프레임워크 분석 JSON 추출 성공');
        return extractedJSON;
      } else {
        console.log('❌ 프레임워크 분석 JSON 추출 실패, 폴백 사용');
        return this.createFallbackFrameworkContext(detectedAnnotations, detectedClasses);
      }

    } catch (error) {
      console.error('❌ 프레임워크 분석 오류:', error.message);
      console.log('⚠️ 폴백 분석 결과를 사용합니다');
      return this.createFallbackFrameworkContext(detectedAnnotations, detectedClasses);
    }
  }

  /**
   * 가이드라인 텍스트를 LLM으로 분석하여 구조화된 정보 추출
   * checkType, businessRules, patterns 등의 필드로 변환
   */
  async generateGuidelineAnalysis(prompt, options = {}) {
    console.log('🧠 가이드라인 분석 요청 처리 중...');

    try {
      const response = await this.generateCompletion(prompt, {
        temperature: 0.1,
        num_predict: 2000,
        ...options
      });

      if (!response || response.trim() === '') {
        console.warn('⚠️ 빈 응답 수신');
        return null;
      }

      const jsonResult = this.llmClient.cleanAndExtractJSON(response);

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
      console.error('❌ 가이드라인 분석 중 오류:', error.message);
      throw error;
    }
  }

  /**
   * 여러 JSON 추출 방법을 순차적으로 시도
   * cleanAndExtractJSON, 코드블록 추출, 정규표현식, 텍스트 파싱 순으로 시도
   */
  extractJSONWithMultipleMethods(response) {
    const methods = [
      () => this.llmClient.cleanAndExtractJSON(response),
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

  /**
   * 마크다운 코드 블록(```json ... ```)에서 JSON 추출 시도
   * 여러 코드 블록이 있을 경우 첫 번째 파싱 가능한 블록 반환
   */
  extractJSONFromCodeBlocks(response) {
    const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/gi;
    const matches = [...response.matchAll(codeBlockRegex)];

    for (const match of matches) {
      try {
        const jsonText = match[1].trim();
        return JSON.parse(jsonText);
      } catch (error) {
        continue;
      }
    }
    return null;
  }

  /**
   * 정규표현식으로 { ... } 패턴 찾아 JSON 파싱
   * 파싱 실패 시 repairJSON으로 수정 시도
   */
  extractJSONWithRegex(response) {
    const jsonRegex = /\{[\s\S]*\}/;
    const match = response.match(jsonRegex);

    if (match) {
      try {
        const jsonText = match[0];
        return JSON.parse(jsonText);
      } catch (error) {
        return this.repairJSON(jsonText);
      }
    }
    return null;
  }

  /**
   * 첫 { 부터 마지막 } 까지 추출하여 JSON 파싱 시도
   * 실패 시 repairJSON으로 수정 후 재시도
   */
  extractJSONFromText(response) {
    try {
      const firstBrace = response.indexOf('{');
      const lastBrace = response.lastIndexOf('}');

      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        const jsonText = response.substring(firstBrace, lastBrace + 1);
        return JSON.parse(jsonText);
      }
    } catch (error) {
      try {
        return this.repairJSON(jsonText);
      } catch (repairError) {
        return null;
      }
    }
    return null;
  }

  /**
   * 잘못된 JSON 문법을 자동으로 수정 시도
   * 후행 쉼표 제거, 작은따옴표를 큰따옴표로, 키에 따옴표 추가 등
   */
  repairJSON(jsonText) {
    try {
      let repaired = jsonText
        .replace(/,\s*}/g, '}')
        .replace(/,\s*]/g, ']')
        .replace(/'/g, '"')
        .replace(/(\w+):/g, '"$1":')
        .replace(/:\s*([^",\[\]{}]+?)(?=\s*[,}])/g, ': "$1"');

      return JSON.parse(repaired);
    } catch (error) {
      return null;
    }
  }

  /**
   * 패턴 JSON이 필수 필드를 모두 포함하고 올바른 타입인지 검증
   * metadata, anti_pattern, recommended_pattern, impact_analysis 확인
   */
  validatePatternStructure(pattern) {
    const requiredFields = ['metadata', 'anti_pattern', 'recommended_pattern', 'impact_analysis'];

    for (const field of requiredFields) {
      if (!pattern[field] || typeof pattern[field] !== 'object') {
        console.warn(`⚠️ 필수 필드 누락 또는 잘못된 타입: ${field}`);
        return false;
      }
    }

    if (!pattern.metadata.title || !pattern.metadata.category) {
      console.warn('⚠️ metadata 필수 필드 누락');
      return false;
    }

    return true;
  }

  /**
   * LLM이 생성한 패턴에 누락된 필드를 issueData로 보완
   * severity, tags, code_template, occurrence_frequency 등 추가
   */
  enhanceExtractedPattern(pattern, issueData) {
    if (!pattern.metadata.severity) {
      pattern.metadata.severity = issueData.severity || 'MEDIUM';
    }

    if (!pattern.metadata.tags || pattern.metadata.tags.length === 0) {
      pattern.metadata.tags = ['auto-generated', 'pattern-analysis'];
    }

    if (!pattern.anti_pattern.code_template) {
      pattern.anti_pattern.code_template = issueData.problematicCode || '// 문제 코드';
    }

    if (!pattern.recommended_pattern.code_template) {
      pattern.recommended_pattern.code_template = issueData.fixedCode || '// 수정된 코드';
    }

    if (!pattern.impact_analysis.historical_data) {
      pattern.impact_analysis.historical_data = {
        occurrence_frequency: issueData.occurrenceCount || 1,
        fix_effort_estimation: {
          complexity: 'MEDIUM',
          estimated_hours: 3,
          required_expertise: ['java_developer']
        }
      };
    }

    return pattern;
  }

  /**
   * 전략과 제공자에 따라 최적화된 프롬프트 생성
   * Claude는 XML 형식, Qwen3는 간결한 형식, 기타는 범용 형식
   */
  createBasicPatternPrompt(issueData, strategy = 'optimized') {
    if (config.llm.provider === 'bedrock' && !config.llm.bedrock.isDeepSeekR1) {
      return this.createClaudePrompt(issueData);
    } else if (this.isQwen3) {
      return this.createQwen3OptimizedPrompt(issueData, strategy);
    } else {
      return this.createGenericPrompt(issueData);
    }
  }

  /**
   * Claude 모델을 위한 XML 태그 기반 프롬프트 생성
   * 구조화된 형식으로 issue_data 제공 및 완전한 JSON 스키마 명시
   */
  createClaudePrompt(issueData) {
    return `Java 코드 이슈를 분석하고 완전한 JSON 응답을 한글로 작성해주세요. 모든 필수 필드를 포함해야 합니다.

<issue_data>
이슈 ID: ${issueData.issueId}
제목: ${issueData.title}
설명: ${issueData.description || '설명 없음'}
카테고리: ${issueData.category || 'resource_management'}
심각도: ${issueData.severity || 'MEDIUM'}
발생 횟수: ${issueData.occurrenceCount || 1}회

문제 코드:
${issueData.problematicCode}

수정된 코드:
${issueData.fixedCode}
</issue_data>

다음 JSON 구조로 정확히 응답해주세요:

{
  "metadata": {
    "title": "이슈를 설명하는 간결한 한글 제목",
    "category": "${issueData.category || 'resource_management'}",
    "severity": "${issueData.severity || 'MEDIUM'}",
    "tags": ["관련", "태그", "한글로"]
  },
  "anti_pattern": {
    "code_template": "문제가 되는 코드의 일반화된 템플릿",
    "pattern_signature": {
      "semantic_signature": "패턴을_설명하는_영어_이름",
      "regex_patterns": ["탐지용 정규표현식1", "탐지용 정규표현식2"]
    },
    "problematic_characteristics": {
      "missing_operations": ["누락된 작업 1", "누락된 작업 2"],
      "incorrect_usage": ["잘못된 사용법 1", "잘못된 사용법 2"],
      "framework_violations": ["프레임워크 위반사항 1", "프레임워크 위반사항 2"]
    }
  },
  "recommended_pattern": {
    "code_template": "올바른 코드의 일반화된 템플릿",
    "pattern_name": "권장_패턴_영어_이름",
    "implementation_guide": {
      "best_practices": ["모범 사례 1", "모범 사례 2"],
      "framework_specific_notes": ["프레임워크별 주의사항 1", "프레임워크별 주의사항 2"]
    }
  },
  "impact_analysis": {
    "production_impact": {
      "failure_scenarios": ["장애 시나리오 1", "장애 시나리오 2"],
      "performance_degradation": {
        "response_time_impact": "응답 시간에 미치는 영향에 대한 한글 설명",
        "throughput_impact": "처리량에 미치는 영향에 대한 한글 설명",
        "resource_consumption": "리소스 사용량에 미치는 영향에 대한 한글 설명"
      }
    },
    "historical_data": {
      "occurrence_frequency": ${issueData.occurrenceCount || 1},
      "fix_effort_estimation": {
        "complexity": "LOW",
        "estimated_hours": 2,
        "required_expertise": ["자바 개발자"]
      }
    }
  }
}

중요: 위의 JSON 객체만 반환하세요. 마크다운 형식이나 추가 설명은 포함하지 마세요.`;
  }

  /**
   * Qwen3 모델을 위한 전략별 최적화 프롬프트 생성
   * 전략에 따라 프롬프트 길이와 상세도 조절
   */
  createQwen3OptimizedPrompt(issueData, strategy) {
    const codeLimit = {
      'optimized': 1200,
      'structured': 800,
      'simple': 300,
      'micro': 200
    }[strategy] || 1200;

    const truncatedCode = this.truncateCode(issueData.problematicCode, codeLimit);
    const truncatedFixedCode = this.truncateCode(issueData.fixedCode, codeLimit);

    if (strategy === 'micro') {
      return `Analyze this database connection leak issue:

Problem: ${issueData.title}
Code issue: Connection not closed properly in UserService

Return minimal JSON:
{
  "metadata": {"title": "Database Connection Leak", "category": "resource_management", "severity": "HIGH", "tags": ["database", "connection", "leak"]},
  "anti_pattern": {"code_template": "Connection not closed", "pattern_signature": {"semantic_signature": "connection_leak", "regex_patterns": ["getConnection.*without.*close"]}},
  "recommended_pattern": {"code_template": "try-with-resources", "pattern_name": "auto_close_connection", "implementation_guide": {"best_practices": ["Use try-with-resources"]}},
  "impact_analysis": {"production_impact": {"failure_scenarios": ["Connection pool exhaustion"]}, "historical_data": {"occurrence_frequency": ${issueData.occurrenceCount || 1}}}
}`;
    }

    if (strategy === 'simple') {
      return `Java issue: "${issueData.title}"

Problem code:
${truncatedCode}

Solution code:
${truncatedFixedCode}

Generate JSON with required fields:
{
  "metadata": {"title": "Brief title", "category": "${issueData.category}", "severity": "${issueData.severity}", "tags": ["tag1", "tag2"]},
  "anti_pattern": {"code_template": "problem template", "pattern_signature": {"semantic_signature": "pattern_name", "regex_patterns": ["regex1"]}},
  "recommended_pattern": {"code_template": "solution template", "pattern_name": "solution", "implementation_guide": {"best_practices": ["practice1"]}},
  "impact_analysis": {"production_impact": {"failure_scenarios": ["scenario1"]}, "historical_data": {"occurrence_frequency": ${issueData.occurrenceCount}}}
}`;
    }

    const basePrompt = `# Java Code Pattern Analysis Task

## Issue Information
- **ID**: ${issueData.issueId}
- **Title**: ${issueData.title}
- **Category**: ${issueData.category || 'resource_management'}
- **Severity**: ${issueData.severity || 'MEDIUM'}

## Problematic Code
\`\`\`java
${truncatedCode}
\`\`\`

## Fixed Code
\`\`\`java
${truncatedFixedCode}
\`\`\``;

    if (strategy === 'structured') {
      return basePrompt + `

## Output Format
Respond with only a valid JSON object:

{
  "metadata": {
    "title": "String - Brief issue title",
    "category": "String - ${issueData.category || 'resource_management'}",
    "severity": "String - ${issueData.severity || 'MEDIUM'}",
    "tags": ["Array of strings"]
  },
  "anti_pattern": {
    "code_template": "String - Problematic code template",
    "pattern_signature": {
      "semantic_signature": "String - Pattern identifier",
      "regex_patterns": ["Array of regex patterns"]
    }
  },
  "recommended_pattern": {
    "code_template": "String - Correct code template",
    "pattern_name": "String - Solution pattern name"
  },
  "impact_analysis": {
    "production_impact": {
      "failure_scenarios": ["Array of failure scenarios"]
    },
    "historical_data": {
      "occurrence_frequency": ${issueData.occurrenceCount || 1}
    }
  }
}`;
    }

    return basePrompt + `

## Analysis Requirements
1. Identify the core anti-pattern
2. Provide a generalized template
3. Suggest the recommended solution pattern
4. Analyze production impact

Provide ONLY a valid JSON object with the complete structure.`;
  }

  /**
   * 범용 프롬프트 생성 - 특별한 최적화 없이 기본 형식
   */
  createGenericPrompt(issueData) {
    return `당신은 Java 코드 패턴 분석 전문가입니다. 다음 이슈를 분석하여 완전한 JSON 객체를 생성해주세요.

이슈: ${issueData.title}
카테고리: ${issueData.category}
심각도: ${issueData.severity}

문제 코드:
${issueData.problematicCode}

수정된 코드:
${issueData.fixedCode}

완전한 JSON 구조로 응답해주세요. 모든 필수 필드를 포함해야 합니다.`;
  }

  /**
   * 프레임워크 분석을 위한 프롬프트 생성
   * 어노테이션과 클래스 정보를 포함하여 탐지 규칙 생성 요청
   */
  createFrameworkAnalysisPrompt(issueData, annotations, classes) {
    if (config.llm.provider === 'bedrock' && !config.llm.bedrock.isDeepSeekR1) {
      return `감지된 프레임워크 구성요소를 분석하고 완전한 JSON 응답을 한글로 작성해주세요.

<framework_data>
어노테이션: ${JSON.stringify(annotations)}
클래스들: ${JSON.stringify(classes)}
</framework_data>

다음 JSON 구조로 모든 필드를 완성하여 응답해주세요:

{
  "detection_rules": {
    "ast_rules": [
      {
        "rule_name": "규칙을_설명하는_영어_이름",
        "rule_expression": "AST 표현식 패턴",
        "confidence_score": 0.8
      }
    ],
    "semantic_rules": [
      {
        "rule_name": "의미론적_규칙_영어_이름",
        "rule_description": "규칙에 대한 명확한 한글 설명",
        "pattern_indicators": ["패턴 지표1", "패턴 지표2"]
      }
    ]
  },
  "framework_context": {
    "framework_version": "추정되는_프레임워크_버전",
    "applicable_components": {
      "custom_annotations": ${JSON.stringify(annotations)},
      "custom_classes": ${JSON.stringify(classes)},
      "framework_apis": ["감지된_API1", "감지된_API2"]
    }
  }
}

마크다운 형식이나 추가 설명 없이 JSON 객체만 반환하세요.`;
    } else {
      return `프레임워크 구성요소를 분석해주세요.

감지된 정보:
- 어노테이션: ${JSON.stringify(annotations)}
- 클래스들: ${JSON.stringify(classes)}

완전한 JSON 구조로 응답해주세요.`;
    }
  }

  /**
   * 코드 텍스트를 지정된 최대 길이로 자르기
   * 줄바꿈 위치를 고려하여 자연스럽게 자름
   */
  truncateCode(code, maxLength) {
    if (!code || code.length <= maxLength) return code;

    const truncated = code.substring(0, maxLength);
    const lastNewline = truncated.lastIndexOf('\n');

    return lastNewline > maxLength * 0.7 ?
      truncated.substring(0, lastNewline) + '\n// ... truncated' :
      truncated + '...';
  }

  /**
   * LLM 생성 실패 시 사용할 기본 패턴 객체 생성
   * issueData 정보를 기반으로 최소한의 유효한 패턴 구조 제공
   */
  createEnhancedFallbackPattern(issueData, error) {
    console.log('🔧 향상된 폴백 패턴 생성 중...');

    return {
      metadata: {
        title: issueData.title || '자동 분석된 코딩 패턴 이슈',
        category: issueData.category || 'resource_management',
        severity: issueData.severity || 'MEDIUM',
        tags: ['fallback-generated', 'requires-review', config.llm.provider]
      },
      anti_pattern: {
        code_template: this.sanitizeCode(issueData.problematicCode || '// 문제 코드'),
        pattern_signature: {
          semantic_signature: `${issueData.category || 'unknown'}_pattern_${Date.now()}`,
          regex_patterns: this.generateBasicRegexPatterns(issueData.problematicCode)
        },
        problematic_characteristics: {
          missing_operations: this.analyzeCodeIssues(issueData.problematicCode, 'missing'),
          incorrect_usage: this.analyzeCodeIssues(issueData.problematicCode, 'incorrect'),
          framework_violations: this.analyzeCodeIssues(issueData.problematicCode, 'violations')
        }
      },
      recommended_pattern: {
        code_template: this.sanitizeCode(issueData.fixedCode || '// 수정된 코드'),
        pattern_name: `recommended_${issueData.category || 'general'}_pattern`,
        implementation_guide: {
          best_practices: [
            '코드 리뷰를 통한 검증 필요',
            '단위 테스트 작성 권장',
            '프레임워크 공식 문서 참조'
          ],
          framework_specific_notes: [
            `${config.llm.provider} 모델로 생성된 패턴으로 추가 검토 필요`,
            '프로덕션 적용 전 충분한 테스트 필요'
          ]
        }
      },
      impact_analysis: {
        production_impact: {
          failure_scenarios: this.generateFailureScenarios(issueData),
          performance_degradation: {
            response_time_impact: '성능 영향 분석 필요',
            throughput_impact: '처리량 영향 분석 필요',
            resource_consumption: '리소스 사용량 영향 분석 필요'
          }
        },
        historical_data: {
          occurrence_frequency: issueData.occurrenceCount || 1,
          fix_effort_estimation: {
            complexity: 'MEDIUM',
            estimated_hours: 4,
            required_expertise: ['java_developer', 'code_reviewer']
          }
        }
      },
      _fallback_info: {
        reason: error ? error.message : 'All strategies failed',
        timestamp: new Date().toISOString(),
        model: this.model,
        requires_manual_review: true
      }
    };
  }

  /**
   * LLM 생성 실패 시 사용할 기본 프레임워크 컨텍스트 생성
   * 최소한의 탐지 규칙과 구성요소 정보 제공
   */
  createFallbackFrameworkContext(annotations, classes) {
    return {
      detection_rules: {
        ast_rules: [
          {
            rule_name: "fallback_ast_rule",
            rule_expression: ".*",
            confidence_score: 0.3
          }
        ],
        semantic_rules: [
          {
            rule_name: "fallback_semantic_rule",
            rule_description: "기본 의미론적 규칙 - 수동 검토 필요",
            pattern_indicators: ["requires_manual_review"]
          }
        ]
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

  /**
   * 코드 문자열을 안전하게 정제
   * null 체크 및 최대 1000자로 제한
   */
  sanitizeCode(code) {
    if (!code || typeof code !== 'string') return '// No code available';
    return code.trim().slice(0, 1000);
  }

  /**
   * 코드에서 클래스명과 메서드 패턴을 추출하여 기본 정규표현식 생성
   */
  generateBasicRegexPatterns(code) {
    const patterns = [];
    if (code && typeof code === 'string') {
      const classMatch = code.match(/class\s+(\w+)/);
      if (classMatch) {
        patterns.push(`class\\s+${classMatch[1]}`);
      }

      const methodMatches = code.match(/\w+\s+(\w+)\s*\([^)]*\)/g);
      if (methodMatches && methodMatches.length > 0) {
        patterns.push('\\w+\\s+\\w+\\s*\\([^)]*\\)');
      }
    }

    return patterns.length > 0 ? patterns : ['.*'];
  }

  /**
   * 코드의 문제점을 휴리스틱하게 분석
   * type에 따라 missing(누락), incorrect(오용), violations(위반) 검사
   */
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

  /**
   * 이슈 카테고리별로 예상되는 장애 시나리오 생성
   */
  generateFailureScenarios(issueData) {
    const scenarios = [];

    if (issueData.category === 'resource_management') {
      scenarios.push('메모리 누수로 인한 OutOfMemoryError');
      scenarios.push('파일 핸들 고갈로 인한 시스템 장애');
    } else if (issueData.category === 'security_vulnerability') {
      scenarios.push('보안 취약점을 통한 데이터 유출');
      scenarios.push('권한 우회로 인한 시스템 침해');
    } else {
      scenarios.push('예상치 못한 런타임 오류');
      scenarios.push('성능 저하로 인한 서비스 응답 지연');
    }

    return scenarios;
  }
}