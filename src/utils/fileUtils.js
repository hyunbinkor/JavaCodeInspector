/**
 * 파일 I/O 관련 유틸리티 함수들
 */

import fs from 'fs/promises';
import path from 'path';

/**
 * JSON 파일에서 데이터 로드 및 필수 필드 검증
 * 
 * @example
 * // Issue Raw 데이터 로드
 * await loadData('raw_data.json', 'issueRaw');
 * 
 * @example
 * // 샘플 코드 로드
 * await loadData('sample.json', 'sampleCode');
 * 
 * @example
 * // 규칙 로드
 * await loadData('rule.json', 'rule');
 */
export async function loadData(fileName, directoryFlag) {
  try {
    // directoryFlag에서 .env 키 조회
    const baseDir = getDirectoryPath(directoryFlag);
    const filePath = path.join(baseDir, fileName);
    const content = await fs.readFile(filePath, 'utf-8');
    let data;

    switch (directoryFlag) {
      case 'issueRaw':
        data = JSON.parse(content);
        const required = ['issueId', 'title', 'problematicCode'];
        for (const field of required) {
          if (!data[field]) {
            throw new Error(`필수 필드 누락: ${field}`);
          }
        }
        break;
      case 'rule':
        data = JSON.parse(content);
        break;
      case 'sampleCode':
        data = content
        break;
      default:
        throw new Error(`이슈 데이터 로드 실패 (${fileName}) [${directoryFlag}]: 유효하지 않은 directoryFlag 값`);
    }

    return data;
  } catch (error) {
    throw new Error(`이슈 데이터 로드 실패 (${fileName}): ${error.message}`);
  }
}

/**
 * directoryFlag에 따라 .env에서 디렉토리 경로를 조회합니다.
 * 
 * @param {string} directoryFlag - 디렉토리 플래그 (CamelCase, 예: 'issuePattern', 'report')
 * @returns {string} .env에서 읽은 디렉토리 경로
 * @throws {Error} 유효하지 않은 플래그 또는 환경변수 미설정
 */
function getDirectoryPath(directoryFlag) {
  let envKey;
  
  switch (directoryFlag) {
    case 'fixedCode':
      envKey = 'FIXED_CODE_DIRECTORY';
      break;
    case 'issueRaw':
      envKey = 'ISSUE_RAW_DIRECTORY';
      break;
    case 'issuePattern':
      envKey = 'ISSUE_PATTERN_DIRECTORY';
      break;
    case 'sampleCode':
      envKey = 'SAMPLE_CODE_DIRECTORY';
      break;
    case 'report':
      envKey = 'REPORT_DIRECTORY';
      break;
    case 'rule':
      envKey = 'RULE_DIRECTORY';
      break;
    default:
      throw new Error(
        `유효하지 않은 directoryFlag: ${directoryFlag}. ` +
        `지원하는 값: issueRaw, issuePattern, sampleCode, report, rule`
      );
  }
  
  const dirPath = process.env[envKey];
  
  if (!dirPath) {
    throw new Error(`환경변수 ${envKey}가 설정되어 있지 않습니다.`);
  }
  
  return dirPath;
}

/**
 * JSON 데이터를 파일로 저장합니다.
 * 
 * directoryFlag를 바탕으로 .env에서 디렉토리 경로를 읽어와 해당 디렉토리에 저장합니다.
 * 디렉토리가 없으면 자동 생성됩니다.
 * 
 * @param {Object|Array} dataset - 저장할 데이터
 * @param {string} fileName - 파일명 (예: 'pattern.json')
 * @param {string} directoryFlag - 디렉토리 플래그 (CamelCase, 예: 'issuePattern', 'report')
 * @returns {Promise<void>}
 * @throws {Error} 디렉토리 경로 조회 또는 저장 실패
 * 
 * @example
 * // Fixed Code 데이터 저장
 * await saveJsonData(dataset, 'raw_data.json', 'fixedCode');
 * 
 * @example
 * // Issue 패턴 저장
 * await saveJsonData(patternData, 'pattern.json', 'issuePattern');
 * 
 * @example
 * // 보고서 저장
 * await saveJsonData(reportData, 'report.json', 'report');
 * 
 * @example
 * // 규칙 저장
 * await saveJsonData(ruleData, 'rule.json', 'rule');
 */
export async function saveJsonData(dataset, fileName, directoryFlag) {
  try {
    // directoryFlag에서 .env 키 조회
    const baseDir = getDirectoryPath(directoryFlag);
    
    const filePath = path.join(baseDir, fileName);
    const dir = path.dirname(filePath);
    
    // 디렉토리 생성 (없으면)
    await fs.mkdir(dir, { recursive: true });
    
    // JSON 파일 저장
    await fs.writeFile(filePath, JSON.stringify(dataset, null, 2), 'utf-8');
  } catch (error) {
    throw new Error(`데이터 저장 실패 (${directoryFlag}/${fileName}): ${error.message}`);
  }
}

/**
 * 디렉토리 내 모든 JSON 파일 경로 반환
 */
export async function getJsonFiles(dirPath) {
  try {
    const files = await fs.readdir(dirPath);
    const jsonFiles = files
      .filter(file => file.endsWith('.json'))
      .map(file => path.join(dirPath, file));

    return jsonFiles;
  } catch (error) {
    throw new Error(`디렉토리 읽기 실패 (${dirPath}): ${error.message}`);
  }
}