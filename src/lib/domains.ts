/**
 * The two hostnames this deployment answers on, and which one is the product.
 *
 * Split out of `proxy.ts` because it stopped being only a routing concern.
 * `auth-origins.ts` needs to know where the application lives too, and for a
 * reason worth stating: **the Vercel production domain is now the marketing
 * domain.** Before the split, "the project's production domain" and "where the
 * app answers" were the same string, and `auth-origins.ts` was written on that
 * assumption. They are now different hosts, and the assumption silently became
 * wrong — Better Auth resolved `baseURL` to `theforseti.ai` and refused every
 * sign-in arriving from `demo.theforseti.ai` with `Invalid origin`, naming the
 * application domain, which is the one part that was right.
 *
 * Constants rather than environment variables. There is one marketing domain
 * and one application domain, both bought on purpose. A dashboard variable
 * would move a routing decision somewhere no reader of `proxy.ts` would look,
 * and an unset value would silently serve the application at the marketing
 * domain — which is the failure this file exists to make unrepresentable.
 */

/** The marketing domain. Serves one page and forwards everything else. */
export const LANDING_HOST = "theforseti.ai";

/**
 * The application's origin, and the only one it is served from.
 *
 * Note that this is a subdomain *of* `LANDING_HOST`, so it ends with it. Every
 * comparison against either must be equality — a suffix or substring test
 * matches the application on every request and serves it the marketing page.
 */
export const APP_ORIGIN = "https://demo.theforseti.ai";

/**
 * The landing page, as a static asset in `public/`.
 *
 * One self-contained document — its own `<head>`, its own styles, no relative
 * assets — so it is served as authored rather than ported into a route group.
 * `/` on the marketing host *rewrites* to it: the visitor's URL stays the bare
 * domain, and the filename never appears in a share or a link.
 */
export const LANDING_ASSET = "/landing.html";
