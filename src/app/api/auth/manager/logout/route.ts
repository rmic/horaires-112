import { ok, withApiError } from "@/lib/api";
import { clearManagerSessionCookie } from "@/lib/manager-auth";

export const runtime = "nodejs";

export const POST = () =>
  withApiError(async () => {
    const response = ok({ success: true });
    clearManagerSessionCookie(response);
    return response;
  });
