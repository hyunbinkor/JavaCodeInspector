/**
 * 통합 Java 코드 품질 검사 CLI 프로그램 (메인 진입점)
 * 
 * 3-Layer 아키텍처:
 * - Layer1: DevelopmentGuidelineChecker (가이드라인 규칙 검증)
 * - Layer2: VectorDB 패턴 검색 (Qdrant 기반 유사 패턴 매칭)
 * - Layer3: UnifiedJavaCodeChecker (통합 리포트 생성)
 * 
 * 지원 명령어:
 * - check           : 통합 검사 (권장)
 * - check-guidelines: 가이드라인만 검사
 * - search          : 패턴 검색
 * - batch           : 이슈 배치 처리
 * - extract-guidelines: 규칙 추출
 * - import-guidelines : 규칙 VectorDB 저장
 * - profile         : 코드 프로파일링 (태그 추출) [신규]
 * - list-tags       : 태그 정의 목록 [신규]
 * 
 * @module main
 * @version 3.1.0
 */

import { Command } from 'commander';
import { pathToFileURL } from 'url';

// Commands
import { processBatchIssues } from './commands/issueCommand.js';
import { searchPatterns } from './commands/searchCommand.js';
import { performUnifiedCheck, performGuidelineOnlyCheck } from './commands/checkCommand.js';
import { extractGuidelines, importGuidelines } from './commands/guidelineCommand.js';
import { profileCode, listTags, validateTagDefinitions, testTags } from './commands/tagCommand.js';
import { 
  analyzeRules, 
  generateTagConditions, 
  applyTagConditions,
  checkTagConditionStatus 
} from './commands/analyzeCommand.js';
import logger from './utils/loggerUtils.js';

// TLS 인증서 검증 비활성화 (개발 환경)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const program = new Command();

// CLI 프로그램 기본 정보 설정
program
  .name('unified-code-analyzer')
  .description('통합 Java 코드 품질 검사 도구 (3-Layer 아키텍처)')
  .version('3.1.0');

// ============================================================
// 1. check - 통합 코드 품질 검사 (권장)
// ============================================================
program
  .command('check')
  .description('통합 Java 코드 품질 검사 (Layer1 + Layer2 + Layer3)')
  .requiredOption('-c, --code <file>', '검사할 Java 코드 파일')
  .option('-r, --rules <file>', '규칙 JSON 파일 (기본: 내장 규칙)')
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
// 7. profile - 코드 프로파일링 (태그 추출) [신규]
// ============================================================
program
  .command('profile')
  .description('Java 코드의 태그 프로파일 생성')
  .requiredOption('-c, --code <file>', '프로파일링할 Java 파일')
  .option('-o, --output <file>', '결과 저장 파일 (JSON)')
  .option('-v, --verbose', '상세 출력')
  .option('--no-llm', 'LLM 기반 태깅 비활성화 (Tier 1만)')
  .action(async (options) => {
    try {
      await profileCode(options);
    } catch (error) {
      logger.error('프로파일링 실패:', error.message);
      process.exit(1);
    }
  });

// ============================================================
// 8. list-tags - 태그 정의 목록 [신규]
// ============================================================
program
  .command('list-tags')
  .description('정의된 태그 목록 조회')
  .option('-c, --category <name>', '특정 카테고리만 표시')
  .option('-t, --tier <number>', '특정 티어만 표시 (1 또는 2)')
  .action(async (options) => {
    try {
      await listTags(options);
    } catch (error) {
      logger.error('태그 목록 조회 실패:', error.message);
      process.exit(1);
    }
  });

// ============================================================
// 9. validate-tags - 태그 정의 유효성 검사 [신규]
// ============================================================
program
  .command('validate-tags')
  .description('태그 정의 파일 유효성 검사')
  .option('-i, --input <file>', '검사할 태그 정의 파일')
  .action(async (options) => {
    try {
      await validateTagDefinitions(options);
    } catch (error) {
      logger.error('태그 유효성 검사 실패:', error.message);
      process.exit(1);
    }
  });

// ============================================================
// 10. test-tags - 특정 태그 테스트 [신규]
// ============================================================
program
  .command('test-tags')
  .description('특정 코드에 대해 특정 태그 테스트')
  .requiredOption('-c, --code <file>', 'Java 파일')
  .requiredOption('-t, --tags <tags>', '테스트할 태그 (쉼표 구분)')
  .action(async (options) => {
    try {
      await testTags(options);
    } catch (error) {
      logger.error('태그 테스트 실패:', error.message);
      process.exit(1);
    }
  });

// ============================================================
// 11. analyze-rules - 규칙 분석 (필요 태그 추출) [Step 6]
// ============================================================
program
  .command('analyze-rules')
  .description('규칙 파일을 분석하여 필요한 태그 목록 추출')
  .requiredOption('-i, --input <file>', '규칙 JSON 파일')
  .option('-o, --output <file>', '분석 결과 저장 파일')
  .option('--llm', 'LLM 기반 정밀 분석 사용')
  .action(async (options) => {
    try {
      await analyzeRules(options);
    } catch (error) {
      logger.error('규칙 분석 실패:', error.message);
      process.exit(1);
    }
  });

// ============================================================
// 12. generate-conditions - tagCondition 자동 생성 [Step 6]
// ============================================================
program
  .command('generate-conditions')
  .description('분석 결과를 기반으로 tagCondition 표현식 생성')
  .requiredOption('-i, --input <file>', '분석 결과 또는 규칙 JSON')
  .option('-o, --output <file>', '결과 저장 파일')
  .option('--llm', 'LLM 기반 표현식 생성')
  .option('--apply', '원본 규칙에 직접 적용')
  .action(async (options) => {
    try {
      await generateTagConditions(options);
    } catch (error) {
      logger.error('tagCondition 생성 실패:', error.message);
      process.exit(1);
    }
  });

// ============================================================
// 13. apply-tags - tagCondition 일괄 적용 [Step 6]
// ============================================================
program
  .command('apply-tags')
  .description('규칙 파일에 tagCondition 자동 분석 및 적용 (통합)')
  .requiredOption('-i, --input <file>', '규칙 JSON 파일')
  .option('-o, --output <file>', '출력 파일 (기본: _tagged.json 접미사)')
  .option('--llm', 'LLM 사용 (모든 규칙에 LLM 적용)')
  .option('--llm-fallback', '매칭 실패 시에만 LLM 자동 사용 (권장)')
  .action(async (options) => {
    try {
      await applyTagConditions(options);
    } catch (error) {
      logger.error('tagCondition 적용 실패:', error.message);
      process.exit(1);
    }
  });

// ============================================================
// 14. check-tags-status - tagCondition 현황 확인 [Step 6]
// ============================================================
program
  .command('check-tags-status')
  .description('규칙 파일의 tagCondition 적용 현황 확인')
  .requiredOption('-i, --input <file>', '규칙 JSON 파일')
  .action(async (options) => {
    try {
      await checkTagConditionStatus(options);
    } catch (error) {
      logger.error('현황 확인 실패:', error.message);
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