# Connecting MetaFlow AI to Meta (Facebook and Instagram)

The code for connecting Facebook Pages and Instagram professional accounts is built and tested against simulated Meta responses. **It has not been run against the real Meta platform yet**, because that needs a Meta app, which only the owner can create. This page lists what to do and what to expect.

Until these steps are done, the app works normally and the Social Accounts page says that connecting is not available yet.

## 1. Create the Meta app

1. Go to <https://developers.facebook.com/apps> and create an app (type **Business**).
2. Add the **Facebook Login for Business** product (or **Facebook Login**).
3. Under the login product's settings, add this to **Valid OAuth Redirect URIs**:
   - Local development: `http://localhost:3000/api/social/meta/callback`
   - Production: `https://<your app domain>/api/social/meta/callback`

   Meta requires HTTPS for everything except `localhost`.

4. From **App settings → Basic**, copy the **App ID** and **App secret**.

## 2. Configure the backend

Add four values to `backend/.env` locally (and to Render in production). Never commit them.

| Variable                       | Value                                                                   |
| ------------------------------ | ----------------------------------------------------------------------- |
| `META_APP_ID`                  | The numeric App ID                                                      |
| `META_APP_SECRET`              | The App secret                                                          |
| `META_REDIRECT_URI`            | Exactly the redirect URI registered in step 1.3                         |
| `SOCIAL_TOKEN_ENCRYPTION_KEYS` | A new random key (see below)                                            |
| `META_GRAPH_API_VERSION`       | Optional. Defaults to `v27.0`, the version the code was written against |

Generate an encryption key (32 random bytes, base64):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

All four are required together. If only some are set, the backend refuses to start and names the missing variable, so tokens can never be stored without encryption.

Restart the backend. Its startup log line shows `socialConnectionConfigured: true`.

**Keep the encryption key safe.** If it is lost, every connected account has to be reconnected. To rotate it, put the new key first and keep the old one after a comma: `SOCIAL_TOKEN_ENCRYPTION_KEYS=<new>,<old>`.

## 3. Test with your own accounts

While the Meta app is in **development mode**, only people with a role on the app (admin, developer, tester) can connect, and only to Pages they manage. That is enough for testing.

1. Sign in to MetaFlow AI as a workspace owner and open **Social Accounts**.
2. Choose **Connect Facebook Pages**, sign in on Facebook, and select at least one Page.
3. You should return to Social Accounts with the Page listed as **Connected**.
4. For Instagram: the account must be a **Business or Creator** account **linked to a Facebook Page** you manage. Choose **Connect Instagram accounts** and select that Page.

Please report anything that differs from this; the first real run is the first real test.

## 4. Before real customers can connect

Meta only lets other people use the app after **App Review** and **Business Verification**. These permissions need **Advanced Access**:

| Permission                  | Used for                                         |
| --------------------------- | ------------------------------------------------ |
| `pages_show_list`           | Listing the Pages a person manages               |
| `pages_read_engagement`     | Reading Page details; required for Instagram too |
| `pages_manage_posts`        | Publishing to Facebook Pages                     |
| `instagram_basic`           | Reading the linked Instagram account             |
| `instagram_content_publish` | Publishing to Instagram                          |

Review needs a privacy policy URL, a data deletion procedure, and screen recordings of each permission in use, so it can only be submitted once publishing works end to end. Plan for it to take days to weeks.

## What the integration does and stores

- **Stored per connected account:** Meta's ID for the Page or Instagram account, its name, username and picture URL, the permissions granted, and the **Page access token**, encrypted with AES-256-GCM.
- **Not stored:** Facebook passwords (MetaFlow AI never sees them) and the personal user access token, which is used once to list Pages and then discarded.
- **Disconnecting** deletes the stored token and the connection in MetaFlow AI. It does not remove MetaFlow AI from the person's Facebook settings; they can do that under Facebook → Settings → Business integrations.

## Known limits

- Meta's token exchange endpoints are documented as GET requests with the app secret and code in the query string. They are sent that way, server to server over HTTPS, and are never logged. All other calls send tokens in the `Authorization` header.
- If a person manages a Page only through Business Manager, Meta may additionally require `ads_management` or `business_management` for Instagram. This is not requested yet and will be decided after the first real test.
- Up to 500 Pages are read per authorization.
