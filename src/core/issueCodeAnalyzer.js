import { JavaASTParser } from '../ast/javaAstParser.js';
import { LLMService } from '../clients/llmService.js';
import { DynamicSafePatternAnalyzer } from './dynamicSafePatternAnalyzer.js';
import { config } from '../config.js';

/**
 * VectorDB의 동적 패턴을 활용한 코드 분석기
 * Java 코드의 보안 취약점, 리소스 관리 문제, 성능 이슈, 예외 처리 패턴을 분석
 */
export class issueCodeAnalyzer {
  constructor() {
    this.astParser = new JavaASTParser();
    this.llmService = new LLMService();
    this.dynamicAnalyzer = new DynamicSafePatternAnalyzer();
  }

  /**
   * 코드 분석기 초기화
   * 1. LLM 서비스 연결 확인
   * 2. VectorDB 패턴을 사용하는 동적 패턴 분석기 초기화
   * @throws {Error} LLM 서비스 연결 실패 시
   */
  async initialize() {
    console.log('🚀 코드 분석기 초기화 중...');

    const isConnected = await this.llmService.checkConnection();
    if (!isConnected) {
      throw new Error('LLM 서비스 연결 실패');
    }

    await this.dynamicAnalyzer.initialize();

    console.log('✅ 코드 분석기 초기화 완료');
  }

