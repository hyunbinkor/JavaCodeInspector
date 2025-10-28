#!/usr/bin/env node

/**
 * 통합 Java 코드 품질 검사 CLI 프로그램 (메인 진입점)
 * 
 * 3-Layer 아키텍처 기반 정적 분석 시스템:
 * - Layer1: DevelopmentGuidelineChecker (가이드라인 규칙 검증)
 * - Layer2: VectorDB 패턴 검색 (Qdrant 기반 유사 패턴 매칭)
 * - Layer3: UnifiedJavaCodeChecker (통합 리포트 생성)
 * 
 * 핵심 컴포넌트:
 * - GuidelineExtractor: PDF에서 규칙 추출
 * - CodeEmbeddingGenerator: 코드 벡터화
 * - IssueCodeAnalyzer: 패턴 분석 및 수정안 생성
 * - PatternDatasetGenerator: 패턴 데이터셋 관리
 * 
 * @module main
 * @version 2.0.0
 * 
 * # TODO: Node.js → Python 변환 필요 (FastAPI 기반)
 * # TODO: commander → argparse/typer 마이그레이션
 * # NOTE: 금융권 보안 요구사항 준수 필요 (파일 경로 검증, 입력 sanitization)
 */

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
import logger from './utils/loggerUtils.js';

const program = new Command();

// CLI 프로그램 기본 정보 설정
program
  .name('unified-code-analyzer')
  .description('통합 Java 코드 품질 검사 도구 (패턴 분석 + 개발가이드 검사)')
  .version('2.0.0');

/**
 * 통합 코드 품질 검사 명령어
 * 
 * @command check
 * @param {string} options.code - 검사할 Java 코드 파일 경로
 * @param {string} options.output - 분석 결과 저장 파일 경로
 * @param {boolean} options.skipPatterns - 패턴 분석 건너뛰기 플래그
 * @param {boolean} options.skipGuidelines - 가이드라인 검사 건너뛰기 플래그
 * @param {boolean} options.skipContextual - LLM 맥락 검사 건너뛰기 플래그
 * @param {boolean} options.generateFixes - 수정안 자동 생성 플래그
 * @param {number} options.limit - 패턴 검색 결과 수 (기본값: 10)
 * 
 * @example check --code=MyClass.java --output=report.json
 * @example check --code=MyClass.java --skip-patterns --generate-fixes
 * @example check --code=MyClass.java --limit=20 --output=result.json
 * 
 * # TODO: Python으로 변환 시 performUnifiedCheck() → unified_check() FastAPI 엔드포인트 연동
 * # PERFORMANCE: 병렬 처리 최적화 기회 (가이드라인 검사 + 패턴 검색 동시 실행)
 */
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
      logger.error('통합 검사 실패:', error.message);
      process.exit(1);
    }
  });

/**
 * 개발가이드 전용 검사 명령어
 * 
 * @command check-guidelines
 * @param {string} options.code - 검사할 Java 코드 파일 경로
 * @param {boolean} options.includeContextual - LLM 맥락 검사 포함 플래그
 * @param {boolean} options.fix - 가이드라인 기반 수정안 생성 플래그
 * @param {string} options.output - 결과 저장 파일 경로
 * 
 * @example check-guidelines --code=MyClass.java
 * @example check-guidelines --code=MyClass.java --include-contextual --fix
 * @example check-guidelines --code=MyClass.java --output=guideline_report.json
 * 
 * # TODO: Python 변환 시 DevelopmentGuidelineChecker 클래스 구현 필요
 */
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
      logger.error('가이드라인 검사 실패:', error.message);
      process.exit(1);
    }
  });

/**
 * VectorDB 기반 유사 패턴 검색 및 분석 명령어
 * 
 * @command search
 * @param {string} options.code - 검색할 코드 파일 경로
 * @param {number} options.limit - 검색 결과 수 (기본값: 5)
 * @param {boolean} options.fix - 수정안 제시 활성화 플래그
 * @param {string} options.output - 분석 결과 저장 파일 경로
 * 
 * @example search --code=MyClass.java --limit=10
 * @example search --code=MyClass.java --fix --output=patterns.json
 * 
 * # TODO: Python 변환 시 Qdrant 클라이언트 연동 필요
 * # PERFORMANCE: 벡터 검색 캐싱으로 중복 임베딩 생성 방지
 */
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
      logger.error('❌ 검색 실패:', error.message);
      process.exit(1);
    }
  });

