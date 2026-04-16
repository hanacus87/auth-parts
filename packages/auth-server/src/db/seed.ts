import { db } from "./index";
import { clients, users } from "./schema";
import { ulid } from "ulid";

async function seed() {
  // Confidential client（BFF App Server）
  // token_endpoint_auth_method = "client_secret_basic" + PKCE
  await db
    .insert(clients)
    .values({
      id: "bff-app",
      secret: "bff-app-secret",
      name: "BFF App Server",
      redirectUris: ["http://localhost:3000/auth/callback"],
      allowedScopes: ["openid", "profile", "email", "offline_access"],
      tokenEndpointAuthMethod: "client_secret_basic",
      allowedGrantTypes: ["authorization_code", "refresh_token"],
      backchannelLogoutUri: "http://localhost:3000/auth/backchannel-logout",
    })
    .onConflictDoUpdate({
      target: clients.id,
      set: { backchannelLogoutUri: "http://localhost:3000/auth/backchannel-logout" },
    });

  // Confidential client（BFF App Server Sub — SSO デモ用、profile スコープなし）
  await db
    .insert(clients)
    .values({
      id: "bff-sub",
      secret: "bff-sub-secret",
      name: "BFF App Server Sub",
      redirectUris: ["http://localhost:3001/auth/callback"],
      allowedScopes: ["openid", "email", "offline_access"],
      tokenEndpointAuthMethod: "client_secret_basic",
      allowedGrantTypes: ["authorization_code", "refresh_token"],
      backchannelLogoutUri: "http://localhost:3001/auth/backchannel-logout",
    })
    .onConflictDoUpdate({
      target: clients.id,
      set: { backchannelLogoutUri: "http://localhost:3001/auth/backchannel-logout" },
    });

  // テストユーザー
  await db
    .insert(users)
    .values({
      id: ulid(),
      email: "test@example.com",
      passwordHash: await Bun.password.hash("password123"),
      name: "Test User",
      givenName: "Test",
      familyName: "User",
    })
    .onConflictDoNothing();

  console.log("Seed completed");
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
