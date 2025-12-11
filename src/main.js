/**
 * 통합 Java 코드 품질 검사 CLI 프로그램 (메인 진입점)
 * 
 * 3-Layer 아키텍처:
 * - Layer1: DevelopmentGuidelineChecker (가이드라인 규칙 검증)
 * - Layer2: VectorDB 패턴 검색 (Qdrant 기반 유사 패턴 매칭)
 * - Layer3: UnifiedJavaCodeChecker (통합 리포트 생성)
 * 
 * 지원 명령어 (6개):
 * - check           : 통합 검사 (권장)
 * - check-guidelines: 가이드라인만 검사
 * - search          : 패턴 검색
 * - batch           : 이슈 배치 처리
 * - extract-guidelines: 규칙 추출
 * - import-guidelines : 규칙 VectorDB 저장
 * 
 * @module main
 * @version 3.0.0
 */

import { Command } from 'commander';
import { pathToFileURL } from 'url';

// Commands
import { processBatchIssues } from './commands/issueCommand.js';
import { searchPatterns } from './commands/searchCommand.js';
import { performUnifiedCheck, performGuidelineOnlyCheck } from './commands/checkCommand.js';
import { extractGuidelines, importGuidelines } from './commands/guidelineCommand.js';
import logger from './utils/loggerUtils.js';

// TLS 인증서 검증 비활성화 (개발 환경)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const program = new Command();

// CLI 프로그램 기본 정보 설정
program
  .name('unified-code-analyzer')
  .description('통합 Java 코드 품질 검사 도구 (3-Layer 아키텍처)')
  .version('3.0.0');

// ============================================================
// 1. check - 통합 코드 품질 검사 (권장)
// ============================================================
program
  .command('check')
  .description('통합 Java 코드 품질 검사 (Layer1 + Layer2 + Layer3)')
  .requiredOption('-c, --code <file>', '검사할 Java 코드 파일')
  .option('-o, --output <file>', '분석 결과 저장 파일 (JSON)')
  .option('--fix', '수정안 자동 생성')
  .option('-l, --limit <number>', '패턴 검색 결과 수', '10')
  .action(async (options) => {
    try {
      await performUnifiedCheck(options);
    } catch (error) {
      logger.error('통합 검사 실패:', error.message);
      process.exit(1);
    }
  });

// ============================================================
// 2. check-guidelines - 가이드라인 전용 검사
// ============================================================
program
  .command('check-guidelines')
  .description('개발가이드 규칙만 검사 (Layer1)')
  .requiredOption('-c, --code <file>', '검사할 Java 코드 파일')
  .option('-o, --output <file>', '결과 저장 파일 (JSON)')
  .option('--fix', '가이드라인 기반 코드 수정 생성')
  .action(async (options) => {
    try {
      await performGuidelineOnlyCheck(options);
    } catch (error) {
      logger.error('가이드라인 검사 실패:', error.message);
      process.exit(1);
    }
  });

// ============================================================
// 3. search - VectorDB 패턴 검색
// ============================================================
program
  .command('search')
  .description('VectorDB 기반 유사 패턴 검색 (Layer2)')
  .requiredOption('-c, --code <file>', '검색할 코드 파일')
  .option('-l, --limit <number>', '검색 결과 수', '5')
  .option('-o, --output <file>', '분석 결과 저장 파일')
  .action(async (options) => {
    try {
      await searchPatterns(options);
    } catch (error) {
      logger.error('패턴 검색 실패:', error.message);
      process.exit(1);
    }
  });

// ============================================================
// 4. batch - 이슈 데이터 배치 처리
// ============================================================
program
  .command('batch')
  .description('이슈 데이터를 배치 처리하여 VectorDB에 저장')
  .option('-i, --input <dir>', '입력 디렉토리 (기본: ISSUE_RAW_DIRECTORY)')
  .option('-o, --output <dir>', '패턴 JSON 저장 디렉토리')
  .option('--clear', '기존 VectorDB 데이터 초기화 후 저장')
  .action(async (options) => {
    try {
      await processBatchIssues(options);
    } catch (error) {
      logger.error('배치 처리 실패:', error.message);
      process.exit(1);
    }
  });

// ============================================================
// 5. extract-guidelines - PDF/DOCX에서 규칙 추출
// ============================================================
program
  .command('extract-guidelines')
  .description('PDF/DOCX 개발가이드에서 규칙 추출')
  .requiredOption('-i, --input <file>', '입력 파일 (PDF/DOCX)')
  .requiredOption('-o, --output <file>', '출력 JSON 파일')
  .action(async (options) => {
    try {
      await extractGuidelines(options);
    } catch (error) {
      logger.error('가이드라인 추출 실패:', error.message);
      process.exit(1);
    }
  });

// ============================================================
// 6. import-guidelines - 규칙 JSON을 VectorDB에 저장
// ============================================================
program
  .command('import-guidelines')
  .description('추출된 가이드라인 JSON을 VectorDB에 저장')
  .requiredOption('-i, --input <file>', '가이드라인 JSON 파일')
  .option('--dry-run', 'VectorDB 저장 없이 미리보기만')
  .action(async (options) => {
    try {
      await importGuidelines(options);
    } catch (error) {
      logger.error('가이드라인 import 실패:', error.message);
      process.exit(1);
    }
  });

// ============================================================
// 메인 진입점
// ============================================================
async function main() {
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    logger.error('실행 오류:', error.message);
    process.exit(1);
  }
}

// 직접 실행 시에만 main 함수 호출
const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  main();
}

export { program };