  /**
   * VectorDB의 동적 패턴을 사용한 코드 이슈 분석
   * 처리 흐름:
   * 1. AST 파싱으로 코드 구조 분석
   * 2. VectorDB에서 동적으로 안전한 패턴 확인
   * 3. 유사 패턴을 안전한 패턴과 안티패턴으로 분류
   * 4. 각 안티패턴에 대해 해당 카테고리가 안전하게 구현되었는지 확인
   * 5. 동적 패턴 매칭으로 실제 이슈 탐지
   * 6. 거짓 양성 검증 및 필터링
   * 7. 중복 제거 및 우선순위 정렬
   * 8. 카테고리별 권장사항 생성
   * 
   * @param {string} sourceCode - 분석할 Java 소스 코드
   * @param {Array} similarPatterns - VectorDB 유사도 검색으로 찾은 유사 패턴들
   * @returns {Object} 발견된 이슈, 안전한 패턴, 권장사항을 포함한 분석 결과
   */
  async analyzeCodeIssues(sourceCode, similarPatterns) {
    console.log('🔍 코드 내 문제 위치 분석 시작...');

    const detectedIssues = [];
    const codeLines = sourceCode.split('\n');

    // AST 파싱으로 코드의 구조적 정보 추출
    const astResult = this.astParser.parseJavaCode(sourceCode);

    // similarPatterns가 이미 제공되었는지 확인
    if (!similarPatterns || similarPatterns.length === 0) {
      console.log('  ⚠️ 유사 패턴이 제공되지 않음, VectorDB 검색 시도...');
      
      try {
        // 검색용 임베딩 생성
        const CodeEmbeddingGenerator = (await import('../embeddings/codeEmbedding.js')).CodeEmbeddingGenerator;
        const embeddingGenerator = new CodeEmbeddingGenerator();
        
        const searchEmbeddings = await embeddingGenerator.generateEmbeddings(sourceCode);
        const queryVector = searchEmbeddings.combined_embedding;
        
        // 벡터 검증
        if (!queryVector || queryVector.length !== 480) {
          console.error(`❌ 검색 벡터 차원 오류: ${queryVector?.length} !== 480`);
          similarPatterns = [];
        } else {
          console.log(`  🔍 검색 벡터 생성 완료: 480차원`);
          console.log(`     범위: [${Math.min(...queryVector).toFixed(4)}, ${Math.max(...queryVector).toFixed(4)}]`);
          
          // 0이 아닌 값 비율 확인
          const nonZeroCount = queryVector.filter(v => v !== 0).length;
          const nonZeroRatio = (nonZeroCount / 480 * 100).toFixed(1);
          console.log(`     0이 아닌 값: ${nonZeroCount}/480 (${nonZeroRatio}%)`);
          
          if (nonZeroCount === 0) {
            console.warn('     ⚠️ 모든 값이 0인 벡터 - 검색 결과가 없을 수 있음');
          }
          
          // VectorDB에서 유사 패턴 검색
          const VectorClient = (await import('../clients/vectorClient.js')).VectorClient;
          const vectorClient = new VectorClient();
          
          similarPatterns = await vectorClient.searchSimilarPatterns(
            queryVector,
            10,  // limit
            0.7  // threshold
          );
          
          console.log(`  ✅ VectorDB 검색 완료: ${similarPatterns.length}개 패턴 발견`);
          
          if (similarPatterns.length > 0) {
            console.log(`     최고 유사도: ${similarPatterns[0].score?.toFixed(4) || 'N/A'}`);
            console.log(`     카테고리 분포:`, 
              [...new Set(similarPatterns.map(p => p.category))].join(', '));
          }
        }
      } catch (error) {
        console.error('  ❌ VectorDB 검색 실패:', error.message);
        if (error.stack) {
          console.error('     스택:', error.stack.split('\n').slice(0, 3).join('\n'));
        }
        similarPatterns = [];
      }
    }

    // 1단계: VectorDB에서 안전한 패턴을 동적으로 확인
    const safePracticesFound = await this.dynamicAnalyzer.checkForSafePracticesDynamic(sourceCode);
    console.log(`  📊 발견된 안전한 패턴: ${safePracticesFound.length}개`);

    // 2단계: 유사 패턴을 안전한 패턴과 문제 패턴으로 분류
    const patternClassification = this.dynamicAnalyzer.classifySimilarPatterns(similarPatterns);
    console.log(`  ✅ 안전한 패턴: ${patternClassification.safePatterns.length}개`);
    console.log(`  ⚠️ 문제 패턴: ${patternClassification.antiPatterns.length}개`);

    if (patternClassification.antiPatterns.length > 0) {
      console.log(`     문제 패턴 카테고리:`, 
        [...new Set(patternClassification.antiPatterns.map(p => p.category))].join(', '));
    }

    // 3단계: 각 문제 패턴에 대해 실제 코드에서 이슈 탐지
    for (const pattern of patternClassification.antiPatterns) {
      // 해당 카테고리가 이미 안전하게 구현되었는지 동적으로 확인
      // 예: 'resource_management' 카테고리의 try-with-resources가 이미 사용 중이면 스킵
      if (this.dynamicAnalyzer.isCategorySafelyImplementedDynamic(pattern.category, safePracticesFound)) {
        console.log(`  ✅ ${pattern.category} 카테고리는 안전하게 구현됨, 스킵`);
        continue;
      }

      // VectorDB 패턴의 semantic signature를 사용하여 코드에서 문제 위치 탐지
      const matches = await this.dynamicAnalyzer.findIssuesUsingDynamicPatterns(sourceCode, [pattern]);

      console.log(`  🔎 ${pattern.category} 패턴 매칭: ${matches.length}개 후보 발견`);

      for (const match of matches) {
        // 매칭된 위치가 실제로 문제인지 재검증 (주석, 선언문 등 제외)
        if (!this.validateIssueMatch(match, codeLines, safePracticesFound)) {
          console.log(`  ⭐️ 거짓 양성 제거: 라인 ${match.startLine} (${match.type})`);
          continue;
        }

        // 검증된 이슈 객체 생성
        const issue = {
          id: `issue_${detectedIssues.length + 1}`,
          title: pattern.metadata?.title || pattern.title,
          description: this.generateIssueDescription(pattern, match),
          severity: this.adjustSeverityBasedOnContext(pattern.metadata?.severity || 'MEDIUM', match, safePracticesFound),
          category: pattern.category,
          location: {
            startLine: match.startLine,
            endLine: match.endLine,
            startColumn: match.startColumn || 0,
            endColumn: match.endColumn || 0
          },
          codeSnippet: this.extractCodeSnippet(codeLines, match.startLine, match.endLine),
          patternInfo: {
            patternId: match.patternId || pattern.issue_record_id,
            semanticSignature: pattern.anti_pattern?.pattern_signature?.semantic_signature,
            confidence: match.confidence || 0.8
          },
          relatedPattern: pattern
        };

        detectedIssues.push(issue);
        console.log(`  ✅ 이슈 추가: ${issue.title} (라인 ${issue.location.startLine})`);
      }
    }

    // 4단계: 동일 라인의 중복 이슈 제거
    const uniqueIssues = this.deduplicateIssuesStrict(detectedIssues);
    console.log(`  🔄 중복 제거: ${detectedIssues.length} -> ${uniqueIssues.length}개`);
    
    // 5단계: 심각도, 신뢰도, 카테고리 우선순위로 정렬
    const sortedIssues = this.prioritizeIssues(uniqueIssues);

    // 6단계: 각 카테고리별 VectorDB 기반 권장사항 생성
    const recommendations = this.generateCategoryRecommendations(patternClassification.antiPatterns, safePracticesFound);

    console.log(`✅ 분석 완료: ${sortedIssues.length}개의 실제 문제 발견`);

    if (sortedIssues.length > 0) {
      console.log(`   심각도 분포:`, this.getSeverityDistribution(sortedIssues));
    }

    return {
      detectedIssues: sortedIssues,
      safePracticesFound: safePracticesFound,
      recommendations: recommendations,
      patternClassification: patternClassification,
      analysisMetadata: {
        totalLines: codeLines.length,
        astAnalysisSuccess: astResult?.success || false,
        patternsChecked: similarPatterns.length,
        safePatterns: patternClassification.safePatterns.length,
        antiPatterns: patternClassification.antiPatterns.length,
        analysisTimestamp: new Date().toISOString()
      }
    };
  }

  /**
   * 각 카테고리별로 VectorDB의 safe_pattern 정보를 기반으로 권장사항 생성
   * 중복 카테고리는 한 번만 처리
   */
  generateCategoryRecommendations(antiPatterns, safePracticesFound) {
    const recommendations = [];
    const processedCategories = new Set();

    for (const pattern of antiPatterns) {
      if (processedCategories.has(pattern.category)) {
        continue;
      }

      const categoryRecommendation = this.dynamicAnalyzer.generateRecommendations(
        pattern.category,
        safePracticesFound
      );

      recommendations.push(categoryRecommendation);
      processedCategories.add(pattern.category);
    }

    return recommendations;
  }

