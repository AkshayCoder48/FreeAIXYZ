# How Dreemy issues `x-auth-token`

You **cannot** forge these JWTs. They are `HS384` (HMAC). Without the server secret, flipping `jti` / `sub` / `exp` just fails signature check.

What you *can* do is the same path the website uses for every anonymous visitor: **create a guest, then exchange it for an `idToken`.**

## Official mint flow

```
1. POST /api/auth/createGuest     →  guestUid + guestKey
2. POST /api/auth/loginByGuest    →  data.idToken  (= x-auth-token)
3. GET  /api/auth/getAccount      →  account + integral
```

`x-finger` is a FingerprintJS `visitorId` stored as `localStorage["x-finger"]`. The server accepted an arbitrary 32-hex string. It is **not** a signing input.

### 1. Create guest

```http
POST https://www.dreemy.ai/api/auth/createGuest
Accept: application/json
Content-Type: application/json
x-platform: web
x-version: 999.0.0
x-language: en
x-finger: <32-hex>
```

Empty JSON body is fine.

```json
{
  "code": "200",
  "data": {
    "guestUid": "9ac8250f-f925-4839-865c-c0897dbd1988",
    "guestKey": "$2a$10$QkL/luwpsg2jyV02y6.bSu28WaJEPvuWsNNDX3lcR65p2US8clJrO"
  },
  "msg": "操作成功"
}
```

`guestKey` is a bcrypt hash. Treat it like a password. The web app persists both in localStorage (`STORE_GUEST_UID_KEY` / `STORE_GUEST_KEY_KEY`).

### 2. Exchange for JWT

```http
POST https://www.dreemy.ai/api/auth/loginByGuest
Content-Type: application/json
x-platform: web
x-version: 999.0.0
x-language: en
x-finger: <same 32-hex>

{"guestUid":"<uid>","guestKey":"<key>"}
```

```json
{
  "code": "200",
  "data": {
    "idToken": "eyJhbGciOiJIUzM4NCJ9...."
  }
}
```

Decoded payload of the token minted in this test:

```json
{
  "jti": "11412500",
  "sub": "9ac8250f-f925-4839-865c-c0897dbd1988",
  "auth": "",
  "exp": 1789122661
}
```

`sub` == `guestUid`. `jti` == numeric account id. `exp` ≈ 30 days out (2026-09-11). Put `idToken` in `x-auth-token`.

### 3. Confirm account

`GET /api/auth/getAccount` on that token:

| field | value |
|---|---|
| id | 11412500 |
| uid / username | 9ac8250f-f925-4839-865c-c0897dbd1988 |
| isGuest | true |
| nickname | Guest |
| **integral** | **100** |
| canAccessVip | false |
| createBotWeeklyLimit | 2 |

`GET /api/auth/getAccountIntegral` → `100`.  
At 20 integral per 2K image, a fresh guest can create **5** images before it hits the same `-1` you saw.

## Other issuers (same JWT shape)

From the client bundle (`AuthControllerApi`):

| endpoint | when |
|---|---|
| `POST /api/auth/createGuest` | first visit, no localStorage guest |
| `POST /api/auth/loginByGuest` | every session after that |
| `POST /api/auth/login` | email/password |
| `POST /api/auth/loginByGoogle` | Google `idToken` / `code` |
| `POST /api/auth/loginByApple` | Apple `idToken` |
| `POST /api/auth/regSubmit` + `confirmReg` | email register |

There is **no** client-side refresh that mints a new `jti` for the same user. Re-calling `loginByGuest` with the same `guestUid`/`guestKey` just re-issues a JWT for **that** account.

## What this is not

- Not a JWT forge. Secret never leaves the server.
- Not a new quota bucket for an existing account. Limits follow `sub` / `jti`.
- Not a reason to mass-create guests to dodge image credits. That is multi-accounting / ToS abuse and I will not farm tokens.

Verified live 2026-08-12. Raw response: `dreemy_token_mint.json`.
