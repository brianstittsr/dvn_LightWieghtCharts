import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  userCredsFor,
  projectxCancelOrder,
  projectxCloseContract,
  projectxOpenOrders,
  projectxOpenPositions,
  projectxPlaceOrder,
  uniqueTag,
  PX_ORDER_TYPE,
  PX_SIDE,
} from "@/lib/platforms/projectx";
import { verifyUser } from "@/lib/server-auth";

const base = z.object({
  platform: z.enum(["topstep", "apex"]),
  /** Optional — falls back to the account id pinned on the linked record/env. */
  accountId: z.number().int().positive().optional(),
});

const placeSchema = base.extend({
  action: z.literal("place"),
  contractId: z.string().min(1),
  side: z.enum(["buy", "sell"]),
  size: z.number().int().min(1).max(500),
  type: z.enum(["market", "limit", "joinBid", "joinAsk"]),
  limitPrice: z.number().positive().optional(),
  tpTicks: z.number().int().min(1).max(10000).optional(),
  slTicks: z.number().int().min(1).max(10000).optional(),
});

const manageSchema = base.extend({
  action: z.enum(["close", "reverse", "cancelContract", "flattenAll", "cancelAll"]),
  contractId: z.string().min(1).optional(),
});

const bodySchema = z.discriminatedUnion("action", [placeSchema, manageSchema]);

const TYPE_MAP = {
  market: PX_ORDER_TYPE.Market,
  limit: PX_ORDER_TYPE.Limit,
  joinBid: PX_ORDER_TYPE.JoinBid,
  joinAsk: PX_ORDER_TYPE.JoinAsk,
} as const;

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }
  const body = parsed.data;
  const resolved = await userCredsFor(body.platform, await verifyUser(req));
  if (!resolved) {
    return NextResponse.json(
      {
        error: `No ${body.platform} account linked to your login — add one in Admin → Trading accounts (API key field = platform username, secret = API key)`,
      },
      { status: 400 },
    );
  }
  const creds = resolved.creds;
  const accountId = parsed.data.accountId ?? resolved.accountId;
  if (!accountId) {
    return NextResponse.json(
      { error: "accountId required — none provided and none pinned on the linked account" },
      { status: 400 },
    );
  }

  try {
    switch (body.action) {
      case "place": {
        if (body.type === "limit" && body.limitPrice == null) {
          return NextResponse.json(
            { error: "limitPrice required for limit orders" },
            { status: 400 },
          );
        }
        const { orderId } = await projectxPlaceOrder(creds, {
          accountId: accountId,
          contractId: body.contractId,
          type: TYPE_MAP[body.type],
          side: body.side === "buy" ? PX_SIDE.Buy : PX_SIDE.Sell,
          size: body.size,
          limitPrice: body.limitPrice,
          takeProfitTicks: body.tpTicks,
          stopLossTicks: body.slTicks,
          customTag: uniqueTag("lwc-order"),
        });
        return NextResponse.json({ data: { orderId } });
      }

      case "close": {
        if (!body.contractId) return NextResponse.json({ error: "contractId required" }, { status: 400 });
        await projectxCloseContract(creds, accountId, body.contractId);
        return NextResponse.json({ data: { ok: true } });
      }

      case "reverse": {
        if (!body.contractId) return NextResponse.json({ error: "contractId required" }, { status: 400 });
        const pos = (await projectxOpenPositions(creds, accountId)).find(
          (p) => p.contractId === body.contractId,
        );
        if (!pos) return NextResponse.json({ error: "No open position on this contract" }, { status: 404 });
        await projectxCloseContract(creds, accountId, body.contractId);
        const { orderId } = await projectxPlaceOrder(creds, {
          accountId: accountId,
          contractId: body.contractId,
          type: PX_ORDER_TYPE.Market,
          side: pos.type === 1 ? PX_SIDE.Sell : PX_SIDE.Buy,
          size: pos.size,
          customTag: uniqueTag("lwc-reverse"),
        });
        return NextResponse.json({ data: { orderId } });
      }

      case "cancelContract": {
        if (!body.contractId) return NextResponse.json({ error: "contractId required" }, { status: 400 });
        const orders = (await projectxOpenOrders(creds, accountId)).filter(
          (o) => o.contractId === body.contractId,
        );
        await Promise.all(orders.map((o) => projectxCancelOrder(creds, accountId, o.id)));
        return NextResponse.json({ data: { cancelled: orders.length } });
      }

      case "cancelAll": {
        const orders = await projectxOpenOrders(creds, accountId);
        await Promise.all(orders.map((o) => projectxCancelOrder(creds, accountId, o.id)));
        return NextResponse.json({ data: { cancelled: orders.length } });
      }

      case "flattenAll": {
        const positions = await projectxOpenPositions(creds, accountId);
        const orders = await projectxOpenOrders(creds, accountId);
        await Promise.all([
          ...positions.map((p) => projectxCloseContract(creds, accountId, p.contractId)),
          ...orders.map((o) => projectxCancelOrder(creds, accountId, o.id)),
        ]);
        return NextResponse.json({
          data: { closed: positions.length, cancelled: orders.length },
        });
      }
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Futures API error" },
      { status: 502 },
    );
  }
}