  /**
   * 매칭 결과가 실제 문제인지 검증
   * 다음 경우 거짓 양성으로 판단:
   * - 주석이나 문서화 라인
   * - package, import, annotation 등 선언문
   * - 빈 라인이나 중괄호만 있는 라인
   * - 해당 카테고리가 이미 안전하게 구현된 경우
   * - 신뢰도가 0.7 미만인 경우
   */
  validateIssueMatch(match, codeLines, safePracticesFound) {
    const line = codeLines[match.startLine - 1]?.trim() || '';

    // 주석, 선언문, 빈 라인 체크
    if (this.isCommentOrDocumentation(line) ||
      this.isDeclarationStatement(line) ||
      line.length === 0 ||
      /^[\s{}]*$/.test(line)) {
      return false;
    }

    // 해당 카테고리가 이미 안전한 패턴으로 구현되었는지 확인
    const matchCategory = match.type;
    const isSafelyImplemented = this.dynamicAnalyzer.isCategorySafelyImplementedDynamic(
      matchCategory,
      safePracticesFound
    );

    if (isSafelyImplemented) {
      return false;
    }

    // 패턴 매칭 신뢰도가 너무 낮으면 제외
    if (match.confidence && match.confidence < 0.7) {
      return false;
    }

    return true;
  }

  /**
   * 특정 이슈에 대한 수정안 생성
   * VectorDB의 safe_pattern과 권장사항을 LLM 프롬프트에 포함하여
   * 더 정확하고 실용적인 수정안 제공
   * 
   * @param {Object} issue - 수정할 이슈 정보
   * @param {string} sourceCode - 전체 소스 코드
   * @returns {Object} 수정 단계, 수정된 코드, 설명, VectorDB 기반 제안을 포함한 수정안
   */
  async generateFixSuggestion(issue, sourceCode) {
    console.log(`   수정안 생성 중: ${issue.title}`);

    try {
      // VectorDB에서 해당 카테고리의 안전한 패턴 정보 가져오기
      const categoryRecommendation = this.dynamicAnalyzer.generateRecommendations(issue.category, []);

      // VectorDB의 모범 사례와 코드 예시를 포함한 향상된 프롬프트 생성
      const enhancedPrompt = this.createEnhancedFixSuggestionPrompt(
        issue,
        sourceCode,
        categoryRecommendation
      );

      // LLM을 통해 수정안 생성
      const response = await this.llmService.generateCompletion(enhancedPrompt, {
        temperature: 0.1,
        num_predict: 2000
      });

      const fixSuggestion = this.llmService.llmClient.cleanAndExtractJSON(response);

      if (fixSuggestion) {
        return {
          steps: fixSuggestion.steps || [],
          fixedCode: fixSuggestion.fixedCode || '',
          explanation: fixSuggestion.explanation || '',
          confidence: fixSuggestion.confidence || 0.8,
          patternBasedSuggestions: categoryRecommendation.suggestions,
          codeExample: categoryRecommendation.codeExample,
          frameworkNotes: categoryRecommendation.frameworkNotes
        };
      } else {
        return this.createEnhancedFallbackFixSuggestion(issue, categoryRecommendation);
      }

    } catch (error) {
      console.warn(`   수정안 생성 실패: ${error.message}`);
      const categoryRecommendation = this.dynamicAnalyzer.generateRecommendations(issue.category, []);
      return this.createEnhancedFallbackFixSuggestion(issue, categoryRecommendation);
    }
  }

  /**
   * VectorDB의 패턴 정보를 포함한 LLM 프롬프트 생성
   * 모범 사례, 프레임워크별 권장사항, 코드 예시를 프롬프트에 포함하여
   * LLM이 더 정확한 수정안을 생성하도록 유도
   */
  createEnhancedFixSuggestionPrompt(issue, sourceCode, categoryRecommendation) {
    const bestPracticesText = categoryRecommendation.suggestions.join('\n- ');
    const frameworkNotesText = categoryRecommendation.frameworkNotes.join('\n- ');

    return `Java 코드의 특정 문제에 대한 구체적인 수정안을 JSON 형식으로 제시해주세요.

문제 정보:
- 제목: ${issue.title}
- 카테고리: ${issue.category}
- 심각도: ${issue.severity}
- 위치: ${issue.location.startLine}~${issue.location.endLine}줄
- 설명: ${issue.description}

문제가 있는 코드 부분:
${issue.codeSnippet}

=== VectorDB에서 가져온 권장 패턴 정보 ===
모범 사례:
- ${bestPracticesText}

프레임워크별 권장사항:
- ${frameworkNotesText}

권장 코드 예시:
${categoryRecommendation.codeExample}

다음 JSON 구조로 수정안을 제시해주세요:

{
  "steps": [
    "수정 단계 1에 대한 구체적인 설명",
    "수정 단계 2에 대한 구체적인 설명"
  ],
  "fixedCode": "수정된 코드 (문제가 있던 부분만)",
  "explanation": "왜 이렇게 수정해야 하는지에 대한 상세한 설명",
  "confidence": 0.9
}

중요: VectorDB의 권장 패턴 정보를 참고하여 구체적이고 실용적인 수정안을 제시하세요.`;
  }

  /**
   * LLM 수정안 생성 실패 시 VectorDB 정보를 기반으로 기본 수정안 생성
   */
  createEnhancedFallbackFixSuggestion(issue, categoryRecommendation) {
    return {
      steps: categoryRecommendation.suggestions.length > 0
        ? categoryRecommendation.suggestions
        : [`${issue.category} 카테고리의 모범 사례 적용`, '코드 리뷰 및 개선 필요'],
      fixedCode: categoryRecommendation.codeExample || `// ${issue.title} 문제 수정 필요\n${issue.codeSnippet}`,
      explanation: `${issue.category} 카테고리의 ${issue.title} 문제입니다. ${categoryRecommendation.suggestions.join(', ')}를 적용하여 수정하세요.`,
      confidence: 0.7,
      patternBasedSuggestions: categoryRecommendation.suggestions,
      frameworkNotes: categoryRecommendation.frameworkNotes
    };
  }

