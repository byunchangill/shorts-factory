import { Router, type RequestHandler, type Router as ExpressRouter } from 'express';

/**
 * async 라우트의 예외를 에러 핸들러로 넘기는 Router.
 *
 * Express 4는 핸들러가 돌려준 프로미스를 보지 않는다. `async (req, res) => { ... }` 안에서
 * 던진 예외(예: zod parse 실패)는 next()로 가지 않고 **unhandledRejection**이 되고,
 * 응답은 영원히 오지 않는다 — 화면은 "저장 중"에서 멈추고 서버 로그에만 스택이 찍힌다.
 * (실제로 PUT /keys/google-oauth 가 이렇게 죽었다)
 *
 * 그래서 라우트 파일은 `Router()` 대신 항상 이걸 쓴다.
 */

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'all'] as const;

function wrap(handler: unknown): unknown {
  if (typeof handler !== 'function') return handler; // 경로 문자열·정규식·배열
  const fn = handler as RequestHandler;
  const wrapped: RequestHandler = (req, res, next) => {
    try {
      const out = (fn as (...a: unknown[]) => unknown)(req, res, next);
      if (out && typeof (out as Promise<unknown>).catch === 'function') {
        (out as Promise<unknown>).catch(next);
      }
    } catch (e) {
      next(e);
    }
  };
  return wrapped;
}

export function asyncRouter(): ExpressRouter {
  const router = Router();
  for (const method of METHODS) {
    const original = (router[method] as (...args: unknown[]) => unknown).bind(router);
    // 배열로 넘긴 핸들러도 감싼다
    (router as unknown as Record<string, unknown>)[method] = (...args: unknown[]) =>
      original(...args.map((a) => (Array.isArray(a) ? a.map(wrap) : wrap(a))));
  }
  return router;
}
