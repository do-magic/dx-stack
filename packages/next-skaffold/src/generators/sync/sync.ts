import { createSkaffoldSyncGenerator } from '@dxs/skaffold';
import { nextJsAdapter } from '../../lib/next-adapter.ts';

export const syncGenerator = createSkaffoldSyncGenerator([nextJsAdapter]);

export default syncGenerator;
