#!/usr/bin/env bun

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Database } from "bun:sqlite";

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

const sampleData = [
  // 管理職
  ["田中マネージャー", "技術部", "M2", 4.8, "A+", 50000, "2020-01-15", null],
  ["山田部長", "プロダクト部", "M3", 4.6, "A", 80000, "2019-03-20", null],
  ["佐藤主任", "技術部", "M1", 4.4, "A", 35000, "2021-06-10", 1],

  // シニアエンジニア
  ["鈴木エンジニア", "技術部", "P7", 4.2, "A", 30000, "2021-08-15", 3],
  ["高橋エンジニア", "技術部", "P6", 3.8, "B+", 25000, "2022-01-20", 3],
  ["渡辺エンジニア", "技術部", "P6", 4.0, "A", 28000, "2022-03-10", 3],

  // ミドルエンジニア
  ["伊藤エンジニア", "技術部", "P5", 3.6, "B+", 18000, "2022-09-01", 4],
  ["松本エンジニア", "技術部", "P5", 3.4, "B", 15000, "2023-02-15", 4],
  ["中村エンジニア", "技術部", "P4", 3.2, "B", 12000, "2023-05-20", 5],

  // プロダクトチーム
  ["小林プロダクト", "プロダクト部", "P6", 4.1, "A", 26000, "2021-11-10", 2],
  ["加藤プロダクト", "プロダクト部", "P5", 3.7, "B+", 20000, "2022-07-15", 10],
  ["吉田プロダクト", "プロダクト部", "P4", 3.3, "B", 14000, "2023-01-08", 10],
];

for (const data of sampleData) {
  insertEmployee.run(...data);
}

