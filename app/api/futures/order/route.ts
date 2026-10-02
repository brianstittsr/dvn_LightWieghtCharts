import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  credsFor,
  projectxCancelOrder,
  projectxCloseContract,
  projectxOpenOrders,
  projectxOpenPositions,
  projectxPlaceOrder,
  PX_ORDER_TYPE,
  PX_SIDE,
} from "@/lib/platforms/projectx";

const base = z.object({
  platform: z.enum(["topstep", "apex"]),
  accountId: z.number().int().positive(),
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
  const creds = credsFor(body.platform);
  if (!creds) {
    return NextResponse.json(
      { error: `${body.platform} credentials are not configured` },
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
          accountId: body.accountId,
          contractId: body.contractId,
          type: TYPE_MAP[body.type],
          side: body.side === "buy" ? PX_SIDE.Buy : PX_SIDE.Sell,
          size: body.size,
          limitPrice: body.limitPrice,
          takeProfitTicks: body.tpTicks,
          stopLossTicks: body.slTicks,
          customTag: "lwc-dashboard",
        });
        return NextResponse.json({ data: { orderId } });
      }

      case "close": {
        if (!body.contractId) return NextResponse.json({ error: "contractId required" }, { status: 400 });
        await projectxCloseContract(creds, body.accountId, body.contractId);
        return NextResponse.json({ data: { ok: true } });
      }

      case "reverse": {
        if (!body.contractId) return NextResponse.json({ error: "contractId required" }, { status: 400 });
        const pos = (await projectxOpenPositions(creds, body.accountId)).find(
          (p) => p.contractId === body.contractId,
        );
        if (!pos) return NextResponse.json({ error: "No open position on this contract" }, { status: 404 });
        await projectxCloseContract(creds, body.accountId, body.contractId);
        const { orderId } = await projectxPlaceOrder(creds, {
          accountId: body.accountId,
          contractId: body.contractId,
          type: PX_ORDER_TYPE.Market,
          side: pos.type === 1 ? PX_SIDE.Sell : PX_SIDE.Buy,
          size: pos.size,
          customTag: "lwc-reverse",
        });
        return NextResponse.json({ data: { orderId } });
      }

      case "cancelContract": {
        if (!body.contractId) return NextResponse.json({ error: "contractId required" }, { status: 400 });
        const orders = (await projectxOpenOrders(creds, body.accountId)).filter(
          (o) => o.contractId === body.contractId,
        );
        await Promise.all(orders.map((o) => projectxCancelOrder(creds, body.accountId, o.id)));
        return NextResponse.json({ data: { cancelled: orders.length } });
      }

      case "cancelAll": {
        const orders = await projectxOpenOrders(creds, body.accountId);
        await Promise.all(orders.map((o) => projectxCancelOrder(creds, body.accountId, o.id)));
        return NextResponse.json({ data: { cancelled: orders.length } });
      }

      case "flattenAll": {
        const positions = await projectxOpenPositions(creds, body.accountId);
        const orders = await projectxOpenOrders(creds, body.accountId);
        await Promise.all([
          ...positions.map((p) => projectxCloseContract(creds, body.accountId, p.contractId)),
          ...orders.map((o) => projectxCancelOrder(creds, body.accountId, o.id)),
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
