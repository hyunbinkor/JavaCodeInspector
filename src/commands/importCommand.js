/**
 * 가이드라인 JSON을 VectorDB에 import하는 명령어
 */

import fs from 'fs/promises';
import path from 'path';
import { VectorClient } from '../clients/vectorClient.js';
import { loadData } from '../utils/fileUtils.js';
import logger from '../utils/loggerUtils.js';

/**
 * 가이드라인 JSON을 VectorDB에 import
 * 1. JSON 파일 로드 및 파싱
 * 2. 가이드라인 배열 추출 및 검증
 * 3. 통계 정보 출력
 * 4. dry-run이 아닐 경우 Weaviate에 배치 import
 */
export async function importGuidelinesToVectorDB(options) {
  logger.info('\n=== 가이드라인 VectorDB Import 시작 ===');
  logger.info(`입력 파일: ${options.input}`);

  // 입력 파일 존재 여부 및 크기 확인
  const inputPath = path.resolve(options.input);
  try {
    await fs.access(inputPath);
    const stats = await fs.stat(inputPath);
    logger.info(`✅ 입력 파일 확인됨 (크기: ${stats.size} bytes)`);
  } catch (error) {
    logger.error(`❌ 입력 파일을 찾을 수 없습니다: ${inputPath}`);
    process.exit(1);
  }

  // JSON 파일 읽기 및 파싱
  logger.info('\n📖 가이드라인 JSON 파일 로딩 중...');
  let guidelineData;
  try {
    const fileContent = await loadData(inputPath, 'rule');
    guidelineData = JSON.parse(fileContent);
    logger.info('✅ JSON 파싱 완료');
  } catch (error) {
    logger.error('❌ JSON 파일 읽기/파싱 실패:', error.message);
    process.exit(1);
  }

  // 가이드라인 배열 추출 (배열 직접 또는 guidelines 속성)
  let guidelines = [];
  if (Array.isArray(guidelineData)) {
    guidelines = guidelineData;
  } else if (guidelineData.guidelines && Array.isArray(guidelineData.guidelines)) {
    guidelines = guidelineData.guidelines;
  } else {
    logger.error('❌ 올바른 가이드라인 형식이 아닙니다.');
    logger.info('예상 형식: { guidelines: [...] } 또는 [...]');
    process.exit(1);
  }

  logger.info(`\n📊 로드된 가이드라인: ${guidelines.length}개`);

  // 처음 3개 가이드라인 미리보기
  if (guidelines.length > 0) {
    logger.info('\n📋 가이드라인 샘플 (처음 3개):');
    guidelines.slice(0, 3).forEach((guideline, idx) => {
      logger.info(`\n${idx + 1}. ${guideline.title || guideline.ruleId}`);
      logger.info(`   카테고리: ${guideline.category}`);
      logger.info(`   체크 타입: ${guideline.checkType}`);
      logger.info(`   심각도: ${guideline.severity}`);
    });
  }

  // 카테고리, 심각도, 체크 타입별 통계 집계
  const stats = {
    category: {},
    severity: {},
    checkType: {}
  };

  guidelines.forEach(g => {
    stats.category[g.category] = (stats.category[g.category] || 0) + 1;
    stats.severity[g.severity] = (stats.severity[g.severity] || 0) + 1;
    stats.checkType[g.checkType] = (stats.checkType[g.checkType] || 0) + 1;
  });

  logger.info('\n📈 통계:');
  logger.info('\n카테고리별 분포:');
  Object.entries(stats.category).forEach(([k, v]) =>
    logger.info(`  - ${k}: ${v}개`)
  );

  logger.info('\n심각도별 분포:');
  Object.entries(stats.severity).forEach(([k, v]) =>
    logger.info(`  - ${k}: ${v}개`)
  );

  logger.info('\n체크 타입별 분포:');
  Object.entries(stats.checkType).forEach(([k, v]) =>
    logger.info(`  - ${k}: ${v}개`)
  );

  // Dry-run 모드일 경우 실제 저장하지 않고 종료
  if (options.dryRun) {
    logger.info('\n🔍 Dry-run 모드: VectorDB 저장을 건너뜁니다.');
    logger.info('실제 저장하려면 --dry-run 옵션을 제거하세요.');
    logger.info('\n=== Import 미리보기 완료 ===');
    return;
  }

  // VectorDB 클라이언트 초기화 및 스키마 설정
  logger.info('\n🔥 VectorDB에 가이드라인 import 중...');
  const vectorClient = new VectorClient();

  logger.info('\n🔧 스키마 초기화 중...');
  try {
    await vectorClient.initializeSchema();
    logger.info('✅ 스키마 초기화 완료');
  } catch (error) {
    logger.info(`⚠️ 스키마 초기화 경고: ${error.message}`);
    logger.info('계속 진행합니다...');
  }

  // 가이드라인을 Weaviate에 배치 저장
  logger.info('\n🔥 VectorDB에 가이드라인 import 중...');

  try {
    const startTime = Date.now();
    const results = await vectorClient.batchImportGuidelines(guidelines);
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    logger.info(`\n✅ VectorDB import 완료!`);
    logger.info(`⏱️ 소요 시간: ${duration}초`);
    logger.info(`✅ 성공: ${results.success}개`);
    logger.info(`❌ 실패: ${results.failed}개`);

    // 실패한 항목이 있을 경우 처음 5개만 출력
    if (results.failed > 0 && results.errors && results.errors.length > 0) {
      logger.info('\n⚠️ 실패한 항목:');
      results.errors.slice(0, 5).forEach((error, idx) => {
        logger.info(`  ${idx + 1}. ${error.ruleId || 'Unknown'}: ${error.error}`);
      });
      if (results.errors.length > 5) {
        logger.info(`  ... 외 ${results.errors.length - 5}개`);
      }
    }

  } catch (error) {
    logger.error('\n❌ VectorDB import 중 오류 발생');
    logger.error(`오류 메시지: ${error.message}`);
    if (error.stack) {
      logger.error('\n스택 트레이스:');
      logger.error(error.stack);
    }
    throw error;
  }

  logger.info('\n=== 가이드라인 Import 완료 ===');
}