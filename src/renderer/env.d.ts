import type { CouncilApi } from '../shared/types.ts';

declare global {
  interface Window { council: CouncilApi }
}
