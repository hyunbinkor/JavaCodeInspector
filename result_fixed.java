package com.example.bad;

import java.io.File;
import java.util.*;

/**
 * <PRE>
 * 여러 코딩 표준 위반 사례를 포함한 샘플 클래스
 * </PRE>
 * 
 * @logicalName I대여관리Pbc
 * @version 1.0, 2024/01/15
 */
public class RentalService {
    
    // 수정: 멤버 변수 선언 순서 (primitive -> reference -> static final 순서)
    private int count;
    private String userName;
    private int b = 0;
    private int c = 0;
    
    // 수정: 로컬변수 명명규칙 적용 - 타입 접두사 추가
    String strMemberName;
    String strRentalItem;
    
    public static final int MAX_COUNT = 100;
    
    // 수정: 상수명을 대문자로 변경
    private static final String DATABASE_URL = "jdbc:mysql://localhost";
    
    // 수정: 매직 넘버를 상수로 선언
    private static final int MIN_AGE = 18;
    private static final int MAX_AGE = 120;
    
    /**
     * 대여 정보 조회 메서드
     */
    // 수정: 메서드 들여쓰기 4칸으로 수정, 괄호 사이 공백 제거
    public void checkRental() {
        
        // 수정: for문 공백 규칙 적용, 루프 변수명 변경 (i -> inx)
        for (int inx = 0; inx < MAX_COUNT; inx++) {
            System.out.println(inx);
        }
        
        // 수정: Loop 변수명 변경 (i -> inx, j -> jnx)
        for (int inx = 0; inx < 10; inx++) {
            for (int jnx = 0; jnx < 5; jnx++) {
                processData(inx, jnx);
            }
        }
        
        // 수정: if문 중괄호 사용
        if (count > 10) {
            count = 0;
        }
        
        // 수정: if문 공백 규칙 적용
        if (count > 5) {
            System.out.println("High count");
        }
        
        // 수정: 연산자 앞뒤 공백 추가
        int result = count * 2 + 5;
        
        // 수정: 단항 연산자와 피연산자 사이 공백 제거
        boolean flag = !true;
        int negative = -10;
        
        // 수정: Cast 연산자 공백 제거
        double value = (double)result;
        String text = (String)getObject();
        
        // 수정: Comma 연산자 앞 공백 제거, 뒤 공백 유지
        calculateSum(10, 20, 30);
        
        // 수정: 두 문장을 각각 다른 줄에 작성
        int x = 10;
        int y = 20;
        
        // 수정: 하나의 expression에 하나의 할당 연산자만 사용
        int a = 5;
        b = 5;
        c = 5;
        
        // 수정: while문 공백 규칙 적용
        while (count < 100) {
            count++;
        }
        
        // 수정: do-while문 형식 수정
        do {
            count++;
        } while (count < 50);
    }
    
    // 수정: 메서드 이름과 여는 괄호 사이 공백 제거
    public void processData(int x, int y) {
        // 수정: 인자 사이 공백 규칙 적용
        calculateSum(x, y, 10);
    }
    
    // 수정: 배열 인덱싱 및 점 표기법 공백 제거
    public void arrayAccess() {
        int[] numbers = new int[10];
        int value = numbers[0];  // 변수명과 대괄호 사이 공백 제거
        
        // 수정: 점 표기법 공백 제거
        String result = userName.toString();
    }
    
    // 수정: switch문 형식 수정
    public void checkStatus(int status) {
        switch (status) {
            case 1:
            case 2:  // 각 case를 별도 줄에 작성
                System.out.println("Active");
                break;
            case 3:  // 들여쓰기 일치
                System.out.println("Inactive");
                break;
            default:  // default 추가
                System.out.println("Unknown status");
                break;
        }
    }
    
    // 수정: try-catch 형식 수정
    public void handleException() {
        try {
            int result = Integer.parseInt("123");
        } catch (NumberFormatException e) {
            System.out.println("Error");
        }
    }
    
    // 수정: 긴 문자열 연결에 StringBuffer 사용
    public String buildQuery() {
        StringBuffer sql = new StringBuffer();
        sql.append("SELECT * FROM table1 ");
        sql.append("WHERE column1 = 'value' ");
        sql.append("AND column2 = 'value2' ");
        sql.append("ORDER BY column1");
        return sql.toString();
    }
    
    // 수정: LData Key값을 소문자로 변경 (주석으로 표현)
    public void setUserData() {
        // LData 사용 예시 (실제로는 존재하지 않으므로 주석으로 표현)
        // ldata.put("user_id", userId);  // 수정됨 - 소문자 사용
        // ldata.put("reg_date", regDate); // 수정됨 - 소문자 사용
    }
    
    // 수정: 매직 넘버를 상수로 대체
    public boolean validate(int age) {
        if (age < MIN_AGE || age > MAX_AGE) {
            return false;
        }
        return true;
    }
    
    private Object getObject() {
        return new String("test");
    }
    
    // 수정: 메서드 파라미터 공백 규칙 적용
    private void calculateSum(int a, int b, int c) {
        int sum = a + b + c;  // 연산자 공백 추가
    }
}