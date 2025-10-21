#!/usr/bin/env node

import { Command } from 'commander';
import { pathToFileURL } from 'url';

// Commands
import { performUnifiedCheck } from './commands/checkCommand.js';
import { performGuidelineOnlyCheck } from './commands/checkGuidelinesCommand.js';
import { searchAndAnalyzePatterns } from './commands/searchCommand.js';
import { processSingleIssue } from './commands/analyzeCommand.js';
import { processBatchIssues } from './commands/batchCommand.js';
import { manageGuidelines } from './commands/guidelinesCommand.js';
import { extractGuidelinesFromPDF } from './commands/extractCommand.js';
import { importGuidelinesToVectorDB } from './commands/importCommand.js';
import { checkSystemStatus } from './commands/statusCommand.js';

const program = new Command();

// CLI 프로그램 기본 정보 설정
program
  .name('unified-code-analyzer')
  .description('통합 Java 코드 품질 검사 도구 (패턴 분석 + 개발가이드 검사)')
  .version('2.0.0');

// 통합 코드 품질 검사 명령어
program
  .command('check')
  .description('통합 Java 코드 품질 검사 (추천)')
  .option('-c, --code <file>', '검사할 Java 코드 파일')
  .option('-o, --output <file>', '분석 결과 저장 파일')
  .option('--skip-patterns', '패턴 분석 건너뛰기')
  .option('--skip-guidelines', '가이드라인 검사 건너뛰기')
  .option('--skip-contextual', 'LLM 기반 맥락적 검사 건너뛰기')
  .option('--generate-fixes', '수정안 자동 생성')
  .option('-l, --limit <number>', '패턴 검색 결과 수', '10')
  .action(async (options) => {
    try {
      await performUnifiedCheck(options);
    } catch (error) {
      console.error('통합 검사 실패:', error.message);
      process.exit(1);
    }
  });

// 개발가이드 전용 검사 명령어
program
  .command('check-guidelines')
  .description('개발가이드 규칙만 검사')
  .option('-c, --code <file>', '검사할 Java 코드 파일')
  .option('--include-contextual', 'LLM 기반 맥락적 검사 포함')
  .option('--fix', '가이드라인 기반 코드 수정 생성')
  .option('-o, --output <file>', '결과 저장 파일')
  .action(async (options) => {
    try {
      await performGuidelineOnlyCheck(options);
    } catch (error) {
      console.error('가이드라인 검사 실패:', error.message);
      process.exit(1);
    }
  });

// VectorDB 기반 유사 패턴 검색 및 분석 명령어
program
  .command('search')
  .description('유사 패턴 검색 및 수정안 제시 (issueCodeAnalyzer 사용)')
  .option('-c, --code <file>', '검색할 코드 파일')
  .option('-l, --limit <number>', '검색 결과 수', '5')
  .option('--fix', '수정안 제시 활성화')
  .option('-o, --output <file>', '분석 결과 저장 파일')
  .action(async (options) => {
    try {
      await searchAndAnalyzePatterns(options);
    } catch (error) {
      console.error('❌ 검색 실패:', error.message);
      process.exit(1);
    }
  });

// 하위 호환성을 위한 search-patterns 명령어
program
  .command('search-patterns')
  .description('VectorDB 패턴 분석만 수행 (search 명령어와 동일)')
  .option('-c, --code <file>', '검사할 코드 파일')
  .option('-l, --limit <number>', '검색 결과 수', '5')
  .option('--fix', '수정안 제시 활성화')
  .option('-o, --output <file>', '분석 결과 저장 파일')
  .action(async (options) => {
    try {
      await searchAndAnalyzePatterns(options);
    } catch (error) {
      console.error('패턴 검색 실패:', error.message);
      process.exit(1);
    }
  });

// 단일 이슈를 분석하여 패턴 데이터셋 생성
program
  .command('analyze')
  .description('단일 이슈를 분석하여 패턴 데이터셋 생성')
  .option('-i, --input <file>', '입력 JSON 파일 경로')
  .option('-o, --output <file>', '출력 JSON 파일 경로')
  .action(async (options) => {
    try {
      await processSingleIssue(options);
    } catch (error) {
      console.error('분석 실패:', error.message);
      process.exit(1);
    }
  });

// 여러 이슈 파일을 배치로 처리
program
  .command('batch')
  .description('여러 이슈를 배치로 처리')
  .option('-i, --input <dir>', '입력 디렉토리 경로')
  .option('-o, --output <dir>', '출력 디렉토리 경로')
  .action(async (options) => {
    try {
      await processBatchIssues(options);
    } catch (error) {
      console.error('배치 처리 실패:', error.message);
      process.exit(1);
    }
  });

// 가이드라인 규칙 관리 명령어
program
  .command('manage-guidelines')
  .description('개발가이드 룰 관리')
  .option('--import <file>', '가이드라인 텍스트 파일 가져오기')
  .option('--list', '저장된 가이드라인 룰 목록 출력')
  .option('--export <file>', '가이드라인 룰을 파일로 내보내기')
  .action(async (options) => {
    try {
      await manageGuidelines(options);
    } catch (error) {
      console.error('가이드라인 관리 실패:', error.message);
      process.exit(1);
    }
  });

// PDF에서 개발가이드 규칙 추출
program
  .command('extract-guidelines')
  .description('PDF에서 개발가이드 규칙 추출')
  .requiredOption('-i, --input <file>', '입력 PDF 파일 경로')
  .requiredOption('-o, --output <file>', '출력 JSON 파일 경로')
  .option('--import-to-db', '추출 후 바로 VectorDB에 import')
  .action(async (options) => {
    try {
      await extractGuidelinesFromPDF(options);
    } catch (error) {
      console.error('가이드라인 추출 실패:', error.message);
      process.exit(1);
    }
  });

// 추출된 가이드라인 JSON을 VectorDB에 일괄 저장
program
  .command('import-guidelines')
  .description('추출된 가이드라인 JSON을 VectorDB에 저장')
  .requiredOption('-i, --input <file>', '가이드라인 JSON 파일 경로')
  .option('--dry-run', 'VectorDB 저장 없이 미리보기만')
  .action(async (options) => {
    try {
      await importGuidelinesToVectorDB(options);
    } catch (error) {
      console.error('가이드라인 import 실패:', error.message);
      process.exit(1);
    }
  });

// 시스템 상태 확인
program
  .command('status')
  .description('시스템 상태 확인')
  .action(async () => {
    try {
      await checkSystemStatus();
    } catch (error) {
      console.error('상태 확인 실패:', error.message);
      process.exit(1);
    }
  });

/**
 * 메인 진입점: CLI 명령어 파싱 및 실행
 */
async function main() {
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    console.error('실행 오류:', error.message);
    process.exit(1);
  }
}

// 직접 실행 시에만 main 함수 호출
const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  main();
}