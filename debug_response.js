// debug_response.js - Ollama 응답 디버깅용 스크립트
import axios from 'axios';

const OLLAMA_URL = 'http://149.36.1.227:19846';
const MODEL = 'qwen3:32b';

async function testOllamaResponse() {
  console.log('🔍 Ollama 응답 디버깅 시작...\n');
  
  const client = axios.create({
    baseURL: OLLAMA_URL,
    timeout: 60000
  });

  // 테스트 케이스들
  const testCases = [
    {
      name: '1. 기본 JSON 요청',
      prompt: 'Return only this JSON: {"test": "success", "number": 42}',
      options: {}
    },
    {
      name: '2. Stop 토큰 없이',
      prompt: 'Create a simple JSON object with name and age fields. Response format: {"name": "John", "age": 30}',
      options: {
        temperature: 0.1,
        num_predict: 100
      }
    },
    {
      name: '3. Stop 토큰 있이 (<think> 차단)',
      prompt: 'Create a simple JSON object with name and age fields. Response format: {"name": "John", "age": 30}',
      options: {
        temperature: 0.1,
        num_predict: 100,
        stop: ["<think>", "</think>"]
      }
    },
    {
      name: '4. 실제 패턴 생성 프롬프트 (축약)',
      prompt: `JSON ONLY RESPONSE REQUIRED. Respond with ONLY this JSON:
{
  "metadata": {
    "title": "test pattern",
    "category": "resource_management",
    "severity": "MEDIUM"
  }
}`,
      options: {
        temperature: 0.1,
        num_predict: 200
      }
    }
  ];

  for (let testCase of testCases) {
    console.log(`\n${testCase.name}`);
    console.log('=' .repeat(50));
    
    try {
      const payload = {
        model: MODEL,
        prompt: testCase.prompt,
        stream: false,
        options: testCase.options
      };
      
      console.log('프롬프트:', testCase.prompt.substring(0, 100) + '...');
      console.log('옵션:', JSON.stringify(testCase.options, null, 2));
      
      const startTime = Date.now();
      const response = await client.post('/api/generate', payload);
      const endTime = Date.now();
      
      const responseText = response.data.response;
      
      console.log(`응답 시간: ${endTime - startTime}ms`);
      console.log(`응답 길이: ${responseText?.length || 0}자`);
      
      if (!responseText || responseText.trim() === '') {
        console.log('❌ 응답이 비어있습니다!');
      } else {
        console.log(`✅ 응답 받음:`);
        console.log(`"${responseText.substring(0, 200)}${responseText.length > 200 ? '...' : ''}"`);
        
        // JSON 파싱 시도
        try {
          const cleanResponse = responseText.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
          if (cleanResponse.startsWith('{')) {
            JSON.parse(cleanResponse);
            console.log('✅ JSON 파싱 성공');
          } else {
            console.log('⚠️ JSON 형태가 아님');
          }
        } catch (jsonError) {
          console.log('❌ JSON 파싱 실패:', jsonError.message);
        }
      }
      
    } catch (error) {
      console.error(`❌ 테스트 실패: ${error.message}`);
    }
    
    // 테스트 간 간격
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('\n🏁 디버깅 완료');
}

testOllamaResponse();