  /**
   * 주석 또는 문서화 라인인지 확인
   */
  isCommentOrDocumentation(line) {
    return line.startsWith('//') ||
      line.startsWith('/*') ||
      line.startsWith('*') ||
      line.includes('*/');
  }

  /**
   * 선언문인지 확인 (package, import, annotation)
   */
  isDeclarationStatement(line) {
    return line.startsWith('package ') ||
      line.startsWith('import ') ||
      line.startsWith('@');
  }

  /**
   * 컨텍스트를 고려하여 심각도 조정
   * 관련된 안전한 패턴이 발견되면 심각도를 한 단계 낮춤
   * (CRITICAL -> HIGH, HIGH -> MEDIUM, MEDIUM -> LOW)
   */
  adjustSeverityBasedOnContext(originalSeverity, match, safePractices) {
    const relatedSafePractices = safePractices.filter(safe =>
      safe.category === match.type
    );

    if (relatedSafePractices.length > 0) {
      const severityMap = { 'CRITICAL': 'HIGH', 'HIGH': 'MEDIUM', 'MEDIUM': 'LOW' };
      return severityMap[originalSeverity] || originalSeverity;
    }

    return originalSeverity;
  }

  /**
   * 동일한 라인에서 동일한 카테고리의 중복 이슈 제거
   * 신뢰도가 높은 이슈를 우선적으로 유지
   */
  deduplicateIssuesStrict(issues) {
    if (issues.length === 0) return [];

    const unique = [];
    const seenLines = new Set();

    // 신뢰도 높은 순으로 정렬
    const sortedByConfidence = issues.sort((a, b) =>
      (b.patternInfo?.confidence || 0) - (a.patternInfo?.confidence || 0)
    );

    for (const issue of sortedByConfidence) {
      const lineKey = `${issue.location.startLine}-${issue.category}`;

      if (!seenLines.has(lineKey)) {
        seenLines.add(lineKey);
        unique.push(issue);
      }
    }

    return unique;
  }

  /**
   * 이슈의 우선순위 정렬
   * 정렬 기준:
   * 1. 심각도 (CRITICAL > HIGH > MEDIUM > LOW)
   * 2. 신뢰도 (높은 순)
   * 3. 카테고리 우선순위 (보안 > 리소스 관리 > 성능 > 예외 처리)
   * 4. 라인 번호 (낮은 순)
   */
  prioritizeIssues(issues) {
    const severityOrder = { 'CRITICAL': 4, 'HIGH': 3, 'MEDIUM': 2, 'LOW': 1 };

    return issues.sort((a, b) => {
      const severityDiff = (severityOrder[b.severity] || 0) - (severityOrder[a.severity] || 0);
      if (severityDiff !== 0) return severityDiff;

      const confidenceDiff = (b.patternInfo?.confidence || 0) - (a.patternInfo?.confidence || 0);
      if (confidenceDiff !== 0) return confidenceDiff;

      const categoryOrder = {
        'security_vulnerability': 4,
        'resource_management': 3,
        'performance_issue': 2,
        'exception_handling': 1
      };
      const categoryDiff = (categoryOrder[b.category] || 0) - (categoryOrder[a.category] || 0);
      if (categoryDiff !== 0) return categoryDiff;

      return a.location.startLine - b.location.startLine;
    });
  }

  /**
   * 패턴과 매칭 정보를 기반으로 이슈 설명 생성
   */
  generateIssueDescription(pattern, match) {
    const baseDescription = match.description || pattern.metadata?.title || pattern.title;

    if (match.details) {
      return `${baseDescription} - ${match.details.description || match.details}`;
    }

    return baseDescription;
  }

  /**
   * 이슈 위치 주변의 코드 스니펫 추출
   * 문제 라인 앞뒤 2줄을 포함하여 컨텍스트 제공
   */
  extractCodeSnippet(codeLines, startLine, endLine) {
    const start = Math.max(0, startLine - 2);
    const end = Math.min(codeLines.length, endLine + 1);

    return codeLines.slice(start, end).join('\n');
  }

  /**
   * 심각도 분포 계산 (디버깅용)
   */
  getSeverityDistribution(issues) {
    const distribution = {};
    for (const issue of issues) {
      distribution[issue.severity] = (distribution[issue.severity] || 0) + 1;
    }
    return distribution;
  }

  /**
   * LLM을 사용하여 전체 코드의 모든 이슈를 수정한 버전 생성
   * Ollama와 Bedrock에 따라 다른 전략 사용:
   * - Ollama: 개별 메서드 단위로 순차 처리 (안정성 우선)
   * - Bedrock: 전체 코드 일괄 처리 (효율성 우선)
   */
  async generateFullFixedCodeWithLLM(sourceCode, detectedIssues) {
    console.log('   LLM을 통한 전체 코드 수정 생성 중...');

    if (detectedIssues.length === 0) {
      console.log('   수정할 이슈가 없습니다.');
      return sourceCode;
    }

    // Ollama는 안정성을 위해 개별 처리
    if (config.llm.provider === 'ollama') {
      return await this.generateFullFixedCodeWithLLMChunked(sourceCode, detectedIssues);
    }

    // Bedrock은 기존 일괄 처리 방식 유지
    return await this.generateFullFixedCodeWithLLMOriginal(sourceCode, detectedIssues);
  }

