// A generic list/get/create/update/delete for simple workspace resources that
// publish `<resource>.created|updated|deleted` events.

import type { WsData } from "../db";
import { publish } from "../gateway";
import { del, get, notFound, paginate, patch, post, respond, type Ctx } from "../router";
import { uuid } from "../util";

type Row = { id: string };

export function crud<R extends Row>(opts: {
  path: string;
  resource: string;
  list: (ws: WsData) => R[];
  create: (ctx: Ctx, id: string) => R;
  update: (ctx: Ctx, row: R) => void;
  filter?: (ctx: Ctx, rows: R[]) => R[];
  sort?: (a: R, b: R) => number;
  beforeDelete?: (ctx: Ctx, row: R) => void;
  label?: string;
}) {
  const label = opts.label ?? opts.resource.replace(/_/g, " ");
  const find = (ctx: Ctx) => {
    const row = opts.list(ctx.ws).find((x) => x.id === ctx.params.id);
    if (!row) throw notFound(label[0].toUpperCase() + label.slice(1));
    return row;
  };

  get(opts.path, (ctx) => {
    let rows = opts.list(ctx.ws);
    if (opts.filter) rows = opts.filter(ctx, rows);
    if (opts.sort) rows = rows.slice().sort(opts.sort);
    return paginate(ctx, rows, 100);
  });
  get(`${opts.path}/:id`, (ctx) => find(ctx));
  post(opts.path, (ctx) => {
    const row = opts.create(ctx, uuid());
    opts.list(ctx.ws).push(row);
    publish(ctx.ws, `${opts.resource}.created`, { [opts.resource]: row });
    return respond(201, row);
  });
  patch(`${opts.path}/:id`, (ctx) => {
    const row = find(ctx);
    opts.update(ctx, row);
    publish(ctx.ws, `${opts.resource}.updated`, { [opts.resource]: row });
    return row;
  });
  del(`${opts.path}/:id`, (ctx) => {
    const row = find(ctx);
    opts.beforeDelete?.(ctx, row);
    const list = opts.list(ctx.ws);
    list.splice(list.indexOf(row), 1);
    publish(ctx.ws, `${opts.resource}.deleted`, { [`${opts.resource}_id`]: row.id });
    return respond(204);
  });
}

/** Copy known keys from the body onto a row when present and of the right type. */
export function assign<R extends object>(row: R, body: Record<string, unknown>, keys: (keyof R & string)[]) {
  const target = row as Record<string, unknown>;
  for (const k of keys) {
    if (!(k in body)) continue;
    const v = body[k];
    const cur = target[k];
    if (cur === null || cur === undefined || typeof cur === typeof v || v === null) target[k] = v;
  }
}
