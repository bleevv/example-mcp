#!/usr/bin/env bun

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Database } from "bun:sqlite";
import { z } from "zod";
import { sampleData } from "./sampleData.js";

const db = new Database(":memory:");

db.run(`
  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    department TEXT NOT NULL,
    level TEXT NOT NULL,
    performance_score REAL NOT NULL,
    quarterly_rating TEXT NOT NULL,
    bonus REAL NOT NULL,
    hire_date DATE NOT NULL,
    manager_id INTEGER,
    FOREIGN KEY (manager_id) REFERENCES employees(id)
  )
`);

const insertEmployee = db.prepare(`
  INSERT INTO employees (name, department, level, performance_score, quarterly_rating, bonus, hire_date, manager_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

for (const data of sampleData) {
  insertEmployee.run(...data);
}

// McpServer handles Zod validation automatically

const server = new McpServer({
  name: "employee",
  version: "1.0.0",
});

server.tool(
  "query_employees",
  "社員情報を検索、部署・等級・パフォーマンスでフィルタ可能",
  {
      department: z.string().optional(),
      level: z.string().optional(),
      min_performance: z.number().optional(),
  },
  async ({department, level, min_performance}) => {
    let query = "SELECT * FROM employees WHERE 1=1";
    const params: any[] = [];

    if (department) {
      query += " AND department = ?";
      params.push(department);
    }
    if (level) {
      query += " AND level = ?";
      params.push(level);
    }
    if (min_performance) {
      query += " AND performance_score >= ?";
      params.push(min_performance);
    }

  query += " ORDER BY performance_score DESC";

  const stmt = db.prepare(query);
  const employees = stmt.all(...params);

  return {
    content: [
      {
        type: "text",
        text: `${employees.length}人の社員が検索されました:\n\n${employees
          .map(
            (emp: any) =>
              `ID: ${emp.id}\n氏名: ${emp.name}\n部署: ${emp.department}\n等級: ${emp.level}\nパフォーマンス: ${emp.performance_score}\n評価: ${emp.quarterly_rating}\nボーナス: ¥${emp.bonus}\n入社日: ${emp.hire_date}\n`
          )
          .join("\n")}`,
      },
    ],
  };
});

server.tool(
  "add_employee",
  "新規社員追加",
  {
    name: z.string(),
    department: z.string(),
    level: z.string(),
    performance_score: z.number().min(1.0).max(5.0),
    quarterly_rating: z.enum(["A+", "A", "B+", "B", "C"]),
    bonus: z.number(),
    hire_date: z.string(),
    manager_id: z.number().optional(),
  },
  async ({name, department, level, performance_score, quarterly_rating, bonus, hire_date, manager_id}) => {
    const stmt = db.prepare(`
      INSERT INTO employees (name, department, level, performance_score, quarterly_rating, bonus, hire_date, manager_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      name,
      department,
      level,
      performance_score,
      quarterly_rating,
      bonus,
      hire_date,
      manager_id || null
    );

    return {
      content: [
        {
          type: "text",
          text: `社員 ${name} を正常に追加しました。ID: ${result.lastInsertRowid}`,
        },
      ],
    };
});

server.tool(
  "department_stats",
  "部署統計情報取得",
  {
    department: z.string().optional(),
  },
  async ({department}) => {
    let query = `
      SELECT 
        department,
        COUNT(*) as employee_count,
        AVG(performance_score) as avg_performance,
        AVG(bonus) as avg_bonus,
        MIN(performance_score) as min_performance,
        MAX(performance_score) as max_performance
      FROM employees
    `;

    if (department) {
      query += " WHERE department = ? GROUP BY department";
      const stmt = db.prepare(query);
      const stats = stmt.get(department) as any;

      if (!stats) {
        return {
          content: [{ type: "text", text: `部署が見つかりません: ${department}` }],
        };
      }

    return {
      content: [
        {
          type: "text",
          text: `${stats.department}部署統計:\n\n社員数: ${stats.employee_count}人\n平均パフォーマンス: ${stats.avg_performance.toFixed(2)}\n平均ボーナス: ¥${Math.round(stats.avg_bonus)}\nパフォーマンス範囲: ${stats.min_performance} - ${stats.max_performance}`,
        },
      ],
    };
  } else {
    query += " GROUP BY department ORDER BY avg_performance DESC";
    const stmt = db.prepare(query);
    const allStats = stmt.all();

    return {
      content: [
        {
          type: "text",
          text: `各部署統計:\n\n${allStats
            .map(
              (stats: any) =>
                `【${stats.department}】\n人数: ${stats.employee_count}人 | 平均パフォーマンス: ${stats.avg_performance.toFixed(2)} | 平均ボーナス: ¥${Math.round(stats.avg_bonus)}`
            )
            .join("\n\n")}`,
        },
      ],
    };
  }
});