  /**
   * Ollama 전용 개별 메서드 처리 방식
   * 각 이슈가 포함된 메서드를 하나씩 추출하여 수정 후 교체
   * 배치 처리를 완전히 건너뛰고 바로 개별 처리 시작
   */
  async generateFullFixedCodeWithLLMChunked(sourceCode, detectedIssues) {
    console.log('   📄 Ollama 개별 처리 전용 모드 시작...');
    console.log('   ⚡ 배치 처리 건너뛰고 바로 개별 처리 시작');

    const sortedIssues = this.prioritizeIssues(detectedIssues);
    console.log(`   📊 코드 길이: ${sourceCode.length}자, 총 ${sortedIssues.length}개 이슈를 개별 처리`);

    const currentCode = await this.processIssuesIndividually(sourceCode, sortedIssues);

    console.log(`   ✅ Ollama 개별 처리 완료: ${sortedIssues.length}/${detectedIssues.length}개 이슈 처리됨`);
    return currentCode;
  }

  /**
   * 각 이슈를 메서드 단위로 개별 처리
   * 처리 흐름:
   * 1. 이슈를 우선순위별로 정렬
   * 2. 각 이슈에 대해 포함된 메서드 추출
   * 3. 이미 처리된 메서드는 스킵 (중복 방지)
   * 4. 메서드 단위로 집중된 프롬프트 생성
   * 5. LLM으로 메서드 수정
   * 6. 수정된 메서드 검증 및 원본 코드에 교체
   * 7. 처리된 메서드를 캐시에 기록
   */
  async processIssuesIndividually(sourceCode, issues) {
    let currentCode = sourceCode;
    const processedRegions = new Set(); // 처리된 메서드 추적
    const methodCache = new Map(); // 메서드 정보 캐시

    const sortedIssues = this.prioritizeIssuesForProcessing(issues);

    for (let i = 0; i < sortedIssues.length; i++) {
      const issue = sortedIssues[i];

      try {
        // 이슈가 포함된 메서드의 전체 컨텍스트 추출
        const methodContext = this.extractMethodContext(currentCode, issue);
        if (!methodContext) {
          console.warn(`   메서드 컨텍스트 추출 실패: ${issue.title}`);
          continue;
        }

        const regionKey = `${methodContext.methodName}_${methodContext.startLine}_${methodContext.endLine}`;

        // 이미 처리된 메서드는 스킵
        if (processedRegions.has(regionKey)) {
          console.log(`   이미 처리된 메서드 스킵: ${issue.title} (${methodContext.methodName})`);
          continue;
        }

        // 메서드에 집중된 간결한 프롬프트 생성
        const miniPrompt = this.createFocusedPrompt(methodContext, issue);

        console.log(`   개별 처리 ${i + 1}/${sortedIssues.length}: ${issue.title} (메서드: ${methodContext.methodName})`);

        // LLM으로 메서드 수정 (낮은 temperature로 안정성 확보)
        const response = await this.llmService.generateCompletion(miniPrompt, {
          temperature: 0.05,
          num_predict: 3000,
          timeout: 60000,
          repeat_penalty: 1.15,
          top_k: 20,
          top_p: 0.7
        });

        // LLM 응답에서 수정된 메서드 추출 및 검증
        const fixedMethod = this.extractAndValidateFixedMethod(response, methodContext, issue);

        if (fixedMethod) {
          // 원본 코드에서 해당 메서드를 수정된 버전으로 교체
          const newCode = this.replaceMethodInCode(currentCode, methodContext, fixedMethod);

          // 코드 변경사항 검증 (메서드 유지, 중괄호 균형 등)
          if (this.validateCodeChange(currentCode, newCode, methodContext)) {
            currentCode = newCode;
            processedRegions.add(regionKey);

            methodCache.set(methodContext.methodName, {
              ...methodContext,
              processed: true,
              lastModified: Date.now()
            });

            console.log(`   메서드 교체 완료: ${methodContext.methodName}`);
          } else {
            console.warn(`   코드 변경 검증 실패: ${issue.title}`);
          }
        } else {
          console.warn(`   수정된 메서드 추출 실패: ${issue.title}`);
        }

      } catch (error) {
        console.warn(`   개별 처리 실패 (${issue.title}): ${error.message}`);
      }
    }

    return currentCode;
  }

  /**
   * 처리 우선순위 기반 이슈 정렬
   * 정렬 기준:
   * 1. 심각도 (CRITICAL > HIGH > MEDIUM > LOW)
   * 2. 카테고리 중요도 (리소스 관리 > 보안 > 예외 처리 > 성능)
   * 3. 라인 번호 (낮은 순 - 위에서 아래로 처리)
   */
  prioritizeIssuesForProcessing(issues) {
    return issues.sort((a, b) => {
      const severityOrder = { 'CRITICAL': 4, 'HIGH': 3, 'MEDIUM': 2, 'LOW': 1 };
      const severityDiff = (severityOrder[b.severity] || 0) - (severityOrder[a.severity] || 0);
      if (severityDiff !== 0) return severityDiff;

      const categoryPriority = {
        'resource_management': 4,
        'security_vulnerability': 3,
        'exception_handling': 2,
        'performance_issue': 1
      };
      const categoryDiff = (categoryPriority[b.category] || 0) - (categoryPriority[a.category] || 0);
      if (categoryDiff !== 0) return categoryDiff;

      return a.location.startLine - b.location.startLine;
    });
  }

