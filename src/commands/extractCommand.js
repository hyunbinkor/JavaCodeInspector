import fs from 'fs/promises';
import path from 'path';
import { GuidelineExtractor } from '../core/guidelineExtractor.js';
import { VectorClient } from '../clients/vectorClient.js';

/**
 * PDF에서 가이드라인 추출
 * 1. PDF 파일 존재 확인
 * 2. GuidelineExtractor 초기화 및 PDF 파싱
 * 3. LLM을 통해 텍스트에서 구조화된 가이드라인 추출
 * 4. JSON 파일로 저장
 * 5. 옵션에 따라 VectorDB에 바로 import
 */
export async function extractGuidelinesFromPDF(options) {
  console.log('\n=== PDF 가이드라인 추출 시작 ===');
  console.log(`입력 파일: ${options.input}`);
  console.log(`출력 파일: ${options.output}`);
  console.log(`작업 디렉토리: ${process.cwd()}`);
  console.log(`절대 경로: ${path.resolve(options.input)}`);

  // PDF 파일 존재 여부 및 크기 확인
  const inputPath = path.resolve(options.input);
  try {
    await fs.access(inputPath);
    const stats = await fs.stat(inputPath);
    console.log(`✅ 입력 파일 확인됨 (크기: ${stats.size} bytes)`);
  } catch (error) {
    console.error(`❌ 입력 파일을 찾을 수 없습니다: ${inputPath}`);
    console.error(`현재 디렉토리의 파일 목록을 확인하세요:`);
    try {
      const files = await fs.readdir('.');
      console.log('현재 디렉토리 파일:', files.filter(f => f.endsWith('.pdf')));
    } catch (e) {
      // 무시
    }
    process.exit(1);
  }

  // GuidelineExtractor 초기화 (LLM 클라이언트 설정 포함)
  console.log('\n🚀 GuidelineExtractor 초기화 중...');
  const extractor = new GuidelineExtractor();

  try {
    await extractor.initialize();
    console.log('✅ 초기화 완료');

    // PDF 파일 텍스트 추출 및 LLM으로 가이드라인 파싱
    console.log('\n📄 PDF 파일 분석 시작...');
    const startTime = Date.now();

    await extractor.extractFromPDF(inputPath);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`⏱️ 추출 소요 시간: ${duration}초`);

    // 추출 결과가 없을 경우 경고
    if (extractor.guidelines.length === 0) {
      console.warn('\n⚠️ 추출된 가이드라인이 없습니다.');
      console.log('extracted_text_debug.txt 파일을 확인해보세요.');

      if (extractor.extractedText) {
        console.log(`\n추출된 텍스트 샘플 (처음 500자):`);
        console.log(extractor.extractedText.substring(0, 500));
      }
      return;
    }

    console.log(`\n✅ 총 ${extractor.guidelines.length}개의 가이드라인 추출 완료`);

    // 처음 3개 가이드라인 샘플 출력
    console.log('\n📋 추출된 가이드라인 샘플 (처음 3개):');
    extractor.guidelines.slice(0, 3).forEach((guideline, idx) => {
      console.log(`\n${idx + 1}. ${guideline.title}`);
      console.log(`   카테고리: ${guideline.category}`);
      console.log(`   체크 타입: ${guideline.checkType}`);
      console.log(`   설명: ${guideline.description.substring(0, 100)}...`);
    });

    // 추출된 가이드라인을 JSON 파일로 저장
    console.log(`\n💾 JSON 파일 저장 중: ${options.output}`);
    await extractor.saveToJSON(options.output);

    // --import-to-db 옵션이 있을 경우 바로 VectorDB에 저장
    if (options.importToDb) {
      console.log('\n🔥 VectorDB에 가이드라인 import 중...');
      const vectorClient = new VectorClient();

      const results = await vectorClient.batchImportGuidelines(extractor.guidelines);

      console.log(`✅ VectorDB import 완료: 성공 ${results.success}개, 실패 ${results.failed}개`);
    }

    console.log('\n=== 가이드라인 추출 완료 ===');

  } catch (error) {
    console.error('\n❌ 가이드라인 추출 중 오류 발생');
    console.error(`오류 메시지: ${error.message}`);
    console.error(`오류 타입: ${error.name}`);
    if (error.stack) {
      console.error('\n스택 트레이스:');
      console.error(error.stack);
    }
    throw error;
  }
}