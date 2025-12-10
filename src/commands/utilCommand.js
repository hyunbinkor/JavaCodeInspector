import path from 'path';
import { VectorClient } from '../clients/vectorClient.js';
import { PatternDatasetGenerator } from '../core/patternGenerator.js';
import { issueCodeAnalyzer as IssueCodeAnalyzer } from '../core/issueCodeAnalyzer.js';
import { loadData, saveJsonData } from '../utils/fileUtils.js';
import { addLineNumbers } from '../utils/codeUtils.js';
import logger from '../utils/loggerUtils.js';

/**
 * VectorDB 기반 유사 패턴 검색 및 동적 분석
 * 
 * 내부 흐름:
 * 1. CodeEmbeddingGenerator로 입력 코드 벡터 생성
 * 2. Qdrant VectorDB에서 유사도 기반 패턴 검색
 * 3. IssueCodeAnalyzer로 검색된 패턴 분석
 * 4. (옵션) vLLM 기반 수정안 생성
 * 5. 분석 결과 및 유사 패턴 목록 반환
 * 
 * @param {Object} options - CLI 옵션
 * @param {string} options.code - 검색할 코드 파일 경로
 * @param {number} options.limit - 검색 결과 수 (기본값: 5)
 * @param {boolean} options.fix - 수정안 제시 활성화
 * @param {string} options.output - 분석 결과 저장 파일 경로
 */