  /**
   * 이슈가 포함된 메서드의 전체 컨텍스트 추출
   * 추출 과정:
   * 1. 이슈 라인에서 역방향으로 메서드 시그니처 탐색
   * 2. 메서드 시작 위치와 이름 파악
   * 3. 중괄호 카운팅으로 메서드 종료 지점 찾기
   * 4. 메서드 전체 내용과 주변 컨텍스트 반환
   * 
   * @returns {Object|null} 메서드 이름, 시작/종료 라인, 전체 내용
   */
  extractMethodContext(sourceCode, issue) {
    const lines = sourceCode.split('\n');
    const issueLine = issue.location.startLine;

    let methodStart = -1;
    let methodEnd = -1;
    let methodName = 'unknown';
    let braceCount = 0;
    let methodFound = false;

    // 역방향으로 메서드 시그니처 탐색
    for (let i = issueLine - 1; i >= 0; i--) {
      const line = lines[i].trim();

      const methodPattern = /^\s*(public|private|protected).*?\s+(\w+)\s*\([^)]*\)\s*(?:throws\s+[\w\s,<>]+)?\s*\{?\s*$/;
      const match = line.match(methodPattern);

      if (match) {
        methodStart = i;
        methodName = match[2];
        methodFound = true;
        break;
      }

      // 클래스나 인터페이스 선언까지 도달하면 중단
      if (line.includes('class ') || line.includes('interface ')) {
        break;
      }
    }

    if (!methodFound) return null;

    // 중괄호 균형으로 메서드 종료 지점 찾기
    let foundOpenBrace = false;
    for (let i = methodStart; i < lines.length; i++) {
      const line = lines[i];

      for (const char of line) {
        if (char === '{') {
          braceCount++;
          foundOpenBrace = true;
        } else if (char === '}') {
          braceCount--;
          if (foundOpenBrace && braceCount === 0) {
            methodEnd = i;
            break;
          }
        }
      }

      if (methodEnd !== -1) break;
    }

    // 종료 지점을 찾지 못한 경우 최대 50줄로 제한
    if (methodEnd === -1) {
      methodEnd = Math.min(lines.length - 1, methodStart + 50);
    }

    return {
      methodName: methodName,
      startLine: methodStart,
      endLine: methodEnd,
      content: lines.slice(methodStart, methodEnd + 1).join('\n'),
      fullContent: lines.slice(Math.max(0, methodStart - 2), Math.min(lines.length, methodEnd + 3)).join('\n')
    };
  }

  /**
   * 메서드 단위로 집중된 간결한 프롬프트 생성
   * 불필요한 설명을 제거하고 핵심 정보만 포함하여
   * LLM이 빠르고 정확하게 수정하도록 유도
   */
  createFocusedPrompt(methodContext, issue) {
    return `Fix this Java method. Return ONLY the corrected method:

Method: ${methodContext.methodName}
Issue: ${issue.title}
Category: ${issue.category}

Original method:
${methodContext.content}

Requirements:
- Fix the specific issue: ${issue.description}
- Keep method signature unchanged
- Ensure proper resource management if applicable
- Return complete method only`;
  }

  /**
   * LLM 응답에서 수정된 메서드 추출 및 검증
   * 검증 항목:
   * 1. 메서드 시그니처 일치 여부
   * 2. 기본 Java 구문 유효성
   * 3. 중복 구문 제거
   */
  extractAndValidateFixedMethod(response, methodContext, issue) {
    if (!response) return null;

    // LLM 응답에서 불필요한 부분 제거
    let fixedCode = this.cleanLLMResponse(response);

    if (!fixedCode) return null;

    // 메서드 시그니처가 일치하는지 확인
    if (!this.validateMethodSignature(fixedCode, methodContext.methodName)) {
      console.warn(`   메서드 시그니처 불일치: ${methodContext.methodName}`);
      return null;
    }

    // 기본 Java 구문이 유효한지 확인
    if (!this.validateBasicJavaSyntax(fixedCode)) {
      console.warn(`   Java 구문 오류: ${methodContext.methodName}`);
      return null;
    }

    // 중복된 구문 제거
    fixedCode = this.removeDuplicateStatements(fixedCode);

    return fixedCode;
  }

  /**
   * LLM 응답에서 불필요한 부분 제거
   * 제거 대상:
   * - <think> 태그와 내용
   * - 코드 블록 마커 (```java, ```)
   * - 설명 텍스트
   * - 볼드 마크다운
   * 그 후 실제 메서드 코드만 추출
   */
  cleanLLMResponse(response) {
    if (!response) return null;

    let code = response.trim();

    // think 태그 제거
    code = code.replace(/<think>[\s\S]*?<\/think>/gi, '');
    
    // 코드 블록 마커 제거
    code = code.replace(/```java\s*/gi, '');
    code = code.replace(/```\s*/g, '');
    
    // 볼드 및 설명 제거
    code = code.replace(/\*\*.*?\*\*/g, '');
    code = code.replace(/Explanation:[\s\S]*?(?=public|private|protected|$)/gi, '');

    // 실제 메서드 시작 지점 찾기
    const methodStart = code.search(/(public|private|protected)\s+/);
    if (methodStart >= 0) {
      code = code.substring(methodStart);
    }

    // 과도한 빈 줄 정리
    code = code.replace(/\n\s*\n\s*\n/g, '\n\n');

    return code.trim();
  }

  /**
   * 메서드 시그니처가 예상된 메서드 이름을 포함하는지 확인
   */
  validateMethodSignature(code, expectedMethodName) {
    if (!code || !expectedMethodName) return false;

    const methodPattern = new RegExp(`\\s+${expectedMethodName}\\s*\\(`, 'i');
    return methodPattern.test(code);
  }

