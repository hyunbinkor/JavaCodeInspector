/**
 * 패턴 검색 명령어 핸들러
 * 
 * @module commands/searchCommand
 * @version 3.0.0
 */

import path from 'path';
import { VectorClient } from '../clients/vectorClient.js';
import { PatternDatasetGenerator } from '../core/patternGenerator.js';
import { issueCodeAnalyzer as IssueCodeAnalyzer } from '../core/issueCodeAnalyzer.js';
import { loadData, saveJsonData } from '../utils/fileUtils.js';
import logger from '../utils/loggerUtils.js';

/**
 * VectorDB 기반 유사 패턴 검색 (Layer2)
 * 
 * @param {Object} options - CLI 옵션
 * @param {string} options.code - 검색할 코드 파일
 * @param {number} [options.limit=5] - 검색 결과 수
 * @param {string} [options.output] - 결과 저장 파일
 */
export async function searchPatterns(options) {
  logger.info('=== 패턴 검색 (Layer2) ===');
  logger.info(`대상: ${options.code}`);

  const sourceCode = await loadData(options.code, 'sampleCode');
  const fileName = path.basename(options.code);
  const limit = parseInt(options.limit) || 5;

  // 임베딩 생성
  const generator = new PatternDatasetGenerator();
  await generator.initialize();
  const embeddings = await generator.generateEmbeddings(sourceCode, {});

  // VectorDB 검색
  const vectorClient = new VectorClient();
  const patterns = await vectorClient.searchSimilarPatterns(
    embeddings.combined_embedding,
    limit,
    0.7
  );

  if (patterns.length === 0) {
    logger.info('유사 패턴 없음');
    return;
  }

  logger.info(`\n발견된 패턴: ${patterns.length}개`);
  patterns.forEach((p, i) => {
    const type = p.recommended_pattern ? '✅' : '⚠️';
    logger.info(`  ${i + 1}. ${type} [${(p.score * 100).toFixed(0)}%] ${p.title}`);
  });

  // 패턴 분석
  const analyzer = new IssueCodeAnalyzer();
  await analyzer.initialize();
  const analysis = await analyzer.analyzeCodeIssues(sourceCode, patterns);

  if (analysis.detectedIssues?.length > 0) {
    logger.info(`\n탐지된 이슈: ${analysis.detectedIssues.length}개`);
    analysis.detectedIssues.forEach((issue, i) => {
      logger.info(`  ${i + 1}. 라인 ${issue.line}: ${issue.message}`);
    });
  }

  if (options.output) {
    await saveJsonData({
      fileName,
      timestamp: new Date().toISOString(),
      patterns: patterns.map(p => ({
        id: p.id,
        title: p.title,
        score: p.score,
        isRecommended: p.recommended_pattern
      })),
      issues: analysis.detectedIssues || []
    }, options.output, 'report');
    logger.info(`결과 저장: ${options.output}`);
  }

  logger.info('=== 검색 완료 ===');
}