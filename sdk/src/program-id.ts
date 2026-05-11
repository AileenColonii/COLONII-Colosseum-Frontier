/**
 * Default program ID, isolated from `client.ts` so it can be imported
 * without dragging Anchor into the bundle. The browser entry point
 * (`./browser`) imports from here.
 */

import { PublicKey } from '@solana/web3.js';

export const DEFAULT_PROGRAM_ID = new PublicKey(
  'E8K8WUxSjEgQAArjT4NkpDxrri59b3SNLVmDCU3yyCCG',
);