/**
 * 하위 호환성을 위한 search-patterns 명령어 (search와 동일)
 * 
 * 내부 흐름:
 * - search 명령어와 동일한 searchAndAnalyzePatterns() 호출
 * 
 * @command search-patterns
 * @param {string} options.code - 검사할 코드 파일 경로
 * @param {number} options.limit - 검색 결과 수 (기본값: 5)
 * @param {boolean} options.fix - 수정안 제시 활성화 플래그
 * @param {string} options.output - 분석 결과 저장 파일 경로
 * 
 * @example search-patterns --code=MyClass.java --limit=10
 * 
 * # NOTE: 하위 호환성 유지를 위한 별칭 명령어, Python 마이그레이션 후 제거 고려
 */
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
      logger.error('패턴 검색 실패:', error.message);
      process.exit(1);
    }
  });

/**
 * 단일 이슈 분석 및 패턴 데이터셋 생성 명령어
 * 
 * @command analyze
 * @param {string} options.input - 입력 JSON 파일 경로 (이슈 정보 포함)
 * @param {string} options.output - 출력 JSON 파일 경로 (패턴 데이터셋)
 * 
 * @example analyze --input=issue001.json --output=pattern001.json
 * 
 * # TODO: Python 변환 시 JSON schema 검증 추가 (pydantic 사용)
 */
program
  .command('analyze')
  .description('단일 이슈를 분석하여 패턴 데이터셋 생성')
  .option('-i, --input <file>', '입력 JSON 파일 경로')
  .option('-o, --output <file>', '출력 JSON 파일 경로')
  .action(async (options) => {
    try {
      await processSingleIssue(options);
    } catch (error) {
      logger.error('분석 실패:', error.message);
      process.exit(1);
    }
  });

/**
 * 여러 이슈를 배치로 처리하는 명령어
 * 
 * @command batch
 * @param {string} options.input - 입력 디렉토리 경로 (이슈 JSON 파일들)
 * @param {string} options.output - 출력 디렉토리 경로 (패턴 데이터셋들)
 * 
 * @example batch --input=./issues --output=./patterns
 * 
 * # PERFORMANCE: 병렬 처리 최적화 기회 (Promise.all 또는 워커 스레드 활용)
 * # TODO: Python 변환 시 asyncio/concurrent.futures 사용
 */
program
  .command('batch')
  .description('여러 이슈를 배치로 처리')
  .option('-i, --input <dir>', '입력 디렉토리 경로')
  .option('-o, --output <dir>', '출력 디렉토리 경로')
  .action(async (options) => {
    try {
      await processBatchIssues(options);
    } catch (error) {
      logger.error('배치 처리 실패:', error.message);
      process.exit(1);
    }
  });

/**
 * 가이드라인 규칙 관리 명령어 (CRUD 작업)
 * 
 * @command manage-guidelines
 * @param {string} options.import - 가져올 가이드라인 텍스트 파일 경로
 * @param {boolean} options.list - 저장된 가이드라인 목록 출력 플래그
 * @param {string} options.export - 내보낼 가이드라인 파일 경로
 * 
 * @example manage-guidelines --import=guidelines.txt
 * @example manage-guidelines --list
 * @example manage-guidelines --export=guidelines_backup.json
 * 
 * # NOTE: 금융권 규정 변경 시 가이드라인 업데이트 필수
 * # TODO: Python 변환 시 가이드라인 버전 관리 기능 추가
 */
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
      logger.error('가이드라인 관리 실패:', error.message);
      process.exit(1);
    }
  });

