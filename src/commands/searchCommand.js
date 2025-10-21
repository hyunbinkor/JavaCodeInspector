/**
 * VectorDB 기반 유사 패턴 검색 및 분석 명령어
 */

import fs from 'fs/promises';
import path from 'path';
import { issueCodeAnalyzer as IssueCodeAnalyzer } from '../core/issueCodeAnalyzer.js';
import { PatternDatasetGenerator } from '../core/patternGenerator.js';
import { VectorClient } from '../clients/vectorClient.js';
import { addLineNumbers } from '../utils/codeUtils.js';

/**
 * VectorDB 기반 유사 패턴 검색 및 동적 분석
 * 1. 코드를 임베딩하여 VectorDB에서 유사 패턴 검색
 * 2. issueCodeAnalyzer로 안전/문제 패턴 분류
 * 3. 실제 코드에서 문제 패턴 탐지
 * 4. --fix 옵션 시 패턴 기반 수정 제안 생성
 * 5. 분석 결과 JSON으로 저장
 */
export async function searchAndAnalyzePatterns(options) {
  if (!options.code) {
    console.error('검색할 코드 파일을 지정해주세요: -c <file>');
    return;
  }

  console.log('코드 패턴 분석 시작');
  console.log(`코드 파일: ${options.code}`);

  const sourceCode = await fs.readFile(options.code, 'utf-8');
  const fileName = path.basename(options.code);

  const analyzer = new IssueCodeAnalyzer();
  await analyzer.initialize();

  console.log('\n1단계: 유사 패턴 검색 중...');

  // 코드를 임베딩하여 VectorDB에서 유사한 패턴 검색
  const generator = new PatternDatasetGenerator();
  await generator.initialize();

  const embeddings = await generator.generateEmbeddings(sourceCode, {});
  const queryVector = embeddings.combined_embedding;

  const vectorClient = new VectorClient();
  const similarPatterns = await vectorClient.searchSimilarPatterns(
    queryVector,
    parseInt(options.limit),
    0.7
  );

  if (similarPatterns.length === 0) {
    console.log('유사한 패턴이 발견되지 않았습니다.');
    return;
  }

  console.log(`\n발견된 유사 패턴: ${similarPatterns.length}개`);

  // 검색된 패턴을 안전/문제 패턴으로 분류하여 출력
  similarPatterns.forEach((pattern, index) => {
    const patternType = pattern.recommended_pattern ? '안전한 패턴' : '문제 패턴';
    console.log(`  ${index + 1}. ${pattern.title} (${pattern.category}) - ${patternType}`);
  });

  console.log('\n2단계: 동적 패턴 기반 코드 분석 중...');

  // 검색된 패턴을 기반으로 실제 코드에서 문제점 탐지
  const analysisResults = await analyzer.analyzeCodeIssues(sourceCode, similarPatterns);

  const classification = analysisResults.patternClassification;
  if (classification.safePatterns.length > 0) {
    console.log(`\n안전한 패턴: ${classification.safePatterns.length}개`);
    classification.safePatterns.forEach((pattern, index) => {
      console.log(`  ${index + 1}. ${pattern.title} (${pattern.category})`);
    });
  }

  if (classification.antiPatterns.length > 0) {
    console.log(`\n문제 패턴: ${classification.antiPatterns.length}개`);
    classification.antiPatterns.forEach((pattern, index) => {
      console.log(`  ${index + 1}. ${pattern.title} (${pattern.category})`);
    });
  }

  // 코드에서 발견된 안전한 구현 출력
  if (analysisResults.safePracticesFound && analysisResults.safePracticesFound.length > 0) {
    console.log(`\n코드에서 발견된 안전한 구현: ${analysisResults.safePracticesFound.length}개`);
    analysisResults.safePracticesFound.forEach((practice, index) => {
      console.log(`  ${index + 1}. ${practice.description} (${practice.category})`);
    });
  }

  // 실제 문제가 발견되지 않은 경우 권장사항만 출력
  if (analysisResults.detectedIssues.length === 0) {
    console.log('\n주요 문제성 패턴이 발견되지 않았습니다.');

    if (analysisResults.recommendations && analysisResults.recommendations.length > 0) {
      console.log('\n추가 개선 권장사항:');
      analysisResults.recommendations.forEach((rec, index) => {
        if (rec.missing.length > 0) {
          console.log(`\n  ${rec.category} 카테고리:`);
          console.log(`    현재 구현: ${rec.implemented.map(i => i.description).join(', ') || '없음'}`);
          console.log(`    추가 권장: ${rec.missing.join(', ')}`);
        }
      });
    }

    if (options.output) {
      const analysisReport = {
        fileName,
        analysisDate: new Date().toISOString(),
        sourceCodeLines: sourceCode.split('\n').length,
        result: 'NO_ISSUES_FOUND',
        patternClassification: {
          safePatterns: classification.safePatterns.map(p => ({
            title: p.title,
            category: p.category,
            patternName: p.recommended_pattern?.pattern_name
          })),
          antiPatterns: classification.antiPatterns.map(p => ({
            title: p.title,
            category: p.category,
            severity: p.metadata?.severity
          }))
        },
        safePracticesFound: analysisResults.safePracticesFound,
        recommendations: analysisResults.recommendations,
        detectedIssues: [],
        summary: '주요 문제성 패턴이 발견되지 않았습니다. VectorDB의 동적 패턴 분석을 통해 코드가 모범 사례를 잘 따르고 있음을 확인했습니다.',
        analysisMetadata: analysisResults.analysisMetadata
      };

      await fs.writeFile(options.output, JSON.stringify(analysisReport, null, 2), 'utf-8');
      console.log(`\n분석 결과가 저장되었습니다: ${options.output}`);
    }

    console.log('\n동적 패턴 기반 코드 분석 완료 - 문제 없음');
    return;
  }

  // 발견된 문제 출력
  console.log(`\n실제 발견된 문제: ${analysisResults.detectedIssues.length}개`);

  analysisResults.detectedIssues.forEach((issue, index) => {
    console.log(`\n--- 문제 ${index + 1}: ${issue.title} ---`);
    console.log(`위치: ${issue.location.startLine}~${issue.location.endLine}줄`);
    console.log(`심각도: ${issue.severity}`);
    console.log(`신뢰도: ${(issue.patternInfo?.confidence * 100 || 80).toFixed(0)}%`);
    console.log(`패턴 ID: ${issue.patternInfo?.patternId || 'N/A'}`);
    console.log(`설명: ${issue.description}`);
    console.log('해당 코드:');
    console.log(addLineNumbers(issue.codeSnippet, issue.location.startLine));
  });

  let fullFixedCode = null;

  // --fix 옵션: VectorDB 패턴을 기반으로 수정 제안 생성
  if (options.fix) {
    console.log('\n3단계: VectorDB 패턴 기반 수정안 생성 중...');

    for (let i = 0; i < analysisResults.detectedIssues.length; i++) {
      const issue = analysisResults.detectedIssues[i];
      console.log(`\n문제 ${i + 1} VectorDB 패턴 기반 수정안 생성 중...`);

      // VectorDB에서 가져온 권장 패턴을 기반으로 수정 제안 생성
      const fixSuggestion = await analyzer.generateFixSuggestion(issue, sourceCode);
      analysisResults.detectedIssues[i].fixSuggestion = fixSuggestion;

      console.log(`\n--- VectorDB 패턴 기반 수정안 ${i + 1}: ${issue.title} ---`);

      if (fixSuggestion.patternBasedSuggestions) {
        console.log('VectorDB 권장 사항:');
        fixSuggestion.patternBasedSuggestions.forEach((suggestion, idx) => {
          console.log(`  ${idx + 1}. ${suggestion}`);
        });
      }

      console.log('\n구체적 수정 방법:');
      fixSuggestion.steps.forEach((step, stepIndex) => {
        console.log(`  ${stepIndex + 1}. ${step}`);
      });

      if (fixSuggestion.fixedCode) {
        console.log('\n수정된 코드:');
        console.log(addLineNumbers(fixSuggestion.fixedCode, issue.location.startLine));
      }

      if (fixSuggestion.frameworkNotes && fixSuggestion.frameworkNotes.length > 0) {
        console.log('\n프레임워크별 추가 권장사항:');
        fixSuggestion.frameworkNotes.forEach((note, noteIdx) => {
          console.log(`  • ${note}`);
        });
      }

      if (fixSuggestion.explanation) {
        console.log(`\n설명: ${fixSuggestion.explanation}`);
      }
    }

    // 모든 수정사항을 적용한 전체 코드 생성
    console.log('\n4단계: 전체 VectorDB 패턴 적용 코드 생성 중...');
    fullFixedCode = await analyzer.generateFullFixedCodeWithLLM(sourceCode, analysisResults.detectedIssues);

    console.log('\nVectorDB 패턴이 적용된 전체 수정 코드:');
    console.log('='.repeat(80));
    console.log(addLineNumbers(fullFixedCode));
    console.log('='.repeat(80));
  }

  // 분석 결과를 JSON으로 저장
  if (options.output) {
    const analysisReport = {
      fileName,
      analysisDate: new Date().toISOString(),
      sourceCodeLines: sourceCode.split('\n').length,
      result: 'ISSUES_FOUND',
      patternClassification: {
        safePatterns: classification.safePatterns.map(p => ({
          title: p.title,
          category: p.category,
          patternName: p.recommended_pattern?.pattern_name,
          codeExample: p.recommended_pattern?.code_template
        })),
        antiPatterns: classification.antiPatterns.map(p => ({
          title: p.title,
          category: p.category,
          severity: p.metadata?.severity,
          problematicCode: p.anti_pattern?.code_template
        }))
      },
      safePracticesFound: analysisResults.safePracticesFound,
      detectedIssues: analysisResults.detectedIssues,
      recommendations: analysisResults.recommendations,
      ...(options.fix && {
        vectorDbBasedFixes: analysisResults.detectedIssues.map(issue => ({
          issueTitle: issue.title,
          patternBasedSuggestions: issue.fixSuggestion?.patternBasedSuggestions,
          frameworkNotes: issue.fixSuggestion?.frameworkNotes,
          codeExample: issue.fixSuggestion?.codeExample
        })),
        fullFixedCode: fullFixedCode
      }),
      analysisMetadata: analysisResults.analysisMetadata,
      summary: `VectorDB의 동적 패턴 분석을 통해 ${analysisResults.detectedIssues.length}개의 문제가 발견되었습니다. ${classification.safePatterns.length}개의 안전한 패턴과 ${classification.antiPatterns.length}개의 문제 패턴을 참고하여 분석했습니다.`
    };

    await fs.writeFile(options.output, JSON.stringify(analysisReport, null, 2), 'utf-8');
    console.log(`\nVectorDB 패턴 기반 분석 결과가 저장되었습니다: ${options.output}`);
  }

  const issueCount = analysisResults.detectedIssues.length;
  const safePracticeCount = analysisResults.safePracticesFound?.length || 0;
  const safePatternCount = classification.safePatterns.length;
  const antiPatternCount = classification.antiPatterns.length;

  console.log('\nVectorDB 기반 동적 패턴 분석 완료');
  console.log(`분석 요약:`);
  console.log(`   - VectorDB 안전한 패턴: ${safePatternCount}개`);
  console.log(`   - VectorDB 문제 패턴: ${antiPatternCount}개`);
  console.log(`   - 코드 내 안전한 구현: ${safePracticeCount}개`);
  console.log(`   - 발견된 실제 문제: ${issueCount}개`);
  console.log(`   - VectorDB 기반 수정안: ${options.fix ? '제시됨' : '미제시'}`);

  if (issueCount === 0 && safePracticeCount > 0) {
    console.log(`결론: VectorDB 패턴 분석 결과, 코드가 모범 사례를 잘 따르고 있습니다.`);
  } else if (issueCount > 0) {
    console.log(`권고: VectorDB에서 가져온 ${antiPatternCount}개의 패턴 정보를 참고하여 ${issueCount}개 문제를 수정해주세요.`);
  }
}