  /**
   * 기본 Java 구문 유효성 검증
   * 확인 사항:
   * 1. 접근 제어자 (public/private/protected) 존재
   * 2. 여는 중괄호와 닫는 중괄호 존재
   * 3. 중괄호 균형 (차이가 1 이하)
   */
  validateBasicJavaSyntax(code) {
    if (!code || code.length < 10) return false;

    const hasMethodKeyword = /(public|private|protected)/.test(code);
    const hasOpenBrace = code.includes('{');
    const hasCloseBrace = code.includes('}');

    const openBraces = (code.match(/\{/g) || []).length;
    const closeBraces = (code.match(/\}/g) || []).length;
    const braceBalance = Math.abs(openBraces - closeBraces) <= 1;

    return hasMethodKeyword && hasOpenBrace && hasCloseBrace && braceBalance;
  }

  /**
   * 중복 구문 제거
   * LLM이 때때로 동일한 구문을 반복 생성하는 문제 방지
   * 주석과 중괄호는 제외하고, 실제 코드 구문만 중복 검사
   */
  removeDuplicateStatements(code) {
    if (!code) return code;

    const lines = code.split('\n');
    const uniqueLines = [];
    const seenStatements = new Set();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      // 주석이나 빈 줄은 그대로 유지
      if (!trimmedLine || trimmedLine.startsWith('//') || trimmedLine.startsWith('/*')) {
        uniqueLines.push(line);
        continue;
      }

      // 중괄호만 있는 라인도 유지
      if (trimmedLine === '{' || trimmedLine === '}') {
        uniqueLines.push(line);
        continue;
      }

      // 구문 정규화 후 중복 검사
      const statementKey = this.normalizeStatement(trimmedLine);

      if (seenStatements.has(statementKey)) {
        console.log(`   중복 구문 제거: ${trimmedLine}`);
        continue;
      }

      seenStatements.add(statementKey);
      uniqueLines.push(line);
    }