server.tool(
  "promotion_candidates",
  "昇進候補者取得（パフォーマンス4.0以上かつ現在の等級で1年以上勤務）",
  {
    department: z.string().optional(),
  },
  async ({department}) => {
    let query = `
      SELECT * FROM employees 
      WHERE performance_score >= 4.0 
      AND hire_date <= DATE('now', '-1 year')
    `;

    if (department) {
      query += " AND department = ?";
      const stmt = db.prepare(query);
      const candidates = stmt.all(department);

      return {
        content: [
          {
            type: "text",
            text: `${department}部署の昇進候補者 (${candidates.length}人):\n\n${candidates
              .map(
                (emp: any) =>
                  `${emp.name} | ${emp.level} | パフォーマンス: ${emp.performance_score} | 入社日: ${emp.hire_date}`
              )
              .join("\n")}`,
          },
        ],
      };
  } else {
    query += " ORDER BY performance_score DESC";
    const stmt = db.prepare(query);
    const candidates = stmt.all();

    return {
      content: [
        {
          type: "text",
          text: `全社昇進候補者 (${candidates.length}人):\n\n${candidates
            .map(
              (emp: any) =>
                `${emp.name} | ${emp.department} | ${emp.level} | パフォーマンス: ${emp.performance_score}`
            )
            .join("\n")}`,
        },
      ],
    };
  }
});

server.tool(
  "update_performance",
  "社員パフォーマンス更新",
  {
    employee_id: z.number(),
    performance_score: z.number().min(1.0).max(5.0).optional(),
    quarterly_rating: z.enum(["A+", "A", "B+", "B", "C"]).optional(),
    bonus: z.number().optional(),
  },
  async ({employee_id, performance_score, quarterly_rating, bonus}) => {
    const updates = [];
    const params = [];

    if (performance_score !== undefined) {
      updates.push("performance_score = ?");
      params.push(performance_score);
    }
    if (quarterly_rating) {
      updates.push("quarterly_rating = ?");
      params.push(quarterly_rating);
    }
    if (bonus !== undefined) {
      updates.push("bonus = ?");
      params.push(bonus);
    }

    if (updates.length === 0) {
      return {
        content: [{ type: "text", text: "更新するフィールドが指定されていません" }],
      };
    }

    params.push(employee_id);
    const stmt = db.prepare(`UPDATE employees SET ${updates.join(", ")} WHERE id = ?`);
    const result = stmt.run(...params);

    if (result.changes === 0) {
      return {
        content: [{ type: "text", text: `ID ${employee_id} の社員が見つかりません` }],
      };
    }

    const employee = db.prepare("SELECT name FROM employees WHERE id = ?").get(employee_id) as any;
  return {
    content: [
      {
        type: "text",
        text: `社員 ${employee.name} のパフォーマンス情報を正常に更新しました`,
      },
    ],
  };
});

server.tool(
  "get_team_hierarchy",
  "チーム階層構造取得",
  {
    manager_id: z.number().optional(),
  },
  async ({manager_id}) => {
    if (manager_id) {
      const team = db.prepare(`
        SELECT * FROM employees 
        WHERE manager_id = ? 
        ORDER BY level DESC, performance_score DESC
      `).all(manager_id);

      const manager = db.prepare("SELECT name, level FROM employees WHERE id = ?").get(manager_id) as any;

      if (!manager) {
        return {
          content: [{ type: "text", text: `ID ${manager_id} のマネージャーが見つかりません` }],
        };
      }

    return {
      content: [
        {
          type: "text",
          text: `${manager.name} (${manager.level}) のチーム (${team.length}人):\n\n${team
            .map((emp: any) => `  ├─ ${emp.name} | ${emp.level} | パフォーマンス: ${emp.performance_score}`)
            .join("\n")}`,
        },
      ],
    };
  } else {
    const topManagers = db.prepare(`
      SELECT * FROM employees 
      WHERE manager_id IS NULL 
      ORDER BY level DESC
    `).all();

    const hierarchy = topManagers.map((manager: any) => {
      const team = db.prepare(`
        SELECT * FROM employees 
        WHERE manager_id = ? 
        ORDER BY level DESC, performance_score DESC
      `).all(manager.id);

      return `${manager.name} (${manager.level}) - ${manager.department}\n${team
        .map((emp: any) => `  ├─ ${emp.name} | ${emp.level} | パフォーマンス: ${emp.performance_score}`)
        .join("\n")}`;
    });

    return {
      content: [
        {
          type: "text",
          text: `チーム階層構造:\n\n${hierarchy.join("\n\n")}`,
        },
      ],
    };
  }
});

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("社員パフォーマンス管理MCPサービスが起動しました！");
}

runServer().catch(console.error);