package com.example.controller;

import org.springframework.web.bind.annotation.*;
import org.springframework.beans.factory.annotation.Autowired;
import java.sql.Connection;
import java.sql.Statement;
import java.sql.ResultSet;
import javax.sql.DataSource;

/**
 * 사용자 관리 Controller
 * 
 * 문제점:
 * 1. Controller에서 직접 DB 접근 (계층 위반)
 * 2. SQL Injection 취약점
 * 3. 리소스 누수 위험
 * 4. 빈 catch 블록
 */
@RestController
@RequestMapping("/api/users")
public class UserController {
    
    @Autowired
    private DataSource dataSource;
    
    private UserDAO userDAO;  // DAO 직접 사용

    @GetMapping("/{id}")
    public User getUser(@PathVariable String id) {
        Connection conn = null;
        Statement stmt = null;
        ResultSet rs = null;
        
        try {
            conn = dataSource.getConnection();
            stmt = conn.createStatement();
            
            // SQL Injection 취약점!
            String sql = "SELECT * FROM users WHERE id = '" + id + "'";
            rs = stmt.executeQuery(sql);
            
            if (rs.next()) {
                User user = new User();
                user.setId(rs.getString("id"));
                user.setName(rs.getString("name"));
                return user;
            }
            
        } catch (Exception e) {
            // 빈 catch 블록!
        }
        
        return null;
    }

    @PostMapping("/search")
    public List<User> searchUsers(@RequestParam String keyword) {
        List<User> results = new ArrayList<>();
        
        // 루프 내 DB 호출 (N+1 문제)
        for (int i = 0; i < 100; i++) {
            Connection conn = dataSource.getConnection();
            Statement stmt = conn.createStatement();
            String sql = "SELECT * FROM users WHERE name LIKE '%" + keyword + "%' LIMIT 1 OFFSET " + i;
            ResultSet rs = stmt.executeQuery(sql);
            
            if (rs.next()) {
                User user = new User();
                user.setId(rs.getString("id"));
                results.add(user);
            }
            
            // close 없음 - 리소스 누수!
        }
        
        return results;
    }

    @DeleteMapping("/{id}")
    public void deleteUser(@PathVariable String id) {
        // Controller에서 직접 DAO 호출 (Service 계층 없음)
        userDAO.deleteById(id);
    }
}

class User {
    private String id;
    private String name;
    
    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
}

interface UserDAO {
    void deleteById(String id);
}