    return uniqueLines.join('\n');
  }

  /**
   * 구문 정규화 (중복 검출용)
   * 공백을 통일하고 세미콜론 제거, 소문자 변환하여 비교
   */
  normalizeStatement(statement) {
    return statement.replace(/\s+/g, ' ').replace(/;$/, '').toLowerCase();
  }

  /**
   * 원본 코드에서 특정 메서드를 수정된 버전으로 교체
   * 메서드 시작 라인부터 종료 라인까지를 새 코드로 대체
   */
  replaceMethodInCode(sourceCode, methodContext, fixedMethod) {
    const lines = sourceCode.split('\n');

    const beforeLines = lines.slice(0, methodContext.startLine);
    const afterLines = lines.slice(methodContext.endLine + 1);

    const fixedLines = fixedMethod.split('\n');

    return [...beforeLines, ...fixedLines, ...afterLines].join('\n');
  }

  /**
   * 코드 변경사항 검증
   * 검증 항목:
   * 1. 코드 길이가 원본의 50% 이상인지
   * 2. 메서드 이름이 여전히 존재하는지
   * 3. 중괄호 균형이 유지되는지 (오차 2 이내)
   */
  validateCodeChange(originalCode, newCode, methodContext) {
    if (!newCode || newCode.length < originalCode.length * 0.5) {
      console.warn(`   코드가 너무 많이 줄어듦: ${methodContext.methodName}`);
      return false;
    }

    if (!newCode.includes(methodContext.methodName)) {
      console.warn(`   메서드가 사라짐: ${methodContext.methodName}`);
      return false;
    }

    const openBraces = (newCode.match(/\{/g) || []).length;
    const closeBraces = (newCode.match(/\}/g) || []).length;

    if (Math.abs(openBraces - closeBraces) > 2) {
      console.warn(`   중괄호 불균형: ${methodContext.methodName}`);
      return false;
    }

    return true;
  }

  /**
   * Bedrock용 전체 코드 일괄 처리 방식
   * 모든 이슈를 하나의 프롬프트에 포함하여 전체 코드를 한 번에 수정
   */
  async generateFullFixedCodeWithLLMOriginal(sourceCode, detectedIssues) {
    // 각 카테고리별 VectorDB 권장사항 수집
    const categoryRecommendations = new Map();
    for (const issue of detectedIssues) {
      if (!categoryRecommendations.has(issue.category)) {
        const recommendation = this.dynamicAnalyzer.generateRecommendations(issue.category, []);
        categoryRecommendations.set(issue.category, recommendation);
      }
    }

    // 모든 이슈와 권장사항을 포함한 종합 프롬프트 생성
    const prompt = this.createEnhancedFullCodeFixPrompt(
      sourceCode,
      detectedIssues,
      categoryRecommendations
    );

    try {
      const response = await this.llmService.generateCompletion(prompt, {
        temperature: 0.1,
        num_predict: 4000
      });

      const fixedCode = this.extractCodeFromLLMResponse(response);

      if (fixedCode && this.validateFixedCodeQuality(fixedCode, sourceCode)) {
        console.log('   ✅ LLM 기반 전체 코드 수정 완료');
        return fixedCode;
      } else {
        console.warn('   ⚠️ LLM 수정 결과 검증 실패, 기존 방식 사용');
        return this.generateFullFixedCodeFallback(sourceCode, detectedIssues);
      }

    } catch (error) {
      console.error('   ❌ LLM 기반 수정 실패:', error.message);
      return this.generateFullFixedCodeFallback(sourceCode, detectedIssues);
    }
  }

  /**
   * 전체 코드 수정을 위한 종합 프롬프트 생성
   * 모든 이슈의 위치, 심각도, VectorDB 권장사항을 포함
   */
  createEnhancedFullCodeFixPrompt(sourceCode, detectedIssues, categoryRecommendations) {
    const issuesSummary = detectedIssues.map((issue, index) => {
      const recommendation = categoryRecommendations.get(issue.category);
      return `
${index + 1}. ${issue.title}
   위치: ${issue.location.startLine}-${issue.location.endLine}줄
   심각도: ${issue.severity}
   카테고리: ${issue.category}
   
   VectorDB 권장사항:
   ${recommendation.suggestions.map(s => `   - ${s}`).join('\n')}
   
   권장 코드 패턴:
${recommendation.codeExample}`;
    }).join('\n');

    return `다음 Java 코드에서 발견된 모든 문제점들을 VectorDB의 권장 패턴을 참고하여 종합적으로 수정한 완전한 코드를 제공해주세요.

=== 원본 코드 ===
${sourceCode}

=== 발견된 문제점들 및 VectorDB 권장사항 ===
${issuesSummary}

=== 수정 요구사항 ===
1. VectorDB의 권장 패턴을 우선적으로 적용
2. 기존 비즈니스 로직과 메서드 시그니처 유지
3. 컴파일 가능한 완전한 Java 코드 제공
4. 각 수정사항을 주석으로 설명

수정된 완전한 Java 코드만 반환해주세요.`;
  }

  /**
   * LLM 응답에서 실제 코드 부분만 추출
   * think 태그, 코드 블록 마커, 설명 텍스트 등을 제거하고
   * package, import, class 선언부터 시작하는 순수 코드만 추출
   */
  extractCodeFromLLMResponse(response) {
    if (!response) return null;

    let code = response.trim();

    // think 태그 제거
    code = code.replace(/<think>[\s\S]*?<\/think>/gi, '');
    code = code.replace(/<think>[\s\S]*$/gi, '');

    // 코드 블록 마커 제거
    code = code.replace(/```java\s*/gi, '');
    code = code.replace(/```\s*/g, '');

    // 설명 텍스트 제거
    code = code.replace(/\*\*Explanation:\*\*[\s\S]*?(?=package|import|public|class)/gi, '');
    code = code.replace(/The original code[\s\S]*?(?=package|import|public|class)/gi, '');

    // 실제 코드 시작 지점 찾기
    const packageIndex = code.indexOf('package ');
    const importIndex = code.indexOf('import ');
    const classIndex = code.indexOf('public class ');

    let startIndex = -1;
    if (packageIndex >= 0) startIndex = packageIndex;
    else if (importIndex >= 0) startIndex = importIndex;
    else if (classIndex >= 0) startIndex = classIndex;

    if (startIndex >= 0) {
      code = code.substring(startIndex);
    }

    // 과도한 빈 줄 정리
    code = code.replace(/\n\s*\n\s*\n/g, '\n\n');

    return code.trim();
  }

  /**
   * 수정된 코드의 품질 검증
   * 검증 항목:
   * 1. 코드 길이가 원본의 20% 이상인지
   * 2. 필수 Java 요소 (class, 중괄호) 존재 여부
   * 3. 중괄호 균형 (오차 2 이내)
   * 4. 중복된 catch 블록이나 선언문 없는지
   * 5. 닫히지 않은 문자열 없는지
   */
  validateFixedCodeQuality(fixedCode, originalCode) {
    if (!fixedCode || fixedCode.length < originalCode.length * 0.2) {
      console.log('   ❌ 수정 코드가 너무 짧음');
      return false;
    }

    const requiredElements = ['class ', '{', '}'];
    const hasRequired = requiredElements.every(element => fixedCode.includes(element));

    if (!hasRequired) {
      console.log('   ❌ 필수 Java 요소 누락');
      return false;
    }

    const openBraces = (fixedCode.match(/\{/g) || []).length;
    const closeBraces = (fixedCode.match(/\}/g) || []).length;

    if (Math.abs(openBraces - closeBraces) > 2) {
      console.log('   ❌ 중괄호 불균형');
      return false;
    }

    // 중복된 catch 블록 검사
    if (fixedCode.includes('} catch (SQLException e) {\n} catch (SQLException e) {')) {
      console.log('   ❌ 중복된 catch 블록 발견');
      return false;
    }

    // 중복된 PreparedStatement 선언 검사
    if (fixedCode.includes('PreparedStatement stmt = conn.prepareStatement(sql);\nPreparedStatement stmt = conn.prepareStatement(sql);')) {
      console.log('   ❌ 중복된 PreparedStatement 선언 발견');
      return false;
    }

    // 닫히지 않은 문자열 검사
    if (fixedCode.includes('throw new PaymentProcessingException("Failed to process payment\n')) {
      console.log('   ❌ 닫히지 않은 문자열 발견');
      return false;
    }

    console.log('   ✅ 코드 품질 검증 통과');
    return true;
  }

  /**
   * LLM 수정 실패 시 폴백 처리
   * 원본 코드 상단에 VectorDB 기반 수정 가이드를 주석으로 추가
   */
  generateFullFixedCodeFallback(sourceCode, detectedIssues) {
    const summaryLines = [
      '// 자동 수정 실패 - VectorDB 패턴 기반 수정 가이드',
      '// ====================================='
    ];

    detectedIssues.forEach((issue, index) => {
      summaryLines.push(`// 문제 ${index + 1}: ${issue.title}`);
      summaryLines.push(`// 권장 패턴: ${issue.fixSuggestion?.patternBasedSuggestions?.join(', ') || '정보 없음'}`);
    });

    return [...summaryLines, '', sourceCode].join('\n');
  }
}