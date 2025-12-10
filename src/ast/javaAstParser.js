import javaParser from 'java-parser';
// import logger from '../utils/loggerUtils';

export class JavaASTParser {
    constructor() {
        this.parser = javaParser;

        // 레거시 프레임워크에서 자주 사용되는 기본 클래스들
        this.frameworkClasses = [
            'BaseService', 'DataAccessLayer', 'ConnectionManager',
            'BusinessProcessor', 'AbstractController', 'ServiceImpl'
        ];

        // 명시적으로 close()를 호출해야 하는 리소스 타입들
        this.resourceTypes = [
            'Connection', 'PreparedStatement', 'ResultSet', 'Statement',
            'FileInputStream', 'FileOutputStream', 'BufferedReader', 'BufferedWriter',
            'Socket', 'ServerSocket', 'HttpURLConnection'
        ];

        // 보안 취약점이 발생할 수 있는 메서드들
        this.securitySensitiveApis = [
            'executeQuery', 'executeUpdate', 'execute',
            'getWriter', 'sendRedirect', 'setAttribute',
            'encrypt', 'decrypt', 'hash'
        ];
    }

    parseJavaCode(javaCode) {
        try {
            // java-parser 라이브러리가 완전하지 않아 정규식 기반 분석 사용
            // logger.info('Java 코드 분석 중...');
            const fallbackAnalysis = this.fallbackAnalysis(javaCode);

            return {
                success: true,
                ast: null,
                analysis: fallbackAnalysis,
                error: null
            };
        } catch (error) {
            console.warn('Java 코드 분석 실패:', error.message);

            // 에러 발생 시 빈 구조를 가진 분석 결과 반환
            const emptyAnalysis = this.createEmptyAnalysis();

            return {
                success: false,
                ast: null,
                analysis: emptyAnalysis,
                error: error.message
            };
        }
    }

    createEmptyAnalysis() {
        // 분석 실패 시 반환할 기본 구조체
        return {
            nodeTypes: [],
            nodeCount: 0,
            maxDepth: 1,
            cyclomaticComplexity: 1,
            classDeclarations: [],
            methodDeclarations: [],
            variableDeclarations: [],
            methodInvocations: [],
            constructorCalls: [],
            controlStructures: [],
            exceptionHandling: [],
            annotations: [],
            inheritancePatterns: [],
            resourceLifecycles: [],
            resourceLeakRisks: [],
            securityPatterns: [],
            sqlInjectionRisks: [],
            performanceIssues: [],
            loopAnalysis: [],
            codeSmells: [],
            designPatterns: []
        };
    }


    fallbackAnalysis(javaCode) {
        // AST 파싱 실패 시 정규식으로 기본적인 코드 분석 수행
        return {
            nodeTypes: this.extractNodeTypesRegex(javaCode),
            nodeCount: this.countNodesRegex(javaCode),
            maxDepth: this.estimateDepthRegex(javaCode),
            cyclomaticComplexity: this.calculateComplexityRegex(javaCode),

            classDeclarations: this.extractClassesRegex(javaCode),
            methodDeclarations: this.extractMethodsRegex(javaCode),
            variableDeclarations: this.extractVariablesRegex(javaCode),
            methodInvocations: this.extractMethodCallsRegex(javaCode),
            annotations: this.extractAnnotationsRegex(javaCode),

            controlStructures: [],
            exceptionHandling: [],
            inheritancePatterns: [],
            resourceLifecycles: this.analyzeResourcesRegex(javaCode),
            resourceLeakRisks: [],
            securityPatterns: this.analyzeSecurityRegex(javaCode),
            sqlInjectionRisks: [],
            performanceIssues: this.analyzePerformanceRegex(javaCode),
            loopAnalysis: [],
            codeSmells: [],
            designPatterns: []
        };
    }



