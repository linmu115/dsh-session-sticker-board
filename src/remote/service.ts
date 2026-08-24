import type { Context } from "@deepseek-ai/cordis";
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";

import { normalizeBridgeOrigin } from "../bridge/http-client.ts";

export class StickerBoardRemoteService extends TypertRemoteService {
  readonly origin: string;

  constructor(ctx: Context, origin: string) {
    super(ctx, "stickerBoard");
    this.origin = normalizeBridgeOrigin(origin);
  }

  getBridgeConfig(_agent: unknown): { origin: string } {
    return { origin: this.origin };
  }
}
