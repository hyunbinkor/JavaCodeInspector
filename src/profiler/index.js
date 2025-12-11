/**
 * 프로파일러 모듈
 * 
 * 코드 프로파일링 관련 컴포넌트 통합 export
 * 
 * @module profiler
 * @version 1.0.0
 */

export { CodeProfiler, default as createCodeProfiler } from './CodeProfiler.js';
export { TagExtractor } from './TagExtractor.js';
export { 
  TagDefinitionLoader, 
  getTagDefinitionLoader, 
  createTagDefinitionLoader 
} from './TagDefinitionLoader.js';