/**
 * PDF에서 개발가이드 규칙 추출 명령어
 * 
 * 내부 흐름:
 * 1. GuidelineExtractor로 PDF 파일 읽기
 * 2. PDF 텍스트 추출 (pdfjs 또는 pdf-parse 사용)
 * 3. vLLM 기반 규칙 구조화 (제목, 설명, 예제 코드 분리)
 * 4. JSON 포맷으로 변환 후 파일 저장
 * 5. (옵션) importGuidelinesToVectorDB() 호출하여 VectorDB에 즉시 저장
 * 
 * @command extract-guidelines
 * @param {string} options.input - 입력 PDF 파일 경로 (필수)
 * @param {string} options.output - 출력 JSON 파일 경로 (필수)
 * @param {boolean} options.importToDb - 추출 후 VectorDB 자동 import 플래그
 * 
 * @example extract-guidelines --input=coding_standards.pdf --output=guidelines.json
 * @example extract-guidelines --input=coding_standards.pdf --output=guidelines.json --import-to-db
 * 
 * # TODO: Python 변환 시 GuidelineExtractor 클래스 구현 (PyPDF2 또는 pdfplumber 사용)
 * # NOTE: 금융권 PDF는 보안 제한이 있을 수 있음 (암호화, 복사 방지 등)
 * # PERFORMANCE: 대용량 PDF 처리 시 메모리 사용량 최적화 필요
 */
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
      logger.error('가이드라인 추출 실패:', error.message);
      process.exit(1);
    }
  });

/**
 * 추출된 가이드라인 JSON을 VectorDB에 일괄 저장하는 명령어
 * 
 * 내부 흐름:
 * 1. 가이드라인 JSON 파일 로드 및 검증
 * 2. CodeEmbeddingGenerator로 각 가이드라인 벡터 생성
 * 3. Qdrant VectorDB에 벡터 및 메타데이터 upsert
 * 4. (옵션) dry-run 모드: VectorDB 저장 없이 미리보기만 출력
 * 
 * @command import-guidelines
 * @param {string} options.input - 가이드라인 JSON 파일 경로 (필수)
 * @param {boolean} options.dryRun - VectorDB 저장 없이 미리보기 플래그
 * 
 * @example import-guidelines --input=guidelines.json
 * @example import-guidelines --input=guidelines.json --dry-run
 * 
 * # TODO: Python 변환 시 Qdrant upsert 로직 구현
 * # PERFORMANCE: 배치 upsert로 VectorDB 쓰기 성능 개선 (bulk insert)
 * # NOTE: VectorDB 연결 실패 시 재시도 로직 필요 (exponential backoff)
 */
program
  .command('import-guidelines')
  .description('추출된 가이드라인 JSON을 VectorDB에 저장')
  .requiredOption('-i, --input <file>', '가이드라인 JSON 파일 경로')
  .option('--dry-run', 'VectorDB 저장 없이 미리보기만')
  .action(async (options) => {
    try {
      await importGuidelinesToVectorDB(options);
    } catch (error) {
      logger.error('가이드라인 import 실패:', error.message);
      process.exit(1);
    }
  });

/**
 * 시스템 상태 확인 명령어 (헬스체크)
 * 
 * 내부 흐름:
 * 1. VectorDB (Qdrant) 연결 상태 확인
 * 2. vLLM 서비스 응답 확인
 * 3. 가이드라인 데이터 개수 조회
 * 4. 패턴 데이터셋 개수 조회
 * 5. 시스템 리소스 상태 (메모리, 디스크) 출력
 * 
 * @command status
 * @returns {void} 상태 정보를 콘솔에 출력
 * 
 * @example status
 * 
 * # TODO: Python 변환 시 FastAPI health check 엔드포인트 연동
 * # PERFORMANCE: 상태 체크 타임아웃 설정 (5초 이내)
 */
program
  .command('status')
  .description('시스템 상태 확인')
  .action(async () => {
    try {
      await checkSystemStatus();
    } catch (error) {
      logger.error('상태 확인 실패:', error.message);
      process.exit(1);
    }
  });

/**
 * 메인 진입점: CLI 명령어 파싱 및 실행
 * 
 * 내부 흐름:
 * 1. process.argv에서 명령어 및 옵션 파싱 (commander)
 * 2. 매칭되는 command action 함수 실행
 * 3. 에러 발생 시 에러 메시지 출력 및 프로세스 종료
 * 
 * @returns {Promise<void>}
 * 
 * # TODO: Python 변환 시 argparse 또는 typer CLI 프레임워크 사용
 * # NOTE: 에러 처리 시 금융권 로깅 시스템 연동 필요
 */
async function main() {
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    logger.error('실행 오류:', error.message);
    process.exit(1);
  }
}

// 직접 실행 시에만 main 함수 호출
// # NOTE: ES Module 환경에서 메인 모듈 판별
const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  main();
}