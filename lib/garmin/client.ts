export interface GarminTokens {
  oauth1?: any;
  oauth2: any;
  oauth1_token?: string;
  oauth1_secret?: string;
  expiresAt?: number;
  username?: string;
}

function getGarminConnectClass(): any {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  try {
    const mod = require("garmin-connect");
    return mod.GarminConnect ?? mod.default ?? mod;
  } catch {
    return null;
  }
}

export class GarminClient {
  async login(username: string, password: string): Promise<GarminTokens> {
    if (!username || !password) {
      throw new Error("Username and password required");
    }
    const GarminConnect = getGarminConnectClass();
    if (!GarminConnect) {
      throw new Error("garmin-connect not installed");
    }
    const gc = new GarminConnect({ username, password });
    try {
      await gc.login(username, password);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (msg.toLowerCase().includes("mfa") || msg.toLowerCase().includes("two factor")) {
        throw new Error("Compte Garmin avec MFA — désactive temporairement le 2FA ou utilise un mot de passe d'application");
      }
      if (msg.toLowerCase().includes("locked") || msg.toLowerCase().includes("account")) {
        throw new Error("Compte Garmin verrouillé — vérifie sur connect.garmin.com");
      }
      throw new Error(`Garmin login failed: ${msg}`);
    }
    // export tokens for storage
    try {
      const exported = gc.exportToken();
      return {
        oauth1: exported.oauth1,
        oauth2: exported.oauth2,
        username,
      };
    } catch {
      // fallback to direct client tokens
      const c: any = (gc as any).client;
      return {
        oauth1: c.oauth1Token,
        oauth2: c.oauth2Token,
        username,
      };
    }
  }

  async fetchActivities(tokens: GarminTokens, start: number, limit: number): Promise<any[]> {
    if (!tokens?.oauth2) throw new Error("Missing Garmin tokens");
    const GarminConnect = getGarminConnectClass();
    if (!GarminConnect) throw new Error("garmin-connect not installed");
    const gc = new GarminConnect();
    try {
      gc.loadToken(tokens.oauth1, tokens.oauth2);
    } catch (e: any) {
      throw new Error(`Invalid Garmin tokens: ${e?.message ?? String(e)}`);
    }
    try {
      const activities = await gc.getActivities(start, limit);
      if (Array.isArray(activities)) return activities;
      if (Array.isArray((activities as any).results)) return (activities as any).results;
      return [];
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (msg.includes("429") || msg.toLowerCase().includes("rate")) {
        throw new Error("Garmin rate limited — retry after backoff (429)");
      }
      throw new Error(`Garmin fetchActivities failed: ${msg}`);
    }
  }

  async downloadFIT(tokens: GarminTokens, activityId: string): Promise<Buffer> {
    if (!tokens?.oauth2) throw new Error("Missing Garmin tokens");
    if (!activityId) throw new Error("activityId required");
    const GarminConnect = getGarminConnectClass();
    if (!GarminConnect) throw new Error("garmin-connect not installed");
    const gc = new GarminConnect();
    gc.loadToken(tokens.oauth1, tokens.oauth2);
    // Use underlying HttpClient to get ZIP
    const url = (gc as any).url?.DOWNLOAD_ZIP
      ? `${(gc as any).url.DOWNLOAD_ZIP}${activityId}`
      : `https://connectapi.garmin.com/download-service/files/activity/${activityId}`;
    try {
      const client: any = (gc as any).client;
      // garmin-connect HttpClient uses axios-like get with responseType
      const data = await client.get(url, { responseType: "arraybuffer" });
      if (Buffer.isBuffer(data)) return data;
      if (data instanceof ArrayBuffer) return Buffer.from(data);
      if (typeof data === "string") return Buffer.from(data, "binary");
      // axios may wrap in {data}
      if (data?.data) {
        const d = data.data;
        if (Buffer.isBuffer(d)) return d;
        if (d instanceof ArrayBuffer) return Buffer.from(d);
      }
      return Buffer.from(data as any);
    } catch (e: any) {
      throw new Error(`Garmin downloadFIT failed: ${e?.message ?? String(e)}`);
    }
  }

  async refreshTokens(tokens: GarminTokens): Promise<GarminTokens> {
    if (!tokens) throw new Error("No tokens to refresh");
    // garmin-connect handles auto-refresh via HttpClient; we just re-export if possible
    const GarminConnect = getGarminConnectClass();
    if (!GarminConnect) return tokens;
    try {
      const gc = new GarminConnect();
      gc.loadToken(tokens.oauth1, tokens.oauth2);
      // trigger a lightweight call to refresh if expired — getUserProfile will refresh oauth2
      // we don't call it here to avoid extra network; just return
      const exported = gc.exportToken();
      return { oauth1: exported.oauth1, oauth2: exported.oauth2, username: tokens.username };
    } catch {
      return tokens;
    }
  }
}
