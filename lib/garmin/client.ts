export interface GarminTokens {
  oauth1?: string;
  oauth2: string;
  oauth1_token?: string;
  oauth1_secret?: string;
  expiresAt?: number;
  username?: string;
}

export class GarminClient {
  private baseUrl = "https://connect.garmin.com";
  private ssoUrl = "https://sso.garmin.com/sso";

  async login(username: string, password: string): Promise<GarminTokens> {
    if (!username || !password) {
      throw new Error("Username and password required");
    }
    // In production this would call garmin-connect or garth.
    // We isolate the implementation so it can be mocked in tests.
    // For now we throw a clear error. Tests mock this method.
    throw new Error("Not implemented — wire garmin-connect lib here. Mock GarminClient.login in tests.");
  }

  async fetchActivities(tokens: GarminTokens, start: number, limit: number): Promise<any[]> {
    if (!tokens?.oauth2) throw new Error("Missing Garmin tokens");
    const url = `${this.baseUrl}/activitylist-service/activities/search/activities?start=${start}&limit=${limit}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${tokens.oauth2}`,
        "User-Agent": "GarminAnalysis/1.0",
      },
    });
    if (!res.ok) {
      throw new Error(`Garmin fetchActivities failed: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    // Garmin returns array or { results: [] } depending on endpoint
    if (Array.isArray(data)) return data;
    if (Array.isArray((data as any).results)) return (data as any).results;
    return [];
  }

  async downloadFIT(tokens: GarminTokens, activityId: string): Promise<Buffer> {
    if (!tokens?.oauth2) throw new Error("Missing Garmin tokens");
    if (!activityId) throw new Error("activityId required");
    const url = `${this.baseUrl}/download-service/files/activity/${activityId}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${tokens.oauth2}`,
        "User-Agent": "GarminAnalysis/1.0",
      },
    });
    if (!res.ok) {
      throw new Error(`Garmin downloadFIT failed: ${res.status} ${res.statusText}`);
    }
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  }

  async refreshTokens(tokens: GarminTokens): Promise<GarminTokens> {
    // OAuth2 refresh — if expiresAt is past, throw to force re-login
    if (!tokens) throw new Error("No tokens to refresh");
    if (tokens.expiresAt && tokens.expiresAt < Date.now()) {
      throw new Error("Tokens expired — re-login required");
    }
    return tokens;
  }
}