const server = new Server(
  {
    name: "employee-performance-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "query_employees",
        description: "社員情報を検索、部署・等級・パフォーマンスでフィルタ可能",
        inputSchema: {
          type: "object",
          properties: {
            department: { type: "string", description: "部署名" },
            level: { type: "string", description: "社員等級 (P4-P7, M1-M3)" },
            min_performance: { type: "number", description: "最低パフォーマンススコア" },
          },
        },
      },
      {
        name: "add_employee",
        description: "新規社員追加",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "社員名" },
            department: { type: "string", description: "部署" },
            level: { type: "string", description: "等級" },
            performance_score: { type: "number", description: "パフォーマンススコア (1.0-5.0)" },
            quarterly_rating: { type: "string", description: "四半期評価 (A+, A, B+, B, C)" },
            bonus: { type: "number", description: "ボーナス" },
            hire_date: { type: "string", description: "入社日 (YYYY-MM-DD)" },
            manager_id: { type: "number", description: "上司ID (任意)" },
          },
          required: ["name", "department", "level", "performance_score", "quarterly_rating", "bonus", "hire_date"],
        },
      },
      {
        name: "department_stats",
        description: "部署統計情報取得",
        inputSchema: {
          type: "object",
          properties: {
            department: { type: "string", description: "部署名（任意、未指定の場合は全部署を統計）" },
          },
        },
      },
      {
        name: "promotion_candidates",
        description: "昇進候補者取得（パフォーマンス4.0以上かつ現在の等級で1年以上勤務）",
        inputSchema: {
          type: "object",
          properties: {
            department: { type: "string", description: "部署名（任意）" },
          },
        },
      },
      {
        name: "update_performance",
        description: "社員パフォーマンス更新",
        inputSchema: {
          type: "object",
          properties: {
            employee_id: { type: "number", description: "社員ID" },
            performance_score: { type: "number", description: "新しいパフォーマンススコア" },
            quarterly_rating: { type: "string", description: "新しい四半期評価" },
            bonus: { type: "number", description: "新しいボーナス" },
          },
          required: ["employee_id"],
        },
      },
      {
        name: "get_team_hierarchy",
        description: "チーム階層構造取得",
        inputSchema: {
          type: "object",
          properties: {
            manager_id: { type: "number", description: "マネージャーID（任意、未指定の場合は全てのトップマネージャーを表示）" },
          },
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (!args) {
    throw new Error("Missing arguments");
  }

  switch (name) {
    case "query_employees": {
      let query = "SELECT * FROM employees WHERE 1=1";
      const params: any[] = [];

      if ((args as any).department) {
        query += " AND department = ?";
        params.push((args as any).department);
      }
      if ((args as any).level) {
        query += " AND level = ?";
        params.push((args as any).level);
      }
      if ((args as any).min_performance) {
        query += " AND performance_score >= ?";
        params.push((args as any).min_performance);
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
    }

    case "add_employee": {
      const stmt = db.prepare(`
        INSERT INTO employees (name, department, level, performance_score, quarterly_rating, bonus, hire_date, manager_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const result = stmt.run(
        (args as any).name,
        (args as any).department,
        (args as any).level,
        (args as any).performance_score,
        (args as any).quarterly_rating,
        (args as any).bonus,
        (args as any).hire_date,
        (args as any).manager_id || null
      );

      return {
        content: [
          {
            type: "text",
            text: `社員 ${(args as any).name} を正常に追加しました。ID: ${result.lastInsertRowid}`,
          },
        ],
      };
    }

    case "department_stats": {
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

      if ((args as any).department) {
        query += " WHERE department = ? GROUP BY department";
        const stmt = db.prepare(query);
        const stats = stmt.get((args as any).department) as any;

        if (!stats) {
          return {
            content: [{ type: "text", text: `部署が見つかりません: ${(args as any).department}` }],
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
    }

    case "promotion_candidates": {
      let query = `
        SELECT * FROM employees 
        WHERE performance_score >= 4.0 
        AND DATE(hire_date) <= DATE('now', '-1 year')
      `;

      if ((args as any).department) {
        query += " AND department = ?";
        const stmt = db.prepare(query);
        const candidates = stmt.all((args as any).department);

        return {
          content: [
            {
              type: "text",
              text: `${(args as any).department}部署の昇進候補者 (${candidates.length}人):\n\n${candidates
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
    }

    case "update_performance": {
      const updates = [];
      const params = [];

      if ((args as any).performance_score !== undefined) {
        updates.push("performance_score = ?");
        params.push((args as any).performance_score);
      }
      if ((args as any).quarterly_rating) {
        updates.push("quarterly_rating = ?");
        params.push((args as any).quarterly_rating);
      }
      if ((args as any).bonus !== undefined) {
        updates.push("bonus = ?");
        params.push((args as any).bonus);
      }

      if (updates.length === 0) {
        return {
          content: [{ type: "text", text: "更新するフィールドが指定されていません" }],
        };
      }

      params.push((args as any).employee_id);
      const stmt = db.prepare(`UPDATE employees SET ${updates.join(", ")} WHERE id = ?`);
      const result = stmt.run(...params);

      if (result.changes === 0) {
        return {
          content: [{ type: "text", text: `ID ${(args as any).employee_id} の社員が見つかりません` }],
        };
      }

      const employee = db.prepare("SELECT name FROM employees WHERE id = ?").get((args as any).employee_id) as any;
      return {
        content: [
          {
            type: "text",
            text: `社員 ${employee.name} のパフォーマンス情報を正常に更新しました`,
          },
        ],
      };
    }

    case "get_team_hierarchy": {
      if ((args as any).manager_id) {
        const team = db.prepare(`
          SELECT * FROM employees 
          WHERE manager_id = ? 
          ORDER BY level DESC, performance_score DESC
        `).all((args as any).manager_id);

        const manager = db.prepare("SELECT name, level FROM employees WHERE id = ?").get((args as any).manager_id) as any;

        if (!manager) {
          return {
            content: [{ type: "text", text: `ID ${(args as any).manager_id} のマネージャーが見つかりません` }],
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
    }

    default:
      throw new Error(`不明なツール: ${name}`);
  }
});

async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("社員パフォーマンス管理MCPサービスが起動しました！");
}

runServer().catch(console.error);