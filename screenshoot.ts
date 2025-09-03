import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as puppeteer from 'puppeteer'


// MCPのインスタンスを作る
const server = new McpServer({
  name: "my-mcp",
  version: "1.0.0",
});

server.tool("get_screenshot", "スクリーンショットを取得", {
  url: z.string().describe("スクリーンショットを取得するURL"),
}, async ({ url }) => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto(url);
  const screenshot = await page.screenshot();
  return {
    content: [{
      type: "image",
      data: screenshot.toBase64(),
      mimeType: "image/png",
    }],
  };
});


// Serverを走らせる
async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log("mcp server running!");
}

runServer().catch(console.error);
// はい、これでなんの機能もないMCP Serverの立ち上げができました