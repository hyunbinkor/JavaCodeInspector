/**
 * 파일 I/O 관련 유틸리티 함수들
 */

import fs from 'fs/promises';
import path from 'path';

/**
 * JSON 파일에서 이슈 데이터 로드 및 필수 필드 검증
 */
export async function loadIssueData(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);

    const required = ['issueId', 'title', 'problematicCode'];
    for (const field of required) {
      if (!data[field]) {
        throw new Error(`필수 필드 누락: ${field}`);
      }
    }

    return data;
  } catch (error) {
    throw new Error(`이슈 데이터 로드 실패 (${filePath}): ${error.message}`);
  }
}

/**
 * 패턴 데이터셋을 JSON 파일로 저장 (디렉토리 자동 생성)
 */
export async function savePatternDataset(dataset, filePath) {
  try {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    await fs.writeFile(filePath, JSON.stringify(dataset, null, 2), 'utf-8');
  } catch (error) {
    throw new Error(`패턴 데이터셋 저장 실패 (${filePath}): ${error.message}`);
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