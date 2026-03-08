import { z } from "zod";
import { ApiError, ok, readJson, withApiError } from "@/lib/api";
import {
  applyManagerSessionCookie,
  isManagerPasswordConfigured,
  verifyManagerPassword,
} from "@/lib/manager-auth";

export const runtime = "nodejs";

const loginSchema = z.object({
  password: z.string().min(1),
});

export const POST = (request: Request) =>
  withApiError(async () => {
    if (!isManagerPasswordConfigured()) {
      throw new ApiError(
        503,
        "Protection manager non configurée. Définissez MANAGER_PASSWORD et AUTH_SECRET dans l'environnement, puis redémarrez l'application.",
      );
    }

    const body = loginSchema.safeParse(await readJson<unknown>(request));
    if (!body.success) {
      throw new ApiError(400, "Mot de passe manager invalide.", body.error.flatten());
    }

    const validPassword = await verifyManagerPassword(body.data.password);
    if (!validPassword) {
      throw new ApiError(401, "Mot de passe incorrect.");
    }

    const response = ok({ success: true });
    await applyManagerSessionCookie(response);
    return response;
  });