export async function searchAndAnalyzePatterns(options) {
    if (!options.code) {
        logger.error('검색할 코드 파일을 지정해주세요: -c <file>');
        return;
    }

    logger.info('코드 패턴 분석 시작');
    logger.info(`코드 파일: ${options.code}`);

    const sourceCode = await loadData(options.code, 'sampleCode');
    const fileName = path.basename(options.code);

    const analyzer = new IssueCodeAnalyzer();
    await analyzer.initialize();

    logger.info('\n1단계: 유사 패턴 검색 중...');

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
        logger.info('유사한 패턴이 발견되지 않았습니다.');
        return;
    }

    logger.info(`\n발견된 유사 패턴: ${similarPatterns.length}개`);

    // 검색된 패턴을 안전/문제 패턴으로 분류하여 출력
    similarPatterns.forEach((pattern, index) => {
        const patternType = pattern.recommended_pattern ? '안전한 패턴' : '문제 패턴';
        logger.info(`  ${index + 1}. ${pattern.title} (${pattern.category}) - ${patternType}`);
    });

    logger.info('\n2단계: 동적 패턴 기반 코드 분석 중...');

    // 검색된 패턴을 기반으로 실제 코드에서 문제점 탐지
    const analysisResults = await analyzer.analyzeCodeIssues(sourceCode, similarPatterns);

    const classification = analysisResults.patternClassification;
    if (classification.safePatterns.length > 0) {
        logger.info(`\n안전한 패턴: ${classification.safePatterns.length}개`);
        classification.safePatterns.forEach((pattern, index) => {
            logger.info(`  ${index + 1}. ${pattern.title} (${pattern.category})`);
        });
    }

    if (classification.antiPatterns.length > 0) {
        logger.info(`\n문제 패턴: ${classification.antiPatterns.length}개`);
        classification.antiPatterns.forEach((pattern, index) => {
            logger.info(`  ${index + 1}. ${pattern.title} (${pattern.category})`);
        });
    }

    // 코드에서 발견된 안전한 구현 출력
    if (analysisResults.safePracticesFound && analysisResults.safePracticesFound.length > 0) {
        logger.info(`\n코드에서 발견된 안전한 구현: ${analysisResults.safePracticesFound.length}개`);
        analysisResults.safePracticesFound.forEach((practice, index) => {
            logger.info(`  ${index + 1}. ${practice.description} (${practice.category})`);
        });
    }

    // 실제 문제가 발견되지 않은 경우 권장사항만 출력
    if (analysisResults.detectedIssues.length === 0) {
        logger.info('\n주요 문제성 패턴이 발견되지 않았습니다.');

        if (analysisResults.recommendations && analysisResults.recommendations.length > 0) {
            logger.info('\n추가 개선 권장사항:');
            analysisResults.recommendations.forEach((rec, index) => {
                if (rec.missing.length > 0) {
                    logger.info(`\n  ${rec.category} 카테고리:`);
                    logger.info(`    현재 구현: ${rec.implemented.map(i => i.description).join(', ') || '없음'}`);
                    logger.info(`    추가 권장: ${rec.missing.join(', ')}`);
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

            await saveJsonData(analysisReport, options.output, 'report');
            logger.info(`\n분석 결과가 저장되었습니다: ${options.output}`);
        }

        logger.info('\n동적 패턴 기반 코드 분석 완료 - 문제 없음');
        return;
    }

    // 발견된 문제 출력
    logger.info(`\n실제 발견된 문제: ${analysisResults.detectedIssues.length}개`);

    analysisResults.detectedIssues.forEach((issue, index) => {
        logger.info(`\n--- 문제 ${index + 1}: ${issue.title} ---`);
        logger.info(`위치: ${issue.location.startLine}~${issue.location.endLine}줄`);
        logger.info(`심각도: ${issue.severity}`);
        logger.info(`신뢰도: ${(issue.patternInfo?.confidence * 100 || 80).toFixed(0)}%`);
        logger.info(`패턴 ID: ${issue.patternInfo?.patternId || 'N/A'}`);
        logger.info(`설명: ${issue.description}`);
        logger.info('해당 코드:');
        logger.info(addLineNumbers(issue.codeSnippet, issue.location.startLine));
    });

    let fullFixedCode = null;

    // --fix 옵션: VectorDB 패턴을 기반으로 수정 제안 생성
    if (options.fix) {
        logger.info('\n3단계: VectorDB 패턴 기반 수정안 생성 중...');

        for (let i = 0; i < analysisResults.detectedIssues.length; i++) {
            const issue = analysisResults.detectedIssues[i];
            logger.info(`\n문제 ${i + 1} VectorDB 패턴 기반 수정안 생성 중...`);

            // VectorDB에서 가져온 권장 패턴을 기반으로 수정 제안 생성
            const fixSuggestion = await analyzer.generateFixSuggestion(issue, sourceCode);
            analysisResults.detectedIssues[i].fixSuggestion = fixSuggestion;

            logger.info(`\n--- VectorDB 패턴 기반 수정안 ${i + 1}: ${issue.title} ---`);

            if (fixSuggestion.patternBasedSuggestions) {
                logger.info('VectorDB 권장 사항:');
                fixSuggestion.patternBasedSuggestions.forEach((suggestion, idx) => {
                    logger.info(`  ${idx + 1}. ${suggestion}`);
                });
            }

            logger.info('\n구체적 수정 방법:');
            fixSuggestion.steps.forEach((step, stepIndex) => {
                logger.info(`  ${stepIndex + 1}. ${step}`);
            });

            if (fixSuggestion.fixedCode) {
                logger.info('\n수정된 코드:');
                logger.info(addLineNumbers(fixSuggestion.fixedCode, issue.location.startLine));
            }

            if (fixSuggestion.frameworkNotes && fixSuggestion.frameworkNotes.length > 0) {
                logger.info('\n프레임워크별 추가 권장사항:');
                fixSuggestion.frameworkNotes.forEach((note, noteIdx) => {
                    logger.info(`  • ${note}`);
                });
            }

            if (fixSuggestion.explanation) {
                logger.info(`\n설명: ${fixSuggestion.explanation}`);
            }
        }

        // 모든 수정사항을 적용한 전체 코드 생성
        logger.info('\n4단계: 전체 VectorDB 패턴 적용 코드 생성 중...');
        fullFixedCode = await analyzer.generateFullFixedCodeWithLLM(sourceCode, analysisResults.detectedIssues);

        logger.info('\nVectorDB 패턴이 적용된 전체 수정 코드:');
        logger.info('='.repeat(80));
        logger.info(addLineNumbers(fullFixedCode));
        logger.info('='.repeat(80));
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

        await saveJsonData(analysisReport, options.output, 'report');
        logger.info(`\nVectorDB 패턴 기반 분석 결과가 저장되었습니다: ${options.output}`);
    }

    const issueCount = analysisResults.detectedIssues.length;
    const safePracticeCount = analysisResults.safePracticesFound?.length || 0;
    const safePatternCount = classification.safePatterns.length;
    const antiPatternCount = classification.antiPatterns.length;

    logger.info('\nVectorDB 기반 동적 패턴 분석 완료');
    logger.info(`분석 요약:`);
    logger.info(`   - VectorDB 안전한 패턴: ${safePatternCount}개`);
    logger.info(`   - VectorDB 문제 패턴: ${antiPatternCount}개`);
    logger.info(`   - 코드 내 안전한 구현: ${safePracticeCount}개`);
    logger.info(`   - 발견된 실제 문제: ${issueCount}개`);
    logger.info(`   - VectorDB 기반 수정안: ${options.fix ? '제시됨' : '미제시'}`);

    if (issueCount === 0 && safePracticeCount > 0) {
        logger.info(`결론: VectorDB 패턴 분석 결과, 코드가 모범 사례를 잘 따르고 있습니다.`);
    } else if (issueCount > 0) {
        logger.info(`권고: VectorDB에서 가져온 ${antiPatternCount}개의 패턴 정보를 참고하여 ${issueCount}개 문제를 수정해주세요.`);
    }
}