    generateASTSignature(astAnalysis) {
        // AST 구조를 3가지 관점의 시그니처로 변환 (코드 검색/비교용)
        const signature = {
            // 구조적 시그니처: 노드 구성, 깊이, 복잡도
            structural: {
                nodePattern: this.generateNodePattern(astAnalysis.nodeTypes),
                depthPattern: astAnalysis.maxDepth,
                complexityPattern: astAnalysis.cyclomaticComplexity
            },

            // 의미론적 시그니처: 리소스 사용, 보안 패턴, 프레임워크 활용
            semantic: {
                resourcePattern: this.generateResourcePattern(astAnalysis.resourceLifecycles),
                securityPattern: this.generateSecurityPattern(astAnalysis.securityPatterns),
                frameworkPattern: this.generateFrameworkPattern(astAnalysis.annotations, astAnalysis.inheritancePatterns)
            },

            // 행동 패턴 시그니처: 메서드 호출 순서, 제어 흐름, 예외 처리
            behavioral: {
                methodCallPattern: this.generateMethodCallPattern(astAnalysis.methodInvocations),
                controlFlowPattern: this.generateControlFlowPattern(astAnalysis.controlStructures),
                exceptionPattern: this.generateExceptionPattern(astAnalysis.exceptionHandling)
            }
        };

        return signature;
    }

    generateNodePattern(nodeTypes) {
        // 상위 10개 노드를 화살표로 연결한 패턴 문자열 생성
        return nodeTypes.slice(0, 10).join('->');
    }

    generateResourcePattern(resourceLifecycles) {
        // "리소스타입:생명주기단계" 형식의 패턴 문자열 생성
        return resourceLifecycles.map(r => `${r.type}:${r.stage}`).join(',');
    }

    generateSecurityPattern(securityPatterns) {
        // 보안 패턴 타입들을 쉼표로 연결한 문자열 생성
        return securityPatterns.map(p => p.type).join(',');
    }

    generateFrameworkPattern(annotations, inheritance) {
        // 어노테이션(@Service 등)과 상속 관계를 결합한 패턴 생성
        const patterns = [
            ...annotations.map(a => `@${a.name}`),
            ...inheritance.map(i => `extends:${i.parentClass}`)
        ];
        return patterns.join(',');
    }

    generateMethodCallPattern(methodInvocations) {
        // 상위 5개 메서드 호출을 "객체.메서드" 형식으로 연결
        return methodInvocations
            .slice(0, 5)
            .map(m => `${m.target || 'this'}.${m.method}`)
            .join('->');
    }

    generateControlFlowPattern(controlStructures) {
        // 제어 구조 타입들을 순서대로 화살표로 연결
        return controlStructures.map(cs => cs.type).join('->');
    }

    generateExceptionPattern(exceptionHandling) {
        // 예외 처리 타입들을 쉼표로 연결한 문자열 생성
        return exceptionHandling.map(eh => eh.type).join(',');
    }

