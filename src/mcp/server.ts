import "dotenv/config";
import { createServer } from "node:http";
import { createMcpApp } from "@/mcp/app";
import { getMcpConfig } from "@/mcp/config";

async function main() {
  const config = getMcpConfig();
  const { app, close } = await createMcpApp();
  const httpServer = createServer(app);

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(config.port, config.host, () => resolve());
    httpServer.once("error", reject);
  });

  console.log(`Horaire112 MCP listening on ${config.host}:${config.port}`);
  console.log(`MCP endpoint: ${config.baseUrl.href}`);

  const shutdown = async () => {
    await close();
    await new Promise<void>((resolve, reject) => {
      httpServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  };

  process.on("SIGINT", async () => {
    await shutdown();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await shutdown();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
