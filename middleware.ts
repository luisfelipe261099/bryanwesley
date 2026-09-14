import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession, type Role } from "@/lib/auth/session";

// Cada área e quem pode entrar nela.
const GUARDED: { prefix: string; roles: Role[] }[] = [
  { prefix: "/admin", roles: ["ADMIN"] },
  { prefix: "/barbeiro", roles: ["BARBER", "ADMIN"] },
  { prefix: "/cliente", roles: ["CLIENT", "ADMIN"] },
  { prefix: "/conta", roles: ["ADMIN", "BARBER", "CLIENT"] },
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const guard = GUARDED.find(
    (g) => pathname === g.prefix || pathname.startsWith(`${g.prefix}/`)
  );
  if (!guard) return NextResponse.next();

  // Server Action (POST com o header next-action): deixa passar. Cada
  // action confere a sessão por conta própria (requireRole) e, se faltar,
  // lança o redirect() que o router do Next entende e executa na tela.
  // Um 307 daqui seria seguido pelo fetch do navegador até o HTML do
  // login — a action nunca responderia e a tela ficaria muda.
  // A página protegida precisa saber o próprio caminho para, se a sessão
  // cair, mandar de volta para ela depois do login (Server Components não
  // enxergam a URL). Vai num header interno da requisição.
  const forwarded = new Headers(req.headers);
  forwarded.set("x-pathname", pathname + req.nextUrl.search);
  const next = () => NextResponse.next({ request: { headers: forwarded } });

  if (req.method === "POST" && req.headers.get("next-action")) {
    return next();
  }

  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);

  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = "/entrar";
    url.search = `?proximo=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  if (!guard.roles.includes(session.role)) {
    const url = req.nextUrl.clone();
    url.pathname = "/entrar";
    url.search = "?erro=sem-permissao";
    return NextResponse.redirect(url);
  }

  return next();
}

export const config = {
  matcher: ["/admin/:path*", "/barbeiro/:path*", "/cliente/:path*", "/conta/:path*"],
};
