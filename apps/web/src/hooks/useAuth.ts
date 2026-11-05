import { useCallback, useEffect, useRef, useState } from "react";

const KEYCLOAK_URL = "http://localhost:8081";
const REALM = "trace";
const CLIENT_ID = "trace-web";
const REDIRECT_URI = window.location.origin + "/";

type TokenSet = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

export type AuthState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "authenticated"; tokens: TokenSet }
  | { status: "error"; message: string };

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

async function generatePkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = base64url(hash);
  return { verifier, challenge };
}

const AUTH_BASE = `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect`;

export function useAuth() {
  const [state, setState] = useState<AuthState>({ status: "idle" });
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tokensRef = useRef<TokenSet | null>(null);

  const scheduleRefresh = useCallback((tokens: TokenSet) => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    const delay = Math.max(0, tokens.expiresAt - Date.now() - 30_000);
    refreshTimer.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          grant_type: "refresh_token",
          client_id: CLIENT_ID,
          refresh_token: tokens.refreshToken
        });
        const res = await fetch(`${AUTH_BASE}/token`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString()
        });
        if (!res.ok) throw new Error("Refresh failed");
        const data = (await res.json()) as {
          access_token: string;
          refresh_token: string;
          expires_in: number;
        };
        const next: TokenSet = {
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresAt: Date.now() + data.expires_in * 1000
        };
        tokensRef.current = next;
        setState({ status: "authenticated", tokens: next });
        scheduleRefresh(next);
      } catch {
        setState({ status: "idle" });
      }
    }, delay);
  }, []);

  // Handle OAuth callback (code exchange)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    if (!code || !state) return;

    const verifier = sessionStorage.getItem("pkce_verifier");
    const savedState = sessionStorage.getItem("oauth_state");
    if (!verifier || state !== savedState) return;

    sessionStorage.removeItem("pkce_verifier");
    sessionStorage.removeItem("oauth_state");
    window.history.replaceState({}, "", "/");

    setState({ status: "loading" });

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code,
      code_verifier: verifier
    });

    fetch(`${AUTH_BASE}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    })
      .then((res) => {
        if (!res.ok) throw new Error("Token exchange failed");
        return res.json() as Promise<{
          access_token: string;
          refresh_token: string;
          expires_in: number;
        }>;
      })
      .then((data) => {
        const tokens: TokenSet = {
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresAt: Date.now() + data.expires_in * 1000
        };
        tokensRef.current = tokens;
        setState({ status: "authenticated", tokens });
        scheduleRefresh(tokens);
        window.dispatchEvent(new CustomEvent("trace:auth-complete"));
      })
      .catch((err) => {
        setState({ status: "error", message: err instanceof Error ? err.message : "Auth failed" });
      });
  }, [scheduleRefresh]);

  const login = useCallback(async (pendingSourceId?: string) => {
    if (pendingSourceId) {
      sessionStorage.setItem("trace_pending_source", pendingSourceId);
    }
    const { verifier, challenge } = await generatePkce();
    const oauthState = base64url(crypto.getRandomValues(new Uint8Array(16)));
    sessionStorage.setItem("pkce_verifier", verifier);
    sessionStorage.setItem("oauth_state", oauthState);

    const authUrl = new URL(`${AUTH_BASE}/auth`);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
    authUrl.searchParams.set("scope", "openid profile email");
    authUrl.searchParams.set("state", oauthState);
    authUrl.searchParams.set("code_challenge", challenge);
    authUrl.searchParams.set("code_challenge_method", "S256");

    window.location.href = authUrl.toString();
  }, []);

  const logout = useCallback(() => {
    tokensRef.current = null;
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    setState({ status: "idle" });
    const logoutUrl = new URL(`${AUTH_BASE}/logout`);
    logoutUrl.searchParams.set("client_id", CLIENT_ID);
    logoutUrl.searchParams.set("post_logout_redirect_uri", REDIRECT_URI);
    window.location.href = logoutUrl.toString();
  }, []);

  const accessToken =
    state.status === "authenticated" ? state.tokens.accessToken : null;

  return { state, login, logout, accessToken };
}
