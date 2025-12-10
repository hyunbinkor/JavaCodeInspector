/**
 * Meta Info Manager
 * 
 * 프로젝트, 모듈, 팀, 규제 수준 등의 메타 정보를 관리하고
 * 임베딩 생성 시 비즈니스 컨텍스트로 활용
 * 
 * @module MetaInfoManager
 */

import fs from 'fs/promises';
import path from 'path';
import logger from './loggerUtils.js';

export class MetaInfoManager {
    constructor() {
        this.metaInfoTable = new Map();
        this.metaInfoPath = null;
        this.initialized = false;
    }

    /**
     * 초기화 - 메타 정보 테이블 로드
     */
    async initialize() {
        logger.info('📊 메타 정보 관리자 초기화 중...');

        try {
            // 설정에서 메타 정보 경로 로드
            this.metaInfoPath = process.env.META_INFO_PATH ||
                path.join(process.cwd(), 'asset', 'meta_info.json');

            // JSON 파일 로드
            const content = await fs.readFile(this.metaInfoPath, 'utf-8');
            const metaData = JSON.parse(content);

            // Map으로 변환 (빠른 조회)
            if (Array.isArray(metaData)) {
                metaData.forEach(item => {
                    const key = this.generateKey(item);
                    this.metaInfoTable.set(key, item);
                });
            } else if (typeof metaData === 'object') {
                // 객체 형식인 경우
                for (const [key, value] of Object.entries(metaData)) {
                    this.metaInfoTable.set(key, value);
                }
            }

            this.initialized = true;
            logger.info(`✅ 메타 정보 로드 완료: ${this.metaInfoTable.size}개 항목`);
        } catch (error) {
            logger.warn('⚠️ 메타 정보 파일 로드 실패, 기본 모드 사용:', error.message);
            this.metaInfoTable = new Map();
            this.initialized = true;
        }
    }

    /**
     * 메타 정보 키 생성
     */
    generateKey(metaInfo) {
        const project = metaInfo.project_name || '';
        const module = metaInfo.module_name || '';
        return `${project}::${module}`.toLowerCase();
    }

}