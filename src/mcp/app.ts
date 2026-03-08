import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { getOAuthProtectedResourceMetadataUrl, mcpAuthMetadataRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { getOAuthMetadata, verifyAccessToken } from "@/mcp/auth";
import { getMcpConfig } from "@/mcp/config";
import { registerMcpTools } from "@/mcp/tools";

type ManagedTransport = {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  actorUserId: string;
};

function createServer() {
  const server = new McpServer({
    name: "horaire112-mcp",
    version: "0.1.0",
    title: "Horaire 112 MCP",
  });

  registerMcpTools(server);
  return server;
}

export async function createMcpApp() {
  const config = getMcpConfig();
  const app = createMcpExpressApp({
    host: config.host,
    allowedHosts: config.allowedHosts,
  });

  const oauthMetadata = await getOAuthMetadata();
  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(config.baseUrl);

  app.disable("x-powered-by");
  app.use(
    mcpAuthMetadataRouter({
      oauthMetadata,
      resourceServerUrl: config.baseUrl,
      serviceDocumentationUrl: config.serviceDocumentationUrl,
      scopesSupported: config.requiredScopes,
      resourceName: config.resourceName,
    }),
  );

  app.get("/healthz", (_req, res) => {
    res.json({
      ok: true,
      service: "horaire112-mcp",
    });
  });

  app.get("/mcp/info", (_req, res) => {
    res.json({
      name: "horaire112-mcp",
      transport: "streamable-http",
      resource: config.baseUrl.href,
      oauthProtectedResourceMetadata: resourceMetadataUrl,
      requiredScopes: config.requiredScopes,
    });
  });

  const authMiddleware = requireBearerAuth({
    verifier: {
      verifyAccessToken,
    },
    requiredScopes: config.requiredScopes,
    resourceMetadataUrl,
  });

  const transports = new Map<string, ManagedTransport>();

  function getAuthenticatedActorUserId(req: Request & { auth?: { extra?: Record<string, unknown> } }) {
    const userId = req.auth?.extra?.appUserId;
    return typeof userId === "string" ? userId : null;
  }

  function ensureSessionOwnership(sessionId: string, req: Request & { auth?: { extra?: Record<string, unknown> } }, res: Response) {
    const managed = transports.get(sessionId);
    if (!managed) {
      res.status(404).json({
        error: "Session MCP inconnue.",
      });
      return null;
    }

    const actorUserId = getAuthenticatedActorUserId(req);
    if (!actorUserId || actorUserId !== managed.actorUserId) {
      res.status(403).json({
        error: "Cette session MCP appartient à un autre utilisateur authentifié.",
      });
      return null;
    }

    return managed;
  }

  app.post("/mcp", authMiddleware, async (req: Request & { auth?: { extra?: Record<string, unknown> } }, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    try {
      if (sessionId) {
        const managed = ensureSessionOwnership(sessionId, req, res);
        if (!managed) {
          return;
        }

        await managed.transport.handleRequest(req, res, req.body);
        return;
      }

      if (!isInitializeRequest(req.body)) {
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Initialisation MCP attendue sur une nouvelle session.",
          },
          id: null,
        });
        return;
      }

      const actorUserId = getAuthenticatedActorUserId(req);
      if (!actorUserId) {
        res.status(401).json({
          error: "Utilisateur authentifié introuvable.",
        });
        return;
      }

      const server = createServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (createdSessionId) => {
          transports.set(createdSessionId, {
            transport,
            server,
            actorUserId,
          });
        },
      });

      transport.onclose = async () => {
        const currentSessionId = transport.sessionId;
        if (currentSessionId) {
          transports.delete(currentSessionId);
        }
        await server.close();
      };

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP POST error", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : "Erreur interne MCP.",
          },
          id: null,
        });
      }
    }
  });

  app.get("/mcp", authMiddleware, async (req: Request & { auth?: { extra?: Record<string, unknown> } }, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId) {
      res.status(400).json({
        error: "Header mcp-session-id requis.",
      });
      return;
    }

    const managed = ensureSessionOwnership(sessionId, req, res);
    if (!managed) {
      return;
    }

    await managed.transport.handleRequest(req, res);
  });

  app.delete("/mcp", authMiddleware, async (req: Request & { auth?: { extra?: Record<string, unknown> } }, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId) {
      res.status(400).json({
        error: "Header mcp-session-id requis.",
      });
      return;
    }

    const managed = ensureSessionOwnership(sessionId, req, res);
    if (!managed) {
      return;
    }

    await managed.transport.handleRequest(req, res);
  });

  return {
    app,
    close: async () => {
      await Promise.all(
        [...transports.values()].map(async ({ transport, server }) => {
          await transport.close();
          await server.close();
        }),
      );
      transports.clear();
    },
  };
}