    extractNodeTypesRegex(code) {
        // 정규식으로 주요 구문 타입 추출 (class, method, if, for 등)
        const patterns = {
            'ClassDeclaration': /class\s+\w+/g,
            'MethodDeclaration': /\w+\s*\([^)]*\)\s*\{/g,
            'VariableDeclaration': /\w+\s+\w+\s*=/g,
            'IfStatement': /if\s*\(/g,
            'ForStatement': /for\s*\(/g,
            'WhileStatement': /while\s*\(/g,
            'TryStatement': /try\s*\{/g
        };

        const nodeTypes = [];
        Object.entries(patterns).forEach(([type, pattern]) => {
            const matches = code.match(pattern) || [];
            matches.forEach(() => nodeTypes.push(type));
        });

        return nodeTypes;
    }

    countNodesRegex(code) {
        // 정규식으로 추출한 노드 타입의 총 개수 계산
        return this.extractNodeTypesRegex(code).length;
    }

    estimateDepthRegex(code) {
        // 중괄호 쌍으로 코드 블록의 최대 중첩 깊이 계산
        let maxDepth = 0;
        let currentDepth = 0;

        for (const char of code) {
            if (char === '{') {
                currentDepth++;
                maxDepth = Math.max(maxDepth, currentDepth);
            } else if (char === '}') {
                currentDepth--;
            }
        }

        return maxDepth;
    }

    calculateComplexityRegex(code) {
        // if, for, while 등 분기 구문 개수로 순환 복잡도 추정
        const complexityPatterns = /if|for|while|switch|case|catch|\?\s*:/g;
        const matches = code.match(complexityPatterns) || [];
        return matches.length + 1;
    }

    extractClassesRegex(code) {
        // 클래스 선언문에서 이름, 상속, 구현 인터페이스 추출
        const classPattern = /(?:public\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?/g;
        const classes = [];
        let match;

        while ((match = classPattern.exec(code)) !== null) {
            classes.push({
                name: match[1],
                extends: match[2] || null,
                implements: match[3] ? match[3].split(',').map(i => i.trim()) : []
            });
        }

        return classes;
    }

    extractMethodsRegex(code) {
        // 메서드 선언문에서 반환 타입, 이름, 매개변수 추출
        const methodPattern = /(?:public|private|protected)?\s*(?:static)?\s*(\w+)\s+(\w+)\s*\(([^)]*)\)/g;
        const methods = [];
        let match;

        while ((match = methodPattern.exec(code)) !== null) {
            methods.push({
                returnType: match[1],
                name: match[2],
                parameters: match[3].trim()
            });
        }

        return methods;
    }

    extractVariablesRegex(code) {
        // 변수 선언문에서 타입, 이름, 초기화 여부 추출
        const varPattern = /(?:private|public|protected)?\s*(\w+)\s+(\w+)\s*(?:=([^;]+))?;/g;
        const variables = [];
        let match;

        while ((match = varPattern.exec(code)) !== null) {
            variables.push({
                type: match[1],
                name: match[2],
                hasInitializer: !!match[3]
            });
        }

        return variables;
    }

    extractMethodCallsRegex(code) {
        // "객체.메서드(" 패턴으로 메서드 호출 추출
        const callPattern = /(\w+)\.(\w+)\s*\(/g;
        const calls = [];
        let match;

        while ((match = callPattern.exec(code)) !== null) {
            calls.push({
                target: match[1],
                method: match[2]
            });
        }

        return calls;
    }

    extractAnnotationsRegex(code) {
        // @어노테이션 패턴으로 어노테이션 추출
        const annotationPattern = /@(\w+)(?:\([^)]*\))?/g;
        const annotations = [];
        let match;

        while ((match = annotationPattern.exec(code)) !== null) {
            annotations.push({
                name: match[1]
            });
        }

        return annotations;
    }

    analyzeResourcesRegex(code) {
        // Connection, FileStream 등 리소스의 생성/해제 패턴 분석
        const resources = [];

        this.resourceTypes.forEach(resourceType => {
            const pattern = new RegExp(`${resourceType}\\s+(\\w+)\\s*=`, 'g');
            let match;

            while ((match = pattern.exec(code)) !== null) {
                const varName = match[1];

                // try-with-resources 구문 내에 있는지 확인
                const tryWithResourcesPattern = new RegExp(`try\\s*\\([^)]*${varName}[^)]*\\)`, 'g');
                const inTryWithResources = tryWithResourcesPattern.test(code);

                // 명시적 close() 호출이 있는지 확인
                const closePattern = new RegExp(`${varName}\\.close\\(\\)`, 'g');
                const hasCloseCall = closePattern.test(code);

                resources.push({
                    type: resourceType,
                    variable: varName,
                    inTryWithResources,
                    hasCloseCall,
                    riskLevel: (!inTryWithResources && !hasCloseCall) ? 'HIGH' : 'LOW'
                });
            }
        });

        return resources;
    }

    analyzeSecurityRegex(code) {
        // SQL 인젝션, XSS 등 보안 취약점 패턴 탐지
        const securityIssues = [];

        // SQL 쿼리에서 문자열 연결(+) 사용 시 SQL 인젝션 위험
        if (code.includes('executeQuery') || code.includes('executeUpdate')) {
            const sqlConcatPattern = /["'].*\+.*["']/g;
            if (sqlConcatPattern.test(code)) {
                securityIssues.push({
                    type: 'sql_injection',
                    description: 'String concatenation in SQL query',
                    severity: 'HIGH'
                });
            }
        }

        // 사용자 입력을 인코딩 없이 직접 출력 시 XSS 위험
        if (code.includes('getWriter') && code.includes('println')) {
            securityIssues.push({
                type: 'xss',
                description: 'Direct output without encoding',
                severity: 'MEDIUM'
            });
        }

        return securityIssues;
    }

    analyzePerformanceRegex(code) {
        // 루프 내 데이터베이스 쿼리 등 성능 문제 패턴 탐지
        const performanceIssues = [];

        // 반복문 안에서 데이터베이스 쿼리 실행 시 N+1 문제 발생
        const loopWithQueryPattern = /(for|while)\s*\([^)]*\)\s*\{[^}]*(?:executeQuery|find|get)[^}]*\}/g;
        if (loopWithQueryPattern.test(code)) {
            performanceIssues.push({
                type: 'n_plus_one_query',
                description: 'Database query inside loop',
                severity: 'HIGH'
            });
        }

        return performanceIssues;
    }
}