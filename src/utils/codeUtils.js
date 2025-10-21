/**
 * 코드 관련 유틸리티 함수들
 */

/**
 * 코드에 라인 번호 추가 (출력 가독성 향상)
 */
export function addLineNumbers(code, startLine = 1) {
    return code.split('\n').map((line, index) => {
      const lineNum = (startLine + index).toString().padStart(3, ' ');
      return `${lineNum}: ${line}`;
    }).join('\n');
  }
  
  /**
   * LLM 응답에서 순수 코드만 추출
   * 1. <think> 태그, 마크다운 코드 블록 제거
   * 2. 설명, 헤더, 번호 리스트 제거
   * 3. package/import/class 시작점 찾기
   * 4. 마지막 중괄호 이후 설명 제거
   * 5. 빈 줄 정리
   */
  export function cleanLLMCodeResponse(response) {
    if (!response) return null;
  
    let code = response.trim();
  
    // <think> 태그와 마크다운 블록 제거
    code = code.replace(/<think>[\s\S]*?<\/think>/gi, '');
    code = code.replace(/```java\s*/gi, '');
    code = code.replace(/```\s*/g, '');
    code = code.replace(/\*\*.*?\*\*/g, '');
    code = code.replace(/Explanation:[\s\S]*?(?=package|import|public|class|$)/gi, '');
  
    // 마크다운 헤더 제거
    code = code.replace(/^##.*$/gm, '');
    code = code.replace(/^###.*$/gm, '');
    code = code.replace(/^#.*$/gm, '');
  
    // 번호 리스트 제거
    code = code.replace(/^\d+\.\s+.*?:/gm, '');
  
    // Java 코드 시작점 찾기 (package, import, public class 중 첫 번째)
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
  
    // 마지막 중괄호 이후 설명 제거
    const lastBraceIndex = code.lastIndexOf('}');
    if (lastBraceIndex > 0) {
      const afterBrace = code.substring(lastBraceIndex + 1).trim();
      if (afterBrace.length > 0) {
        const codePattern = /^(package|import|public|private|protected|class|interface|@|\s*$)/;
        if (!codePattern.test(afterBrace)) {
          code = code.substring(0, lastBraceIndex + 1);
        }
      }
    }
  
    // 연속된 빈 줄 제거
    code = code.replace(/\n\s*\n\s*\n/g, '\n\n');
  
    return code.trim();
  }
  
  /**
   * Java 코드 유효성 검증
   * 1. 최소 길이 검증 (원본의 30% 이상)
   * 2. class 키워드 존재 확인
   * 3. 괄호 균형 검증 (오차 ±2 이내)
   */
  export function validateJavaCode(fixedCode, originalCode) {
    if (!fixedCode || fixedCode.length < originalCode.length * 0.3) {
      return false;
    }
  
    const hasClass = fixedCode.includes('class ');
    const openBraces = (fixedCode.match(/\{/g) || []).length;
    const closeBraces = (fixedCode.match(/\}/g) || []).length;
  
    return hasClass && Math.abs(openBraces - closeBraces) <= 2;
  }