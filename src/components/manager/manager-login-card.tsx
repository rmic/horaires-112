"use client";

import { LockKeyhole } from "lucide-react";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ManagerOAuthProvider } from "@/lib/manager-auth";

type ManagerLoginCardProps = {
  configured: boolean;
  nextPath: string;
  oauthProviders: ManagerOAuthProvider[];
  passwordEnabled: boolean;
  loginError?: string | null;
};

export function ManagerLoginCard({
  configured,
  nextPath,
  oauthProviders,
  passwordEnabled,
  loginError,
}: ManagerLoginCardProps) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg items-center px-4">
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LockKeyhole className="h-5 w-5" />
            Accès manager protégé
          </CardTitle>
          <CardDescription>
            Connexion sécurisée par compte externe autorisé, avec fallback mot de passe si configuré.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loginError && (
            <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">{loginError}</div>
          )}

          {!configured && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              Configurez au moins un provider OAuth ou un mot de passe manager dans `.env`, puis redémarrez
              l&apos;application.
            </div>
          )}

          {oauthProviders.length > 0 && (
            <div className="space-y-2">
              <Label>Connexion OAuth</Label>
              <div className="grid gap-2">
                {oauthProviders.map((provider) => (
                  <Button
                    key={provider.id}
                    variant="secondary"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError("");
                      try {
                        await signIn(provider.id, {
                          callbackUrl: nextPath || "/manager",
                        });
                      } catch (value) {
                        setError(value instanceof Error ? value.message : "Connexion impossible.");
                        setBusy(false);
                      }
                    }}
                  >
                    Continuer avec {provider.label}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {passwordEnabled && (
            <>
              {oauthProviders.length > 0 && <div className="h-px w-full bg-slate-200" />}
              <div className="space-y-2">
                <Label>Mot de passe manager</Label>
                <Input
                  type="password"
                  placeholder="Mot de passe"
                  value={password}
                  disabled={!configured || busy}
                  onChange={(event) => setPassword(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && configured && !busy) {
                      event.preventDefault();
                      void (async () => {
                        setBusy(true);
                        try {
                          const response = await fetch("/api/auth/manager/login", {
                            method: "POST",
                            headers: {
                              "Content-Type": "application/json",
                            },
                            body: JSON.stringify({ password }),
                          });

                          const body = (await response.json().catch(() => ({}))) as { error?: string };

                          if (!response.ok) {
                            throw new Error(body.error ?? "Connexion impossible.");
                          }

                          window.location.assign(nextPath || "/manager");
                        } catch (value) {
                          setError(value instanceof Error ? value.message : "Connexion impossible.");
                        } finally {
                          setBusy(false);
                        }
                      })();
                    }
                  }}
                />
              </div>

              <Button
                className="w-full"
                disabled={!configured || busy || !password.trim()}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const response = await fetch("/api/auth/manager/login", {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                      },
                      body: JSON.stringify({ password }),
                    });

                    const body = (await response.json().catch(() => ({}))) as { error?: string };

                    if (!response.ok) {
                      throw new Error(body.error ?? "Connexion impossible.");
                    }

                    window.location.assign(nextPath || "/manager");
                  } catch (value) {
                    setError(value instanceof Error ? value.message : "Connexion impossible.");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Se connecter par mot de passe
              </Button>
            </>
          )}

          {error && <p className="text-sm font-semibold text-red-700">{error}</p>}
        </CardContent>
      </Card>
    </main>
  );
}
