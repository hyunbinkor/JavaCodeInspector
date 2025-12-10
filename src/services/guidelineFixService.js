/**
 * 가이드라인 기반 수정안 생성 서비스
 */

import { cleanLLMCodeResponse, validateJavaCode } from '../utils/codeUtils.js';
import logger from '../utils/loggerUtils.js';
/**
 * 개별 가이드라인 위반사항에 대한 수정 제안 생성
 * 1. Cast Operator 등 특정 규칙의 오탐 필터링
 * 2. 컨텍스트 코드 추출 (앞뒤 5줄)
 * 3. LLM에 프롬프트하여 수정 단계, 수정된 라인, 설명 획득
 * 4. 신뢰도 검증 및 불확실한 응답 필터링
 */
export async function generateGuidelineFixSuggestion(issue, sourceCode, llmService) {
  const codeLines = sourceCode.split('\n');
  const issueLineIndex = issue.line - 1;
  const line = codeLines[issueLineIndex] || '';

  // Cast Operator 규칙의 오탐 필터링: 실제로 Cast가 없으면 null 반환
  if (issue.ruleId === 'code_style.3_7_3' || issue.title?.includes('Cast Operator')) {
    const hasCastOperator = /\([A-Z][a-zA-Z0-9<>]*\)\s+[a-zA-Z]/.test(line);
    if (!hasCastOperator) {
      logger.info(`   ⚠️ 오탐 필터링: ${issue.line}번 라인에 Cast 연산자 없음 - "${line.trim()}"`);
      return null;
    }
  }

  // 컨텍스트 코드 추출 (앞뒤 5줄)
  const contextStart = Math.max(0, issueLineIndex - 5);
  const contextEnd = Math.min(codeLines.length, issueLineIndex + 6);
  const contextCode = codeLines.slice(contextStart, contextEnd).join('\n');

  // LLM에 수정 요청 프롬프트 생성
  const prompt = `Java 코드의 개발가이드 위반사항을 수정해주세요.

## 위반사항 정보
- 규칙: ${issue.title}
- 카테고리: ${issue.category}
- 심각도: ${issue.severity}
- 라인: ${issue.line}
- 메시지: ${issue.message}
${issue.suggestion ? `- 제안사항: ${issue.suggestion}` : ''}

## 문제 코드 (라인 ${contextStart + 1}~${contextEnd}):
${contextCode}

## 요구사항
1. 개발가이드 규칙을 정확히 준수하도록 수정
2. 비즈니스 로직은 변경하지 않음
3. 수정이 필요한 라인만 제시

다음 JSON 형식으로 응답해주세요:
{
  "steps": ["수정 단계 1", "수정 단계 2"],
  "fixedLine": "수정된 코드 라인",
  "explanation": "수정 이유 설명"
}`;

  try {
    const response = await llmService.generateCompletion(prompt, {
      temperature: 0.1,
      num_predict: 1000
    });

    const parsed = llmService.llmClient.cleanAndExtractJSON(response);

    // LLM 응답 검증: 불확실한 표현이나 낮은 신뢰도 필터링
    if (parsed && parsed.fixedLine) {
      const uncertainPhrases = [
        '찾을 수 없',
        '제공되지 않았',
        '보이지 않습니다',
        '확인되지 않습니다',
        '발견되지 않',
        '전체 코드를 확인'
      ];

      const isUncertain = uncertainPhrases.some(phrase =>
        parsed.fixedLine.includes(phrase) ||
        parsed.explanation?.includes(phrase)
      );

      if (isUncertain || (parsed.confidence && parsed.confidence < 0.6)) {
        logger.info(`   ⚠️ 신뢰도 낮음: ${issue.title} - LLM이 문제를 찾지 못함`);
        return null;
      }

      return {
        steps: parsed.steps || [],
        fixedLine: parsed.fixedLine,
        explanation: parsed.explanation || '',
        confidence: parsed.confidence || 0.85
      };
    }
  } catch (error) {
    console.warn(`   수정안 생성 중 오류: ${error.message}`);
  }

  return null;
}

/**
 * 전체 코드에 대한 가이드라인 기반 수정 생성
 * 1. 모든 위반사항 요약을 LLM에 전달
 * 2. 비즈니스 로직 유지하면서 모든 위반사항 수정 요청
 * 3. 수정된 전체 Java 코드 반환
 * 4. 코드 클리닝 및 유효성 검증
 */
export async function generateFullFixedCodeForGuidelines(sourceCode, issues, llmService) {
  const issuesSummary = issues.map((issue, idx) =>
    `${idx + 1}. 라인 ${issue.line}: ${issue.title} - ${issue.message}`
  ).join('\n');

  const prompt = `다음 Java 코드의 개발가이드 위반사항들을 모두 수정해주세요.

## 원본 코드
${sourceCode}

## 수정해야 할 위반사항들
${issuesSummary}

## 수정 요구사항
1. 모든 개발가이드 위반사항 수정
2. 비즈니스 로직과 메서드 시그니처는 유지
3. 컴파일 가능한 완전한 Java 코드 제공
4. 주요 수정사항은 주석으로 표시

수정된 완전한 Java 코드만 반환해주세요.`;

  try {
    const response = await llmService.generateCompletion(prompt, {
      temperature: 0.1,
      num_predict: 4000
    });

    // LLM 응답에서 코드만 추출 및 클리닝
    let fixedCode = cleanLLMCodeResponse(response);

    // 코드 유효성 검증 (클래스 존재, 괄호 균형 등)
    if (fixedCode && validateJavaCode(fixedCode, sourceCode)) {
      return fixedCode;
    }
  } catch (error) {
    logger.error('   전체 코드 수정 생성 실패:', error.message);
  }

  return null;
}