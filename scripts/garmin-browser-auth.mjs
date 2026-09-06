#!/usr/bin/env node
/**
 * Get Garmin OAuth tokens via real browser login (Playwright).
 * Port of coleman8er gist: https://gist.github.com/coleman8er/5c8e192d2aa3c8a3a6220c5702e8a5e6
 * Bypasses the 429-blocked SSO programmatic login endpoint.
 *
 * Usage:
 *   npm run garmin:auth
 *   # or: node scripts/garmin-browser-auth.mjs
 *   # then paste the printed GARMIN_TOKEN_B64 into /settings
 *
 * Requires: npx playwright install chromium (once)
 */

import { chromium } from "playwright";
import crypto from "crypto";
import OAuth from "oauth-1.0a";
import fs from "fs";
import path from "path";
import os from "os";

const OAUTH_CONSUMER_URL = "https://thegarth.s3.amazonaws.com/oauth_consumer.json";
const ANDROID_UA = "com.garmin.android.apps.connectmobile";

async function getOAuthConsumer() {
  const res = await fetch(OAUTH_CONSUMER_URL);
  if (!res.ok) throw new Error(`Failed to fetch oauth consumer: ${res.status}`);
  return res.json();
}

function oauthHeader(url, method, consumer, token = null) {
  const oauth = OAuth({
    consumer: { key: consumer.consumer_key, secret: consumer.consumer_secret },
    signature_method: "HMAC-SHA1",
    hash_function(base_string, key) {
      return crypto.createHmac("sha1", key).update(base_string).digest("base64");
    },
  });
  const data = token
    ? { oauth_token: token.oauth_token }
    : {};
  const auth = oauth.authorize({ url, method, data }, token ? { key: token.oauth_token, secret: token.oauth_token_secret } : undefined);
  return oauth.toHeader(auth).Authorization;
}

async function getOAuth1Token(ticket, consumer) {
  const url = `https://connectapi.garmin.com/oauth-service/oauth/preauthorized?ticket=${encodeURIComponent(ticket)}&login-url=https://sso.garmin.com/sso/embed&accepts-mfa-tokens=true`;
  const headers = {
    "User-Agent": ANDROID_UA,
    Authorization: oauthHeader(url, "GET", consumer),
  };
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`preauthorized failed ${res.status}: ${txt.slice(0, 500)}`);
  }
  const text = await res.text();
  const params = new URLSearchParams(text);
  const token = {};
  for (const [k, v] of params.entries()) token[k] = v;
  token.domain = "garmin.com";
  return token;
}

async function exchangeOAuth2(oauth1, consumer) {
  const url = "https://connectapi.garmin.com/oauth-service/oauth/exchange/user/2.0";
  const headers = {
    "User-Agent": ANDROID_UA,
    "Content-Type": "application/x-www-form-urlencoded",
    Authorization: oauthHeader(url, "POST", consumer, oauth1),
  };
  const body = new URLSearchParams();
  if (oauth1.mfa_token) body.set("mfa_token", oauth1.mfa_token);
  const res = await fetch(url, { method: "POST", headers, body: body.toString() });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`exchange failed ${res.status}: ${txt.slice(0, 500)}`);
  }
  const token = await res.json();
  token.expires_at = Math.floor(Date.now() / 1000) + token.expires_in;
  token.refresh_token_expires_at = Math.floor(Date.now() / 1000) + token.refresh_token_expires_in;
  return token;
}

async function browserLogin() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  const ssoUrl =
    "https://sso.garmin.com/sso/embed?id=gauth-widget&embedWidget=true&gauthHost=https://sso.garmin.com/sso&clientId=GarminConnect&locale=en_US&redirectAfterAccountLoginUrl=https://sso.garmin.com/sso/embed&service=https://sso.garmin.com/sso/embed";

  await page.goto(ssoUrl);

  console.log("\n" + "=".repeat(50));
  console.log(" Browser opened — log in with your Garmin");
  console.log(" credentials. The window will close");
  console.log(" automatically when done.");
  console.log("=".repeat(50) + "\n");

  const maxWait = 300000; // 5 min
  const start = Date.now();
  let ticket = null;

  while (Date.now() - start < maxWait) {
    try {
      const content = await page.content();
      let m = content.match(/ticket=(ST-[A-Za-z0-9\-]+)/);
      if (m) {
        ticket = m[1];
        console.log(`Got ticket: ${ticket.slice(0, 30)}...`);
        break;
      }
      const url = page.url();
      if (url.includes("ticket=")) {
        m = url.match(/ticket=(ST-[A-Za-z0-9\-]+)/);
        if (m) {
          ticket = m[1];
          console.log(`Got ticket from URL: ${ticket.slice(0, 30)}...`);
          break;
        }
      }
    } catch {}
    await page.waitForTimeout(500);
  }

  await browser.close();

  if (!ticket) {
    console.error("ERROR: Timed out waiting for login (5 min). Try again.");
    process.exit(1);
  }
  return ticket;
}

async function main() {
  console.log("Garmin Browser Auth");
  console.log("=".repeat(50));

  console.log("Fetching OAuth consumer credentials...");
  const consumer = await getOAuthConsumer();

  console.log("Launching browser...");
  const ticket = await browserLogin();

  console.log("Exchanging ticket for OAuth1 token...");
  const oauth1 = await getOAuth1Token(ticket, consumer);
  console.log(` OAuth1 token: ${oauth1.oauth_token.slice(0, 20)}...`);

  console.log("Exchanging OAuth1 for OAuth2 token...");
  const oauth2 = await exchangeOAuth2(oauth1, consumer);
  console.log(` OAuth2 access_token: ${oauth2.access_token.slice(0, 20)}...`);
  console.log(` Expires in: ${oauth2.expires_in}s`);
  console.log(` Refresh expires in: ${oauth2.refresh_token_expires_in}s`);

  console.log("Verifying tokens...");
  const verify = await fetch("https://connectapi.garmin.com/userprofile-service/socialProfile", {
    headers: {
      "User-Agent": "GCM-iOS-5.7.2.1",
      Authorization: `Bearer ${oauth2.access_token}`,
    },
  });
  if (!verify.ok) throw new Error(`Verify failed ${verify.status}`);
  const profile = await verify.json();
  console.log(` Authenticated as: ${profile.displayName ?? profile.fullName ?? "unknown"}`);

  const garthDir = path.join(os.homedir(), ".garth");
  fs.mkdirSync(garthDir, { recursive: true });
  fs.writeFileSync(path.join(garthDir, "oauth1_token.json"), JSON.stringify(oauth1, null, 2));
  fs.writeFileSync(path.join(garthDir, "oauth2_token.json"), JSON.stringify(oauth2, null, 2));
  console.log(`\nTokens saved to ${garthDir}`);

  const bundle = { oauth1, oauth2 };
  const b64 = Buffer.from(JSON.stringify(bundle)).toString("base64");
  console.log("\n" + "=".repeat(50));
  console.log("GARMIN_TOKEN_B64 (paste into /settings):");
  console.log("=".repeat(50));
  console.log(b64);
  console.log("=".repeat(50));
  console.log("\nAlso saved as JSON bundle:");
  const bundlePath = path.join(garthDir, "garmin-token-bundle.json");
  fs.writeFileSync(bundlePath, JSON.stringify(bundle, null, 2));
  console.log(bundlePath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
