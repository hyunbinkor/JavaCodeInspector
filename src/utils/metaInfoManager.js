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

  /**
   * 메타 정보 조회
   * 
   * @param {Object} query - 조회 조건
   * @param {string} query.project_name - 프로젝트명
   * @param {string} query.module_name - 모듈명
   * @returns {Object|null} 메타 정보
   */
  getMetaInfo(query) {
    if (!this.initialized) {
      logger.warn('⚠️ 메타 정보 관리자가 초기화되지 않음');
      return null;
    }
    
    const key = this.generateKey(query);
    const metaInfo = this.metaInfoTable.get(key);
    
    if (!metaInfo) {
      logger.debug(`메타 정보 없음: ${key}`);
      return this.getDefaultMetaInfo();
    }
    
    return metaInfo;
  }

  /**
   * 기본 메타 정보 반환
   */
  getDefaultMetaInfo() {
    return {
      project_name: 'Unknown',
      module_name: 'Unknown',
      developer_team: 'Unknown',
      compliance_level: 'MEDIUM',
      framework_version: 'Unknown',
      production_status: 'development'
    };
  }

  /**
   * 메타 정보 추가/업데이트
   */
  async setMetaInfo(metaInfo) {
    const key = this.generateKey(metaInfo);
    this.metaInfoTable.set(key, metaInfo);
    
    // 파일에도 저장 (선택적)
    if (this.metaInfoPath) {
      try {
        await this.saveToFile();
        logger.info(`✅ 메타 정보 저장 완료: ${key}`);
      } catch (error) {
        logger.warn('⚠️ 메타 정보 저장 실패:', error.message);
      }
    }
  }

  /**
   * 파일로 저장
   */
  async saveToFile() {
    const dataArray = Array.from(this.metaInfoTable.values());
    const content = JSON.stringify(dataArray, null, 2);
    await fs.writeFile(this.metaInfoPath, content, 'utf-8');
  }

  /**
   * 통계 정보 반환
   */
  getStatistics() {
    const stats = {
      totalEntries: this.metaInfoTable.size,
      complianceLevels: {},
      frameworks: {},
      teams: {}
    };
    
    for (const metaInfo of this.metaInfoTable.values()) {
      // 규제 수준별 집계
      const level = metaInfo.compliance_level || 'UNKNOWN';
      stats.complianceLevels[level] = (stats.complianceLevels[level] || 0) + 1;
      
      // 프레임워크별 집계
      const framework = metaInfo.framework_version || 'UNKNOWN';
      stats.frameworks[framework] = (stats.frameworks[framework] || 0) + 1;
      
      // 팀별 집계
      const team = metaInfo.developer_team || 'UNKNOWN';
      stats.teams[team] = (stats.teams[team] || 0) + 1;
    }
    
    return stats;
  }

  /**
   * 모든 프로젝트 목록 반환
   */
  getAllProjects() {
    const projects = new Set();
    for (const metaInfo of this.metaInfoTable.values()) {
      if (metaInfo.project_name) {
        projects.add(metaInfo.project_name);
      }
    }
    return Array.from(projects);
  }

  /**
   * 프로젝트별 모듈 목록 반환
   */
  getModulesByProject(projectName) {
    const modules = [];
    for (const metaInfo of this.metaInfoTable.values()) {
      if (metaInfo.project_name === projectName) {
        modules.push({
          module_name: metaInfo.module_name,
          compliance_level: metaInfo.compliance_level,
          team: metaInfo.developer_team
        });
      }
    }
    return modules;
  }

  /**
   * 샘플 메타 정보 테이블 생성 (초기 설정용)
   */
  static async createSampleMetaInfo(outputPath) {
    const sampleData = [
      {
        project_name: '금융결제시스템',
        module_name: '거래처리',
        developer_team: '핵심뱅킹팀',
        compliance_level: 'HIGH',
        framework_version: 'Spring Boot 2.7',
        production_status: 'production',
        business_criticality: 0.9,
        description: '실시간 금융 거래 처리 모듈'
      },
      {
        project_name: '금융결제시스템',
        module_name: '정산',
        developer_team: '정산팀',
        compliance_level: 'HIGH',
        framework_version: 'Spring Boot 2.7',
        production_status: 'production',
        business_criticality: 0.85,
        description: '일일 정산 처리 모듈'
      },
      {
        project_name: '고객관리시스템',
        module_name: '회원가입',
        developer_team: 'CRM팀',
        compliance_level: 'MEDIUM',
        framework_version: 'Spring Boot 3.0',
        production_status: 'production',
        business_criticality: 0.7,
        description: '고객 회원가입 및 인증'
      },
      {
        project_name: '고객관리시스템',
        module_name: 'MyPage',
        developer_team: 'CRM팀',
        compliance_level: 'LOW',
        framework_version: 'Spring Boot 3.0',
        production_status: 'production',
        business_criticality: 0.5,
        description: '고객 마이페이지'
      },
      {
        project_name: '내부관리시스템',
        module_name: '리포팅',
        developer_team: 'BI팀',
        compliance_level: 'LOW',
        framework_version: 'Spring Boot 2.5',
        production_status: 'development',
        business_criticality: 0.4,
        description: '내부 리포팅 도구'
      }
    ];
    
    const content = JSON.stringify(sampleData, null, 2);
    await fs.writeFile(outputPath, content, 'utf-8');
    logger.info(`✅ 샘플 메타 정보 생성 완료: ${outputPath}`);
  }
}

/**
 * 메타 정보 스키마
 * 
 * {
 *   project_name: string,          // 프로젝트명
 *   module_name: string,            // 모듈명
 *   developer_team: string,         // 개발팀
 *   compliance_level: 'HIGH'|'MEDIUM'|'LOW',  // 규제 수준
 *   framework_version: string,      // 프레임워크 버전
 *   production_status: 'development'|'staging'|'production',
 *   business_criticality: number,   // 비즈니스 중요도 (0~1)
 *   description: string             // 설명
 * }
 */